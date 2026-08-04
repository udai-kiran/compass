# Sonnet Worker Delegation — iteration 1

---

# Sonnet Worker Delegation — iteration 2 (fix from Codex review-3)

## Task
002-retire-url-regex-hook, iteration 2: fix a real (if low-probability) flaky-test race identified by Codex's implementation review (`tasks/002-retire-url-regex-hook/review-3.md`, Blocking finding #1), and re-confirm the full test suite is green afterward.

Read `tasks/002-retire-url-regex-hook/review-3.md` in full for the exact finding. Summary: in `apps/api/src/app.test.ts`'s P8a test, the candidate BullMQ job-ID range for the debounced budget-eval job is computed once, frozen between `beforeEmit` (captured right before `emit()`) and `afterEmit` (captured right after the cache-version poll observes its bump). `enqueueBudgetEvaluation`'s own `Date.now()` call (which picks the 5-second bucket for the job's id, in `apps/api/src/jobs/index.ts`) happens inside the subscriber *after* `invalidateUserCache` resolves — so in a narrow window, the job's actual bucket could theoretically fall after `afterEmit`'s frozen upper bound (e.g. a 5s boundary crossed between the redis write becoming visible and this test's own poll noticing it), producing a false test failure. This did not happen in two live test runs, but it's a real, fixable design issue in the test, not a production code issue.

## Approved Fix
Do NOT change the bucket-range's lower bound (`firstBucket`, computed from `beforeEmit` — that's still correct and unaffected). Change only the upper bound: instead of freezing `lastBucket` once (from a single `afterEmit` snapshot) and building a fixed `candidateJobIds` array before polling, recompute the candidate range **fresh on every poll iteration** inside the `pollUntil` check callback, using `Math.floor(Date.now() / 5000)` at the moment of that specific check as the upper bound. This way the candidate range can only grow across iterations, never miss a bucket the job could have landed in relative to when we actually query the queue, regardless of exactly when the cache-version poll happened to notice its own bump.

