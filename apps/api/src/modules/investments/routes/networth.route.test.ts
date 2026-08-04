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
import { netWorthRoutes } from "./networth.ts";
import { createSession, destroySession } from "../../../services/session.ts";
import { netWorthSnapshots } from "../schema.ts";
import { users } from "../../../db/schema.ts";

// A Fastify injection test exercising the real HTTP layer (route + Zod body
// schema + the demo-mode auth hook), mirroring
// modules/ledger/routes/user-tasks.route.test.ts's AC12 harness — no
// route-level demo-mode-403 test previously existed for the investments
// domain (see tasks/010-migrate-investments/TASK.md Root Cause's "Demo-mode
// 403" section), so this file is new, not relocated.
//
// Needs a real Postgres + Redis connection (DATABASE_URL, REDIS_URL,
// SESSION_SECRET) — export them (see apps/api/.env) before running
// `npm run test -w apps/api`.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `networth.route.test.ts needs ${name} set (a real Postgres/Redis-backed app boot) — ` +
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
  await app.register(netWorthRoutes);
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
      email: `networth-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "networth.route.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await app.db.delete(netWorthSnapshots).where(eq(netWorthSnapshots.userId, userId));
  await app.db.delete(users).where(eq(users.id, userId));
}

/** A `cookies` map for `app.inject()`, carrying a signed session cookie. */
function sessionCookie(sessionId: string): Record<string, string> {
  return { [SESSION_COOKIE]: app.signCookie(sessionId) };
}

// ---------- new demo-mode-403 characterization (Root Cause "Demo-mode 403") ----------

test("a demo session's POST /api/net-worth/backfill is rejected 403, and no net_worth_snapshots row is written or changed", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, { demo: true });
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const before = await app.db
    .select()
    .from(netWorthSnapshots)
    .where(eq(netWorthSnapshots.userId, userId));
  assert.equal(before.length, 0, "precondition: this fresh user has no net-worth snapshots yet");

  const res = await app.inject({
    method: "POST",
    url: "/api/net-worth/backfill",
    cookies: sessionCookie(sessionId),
    payload: { months: 3 },
  });
  assert.equal(res.statusCode, 403);

  const after_ = await app.db
    .select()
    .from(netWorthSnapshots)
    .where(eq(netWorthSnapshots.userId, userId));
  assert.equal(after_.length, 0, "a rejected demo request must not have written any net_worth_snapshots row");
});
