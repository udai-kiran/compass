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
import { protectionRoutes } from "../plugin.ts";
import { createSession, destroySession } from "../../../services/session.ts";
import { insurancePolicies, retirementDetails } from "../schema.ts";
import { users, accounts } from "../../../db/schema.ts";

// A Fastify injection test exercising the real HTTP layer (route + Zod body
// schema + the demo-mode auth hook), mirroring
// modules/ledger/routes/user-tasks.route.test.ts's AC12 harness and
// modules/investments/routes/networth.route.test.ts — no route-level
// demo-mode-403 test previously existed for the protection domain (see
// tasks/011-migrate-protection/TASK.md Root Cause's "Demo-mode 403" section),
// so this file is new, not relocated.
//
// Registers the whole protectionRoutes plugin (not a single route file), which
// is precisely what the standing Known-traps obligation asks for: it proves
// demo-write protection survives *plugin encapsulation*.
//
// Needs a real Postgres + Redis connection (DATABASE_URL, REDIS_URL,
// SESSION_SECRET) — export them (see apps/api/.env) before running
// `npm run test -w apps/api`.
//
// Deliberately does NOT decorate a stub `storage` on the test app: a 403 at the
// auth hook never reaches a handler body, so `app.storage` is never touched. If
// the 403 ever regressed, the missing decoration makes the test fail loudly —
// which is the point.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `protection.route.test.ts needs ${name} set (a real Postgres/Redis-backed app boot) — ` +
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
  await app.register(protectionRoutes);
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
      email: `protection-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "protection.route.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await app.db.delete(insurancePolicies).where(eq(insurancePolicies.userId, userId));
  await app.db.delete(retirementDetails).where(eq(retirementDetails.userId, userId));
  await app.db.delete(accounts).where(eq(accounts.userId, userId));
  await app.db.delete(users).where(eq(users.id, userId));
}

/** A `cookies` map for `app.inject()`, carrying a signed session cookie. */
function sessionCookie(sessionId: string): Record<string, string> {
  return { [SESSION_COOKIE]: app.signCookie(sessionId) };
}

// ---------- new demo-mode-403 characterization (Root Cause "Demo-mode 403") ----------

test("a demo session's POST /api/insurance/policies is rejected 403, and no insurance_policies row is written", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, { demo: true });
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const before = await app.db
    .select()
    .from(insurancePolicies)
    .where(eq(insurancePolicies.userId, userId));
  assert.equal(before.length, 0, "precondition: this fresh user has no insurance policies yet");

  const res = await app.inject({
    method: "POST",
    url: "/api/insurance/policies",
    cookies: sessionCookie(sessionId),
    payload: { name: "LIC Jeevan Anand" },
  });
  assert.equal(res.statusCode, 403);

  const after_ = await app.db
    .select()
    .from(insurancePolicies)
    .where(eq(insurancePolicies.userId, userId));
  assert.equal(after_.length, 0, "a rejected demo request must not have written any insurance_policies row");
});

test("a demo session's PUT /api/retirement/:accountId/details is rejected 403, and no retirement_details row is written", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, { demo: true });
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  // Fixture: a PPF account so a regressed request could actually progress far
  // enough to reach the handler and the write (see TASK.md Root Cause "Demo-mode
  // 403" — the fixture strengthens the mutation assertion; it is not needed to
  // obtain the 403, which the auth hook rejects before validation).
  const [acc] = await app.db
    .insert(accounts)
    .values({ userId, name: "PPF fixture", type: "ppf" })
    .returning({ id: accounts.id });

  const before = await app.db
    .select()
    .from(retirementDetails)
    .where(eq(retirementDetails.userId, userId));
  assert.equal(before.length, 0, "precondition: this fresh user has no retirement_details rows yet");

  const res = await app.inject({
    method: "PUT",
    url: `/api/retirement/${acc!.id}/details`,
    cookies: sessionCookie(sessionId),
    payload: { annualRateBps: 710 },
  });
  assert.equal(res.statusCode, 403);

  const after_ = await app.db
    .select()
    .from(retirementDetails)
    .where(eq(retirementDetails.userId, userId));
  assert.equal(after_.length, 0, "a rejected demo request must not have written any retirement_details row");
});