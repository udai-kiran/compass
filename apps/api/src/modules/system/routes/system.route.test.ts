import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { loadConfig } from "../../../config.ts";
import { createPool } from "../../../infra/db.ts";
import { createRedis } from "../../../infra/redis.ts";
import { createDb } from "../../../db/index.ts";
import { setupAuth, SESSION_COOKIE } from "../../../plugins/auth.ts";
import { setupSecurity, _test as securityTest } from "../../../plugins/security.ts";
import { systemRoutes } from "../plugin.ts";
import { createSession, destroySession } from "../services/session.ts";
import { users } from "../../../db/core-schema.ts";
import { userProfiles } from "../schema.ts";
import type { Storage } from "../../../lib/storage.ts";

// Task 018 (roadmap 1.8) iteration 2 — system route encapsulation tests.
// Proves the six cross-cutting guards still apply after the system routes
// moved into an encapsulated plugin (systemRoutes). Each assertion is a real
// injection through the Fastify HTTP layer, with real Postgres+Redis backing.
//
// Harness follows the same buildTestApp() pattern as
// modules/ingest/routes/ingest.route.test.ts and
// modules/planning/routes/planning.route.test.ts: real Postgres + Redis,
// the Zod validator/serializer compilers, config/pg/db/redis decorations,
// setupAuth + setupSecurity, then the WHOLE systemRoutes plugin. Also
// decorates app.storage with a stub (backup routes reference it), and adds
// an onClose hook to clean up pg+redis. No eventBus — no system route emits
// ledger.mutated. No @fastify/multipart registration — no test injects a file
// endpoint.
//
// Needs a real Postgres + Redis connection (DATABASE_URL, REDIS_URL,
// SESSION_SECRET) — export them (see apps/api/.env) before running
// `npm run test -w apps/api`.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `system.route.test.ts needs ${name} set (a real Postgres/Redis-backed app boot) — ` +
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

/** Storage stub — backup routes reference app.storage but no test exercises
 * backup endpoints that call it. */
const stubStorage: Storage = {
  put: async () => {
    throw new Error("not used by system.route.test.ts");
  },
  get: async () => {
    throw new Error("not used by system.route.test.ts");
  },
  delete: async () => {},
  list: async () => [],
  ensureReady: async () => {},
};

