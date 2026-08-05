import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { AccountType } from "@compass/shared";
import { loadConfig } from "../../../config.ts";
import { createPool } from "../../../infra/db.ts";
import { createRedis } from "../../../infra/redis.ts";
import { createDb } from "../../../db/index.ts";
import { setupAuth, SESSION_COOKIE } from "../../../plugins/auth.ts";
import { setupSecurity, _test as securityTest } from "../../../plugins/security.ts";
import { ingestRoutes } from "../plugin.ts";
import { createSession, destroySession } from "../../../modules/system/services/session.ts";
import { EventBus, type EventMap } from "../../../lib/event-bus.ts";
import { users } from "../../../db/core-schema.ts";
import { accounts, transactions } from "../../../db/schema.ts";
import { emailIngestions, extractedTransactions, importRows, imports } from "../schema.ts";

// Task 017 (roadmap 1.7) iteration 2 — test-only closure of the two
// TEST-COVERAGE gaps Codex review-2 found in the ingest module migration
// (see tasks/017-migrate-ingest/TASK.md "Codex review-2 disposition" and
// "Verification (test iteration 2)"):
//   G1 (AC7 encapsulation-security): 401 unauth, demo-write 403 + no
//   mutation, hostile-Origin CSRF 403, no route carries `config.public`, and
//   READ/WRITE rate-limit bucket classification — all asserted against
//   routes served through the encapsulated `ingestRoutes` plugin, not a bare
//   route.
//   G2 (AC5 emit-survives-encapsulation): at least one route-level test
//   drives a REAL successful ingest mutation through the encapsulated
//   `ingestRoutes` plugin and asserts `ledger.mutated` fired on
//   `app.eventBus` — the runtime proof the byte-identity check alone can't
//   give.
//
// Harness mirrors modules/planning/routes/planning.route.test.ts's
// buildTestApp() convention (also modules/ledger/routes/ledger-events.route.test.ts
// for the eventBus decoration + queueMicrotask-dispatch polling pattern):
// real Postgres + Redis, the zod validator/serializer compilers,
// config/pg/db/redis decorations, setupAuth + setupSecurity, then registers
// the WHOLE `ingestRoutes` plugin (not a single route file) — deliberately
// NOT buildApp()/startJobs() from app.ts, which also boots BullMQ against the
// shared dev Redis and never closes its "ingestor" queue connection, hanging
// `node --test`.
//
// Needs a real Postgres + Redis connection (DATABASE_URL, REDIS_URL,
// SESSION_SECRET) — export them (see apps/api/.env) before running
// `npm run test -w apps/api`.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `ingest.route.test.ts needs ${name} set (a real Postgres/Redis-backed app boot) — ` +
        "export it (see apps/api/.env) before running `npm run test -w apps/api`.",
    );
  }
  return value;
}
requireEnv("DATABASE_URL");
requireEnv("REDIS_URL");
requireEnv("SESSION_SECRET");

type RouteEntry = { method: string; url: string; configPublic: boolean | undefined };

function flattenMethods(method: string | string[]): string[] {
  return (Array.isArray(method) ? method : [method]).map((m) => m.toUpperCase());
}

async function buildTestApp(): Promise<{ app: FastifyInstance; routeEntries: RouteEntry[] }> {
  const config = loadConfig();
  const app = Fastify({ logger: false, trustProxy: true });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("config", config);
  app.decorate("pg", createPool(config.DATABASE_URL));
  app.decorate("db", createDb(app.pg));
  app.decorate("redis", createRedis(config.REDIS_URL));
  // Needed because inbox/imports route handlers call app.eventBus.emit(...)
  // directly (G2) — see ledger-events.route.test.ts for the same decoration.
  app.decorate("eventBus", new EventBus({ error: () => {} }));
  await setupAuth(app);
  await setupSecurity(app);

  // G1.4: collect every route registered from here on (i.e. everything
  // ingestRoutes registers) so we can assert none carries config.public,
  // via Fastify's own onRoute hook — the same introspection technique
  // app.route-snapshot.test.ts uses for the canonical route-surface gate.
  const routeEntries: RouteEntry[] = [];
  app.addHook("onRoute", (routeOptions) => {
    for (const method of flattenMethods(routeOptions.method)) {
      routeEntries.push({
        method,
        url: routeOptions.url,
        configPublic: (routeOptions.config as { public?: boolean } | undefined)?.public,
      });
    }
  });

  await app.register(ingestRoutes);
  app.addHook("onClose", async () => {
    await app.pg.end();
    app.redis.disconnect();
  });
  return { app, routeEntries };
}