Concretely, in the existing test body (currently around lines 90-112 of `apps/api/src/app.test.ts`):
- Keep `const firstBucket = Math.floor(beforeEmit / 5000);` (unchanged, still correct).
- Remove the frozen `afterEmit`/`lastBucket`/`candidateJobIds` (computed once, before polling).
- Inside the `pollUntil` check callback for finding the job, compute the candidate job ids fresh each call: `const lastBucket = Math.floor(Date.now() / 5000); const candidateJobIds = Array.from({ length: lastBucket - firstBucket + 1 }, (_, i) => \`eval-${userId}-${firstBucket + i}\`);` — then loop over that freshly-computed array to call `alerts.getJob(jobId)` as before.
- Keep the final `assert.ok(foundJob, ...)` message useful — if you no longer have a single fixed `candidateJobIds` list to interpolate into the failure message, list `firstBucket` and the bucket-at-failure-time instead (whatever's clear and accurate).
- Do not change anything else in this file, and do not touch `apps/api/src/routes/ledger-events.route.test.ts` (Codex found no issue with P8b/P8c) or any production code (`app.ts`, `jobs/index.ts`, the five route files) — this is a test-only fix.

## Files and Symbols
- `apps/api/src/app.test.ts` only — the P8a test's job-id bucket-range computation.

## Must Not Change
- Everything else already implemented in iteration 1 (see the iteration-1 delegation above and `tasks/002-retire-url-regex-hook/implementation-1.md`). This is a narrowly scoped test-hardening fix, not a re-implementation.
- `apps/api/src/routes/ledger-events.route.test.ts`, all production route/job/app.ts files, `services/*.ts`, `lib/event-bus.ts`.

## Acceptance Criteria
- The P8a test still asserts both subscriber effects (cache-version bump, and the debounced job's presence + `data.userId`), exactly as before.
- The candidate job-id range's upper bound is now computed at query time (fresh per poll iteration), not frozen at an earlier snapshot — eliminating the race Codex identified.
- `npm run typecheck` passes.
- `npx eslint apps/api/src/app.test.ts` passes (no output, exit 0).
- `npm run test -w apps/api` passes in full (793+ tests, 0 failures) — export `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET` from the repo root `.env` first (`set -a && source .env && set +a`); both Postgres and Redis at `192.168.2.196` are reachable (confirmed independently twice already in this task). Run the full suite **twice** and report both runs' literal tallies and exit codes — do not run it only once.
- Also separately re-confirm (for the record, since Codex's own review run reported a different, contradictory result — 557 pass/11 fail — almost certainly because that reviewer ran the test command without sourcing `.env` first): report the exact command you used to export the env vars, and the literal `pass`/`fail`/`cancelled`/`skipped`/exit-code tally from both of your runs.

## Commands
1. `npm run typecheck`
2. `npx eslint apps/api/src/app.test.ts`
3. `set -a && source .env && set +a && npm run test -w apps/api` — run twice, report both full literal tallies and exit codes
4. `git diff -- apps/api/src/app.test.ts` — report the complete diff

## Required Evidence
- Complete diff of `apps/api/src/app.test.ts` (and confirmation no other file changed: `git status --porcelain`)
- Literal output and exit codes for every command above, both test runs in full
- Explicit confirmation that P8b/P8c and all production files from iteration 1 are untouched


## Task
002-retire-url-regex-hook (roadmap id 0.2, GitHub issue #134): "Retire the URL-regex onResponse hook"

Read `tasks/002-retire-url-regex-hook/TASK.md` in full first — it is the source of truth for every decision below, including two rounds of Codex review findings already folded in. Do not deviate from it without flagging back.

## Approved Plan
- P1: Delete the `onResponse` hook in `apps/api/src/app.ts` (currently lines ~195-203). Extract a named, exported function `registerLedgerCacheSubscriber(app: FastifyInstance): void` that does `app.eventBus.on("ledger.mutated", async ({ userId }) => { await invalidateUserCache(app.redis, userId); await enqueueBudgetEvaluation(app, userId); })`. Call it once, right after `app.decorate("eventBus", eventBus)`, and **before** `await startJobs(app)` — registration must precede boot-catchup's emits or they're silently dropped.
- P2: In `apps/api/src/routes/transactions.ts`, add `app.eventBus.emit("ledger.mutated", { userId: req.session!.userId })` after each of these succeeds: `POST /api/transactions`, `PATCH /api/transactions/:id`, `DELETE /api/transactions/:id`, `PUT /api/transactions/:id/splits`, `POST /api/transactions/bulk`. Store the awaited service result in a local variable first, emit, then send/return it — success only, never on a thrown error. A `bulkAction` result with zero affected rows still emits (harmless, matches today's behavior).
- P3: Same pattern in `apps/api/src/routes/transfers.ts` for: `POST /api/transfers` (link), `POST /api/transfers/record` (create), `DELETE /api/transfers/:id` (unlink).
- P4: Same pattern in `apps/api/src/routes/imports.ts` for **only** `POST /api/imports/:id/commit` and `POST /api/imports/:id/rollback`. Do NOT add emission to `POST /api/imports` (staging upload), `PUT .../mapping`, `PATCH .../rows/:rowId`, or `DELETE /api/imports/:id` — deliberate narrowing, confirmed safe (see TASK.md Root Cause).
- P5: Same pattern in `apps/api/src/routes/inbox.ts` for **only** `POST /api/inbox/:id/accept`, `POST /api/inbox/:id/repayment`, `POST /api/inbox/transfer`. Do NOT add emission to `.../reject`, `.../restore`, `.../unmatch`.
- P6: In `apps/api/src/routes/recurring.ts`, convert the `materializeNow` helper's direct `invalidateUserCache`/`enqueueBudgetEvaluation` calls (both the loop over `res.userIds` and the `else` branch) to `app.eventBus.emit("ledger.mutated", { userId: uid })` / `{ userId }`. **Also add an emit** to the `DELETE /api/recurring/:id` handler (after `deleteTemplate` succeeds) — this is required: `services/cashflow.ts`'s `getForecast()` is wrapped in `cached()` and reads `recurringTemplates` directly, so deleting a template must still invalidate. Remove the now-unused direct imports of `invalidateUserCache`/`enqueueBudgetEvaluation` from this file if nothing else in it calls them.
- P7: In `apps/api/src/jobs/index.ts`, convert the two existing direct-call sites to `app.eventBus.emit("ledger.mutated", { userId })` per user: the `recurring.materialize` job handler (iterating `res.userIds`, ~line 250) and the boot-catchup block (iterating `boot.userIds`, ~line 377). Leave `enqueueBudgetEvaluation`'s own function definition in this file untouched — only the two call sites change.
- P8: Test coverage — three pieces, in a new colocated test file (or files) following `apps/api/src/routes/user-tasks.route.test.ts`'s conventions (env-var-gated real Postgres/Redis, `setupAuth`/`setupSecurity`, explicit `app.close()` cleanup, no `buildApp()`/`startJobs()`):
  - **P8a** (subscriber wiring, isolated): build a real, minimal `Fastify({ logger: false })` instance — no unsafe casts, no duck-typed fake object passed where `FastifyInstance` is expected. Decorate real `redis` (`createRedis(config.REDIS_URL)`), a real BullMQ `Queue("alerts", { connection })` for `app.queues.alerts` (mirror the exact construction already in `jobs/index.ts`), and a real `EventBus`. Call the exported `registerLedgerCacheSubscriber(app)`, then `app.eventBus.emit("ledger.mutated", { userId })`. Await a completion signal — do not assert immediately (the emit is `queueMicrotask`-dispatched, see `lib/event-bus.ts`). Use a short bounded poll (e.g. retry every ~10ms up to ~300-500ms) of `cachever:<userId>` in Redis for a change from its recorded baseline, AND separately confirm the alerts queue received the debounced job — compute the expected `jobId` (`eval-${userId}-${Math.floor(Date.now()/5000)}`) and query it via the BullMQ `Queue` API (e.g. `queue.getJob(jobId)`). Assert both effects, not just one.
  - **P8b** (route emits, end-to-end): build a `buildTestApp()`-style harness (real Postgres/Redis, `setupAuth`+`setupSecurity`, decorate a real `EventBus`, register `transactionRoutes` only — no BullMQ/queues needed here). Add a test-only observer via the real, public `app.eventBus.on("ledger.mutated", (payload) => { observed.push(payload); })` API. `POST /api/transactions` with a valid body, expect 201, then bounded-poll `observed` for an entry with the expected `userId` (poll, don't assert immediately — same fire-and-forget reasoning as P8a).
  - **P8c** (negative case, same harness as P8b): `POST /api/transactions` with a malformed body (400), then wait through the same bounded quiet period and assert `observed` gained **no** entry — proves emission is success-only, not just "not yet delivered."
  - **P8d** (source check, can be manual/part of your evidence, not necessarily an automated `node:test`): confirm `apps/api/src/app.ts` no longer contains the `onResponse`/regex hook.

## Files and Symbols
- `apps/api/src/app.ts` — delete hook, add `registerLedgerCacheSubscriber` (export it), call it before `startJobs`
- `apps/api/src/routes/transactions.ts`, `transfers.ts`, `imports.ts`, `inbox.ts`, `recurring.ts` — add/replace emit calls per P2-P6 above
- `apps/api/src/jobs/index.ts` — replace two direct-call sites per P7
- New test file(s) under `apps/api/src/` (colocated with what they test, e.g. `apps/api/src/app.test.ts` or `apps/api/src/routes/transactions.route.test.ts` — your call on naming/location, but follow the `user-tasks.route.test.ts` structural convention: `requireEnv()` guards, `buildTestApp()`, `createUser()`/`cleanupUser()` helpers, `t.after()` cleanup)

## Must Not Change
- `apps/api/src/lib/event-bus.ts` — already merged (task 0.1), do not touch
- `enqueueBudgetEvaluation`'s own implementation/debounce logic in `jobs/index.ts` — only its call sites change
- `routes/budgets.ts`, `routes/sips.ts`, `routes/emis.ts` — explicitly out of scope, leave their direct `invalidateUserCache`/`enqueueBudgetEvaluation` calls exactly as they are
- `/api/epf-contributions` and the insurance premium-logging route — explicitly out of scope (pre-existing gap, not this task's problem)
- Any `EventMap` types beyond the existing `ledger.mutated` — no new event types
- Service function signatures in `services/transactions.ts`, `transfers.ts`, `imports.ts`, `recurring.ts`, `inbox.ts` — do not thread `EventBus`/Fastify into them; emission happens at the route/job layer only

## Acceptance Criteria
Copy verbatim from `tasks/002-retire-url-regex-hook/TASK.md` — AC1 through AC7. Do not treat this delegation's summary as a substitute; the task file is authoritative if anything here is ambiguous.

## Commands
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -w apps/api` — note: the new route-injection tests need `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET` exported first (see `apps/api/.env` and the pattern in `user-tasks.route.test.ts`'s `requireEnv()` calls). If you can't reach a live Postgres/Redis in your environment, run what you can, and report exactly what ran vs. what you could not run and why — do not claim a command passed if you didn't execute it.
4. `rg -n "onResponse" apps/api/src/app.ts` — expect no output
5. `rg -n 'invalidateUserCache\(|enqueueBudgetEvaluation\(' apps/api/src/routes/transactions.ts apps/api/src/routes/transfers.ts apps/api/src/routes/imports.ts apps/api/src/routes/inbox.ts apps/api/src/routes/recurring.ts` — expect no output

## Required Evidence
- Full list of files changed (and new files created)
- Complete diff (`git diff` for modified files, full contents for new files)
- Literal output of every command above, with exit codes
- Explicit note of any command you could not run (e.g. no live DB/Redis reachable) and why
- Any point where you deviated from this delegation or the approved plan, and why — do not silently change scope or architecture
- Confirmation that `routes/budgets.ts`, `routes/sips.ts`, `routes/emis.ts` were not touched (e.g. `git diff --stat` showing they're absent from the changed-files list)
