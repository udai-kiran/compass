# Verification report — 002-retire-url-regex-hook (independent, iteration 1)

This is an independent, adversarial re-run of the evidence claimed in
`implementation-1.md`. I did not write this code. Nothing was changed as part
of this verification (read-only, plus command execution).

## 1. Changed-file set — `git status --porcelain` / `git diff --stat`

```
$ git status --porcelain
 M .gitignore
 M apps/api/src/app.ts
 M apps/api/src/jobs/index.ts
 M apps/api/src/routes/imports.ts
 M apps/api/src/routes/inbox.ts
 M apps/api/src/routes/recurring.ts
 M apps/api/src/routes/transactions.ts
 M apps/api/src/routes/transfers.ts
 D tasks/00.01-scaffold-monorepo.md
 ... (a large pre-existing, unrelated block of deleted tasks/*.md files, a
      modified tasks/README.md, and ~100 untracked tasks/*.md / ROADMAP.md /
      reviews/ / scripts/ / tasks/00X-*/ entries — all present before this
      task's work started, per the conversation's initial gitStatus context;
      none of these are touched by this task)
?? apps/api/src/app.test.ts
?? apps/api/src/routes/ledger-events.route.test.ts
?? reviews/
?? scripts/
... (rest of the pre-existing untracked noise)
```

```
$ git diff --stat -- apps/api/
 apps/api/src/app.ts                 | 30 ++++++++++++++++++++----------
 apps/api/src/jobs/index.ts          |  7 ++-----
 apps/api/src/routes/imports.ts      | 12 ++++++++++--
 apps/api/src/routes/inbox.ts        | 18 +++++++++++++++---
 apps/api/src/routes/recurring.ts    | 10 +++++-----
 apps/api/src/routes/transactions.ts | 26 +++++++++++++++++++++-----
 apps/api/src/routes/transfers.ts    | 29 ++++++++++++++++-------------
 7 files changed, 89 insertions(+), 43 deletions(-)
```

**Verdict:** exact match to the claimed changed-file set — the 7 modified
`apps/api` files, plus the 2 new (untracked) test files. `apps/api/src/routes/budgets.ts`,
`apps/api/src/routes/sips.ts`, `apps/api/src/routes/emis.ts`, and
`apps/api/src/lib/event-bus.ts` are absent from both listings — confirmed via:

```
$ git status --porcelain apps/api/src/routes/budgets.ts apps/api/src/routes/sips.ts apps/api/src/routes/emis.ts apps/api/src/lib/event-bus.ts
(empty output)
```

The `.gitignore` change and the huge `tasks/*` churn are pre-existing repo
state unrelated to this delegation (visible in the very first gitStatus
snapshot of the conversation, before this verification began) — not part of
this task's diff.

## 2. Full contents read, per-file confirmation

### `apps/api/src/app.ts` (read in full)
- The old `onResponse` regex hook (`/^\/api\/(transactions|transfers|imports|recurring|inbox)/`) is **gone** — no `addHook("onResponse", ...)` anywhere in the file.
- `registerLedgerCacheSubscriber` is exported (line 84):
```
export function registerLedgerCacheSubscriber(app: FastifyInstance): void {
  app.eventBus.on("ledger.mutated", async ({ userId }) => {
    await invalidateUserCache(app.redis, userId);
    await enqueueBudgetEvaluation(app, userId);
  });
}
```
- Called at line 120, right after `app.decorate("eventBus", eventBus)` (line 116) and **before** `await startJobs(app)` (line 122) — order is correct (boot-catchup emits during `startJobs`, so registering first is required and satisfied).

### `apps/api/src/jobs/index.ts` (read in full)
- `recurring.materialize` worker handler (line 244-253): loop over `res.userIds` now calls `app.eventBus.emit("ledger.mutated", { userId })` (line 249) instead of direct `invalidateUserCache`/`enqueueBudgetEvaluation` calls.
- Boot-catchup block (line 372-377): loop over `boot.userIds` calls `app.eventBus.emit("ledger.mutated", { userId })` (line 375).
- `enqueueBudgetEvaluation`'s own `export async function` definition (lines 54-64) is untouched — same debounce jobId scheme `eval-${userId}-${Math.floor(Date.now()/5000)}`, 5000ms delay, unchanged.
- The `invalidateUserCache` import was removed from this file (confirmed absent from the import list at top of file).

