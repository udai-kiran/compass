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
import { userTaskRoutes } from "./user-tasks.ts";
import { createSession, destroySession } from "../../../modules/system/services/session.ts";
import { accounts, transactions, userTasks } from "../schema.ts";
import { users } from "../../../db/schema.ts";
import { createUserTask } from "../services/user-tasks.ts";
import { softDeleteTransaction } from "../services/transactions.ts";

// A Fastify injection test, exercising the real HTTP layer (route + Zod body
// schema + the demo-mode auth hook). This repo has no existing route-level
// injection test to copy a convention from — grepping for `app.inject(`/
// `buildApp` across apps/api/src turns up nothing outside app.ts/server.ts —
// so this harness is new.
//
// Deliberately NOT built on `buildApp` from app.ts: that function also calls
// `startJobs`, which registers BullMQ job schedulers and a producer-only
// "ingestor" queue against the shared dev Redis and immediately runs global,
// unscoped boot passes (`materializeDue`, `evaluateBillReminders`,
// `snapshotAllUsers`) across *every* user in the database — a far heavier and
// riskier footprint than a route-level test should have. Worse, `buildApp`'s
// `onClose` hook never closes the "ingestor" queue's own Redis connection, so
// a `node --test` process built on it never exits on its own (verified: it
// hung past a 2-minute timeout). This harness instead wires up only what the
// user-tasks routes actually need — Postgres, Redis, the auth/security
// plugins (both reused unmodified from ../plugins/), and userTaskRoutes
// itself — skipping storage and the job/queue system entirely, neither of
// which these routes touch.
//
// Needs a real Postgres + Redis connection (DATABASE_URL, REDIS_URL,
// SESSION_SECRET) — export them (see apps/api/.env) before running
// `npm run test -w apps/api`.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `user-tasks.route.test.ts needs ${name} set (a real Postgres/Redis-backed app boot) — ` +
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
  await setupAuth(app);
  await setupSecurity(app);
  await app.register(userTaskRoutes);
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
      email: `user-tasks-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "user-tasks.route.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await app.db.delete(userTasks).where(eq(userTasks.userId, userId));
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

async function createTxn(userId: string, accountId: string): Promise<string> {
  const [t] = await app.db
    .insert(transactions)
    .values({
      userId,
      accountId,
      date: "2026-01-05",
      amountPaise: -1000,
      merchant: "Test merchant",
    })
    .returning({ id: transactions.id });
  return t!.id;
}

/** A `cookies` map for `app.inject()`, carrying a signed session cookie. */
function sessionCookie(sessionId: string): Record<string, string> {
  return { [SESSION_COOKIE]: app.signCookie(sessionId) };
}

// ---------- AC2: title validation (empty / whitespace-only / 201 chars) ----------

test("AC2: create rejects an empty, whitespace-only, or 201-char title with 400", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  for (const title of ["", "   ", "a".repeat(201)]) {
    const res = await app.inject({
      method: "POST",
      url: "/api/user-tasks",
      cookies: sessionCookie(sessionId),
      payload: { title },
    });
    assert.equal(res.statusCode, 400, `title ${JSON.stringify(title)} should be rejected on create`);
  }
});

test("AC2: update rejects an empty, whitespace-only, or 201-char title with 400", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });
  const task = await createUserTask(app.db, userId, {
    title: "Valid title",
    notes: "",
    transactionId: null,
    dueDate: null,
  });

  for (const title of ["", "   ", "a".repeat(201)]) {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/user-tasks/${task.id}`,
      cookies: sessionCookie(sessionId),
      payload: { title },
    });
    assert.equal(res.statusCode, 400, `title ${JSON.stringify(title)} should be rejected on update`);
  }
});

// ---------- AC7 (route-level): retained-link/null-projection contract, and cross-user exclusion ----------

test("AC7 (route-level): GET /api/user-tasks/:id and GET /api/user-tasks both retain the linked transactionId with a null transaction projection after the linked transaction is soft-deleted", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });
  const accountId = await createAccount(userId);
  const txnId = await createTxn(userId, accountId);
  const task = await createUserTask(app.db, userId, {
    title: "Reconcile",
    notes: "",
    transactionId: txnId,
    dueDate: null,
  });

  await softDeleteTransaction(app.db, userId, txnId);

  const getRes = await app.inject({
    method: "GET",
    url: `/api/user-tasks/${task.id}`,
    cookies: sessionCookie(sessionId),
  });
  assert.equal(getRes.statusCode, 200);
  const getBody = getRes.json() as { transactionId: string | null; transaction: unknown };
  assert.equal(getBody.transactionId, txnId);
  assert.equal(getBody.transaction, null);

  const listRes = await app.inject({
    method: "GET",
    url: "/api/user-tasks",
    cookies: sessionCookie(sessionId),
  });
  assert.equal(listRes.statusCode, 200);
  const listBody = listRes.json() as Array<{
    id: string;
    transactionId: string | null;
    transaction: unknown;
  }>;
  const listed = listBody.find((row) => row.id === task.id);
  assert.ok(listed, "the task must still be present in the owner's list");
  assert.equal(listed!.transactionId, txnId);
  assert.equal(listed!.transaction, null);
});

test("AC7 (route-level): a second user's GET /api/user-tasks/:id 404s on the first user's task, and their GET /api/user-tasks omits it entirely", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  const sessionA = await createSession(app.redis, userA);
  const sessionB = await createSession(app.redis, userB);
  t.after(async () => {
    await destroySession(app.redis, sessionA);
    await destroySession(app.redis, sessionB);
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const accountId = await createAccount(userA);
  const txnId = await createTxn(userA, accountId);
  const task = await createUserTask(app.db, userA, {
    title: "A's task",
    notes: "",
    transactionId: txnId,
    dueDate: null,
  });

  const getRes = await app.inject({
    method: "GET",
    url: `/api/user-tasks/${task.id}`,
    cookies: sessionCookie(sessionB),
  });
  assert.equal(getRes.statusCode, 404);

  const listRes = await app.inject({
    method: "GET",
    url: "/api/user-tasks",
    cookies: sessionCookie(sessionB),
  });
  assert.equal(listRes.statusCode, 200);
  const listBody = listRes.json() as Array<{ id: string }>;
  assert.ok(
    listBody.every((row) => row.id !== task.id),
    "user B's list must not contain user A's task row at all, not merely lack its transaction metadata",
  );
});

// ---------- misc-05 AC8 (route half): source/sourceKey cannot be forged via the HTTP body ----------

test("AC8 (route half): POST /api/user-tasks with source/sourceKey in the body is ignored — the created row is source='user', sourceKey=null", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/user-tasks",
    cookies: sessionCookie(sessionId),
    payload: { title: "Forged via HTTP", source: "card-due", sourceKey: "forged-key" },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json() as { source: string; sourceKey: string | null };
  assert.equal(body.source, "user");
  assert.equal(body.sourceKey, null);

  const rows = await app.db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.source, "user");
  assert.equal(rows[0]!.sourceKey, null);
});

// ---------- AC12: demo-mode mutating requests are rejected, with no DB effect ----------

test("AC12: a demo session's mutating request is rejected 403, and no database row is created or changed", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, { demo: true });
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/user-tasks",
    cookies: sessionCookie(sessionId),
    payload: { title: "Should be rejected" },
  });
  assert.equal(res.statusCode, 403);

  const rows = await app.db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.equal(rows.length, 0);
});