async function buildTestApp(): Promise<{ app: FastifyInstance; routeEntries: RouteEntry[] }> {
  const config = loadConfig();
  const app = Fastify({ logger: false, trustProxy: true });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("config", config);
  app.decorate("pg", createPool(config.DATABASE_URL));
  app.decorate("db", createDb(app.pg));
  app.decorate("redis", createRedis(config.REDIS_URL));
  app.decorate("storage", stubStorage);
  await setupAuth(app);
  await setupSecurity(app);

  // T6(b): collect every route registered from here on (systemRoutes) so we
  // can assert config.public is set on exactly the expected public routes.
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

  await app.register(systemRoutes);
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
      email: `system-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "system.route.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await app.db.delete(userProfiles).where(eq(userProfiles.userId, userId));
  await app.db.delete(users).where(eq(users.id, userId));
}

/** A `cookies` map for `app.inject()`, carrying a signed session cookie. */
function sessionCookie(sessionId: string): Record<string, string> {
  return { [SESSION_COOKIE]: app.signCookie(sessionId) };
}

// ---------- T6(a): authenticated-only route rejects unauthenticated ----------

test("T6(a): GET /api/profile (authenticated-only system route) with no session cookie → 401", async () => {
  const res = await app.inject({ method: "GET", url: "/api/profile" });
  assert.equal(res.statusCode, 401, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.error, "Unauthorized");
});

// ---------- T6(b): exact public-route set within the system module ----------

test("T6(b): exactly the 5 known public routes carry config.public=true, and every other system route does not", () => {
  // The expected public set within the system module:
  const expectedPublic = new Set([
    "GET /health",
    "GET /api/auth/bootstrap",
    "POST /api/auth/demo",
    "POST /api/auth/register",
    "POST /api/auth/login",
  ]);

  // Sanity: the collector really did see routes from all 5 route files.
  assert.ok(routeEntries.length > 0, "expected the onRoute collector to have captured system routes");
  assert.ok(routeEntries.some((r) => r.url === "/health"), "expected health routes");
  assert.ok(routeEntries.some((r) => r.url.startsWith("/api/auth")), "expected auth routes");
  assert.ok(routeEntries.some((r) => r.url.startsWith("/api/notifications") || r.url.startsWith("/api/notification-prefs")), "expected notification routes");
  assert.ok(routeEntries.some((r) => r.url.startsWith("/api/export") || r.url.startsWith("/api/backup")), "expected backup routes");
  assert.ok(routeEntries.some((r) => r.url.startsWith("/api/profile") || r.url.startsWith("/api/family")), "expected profile routes");

  // Filter out auto-generated HEAD entries (Fastify adds HEAD for every GET
  // route, and it inherits the config.public flag). The delegation specifies
  // exactly the 5 explicitly-declared methods as public.
  const publicRoutes = routeEntries.filter((r) => r.configPublic === true && r.method !== "HEAD");
  const publicSet = new Set(publicRoutes.map((r) => `${r.method} ${r.url}`));

  assert.deepEqual(
    [...publicSet].sort(),
    [...expectedPublic].sort(),
    `expected exactly ${expectedPublic.size} public routes (excluding auto-generated HEAD), found ${publicSet.size}: ${JSON.stringify([...publicSet])}`,
  );

  // Also verify every non-public route (excluding auto-generated HEAD) has
  // configPublic !== true — i.e., the route file did NOT declare it public.
  const nonPublic = routeEntries.filter((r) => r.configPublic !== true && r.method !== "HEAD");
  assert.ok(nonPublic.length > 0, "expected at least some non-public routes");
  for (const r of nonPublic) {
    assert.equal(
      r.configPublic,
      undefined,
      `route ${r.method} ${r.url} must not carry config.public=true`,
    );
  }
});

// ---------- T6(c): demo chokepoint — PUT /api/profile ----------

test("T6(c): a demo session's PUT /api/profile is rejected 403, and the user_profiles row is unchanged", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, { demo: true });
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  // Seed a user profile row with a known dateOfBirth.
  const originalDob = "1990-06-15";
  await app.db.insert(userProfiles).values({ userId, dateOfBirth: originalDob });

  // Record the precondition: the row exists with the original value.
  const [before] = await app.db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));
  assert.equal(before!.dateOfBirth, originalDob, "precondition: seeded profile has the original dateOfBirth");

  // Drive a genuine PUT /api/profile with a valid body (different date).
  const res = await app.inject({
    method: "PUT",
    url: "/api/profile",
    cookies: sessionCookie(sessionId),
    payload: { dateOfBirth: "1995-01-01" },
  });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(JSON.parse(res.body).error, "DemoReadOnly", "expected DemoReadOnly error for demo session write");

  // After: the row is unchanged — the demo guard prevented the write.
  const [after] = await app.db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));
  assert.equal(
    after!.dateOfBirth,
    originalDob,
    "a rejected demo request must not have mutated the user_profiles row",
  );
});

// The non-demo success-path precondition: the same valid body succeeds when
// the session is NOT a demo session, proving the 403 above is not a
// malformed-body rejection.
test("T6(c) precondition: a non-demo session's PUT /api/profile with the same valid body succeeds (200)", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "PUT",
    url: "/api/profile",
    cookies: sessionCookie(sessionId),
    payload: { dateOfBirth: "1995-01-01" },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.dateOfBirth, "1995-01-01", "expected the profile update to succeed");
});

// ---------- T6(d): CSRF — hostile Origin on a system write ----------

test("T6(d): a non-demo authenticated session POSTing to a system route with a hostile Origin → 403 (CSRF)", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/notifications/read-all",
    cookies: sessionCookie(sessionId),
    headers: { origin: "https://evil.example" },
    payload: {},
  });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(JSON.parse(res.body).error, "Forbidden");
});

// ---------- T6(e): rate-limit bucket classification ----------

test("T6(e): bucketFor classifies auth paths as AUTH, system reads as READ, system writes as WRITE", () => {
  const req = (method: string, url: string): FastifyRequest =>
    ({ method, url }) as FastifyRequest;

  // Auth endpoints get the tightest bucket.
  assert.equal(securityTest.bucketFor(req("POST", "/api/auth/login")).name, securityTest.AUTH_BUCKET.name);
  assert.equal(securityTest.bucketFor(req("POST", "/api/auth/register")).name, securityTest.AUTH_BUCKET.name);
  assert.equal(securityTest.bucketFor(req("POST", "/api/auth/password")).name, securityTest.AUTH_BUCKET.name);

  // System reads.
  assert.equal(securityTest.bucketFor(req("GET", "/api/profile")).name, securityTest.READ_BUCKET.name);
  assert.equal(securityTest.bucketFor(req("GET", "/api/notifications")).name, securityTest.READ_BUCKET.name);
  assert.equal(securityTest.bucketFor(req("GET", "/health")).name, securityTest.READ_BUCKET.name);

  // System writes.
  assert.equal(securityTest.bucketFor(req("PUT", "/api/profile")).name, securityTest.WRITE_BUCKET.name);
  assert.equal(securityTest.bucketFor(req("PUT", "/api/notification-prefs")).name, securityTest.WRITE_BUCKET.name);
  assert.equal(securityTest.bucketFor(req("POST", "/api/notifications/read-all")).name, securityTest.WRITE_BUCKET.name);
});

// ---------- T6(f): security headers ----------

test("T6(f): a real response from an encapsulated system route carries all 6 unconditional security headers", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "GET",
    url: "/api/profile",
    cookies: sessionCookie(sessionId),
  });
  assert.equal(res.statusCode, 200, res.body);

  const headers = res.headers;
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.equal(headers["cross-origin-opener-policy"], "same-origin");
  assert.equal(headers["x-dns-prefetch-control"], "off");
  assert.equal(headers["content-security-policy"], "default-src 'none'; frame-ancestors 'none'");
});

// ---------- T6(g): real unauthenticated GET /health ----------

test("T6(g): a real unauthenticated GET /health → 200 with expected body", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.postgres, true, "expected health body to report postgres connected");
  assert.equal(body.redis, true, "expected health body to report redis connected");
  assert.ok(body.build, "expected health body to include a build field");
});