### `apps/api/src/routes/transactions.ts` (read in full)
All 5 named handlers emit after a successful await, before returning:
- `POST /api/transactions` (line 44-52): `createTransaction` awaited into `txn`, then emit, then `reply.code(201).send(txn)`.
- `PATCH /api/transactions/:id` (line 63-73): emits after `updateTransaction`.
- `DELETE /api/transactions/:id` (line 75-83): emits after `softDeleteTransaction`.
- `PUT /api/transactions/:id/splits` (line 85-93): emits after `setSplits`.
- `POST /api/transactions/bulk` (line 95-103): emits after `bulkAction`.
- `POST /api/epf-contributions` (line 56-61, `recordEpfContribution`) — **correctly left untouched**, no emit, per Non-Goals (pre-existing gap).

### `apps/api/src/routes/transfers.ts` (read in full)
All 3 named handlers emit after success: `POST /api/transfers` (line 21-34, after `linkTransfer`), `POST /api/transfers/record` (line 38-46, after `createTransfer`), `DELETE /api/transfers/:id` (line 48-61, after `unlinkTransfer`).

### `apps/api/src/routes/imports.ts` (read in full)
- `POST /api/imports/:id/commit` (line 107-115) and `POST /api/imports/:id/rollback` (line 117-125) emit after their awaited result.
- Confirmed **no emit** on: `POST /api/imports` (staging upload, line 42-53), `PUT /api/imports/:id/mapping` (line 83-96), `PATCH /api/imports/:id/rows/:rowId` (line 98-105), `DELETE /api/imports/:id` (line 127-134, only legal on a non-committed batch) — matches the deliberate narrowing.

### `apps/api/src/routes/inbox.ts` (read in full)
- `POST /api/inbox/:id/accept` (line 53-67), `POST /api/inbox/:id/repayment` (line 69-83), `POST /api/inbox/transfer` (line 85-98) all emit after their awaited service call.
- `POST /api/inbox/:id/reject` (line 100-109), `POST /api/inbox/:id/restore` (line 111-120), `POST /api/inbox/:id/unmatch` (line 122-131) — confirmed **no emit**, matches the deliberate narrowing.

### `apps/api/src/routes/recurring.ts` (read in full)
- `materializeNow` helper (line 22-32): both branches — the loop over `res.userIds` (line 25-28) and the `else` single-user branch (line 29-31) — emit `ledger.mutated` instead of calling `invalidateUserCache`/`enqueueBudgetEvaluation` directly.
- `DELETE /api/recurring/:id` (line 66-76): emits `ledger.mutated` after `deleteTemplate` succeeds (line 73) — this is the required review-1 correction, present and correct.
- The direct imports of `invalidateUserCache`/`enqueueBudgetEvaluation` are absent from this file's import list.

### `apps/api/src/lib/event-bus.ts` (read in full, unmodified per Scope)
Confirmed `EventBus.emit()` (line 66-94) is synchronous-return, dispatches each subscriber via `queueMicrotask` (line 75), with per-subscriber try/catch error isolation (lines 76-91). This matches the "fire-and-forget, no immediate assertion after emit()" premise the new tests are built on. File confirmed unmodified (absent from `git status --porcelain`).

### `apps/api/src/routes/budgets.ts`, `sips.ts`, `emis.ts` (grepped, not full-read since out of scope and confirmed untouched)
```
$ grep -n "invalidateUserCache\|enqueueBudgetEvaluation" apps/api/src/routes/budgets.ts apps/api/src/routes/sips.ts apps/api/src/routes/emis.ts
apps/api/src/routes/budgets.ts:23:import { invalidateUserCache } from "../services/cache.ts";
apps/api/src/routes/budgets.ts:24:import { enqueueBudgetEvaluation } from "../jobs/index.ts";
apps/api/src/routes/budgets.ts:32:    await invalidateUserCache(app.redis, userId);
apps/api/src/routes/budgets.ts:33:    await enqueueBudgetEvaluation(app, userId);
apps/api/src/routes/emis.ts:7:import { invalidateUserCache } from "../services/cache.ts";
apps/api/src/routes/emis.ts:8:import { enqueueBudgetEvaluation } from "../jobs/index.ts";
apps/api/src/routes/emis.ts:29:        await invalidateUserCache(app.redis, uid);
apps/api/src/routes/emis.ts:30:        await enqueueBudgetEvaluation(app, uid);
apps/api/src/routes/emis.ts:32:      if (res.userIds.length === 0) await invalidateUserCache(app.redis, req.session!.userId);
apps/api/src/routes/sips.ts:25:import { invalidateUserCache } from "../services/cache.ts";
apps/api/src/routes/sips.ts:50:      await invalidateUserCache(app.redis, req.session!.userId);
apps/api/src/routes/sips.ts:60:      await invalidateUserCache(app.redis, req.session!.userId);
apps/api/src/routes/sips.ts:70:      await invalidateUserCache(app.redis, req.session!.userId);
apps/api/src/routes/sips.ts:80:      await invalidateUserCache(app.redis, req.session!.userId);
apps/api/src/routes/sips.ts:90:      await invalidateUserCache(app.redis, req.session!.userId);
apps/api/src/routes/sips.ts:106:      await invalidateUserCache(app.redis, req.session!.userId);
```
Confirmed unchanged direct calls remain — matches AC2/Non-Goals.

