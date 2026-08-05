# Sonnet Worker Delegation — 017 / roadmap 1.7 — ITERATION 2 (test-only)

## Context
Iteration 1 (the module migration) is COMPLETE and independently verified sound — do NOT touch any
production file. Codex implementation review (review-2.md) found no runtime regression but two
TEST-COVERAGE gaps (G1 = AC7, G2 = AC5 emit assertions). This iteration adds ONLY tests. See TASK.md
"Codex review-2 disposition" and "Verification (test iteration 2)".

## Files you may create/edit
- CREATE: `apps/api/src/modules/ingest/routes/ingest.route.test.ts` (the new coverage).
- You MAY read anything. You may NOT modify any production file (routes/services/schema/app.ts/plugins),
  and may NOT modify `plugin.test.ts` or `schema.smoke.test.ts`. If you believe a production file must
  change to make a test pass, STOP and report it — do not change it.

## Harness (copy the proven pattern)
Model the new file on `apps/api/src/modules/planning/routes/planning.route.test.ts`:
- Build a `buildTestApp()` that wires ONLY what's needed: `loadConfig()`, a Fastify instance with the zod
  validator/serializer compilers, decorate `config`/`pg`(createPool)/`db`(createDb)/`redis`(createRedis),
  `await setupAuth(app)`, `await setupSecurity(app)`, then `await app.register(ingestRoutes)` from
  `../plugin.ts`. Do NOT use `buildApp()` from app.ts (it calls `startJobs()`, which hangs `node --test`).
- Add an `onClose` hook ending the pg pool and disconnecting redis; `after(() => app.close())`.
- `requireEnv("DATABASE_URL"/"REDIS_URL"/"SESSION_SECRET")` up top (same as planning's), so a missing DB
  fails loudly rather than silently skipping.
- Use `createUser()`/`cleanupUser()`/`sessionCookie()` helpers as in planning's file; sessions via
  `createSession(app.redis, userId, { demo: true|false })` and `SESSION_COOKIE`/`app.signCookie`.
- `ingestRoutes` is exported from `apps/api/src/modules/ingest/plugin.ts`; ingest tables from `../schema.ts`.

## Required tests

### G1 — AC7 encapsulation-security (choose real encapsulated ingest routes)
A demo-blocked ingest WRITE route is `POST /api/inbox/:id/accept` (or `POST /api/inbox/transfer`); a read
route is `GET /api/inbox` or `GET /api/inbox/orphaned`. Assert, against routes served through the
encapsulated `ingestRoutes` plugin:
1. **401 unauthenticated:** a write with NO session cookie → 401 (auth hook applies inside the plugin).
2. **Demo-write 403 + no mutation:** a demo session POST to an ingest write route → 403, and assert no
   row was written (pick a route/precondition where you can cheaply prove no-write, e.g. a fresh user with
   no matching row; mirror planning's before/after count assertion).
3. **Hostile-Origin CSRF 403:** an authenticated (non-demo) write with a hostile `Origin` header (a
   different host than `req.hostname`) → 403 from the CSRF check in `plugins/security.ts`. (A same-host or
   trusted origin would pass; use a clearly foreign origin like `https://evil.example`.)
4. **No `config.public` on ingest routes:** introspect the registered routes (e.g. via
   `app.hasRoute`/route options or an `onRoute` collector in the test app) and assert no ingest route was
   marked `config.public` — i.e. every ingest route is behind auth. If route `config` is not readable via
   introspection, assert equivalently that an unauthenticated GET to an ingest read route → 401.
5. **READ/WRITE rate-limit classification:** the classifier `bucketFor(req)` in `plugins/security.ts`
   returns WRITE_BUCKET for mutating methods and READ_BUCKET otherwise. If `bucketFor` is exported, import
   and unit-test it directly for a GET ingest path (→ read bucket) and a POST ingest path (→ write
   bucket). If it is NOT exported, assert the observable proxy: the rate-limit hook classifies by method
   (documented in the test) — do NOT export it yourself (that's a production edit); instead assert method
   classification via a documented lighter check and note the limitation.

### G2 — AC5 `ledger.mutated` survives encapsulation
The five emit sites are `app.eventBus.emit("ledger.mutated", { userId })` at inbox accept
(routes/inbox.ts:56), repayment (:72), transfer (:87), import commit (routes/imports.ts:112), rollback
(:122). Add at least one test that DRIVES A REAL SUCCESSFUL ingest mutation through the encapsulated
`ingestRoutes` plugin and asserts `ledger.mutated` fired — subscribe with `app.eventBus.on("ledger.mutated",
…)` (or spy on `app.eventBus.emit`) BEFORE the request, drive the mutation with a real seeded precondition
(e.g. insert a pending `extracted_transactions` row for the test user, then POST the accept), and assert
the handler returned success AND the event fired with the right `userId`.
- Attempt all five sites. For any site whose SUCCESS path needs disproportionate domain fixtures (e.g.
  full account/category/import-batch setup), FLAG it in your report with a one-line justification and,
  for that site, assert instead that the emit line is present in the (unchanged) handler source — but you
  must genuinely drive at least the inbox-accept path (the roadmap's named case) to a real success + emit.
- Never fabricate a success or assert an emit you did not observe.

## Must NOT change
- No production file edits. No route URL/handler/schema/SQL changes. Do not add `config.public` anywhere.
- Do not modify existing tests, snapshots, or `db/schema.ts`.
- Clean up every row/session you create (per-test `t.after`), like planning's file, so the shared dev DB
  stays clean and hermetic.

## Acceptance
- New tests pass; they genuinely exercise the encapsulated `ingestRoutes` (not a bare route).
- AC7's five cases and AC5's runtime emit proof are covered per above.

## Commands (capture literal output + exit codes)
1. `node --env-file-if-exists=../../.env --test apps/api/src/modules/ingest/routes/ingest.route.test.ts`
   from `apps/api` (or the equivalent the repo uses) — all new tests PASS; show counts.
2. `npm run test -w apps/api` — report tests/pass/fail/skip + exit code (should be prior 858 + your new
   test count; reconcile the delta).
3. `npm run typecheck` (root) — exit 0.
4. `npm run lint` (root) — report result. NOTE: a `no-useless-assignment` error in
   `apps/api/src/lib/storage.test.ts` is a SEPARATE task (1.10 iteration 3) being fixed concurrently — if
   you see ONLY that error and it's in that file, report it as not-yours; your own new file must be
   lint-clean.

## Required Evidence
- `git status --short` (your change is the one new test file only) + complete diff of the new file.
- each command's exact invocation, literal output, counts, exit codes.
- for G2: state exactly which emit sites you drove to a real success + observed emit, and which (if any)
  you flagged as disproportionate with justification.
- any production-file change you believe necessary, reported as a blocker — NOT applied. Do NOT commit.
