import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { registerRoutes } from "./app.ts";

// Hermetic route-table identity gate: Fastify + the two Zod compilers +
// registerRoutes(app) + app.ready() only — no requireEnv(), no Postgres,
// Redis, storage, config, eventBus, auth, or security plugins. Confirmed
// sufficient because setupAuth/setupSecurity only add per-request hooks (not
// routes) and route handlers never execute during app.ready()/printRoutes().
//
// Trailing-newline policy: the committed snapshot (route-table.snapshot.txt)
// is the raw, unmodified string returned by
// `app.printRoutes({ commonPrefix: false })`, written byte-for-byte via
// writeFileSync with no extra trailing newline appended — so the comparison
// below is a literal `===` against the file's exact bytes (decoded as UTF-8),
// not a trimmed comparison.

const SNAPSHOT_URL = new URL("./route-table.snapshot.txt", import.meta.url);

/**
 * The exact comparison function the main snapshot test calls. Throws with a
 * diagnostic message on any mismatch — added route, removed route, renamed
 * route, or a changed HTTP method are all just string differences from this
 * function's point of view. This function's *rejection* behavior is what the
 * synthetic sub-test below proves; it does not, by itself, prove that
 * `printRoutes()` renders every production route change as a string diff —
 * that assurance comes from the real P1 → P3 → P6 baseline-diff chain
 * documented in tasks/006-module-scaffold-and-route-gate/TASK.md.
 */
function assertRouteTableMatches(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(
      "Route table does not match the committed snapshot (route-table.snapshot.txt) — " +
        "an added, removed, renamed, or method-changed route was detected. " +
        "Phase 1 module-migration tasks must not change this snapshot; if a route " +
        "genuinely needs to change, update route-table.snapshot.txt deliberately.",
    );
  }
}

test("route table matches the committed snapshot byte-for-byte", async (t) => {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await registerRoutes(app);
  await app.ready();
  t.after(() => app.close());

  const actual = app.printRoutes({ commonPrefix: false });
  const expected = readFileSync(SNAPSHOT_URL, "utf8");

  assertRouteTableMatches(actual, expected);
});

// ---------- Synthetic comparison-helper sub-test ----------
//
// This proves assertRouteTableMatches() itself rejects an added route, a
// removed route, a renamed route, and a method change (GET -> POST) against
// hand-written before/after strings. It is a unit test of the helper's
// rejection behavior only, NOT a claim that printRoutes() would render every
// such production change identically to these synthetic examples.

test("assertRouteTableMatches rejects an added route", () => {
  const before = "├── /api/accounts (GET, HEAD, POST)\n";
  const after = "├── /api/accounts (GET, HEAD, POST)\n├── /api/new-thing (GET, HEAD)\n";
  assert.throws(() => assertRouteTableMatches(after, before));
});

test("assertRouteTableMatches rejects a removed route", () => {
  const before = "├── /api/accounts (GET, HEAD, POST)\n├── /api/goals (GET, HEAD)\n";
  const after = "├── /api/accounts (GET, HEAD, POST)\n";
  assert.throws(() => assertRouteTableMatches(after, before));
});

test("assertRouteTableMatches rejects a renamed route", () => {
  const before = "├── /api/goals (GET, HEAD)\n";
  const after = "├── /api/goal-plans (GET, HEAD)\n";
  assert.throws(() => assertRouteTableMatches(after, before));
});

test("assertRouteTableMatches rejects a method change (GET -> POST)", () => {
  const before = "├── /api/projection-settings (GET, HEAD, PUT)\n";
  const after = "├── /api/projection-settings (POST, HEAD, PUT)\n";
  assert.throws(() => assertRouteTableMatches(after, before));
});

test("assertRouteTableMatches accepts identical tables", () => {
  const table = "├── /api/accounts (GET, HEAD, POST)\n";
  assert.doesNotThrow(() => assertRouteTableMatches(table, table));
});