## 3. New test files — full read and quality judgment

### `apps/api/src/app.test.ts` (read in full — matches implementation-1.md's reproduced content exactly)
- Builds a real `Fastify({ logger: false })`, real `createRedis(config.REDIS_URL)`, a real `Queue("alerts", { connection })` mirroring `jobs/index.ts`'s exact connection construction, and a real `EventBus`.
- Calls the exported `registerLedgerCacheSubscriber(app)`, then `app.eventBus.emit(...)`.
- **Correctly avoids asserting immediately after `emit()`**: uses a `pollUntil` helper (10ms interval, 500ms timeout) to poll `cachever:<userId>` in Redis for a change from baseline, and separately polls the alerts queue via `queue.getJob(jobId)` across every 5s bucket the emit could have landed in.
- Asserts both subscriber effects (cache-version bump and the debounced job's presence + `data.userId`), matching TASK.md's P8a requirement to check both, not just one.
- Judgment: this test does what it claims. The bucket-boundary handling (checking a range of candidate jobIds) is a sound way to avoid a boundary-crossing false negative.

### `apps/api/src/routes/ledger-events.route.test.ts` (read in full — matches implementation-1.md's reproduced content exactly)
- `buildTestApp()` follows the `user-tasks.route.test.ts` convention: real Postgres (`createPool`/`createDb`), real Redis, `setupAuth`/`setupSecurity`, no `startJobs`/`buildApp()`. Registers only `transactionRoutes` and a real `EventBus`.
- **P8b**: subscribes via the real `app.eventBus.on(...)` API, `POST`s a valid transaction, asserts 201, then bounded-polls (`pollForEntry`, 10ms/500ms) the observer array for an entry — correctly avoids an immediate post-inject assertion.
- **P8c**: posts a malformed body (`accountId` missing, `amountPaise: 0`), asserts 400, then waits a fixed 500ms quiet period (`waitQuietPeriod`) before asserting `observed.length === 0` **and** that `cachever:<userId>` is still `null` — this is a reasonable, deterministic negative proof, matching TASK.md's P8c requirement ("long enough to rule out 'not yet delivered' rather than 'never emitted'").
- Judgment: this test does what it claims, correctly accounts for `EventBus.emit()`'s fire-and-forget dispatch, and is a faithful match to the P8b/P8c design in TASK.md.

Both files' actual on-disk contents match verbatim what implementation-1.md reproduced — no discrepancy found between the self-report and the real files.

## 4. Commands run (all from `/home/udai/PennyPilot`)

### `npm run typecheck`
```
$ npm run typecheck
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit

> @compass/docs@0.1.0 typecheck
> tsc --noEmit

> @compass/extractor@0.1.0 typecheck
> tsc --noEmit

> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit

> @compass/web@0.1.0 typecheck
> tsc --noEmit

> @compass/ai@0.1.0 typecheck
> tsc --noEmit

> @compass/shared@0.1.0 typecheck
> tsc --noEmit
```
Exit code: `0`

### `npm run lint`
```
$ npm run lint
> compass@0.1.0 lint
> eslint .

/home/udai/PennyPilot/scripts/tasks-to-issues.mjs
   24:14  error  'process' is not defined  no-undef
  110:15  error  'console' is not defined  no-undef
  110:58  error  'process' is not defined  no-undef
  111:5   error  'console' is not defined  no-undef
  112:5   error  'console' is not defined  no-undef
  113:5   error  'console' is not defined  no-undef
  114:5   error  'console' is not defined  no-undef
  116:5   error  'console' is not defined  no-undef
  117:5   error  'console' is not defined  no-undef
  118:5   error  'console' is not defined  no-undef
  119:5   error  'console' is not defined  no-undef
  120:28  error  'console' is not defined  no-undef
  122:3   error  'process' is not defined  no-undef
  149:61  error  'console' is not defined  no-undef
  154:3   error  'console' is not defined  no-undef
  164:1   error  'console' is not defined  no-undef

✖ 16 problems (16 errors, 0 warnings)
```
Exit code: `1`

Confirmed untracked (not part of this task's diff):
```
$ git status --porcelain scripts/tasks-to-issues.mjs
?? scripts/tasks-to-issues.mjs
```

Isolated lint of the actually-changed/created files:
```
$ npx eslint apps/api/src/app.ts apps/api/src/app.test.ts apps/api/src/jobs/index.ts apps/api/src/routes/imports.ts apps/api/src/routes/inbox.ts apps/api/src/routes/recurring.ts apps/api/src/routes/transactions.ts apps/api/src/routes/transfers.ts apps/api/src/routes/ledger-events.route.test.ts
(no output)
```
Exit code: `0`

### Environment reachability check
```
$ timeout 3 bash -c 'cat < /dev/null > /dev/tcp/192.168.2.196/5432' && echo "postgres reachable" || echo "postgres NOT reachable"
postgres reachable
$ timeout 3 bash -c 'cat < /dev/null > /dev/tcp/192.168.2.196/6379' && echo "redis reachable" || echo "redis NOT reachable"
redis reachable
```

### `set -a && source .env && set +a && npm run test -w apps/api` (run twice, independently, from a fresh shell each time)

Run 1 (piped through `tee`, tail shown):
```
✔ registerLedgerCacheSubscriber: ledger.mutated invalidates the user's cache version and enqueues a debounced budget-eval job (198.104028ms)
...
✔ P8b: POST /api/transactions emits ledger.mutated with the requesting user's id (168.762697ms)
✔ P8c: POST /api/transactions with a malformed body (400) emits no ledger.mutated event (528.966577ms)
...
ℹ tests 793
ℹ suites 1
ℹ pass 793
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5778.269101
```

Run 2 (clean redirect, exit code captured directly):
```
$ set -a && source .env && set +a && npm run test -w apps/api > out.txt 2>&1; echo "EXIT_CODE=$?"
EXIT_CODE=0
```
Tail of run 2's output:
```
✔ positionCashFlows: a valuation older than the most recent sell returns null (0.227072ms)
✔ positionCashFlows: a fully exited position with a valuation supplied still appends no terminal flow (0.232221ms)
ℹ tests 793
ℹ suites 1
ℹ pass 793
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5502.84619
```
Both runs: **793 pass, 0 fail, 0 cancelled, 0 skipped, exit code 0.** The three named new tests (`registerLedgerCacheSubscriber: ...`, `P8b: ...`, `P8c: ...`) are present and passing in both runs, confirmed by grep:
```
$ grep -n "registerLedgerCacheSubscriber\|P8b\|P8c" out.txt
6:✔ registerLedgerCacheSubscriber: ledger.mutated invalidates the user's cache version and enqueues a debounced budget-eval job (198.104028ms)
72:✔ P8b: POST /api/transactions emits ledger.mutated with the requesting user's id (168.762697ms)
73:✔ P8c: POST /api/transactions with a malformed body (400) emits no ledger.mutated event (528.966577ms)
```

### `rg -n "onResponse" apps/api/src/app.ts`
```
(no output)
```
Exit code: `1` (ripgrep's "no matches" code) — matches expectation.

### `rg -n 'invalidateUserCache\(|enqueueBudgetEvaluation\(' apps/api/src/routes/transactions.ts apps/api/src/routes/transfers.ts apps/api/src/routes/imports.ts apps/api/src/routes/inbox.ts apps/api/src/routes/recurring.ts`
```
(no output)
```
Exit code: `1` — matches expectation.

## 5. Per-AC verdict

- **AC1** (regex hook deleted, no `/^\/api\/(transactions|...)/ test(req.url)` anywhere): **PASS.** Confirmed by full read of `app.ts` (no `addHook("onResponse", ...)` block remains) and `rg -n "onResponse" apps/api/src/app.ts` → no output.
- **AC2** (`invalidateUserCache`/`enqueueBudgetEvaluation` called from exactly one place — the subscriber — across the six migrated files; `budgets.ts`/`sips.ts`/`emis.ts` unchanged): **PASS.** `rg` on the five route files returns nothing; `jobs/index.ts` read directly, confirming its only remaining reference is `enqueueBudgetEvaluation`'s own definition. `budgets.ts`/`sips.ts`/`emis.ts` grepped and confirmed still calling both functions directly, and confirmed untouched via `git status --porcelain`.
- **AC3** (every path in the migrated set emits `ledger.mutated`): **PASS.** Verified by direct read of each file: 5 transactions handlers, 3 transfers handlers, imports commit/rollback, inbox accept/repayment/transfer, recurring.ts's `materializeNow` (both branches) + `DELETE /api/recurring/:id`, and both `jobs/index.ts` paths (recurring.materialize worker, boot-catchup) all emit.
- **AC4** (budget-eval debouncing preserved unchanged): **PASS.** `enqueueBudgetEvaluation`'s definition in `jobs/index.ts` (lines 54-64) — same `jobId: eval-${userId}-${Math.floor(Date.now()/5000)}`, `delay: 5000` — is byte-identical to what TASK.md/DELEGATION.md describe; only its two call sites changed.
- **AC5** (test proves cache invalidation is event-driven, not URL-based, via P8a/P8b/P8c): **PASS.** Both new test files read in full; P8a isolates the subscriber against a real Fastify/Redis/BullMQ/EventBus and asserts both effects via bounded polling; P8b proves the route emits end-to-end via a real `.on()` observer with bounded polling; P8c proves a 400 emits nothing via a bounded quiet period, checking both the observer and `cachever:<userId>`. All three tests actually ran and passed in a live run (confirmed above), not merely present as source.
- **AC6** (`npm run typecheck`, `npm run lint`, `npm run test -w apps/api` pass with zero new failures): **PASS with the pre-existing exception carved out by the brief.** `typecheck` exits 0. `lint` exits 1 solely due to the untracked, out-of-scope `scripts/tasks-to-issues.mjs` (confirmed via `git status --porcelain`); every file this task touched is independently confirmed lint-clean (`npx eslint <8 files>` → exit 0, no output). `test -w apps/api` passes 793/793, exit 0, run twice independently with identical results.
- **AC7** (fire-and-forget behavior change accepted and documented): **PASS on documentation; NOT independently re-reviewed by Codex in this iteration.** `app.ts`'s comments (lines 75-83, 117-119) and the test files' own header comments document the `queueMicrotask` dispatch and the "no immediate assertion after emit()" consequence. `lib/event-bus.ts` was read and independently confirmed to match this description (line 66-94: synchronous-return `emit()`, `queueMicrotask`-dispatched handlers, per-subscriber try/catch). However, per the implementer's own "Unresolved risks" section, no separate Codex review pass of this diff against `EventBus.emit()`'s implementation was run as part of this delegation — that portion of AC7's "reviewed by Codex" clause is unresolved/outstanding, not something I ran as part of this verification brief either (not asked to run codex-reviewer here).

## Assumptions
- Treated the large pre-existing `tasks/*.md` churn, `ROADMAP.md`, `reviews/`, `scripts/` untracked entries, and `.gitignore` modification as out-of-scope repo state that predates this task (consistent with the very first `gitStatus` snapshot given in this conversation's system context) — not part of this task's diff, and not evaluated further.
- Ran `npm run test -w apps/api` with `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET` sourced from the repo root `.env` (per DELEGATION.md's instruction); both Postgres and Redis at `192.168.2.196` were independently confirmed reachable via raw `/dev/tcp` checks before running, so this was a live run, not a skip.
- Did not re-run `codex-reviewer` against this diff (not requested by this verification brief); AC7's "reviewed by Codex" clause is flagged as unresolved above rather than assumed satisfied.

## Unresolved risks
- AC7's Codex-review clause has not been independently exercised in this verification pass or (per the implementer's own admission) in the implementation pass.
- No discrepancies were found between `implementation-1.md`'s claims and the actual repository state, file contents, or command outputs in this independent re-run.
