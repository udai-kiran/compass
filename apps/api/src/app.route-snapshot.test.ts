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
// Two snapshots, two different jobs (see tasks/007-migrate-ledger/TASK.md
// Root Cause for the full story of why one gate became two):
//
// 1. `route-surface.snapshot.txt` — the canonical (method, path) pair list,
//    built from an `onRoute` hook registered before `registerRoutes(app)`
//    runs. This is the ACTUAL "unchanged API surface" invariant: it proves
//    method/path identity only (not handler identity, schemas, auth/security
//    hooks, host/version constraints, body limits, or response behavior).
//    This file is captured once (task 1.1's P2) and is never regenerated
//    after that — every later comparison (here, and in every later Phase-1
//    module-migration task) is against this same committed file. A pure
//    registration-structure change (N flat registrations collapsed into one
//    module plugin, same URLs/methods) must NOT change this snapshot.
// 2. `route-table.snapshot.txt` — the raw `printRoutes()` tree. This *is*
//    sensitive to registration/plugin-nesting structure, not just to the
//    (method, path) set — collapsing 11 interleaved flat registrations into
//    one contiguous module plugin call (as task 1.1 does) changes this raw
//    tree even though no URL or method changes. It stays a hard,
//    byte-for-byte regression gate, but with an explicit exception policy:
//    if you deliberately restructured route registration and confirmed the
//    canonical route-surface snapshot above is unchanged, regenerate this
//    file and justify the diff in your task's evidence trail — do not
//    silently accept it. If you did not intend to change registration
//    structure, investigate before regenerating.
//
// Trailing-newline policy: both committed snapshot files are written
// byte-for-byte via writeFileSync with no extra trailing newline appended
// beyond what each generator itself produces — so both comparisons below are
// literal `===` against the file's exact bytes (decoded as UTF-8), not a
// trimmed comparison. For route-surface.snapshot.txt specifically, the
// canonical rendering is `pairs.map(p => \`${p.method} ${p.url}\`).sort().join("\n") + "\n"`
// — one convention, stated once, used identically for generation and
// comparison.

const RAW_SNAPSHOT_URL = new URL("./route-table.snapshot.txt", import.meta.url);
const SURFACE_SNAPSHOT_URL = new URL("./route-surface.snapshot.txt", import.meta.url);

/**
 * The exact comparison function the raw-tree snapshot test calls. Throws with
 * a diagnostic message on any mismatch — added route, removed route, renamed
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
      "Raw route-table tree does not match the committed snapshot (route-table.snapshot.txt) — " +
        "this snapshot fails on ANY registration-tree change, not just an added/removed/renamed/" +
        "method-changed route. If you deliberately restructured route registration (e.g., " +
        "collapsing N flat registrations into one module plugin) and confirmed the canonical " +
        "route-surface snapshot (route-surface.snapshot.txt) is unchanged, regenerate this file " +
        "and justify the diff in your task's evidence trail — do not silently accept it. If you " +
        "did not intend to change registration structure, investigate before regenerating.",
    );
  }
}

/** Fastify's `routeOptions.method` can be a string or an array — flatten and uppercase. */
function flattenMethods(method: string | string[]): string[] {
  return (Array.isArray(method) ? method : [method]).map((m) => m.toUpperCase());
}

test("canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte — the real 'unchanged API surface' gate", async (t) => {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const pairs: Array<{ method: string; url: string }> = [];
  app.addHook("onRoute", (routeOptions) => {
    for (const method of flattenMethods(routeOptions.method)) {
      pairs.push({ method, url: routeOptions.url });
    }
  });

  await registerRoutes(app);
  await app.ready();
  t.after(() => app.close());

  // Assert no duplicate (method, url) pairs before serializing — a silent
  // Set-based dedup could otherwise mask an accidental double-registration.
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const p of pairs) {
    const key = `${p.method} ${p.url}`;
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  assert.deepEqual(duplicates, [], `duplicate (method, url) pairs found: ${duplicates.join(", ")}`);

  const actual = pairs.map((p) => `${p.method} ${p.url}`).sort().join("\n") + "\n";
  const expected = readFileSync(SURFACE_SNAPSHOT_URL, "utf8");

  assert.equal(
    actual,
    expected,
    "Canonical route surface (method, path pairs) does not match the committed " +
      "route-surface.snapshot.txt — a route was genuinely added, removed, renamed, or had a " +
      "method change. Unlike route-table.snapshot.txt, this file must never change across a " +
      "pure module-migration/registration-restructure task.",
  );
});

test("raw printRoutes() tree matches the committed snapshot byte-for-byte", async (t) => {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await registerRoutes(app);
  await app.ready();
  t.after(() => app.close());

  const actual = app.printRoutes({ commonPrefix: false });
  const expected = readFileSync(RAW_SNAPSHOT_URL, "utf8");

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