const { app, routeEntries } = await buildTestApp();
after(async () => {
  await app.close();
});

async function createUser(): Promise<string> {
  const [u] = await app.db
    .insert(users)
    .values({
      email: `ingest-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "ingest.route.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function createAccount(userId: string, type: AccountType = "bank"): Promise<string> {
  const [a] = await app.db
    .insert(accounts)
    .values({ userId, name: `Test ${type}`, type, openingBalancePaise: 0 })
    .returning({ id: accounts.id });
  return a!.id;
}

async function createIngestion(userId: string): Promise<string> {
  const [i] = await app.db
    .insert(emailIngestions)
    .values({
      userId,
      messageId: `ingest-route-test-${randomUUID()}`,
      fromAddr: "alerts@bank.example",
      subject: "Transaction alert",
      raw: "raw",
      status: "extracted",
    })
    .returning({ id: emailIngestions.id });
  return i!.id;
}

type DraftOverrides = Partial<{
  amountPaise: number;
  direction: "debit" | "credit";
  occurredAt: string | null;
}>;

async function createDraft(userId: string, ingestionId: string, over: DraftOverrides = {}): Promise<string> {
  const [d] = await app.db
    .insert(extractedTransactions)
    .values({
      userId,
      ingestionId,
      amountPaise: over.amountPaise ?? 100000,
      direction: over.direction ?? "debit",
      occurredAt: over.occurredAt === undefined ? "2026-01-05" : over.occurredAt,
      counterparty: "Test Merchant",
      sourceQuote: "",
      confidence: 0.9,
      dedupeHash: `ingest-route-test-${randomUUID()}`,
      status: "pending",
    })
    .returning({ id: extractedTransactions.id });
  return d!.id;
}

/** A generic "signed amount" mapping (mirrors imports.ts's BANK_PRESETS "Generic" preset). */
const GENERIC_MAPPING = {
  dateColumn: "Date",
  dateFormat: "YYYY-MM-DD" as const,
  amountMode: "signed" as const,
  amountColumn: "Amount",
  invertSign: false,
  merchantColumn: "Description",
};

/** A staged import batch with one committable row, seeded directly (bypassing the multipart upload/mapping routes, same fixture-depth convention as inbox.test.ts's createDraft). */
async function createStagedImport(userId: string, accountId: string): Promise<string> {
  const [batch] = await app.db
    .insert(imports)
    .values({
      userId,
      accountId,
      fileName: "ingest-route-test.csv",
      status: "staged",
      mapping: GENERIC_MAPPING,
      headers: ["Date", "Amount", "Description"],
      rowCount: 1,
      errorCount: 0,
    })
    .returning({ id: imports.id });
  const importId = batch!.id;
  await app.db.insert(importRows).values({
    importId,
    rowIndex: 0,
    raw: { Date: "2026-01-05", Amount: "500.00", Description: "Test Merchant" },
    date: "2026-01-05",
    amountPaise: 50000,
    merchant: "Test Merchant",
    rawMerchant: "Test Merchant",
    notes: "",
    duplicate: false,
    include: true,
    error: null,
  });
  return importId;
}

async function cleanupUser(userId: string): Promise<void> {
  await app.db.delete(extractedTransactions).where(eq(extractedTransactions.userId, userId));
  await app.db.delete(emailIngestions).where(eq(emailIngestions.userId, userId));
  await app.db.delete(transactions).where(eq(transactions.userId, userId));
  await app.db.delete(imports).where(eq(imports.userId, userId)); // cascades import_rows
  await app.db.delete(accounts).where(eq(accounts.userId, userId));
  await app.db.delete(users).where(eq(users.id, userId));
}

/** A `cookies` map for `app.inject()`, carrying a signed session cookie. */
function sessionCookie(sessionId: string): Record<string, string> {
  return { [SESSION_COOKIE]: app.signCookie(sessionId) };
}

/** A generic accept body, valid per AcceptExtractedTxnSchema. */
function acceptBody(accountId: string) {
  return {
    accountId,
    occurredAt: "2026-01-05",
    amountPaise: 100000,
    direction: "debit" as const,
    merchant: "Test Merchant",
    categoryId: null,
  };
}

type LedgerMutatedEntry = EventMap["ledger.mutated"];

/** Poll `observed` until it gains an entry, or give up after `timeoutMs` — EventBus.emit() is
 * queueMicrotask-dispatched (lib/event-bus.ts), so never assert immediately after inject() returns. */
async function pollForEntry(
  observed: LedgerMutatedEntry[],
  timeoutMs = 500,
  intervalMs = 10,
): Promise<LedgerMutatedEntry | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (observed.length > 0) return observed[0];
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// ---------- G1 (AC7): encapsulation security ----------

test("G1.1: an unauthenticated POST /api/inbox/:id/accept is rejected 401", async () => {
  const res = await app.inject({
    method: "POST",
    url: `/api/inbox/${randomUUID()}/accept`,
    payload: acceptBody(randomUUID()),
  });
  assert.equal(res.statusCode, 401, res.body);
});

test("G1.1b: an unauthenticated GET /api/inbox (read route) is also rejected 401", async () => {
  const res = await app.inject({ method: "GET", url: "/api/inbox" });
  assert.equal(res.statusCode, 401, res.body);
});

test("G1.2: a demo session's POST /api/inbox/:id/accept is rejected 403, leaving an otherwise-acceptable pending draft unmutated and no ledger transaction written", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, { demo: true });
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const accountId = await createAccount(userId);
  const ingestionId = await createIngestion(userId);
  const draftId = await createDraft(userId, ingestionId);

  const [before] = await app.db
    .select()
    .from(extractedTransactions)
    .where(eq(extractedTransactions.id, draftId));
  assert.equal(before!.status, "pending", "precondition: seeded draft is pending");
  assert.equal(before!.transactionId, null, "precondition: seeded draft has no transactionId");
  const beforeTxns = await app.db.select().from(transactions).where(eq(transactions.userId, userId));
  assert.equal(beforeTxns.length, 0, "precondition: fresh user has no ledger transactions");

  const res = await app.inject({
    method: "POST",
    url: `/api/inbox/${draftId}/accept`,
    cookies: sessionCookie(sessionId),
    payload: acceptBody(accountId),
  });
  assert.equal(res.statusCode, 403, res.body);

  const [after] = await app.db
    .select()
    .from(extractedTransactions)
    .where(eq(extractedTransactions.id, draftId));
  assert.equal(after!.status, "pending", "a rejected demo request must not have mutated the draft's status");
  assert.equal(after!.transactionId, null, "a rejected demo request must not have set a transactionId");
  const afterTxns = await app.db.select().from(transactions).where(eq(transactions.userId, userId));
  assert.equal(afterTxns.length, 0, "a rejected demo request must not have written a ledger transaction");
});

test("G1.3: an authenticated non-demo POST /api/inbox/:id/accept with a hostile Origin is rejected 403 (CSRF)", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "POST",
    url: `/api/inbox/${randomUUID()}/accept`,
    cookies: sessionCookie(sessionId),
    headers: { origin: "https://evil.example" },
    payload: acceptBody(randomUUID()),
  });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(JSON.parse(res.body).error, "Forbidden");
});

test("G1.4: no ingest route carries config.public — every ingest route is behind auth", () => {
  assert.ok(routeEntries.length > 0, "expected the onRoute collector to have captured ingest routes");
  // Sanity: this collector really did see routes from all 3 internal files,
  // not just one (mirrors plugin.test.ts's EXPECTED_PAIRS coverage).
  assert.ok(routeEntries.some((r) => r.url.startsWith("/api/inbox")));
  assert.ok(routeEntries.some((r) => r.url.startsWith("/api/imports")));
  assert.ok(routeEntries.some((r) => r.url.startsWith("/api/mailboxes")));

  const publicRoutes = routeEntries.filter((r) => r.configPublic === true);
  assert.deepEqual(
    publicRoutes,
    [],
    `expected no ingest route to carry config.public, found: ${JSON.stringify(publicRoutes)}`,
  );
});

test("G1.5: bucketFor classifies GET ingest paths as read, POST ingest paths as write", () => {
  const req = (method: string, url: string): FastifyRequest => ({ method, url }) as FastifyRequest;
  assert.equal(securityTest.bucketFor(req("GET", "/api/inbox")).name, securityTest.READ_BUCKET.name);
  assert.equal(securityTest.bucketFor(req("GET", "/api/inbox/orphaned")).name, securityTest.READ_BUCKET.name);
  assert.equal(securityTest.bucketFor(req("GET", "/api/imports")).name, securityTest.READ_BUCKET.name);
  assert.equal(securityTest.bucketFor(req("GET", "/api/mailboxes")).name, securityTest.READ_BUCKET.name);
  assert.equal(
    securityTest.bucketFor(req("POST", `/api/inbox/${randomUUID()}/accept`)).name,
    securityTest.WRITE_BUCKET.name,
  );
  assert.equal(securityTest.bucketFor(req("POST", "/api/inbox/transfer")).name, securityTest.WRITE_BUCKET.name);
  assert.equal(securityTest.bucketFor(req("POST", "/api/imports")).name, securityTest.WRITE_BUCKET.name);
  assert.equal(securityTest.bucketFor(req("POST", "/api/mailboxes")).name, securityTest.WRITE_BUCKET.name);
});

// ---------- G2 (AC5): ledger.mutated survives encapsulation ----------
//
// All 5 emit sites are attempted below with real fixtures driven through the
// encapsulated ingestRoutes plugin — none needed disproportionate domain
// setup to reach a genuine success, so none is flagged/skipped.

test("G2.1 (inbox accept — the roadmap's named case): POST /api/inbox/:id/accept drives a real accept and emits ledger.mutated with the requesting user's id", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  const accountId = await createAccount(userId);
  const ingestionId = await createIngestion(userId);
  const draftId = await createDraft(userId, ingestionId);
  const observed: LedgerMutatedEntry[] = [];
  const unsubscribe = app.eventBus.on("ledger.mutated", (payload) => {
    observed.push(payload);
  });
  t.after(async () => {
    unsubscribe();
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "POST",
    url: `/api/inbox/${draftId}/accept`,
    cookies: sessionCookie(sessionId),
    payload: acceptBody(accountId),
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.status, "accepted");
  assert.ok(body.transactionId, "expected the accepted draft to carry a transactionId");

  const entry = await pollForEntry(observed);
  assert.ok(entry, "expected ledger.mutated to have been observed after a real accept");
  assert.equal(entry!.userId, userId);
});

test("G2.2 (inbox repayment): POST /api/inbox/:id/repayment drives a real repayment accept and emits ledger.mutated", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  const fromAccountId = await createAccount(userId, "bank");
  const cardAccountId = await createAccount(userId, "credit_card");
  const ingestionId = await createIngestion(userId);
  const draftId = await createDraft(userId, ingestionId, { direction: "credit", amountPaise: 75000 });
  const observed: LedgerMutatedEntry[] = [];
  const unsubscribe = app.eventBus.on("ledger.mutated", (payload) => {
    observed.push(payload);
  });
  t.after(async () => {
    unsubscribe();
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "POST",
    url: `/api/inbox/${draftId}/repayment`,
    cookies: sessionCookie(sessionId),
    payload: { cardAccountId, fromAccountId, occurredAt: "2026-01-05" },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.status, "accepted");
  assert.ok(body.transactionId, "expected the accepted repayment draft to carry a transactionId");

  const entry = await pollForEntry(observed);
  assert.ok(entry, "expected ledger.mutated to have been observed after a real repayment accept");
  assert.equal(entry!.userId, userId);
});

test("G2.3 (inbox transfer): POST /api/inbox/transfer drives a real paired transfer accept and emits ledger.mutated", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  const fromAccountId = await createAccount(userId, "bank");
  const toAccountId = await createAccount(userId, "bank");
  const ingestionId = await createIngestion(userId);
  const outId = await createDraft(userId, ingestionId, {
    direction: "debit",
    amountPaise: 60000,
    occurredAt: "2026-01-05",
  });
  const inId = await createDraft(userId, ingestionId, {
    direction: "credit",
    amountPaise: 60000,
    occurredAt: "2026-01-06",
  });
  const observed: LedgerMutatedEntry[] = [];
  const unsubscribe = app.eventBus.on("ledger.mutated", (payload) => {
    observed.push(payload);
  });
  t.after(async () => {
    unsubscribe();
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/inbox/transfer",
    cookies: sessionCookie(sessionId),
    payload: { outId, inId, fromAccountId, toAccountId, occurredAt: "2026-01-05" },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body) as Array<{ status: string; transactionId: string | null }>;
  assert.equal(body.length, 2);
  assert.ok(body.every((d) => d.status === "accepted" && d.transactionId));

  const entry = await pollForEntry(observed);
  assert.ok(entry, "expected ledger.mutated to have been observed after a real transfer accept");
  assert.equal(entry!.userId, userId);
});

test("G2.4 (import commit): POST /api/imports/:id/commit drives a real commit and emits ledger.mutated", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  const accountId = await createAccount(userId, "bank");
  const importId = await createStagedImport(userId, accountId);
  const observed: LedgerMutatedEntry[] = [];
  const unsubscribe = app.eventBus.on("ledger.mutated", (payload) => {
    observed.push(payload);
  });
  t.after(async () => {
    unsubscribe();
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "POST",
    url: `/api/imports/${importId}/commit`,
    cookies: sessionCookie(sessionId),
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.created, 1, "expected the one committable staged row to have been created");

  const entry = await pollForEntry(observed);
  assert.ok(entry, "expected ledger.mutated to have been observed after a real import commit");
  assert.equal(entry!.userId, userId);
});

test("G2.5 (import rollback): POST /api/imports/:id/rollback drives a real rollback of a committed import and emits ledger.mutated", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  const accountId = await createAccount(userId, "bank");
  const importId = await createStagedImport(userId, accountId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  // Precondition: commit first (not itself the assertion here — G2.4 already
  // proves commit's own emit) so there is a real committed import to roll back.
  const commitRes = await app.inject({
    method: "POST",
    url: `/api/imports/${importId}/commit`,
    cookies: sessionCookie(sessionId),
  });
  assert.equal(commitRes.statusCode, 200, commitRes.body);
  assert.equal(JSON.parse(commitRes.body).created, 1);

  const observed: LedgerMutatedEntry[] = [];
  const unsubscribe = app.eventBus.on("ledger.mutated", (payload) => {
    observed.push(payload);
  });
  try {
    const rollbackRes = await app.inject({
      method: "POST",
      url: `/api/imports/${importId}/rollback`,
      cookies: sessionCookie(sessionId),
    });
    assert.equal(rollbackRes.statusCode, 200, rollbackRes.body);
    assert.equal(JSON.parse(rollbackRes.body).removed, 1, "expected the one committed transaction to have been removed");

    const entry = await pollForEntry(observed);
    assert.ok(entry, "expected ledger.mutated to have been observed after a real import rollback");
    assert.equal(entry!.userId, userId);
  } finally {
    unsubscribe();
  }
});
