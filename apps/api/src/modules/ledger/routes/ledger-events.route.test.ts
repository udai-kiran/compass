import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { loadConfig } from "../../../config.ts";
import { createPool } from "../../../infra/db.ts";
import { createRedis } from "../../../infra/redis.ts";
import { createDb } from "../../../db/index.ts";
import { setupAuth, SESSION_COOKIE } from "../../../plugins/auth.ts";
import { setupSecurity } from "../../../plugins/security.ts";
import { transactionRoutes } from "./transactions.ts";
import { createSession, destroySession } from "../../../services/session.ts";
import { accounts, transactions } from "../schema.ts";
import { users } from "../../../db/schema.ts";
import { EventBus, type EventMap } from "../../../lib/event-bus.ts";

// Route-injection proof that transactionRoutes emits "ledger.mutated" itself
// (task 002-retire-url-regex-hook, P8b/P8c) — the replacement for the old
// URL-regex `onResponse` hook. This does NOT need `registerLedgerCacheSubscriber`
// or BullMQ: app.test.ts's subscriber-isolation test already proves the
// subscriber's own effects; this test's job is only to prove the route emits.
//
// Built the same way as user-tasks.route.test.ts — real Postgres/Redis,
// setupAuth/setupSecurity, no buildApp()/startJobs() (see that file's own
// comment for why: startJobs does unscoped global boot work and leaks an
// ingestor queue connection that keeps `node --test` alive).
//
// EventBus.emit() is queueMicrotask-dispatched (lib/event-bus.ts), so every
// assertion below is a bounded poll of the observer's recorded list, never an
// immediate check after the HTTP response returns.
//
// Needs a real Postgres + Redis connection (DATABASE_URL, REDIS_URL,
// SESSION_SECRET) — export them (see apps/api/.env) before running
// `npm run test -w apps/api`.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `ledger-events.route.test.ts needs ${name} set (a real Postgres/Redis-backed app boot) — ` +
        "export it (see apps/api/.env) before running `npm run test -w apps/api`.",
    );
  }
  return value;
}
requireEnv("DATABASE_URL");
requireEnv("REDIS_URL");
requireEnv("SESSION_SECRET");

async function buildTestApp(): Promise<FastifyInstance> {
  const config = loadConfig();
  const app = Fastify({ logger: false, trustProxy: true });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("config", config);
  app.decorate("pg", createPool(config.DATABASE_URL));
  app.decorate("db", createDb(app.pg));
  app.decorate("redis", createRedis(config.REDIS_URL));
  app.decorate("eventBus", new EventBus({ error: () => {} }));
  await setupAuth(app);
  await setupSecurity(app);
  await app.register(transactionRoutes);
  app.addHook("onClose", async () => {
    await app.pg.end();
    app.redis.disconnect();
  });
  return app;
}

const app = await buildTestApp();
after(async () => {
  await app.close();
});

async function createUser(): Promise<string> {
  const [u] = await app.db
    .insert(users)
    .values({
      email: `ledger-events-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "ledger-events.route.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await app.db.delete(transactions).where(eq(transactions.userId, userId));
  await app.db.delete(accounts).where(eq(accounts.userId, userId));
  await app.db.delete(users).where(eq(users.id, userId));
}

async function createAccount(userId: string): Promise<string> {
  const [a] = await app.db
    .insert(accounts)
    .values({ userId, name: "Test account", type: "bank" })
    .returning({ id: accounts.id });
  return a!.id;
}

/** A `cookies` map for `app.inject()`, carrying a signed session cookie. */
function sessionCookie(sessionId: string): Record<string, string> {
  return { [SESSION_COOKIE]: app.signCookie(sessionId) };
}

type LedgerMutatedEntry = EventMap["ledger.mutated"];

/** Poll `observed` until it gains an entry, or give up after `timeoutMs`. */
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

/** Wait out a quiet period with no expectation of an entry appearing. */
async function waitQuietPeriod(ms = 500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- P8b: POST /api/transactions emits ledger.mutated ----------

test("P8b: POST /api/transactions emits ledger.mutated with the requesting user's id", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  const accountId = await createAccount(userId);
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
    url: "/api/transactions",
    cookies: sessionCookie(sessionId),
    payload: {
      accountId,
      date: "2026-01-05",
      amountPaise: -1500,
      merchant: "Test merchant",
    },
  });
  assert.equal(res.statusCode, 201);

  const entry = await pollForEntry(observed);
  assert.ok(entry, "expected a ledger.mutated event to have been observed");
  assert.equal(entry!.userId, userId);
});

// ---------- P8c: a failed (400) request emits nothing ----------

test("P8c: POST /api/transactions with a malformed body (400) emits no ledger.mutated event", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
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
    url: "/api/transactions",
    cookies: sessionCookie(sessionId),
    // accountId missing, amountPaise zero — fails CreateTransactionSchema validation.
    payload: { date: "2026-01-05", amountPaise: 0, merchant: "Malformed" },
  });
  assert.equal(res.statusCode, 400);

  // Long enough to rule out "not yet delivered" rather than "never emitted" —
  // the same bounded window used by the positive case above.
  await waitQuietPeriod();
  assert.equal(observed.length, 0, "a 400 response must not have emitted ledger.mutated");

  const cacheVersion = await app.redis.get(`cachever:${userId}`);
  assert.equal(cacheVersion, null, "a failed request must not bump the user's cache version either");
});
