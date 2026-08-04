Implementation review verdict: **READY TO MARK COMPLETE**. No blocking findings remain.

## 1. P8a race

**Genuinely fixed.**

The test retains the lower bound captured before emission:

```ts
const firstBucket = Math.floor(beforeEmit / 5000);
```

But the upper bound is now recalculated inside every `pollUntil` iteration:

```ts
async () => {
  const lastBucket = Math.floor(Date.now() / 5000);
  // construct and query candidate IDs through lastBucket
}
```

The production sequence remains:

1. `EventBus.emit()` schedules the subscriber asynchronously.
2. `registerLedgerCacheSubscriber` awaits `invalidateUserCache(...)`.
3. Only after that resolves does it call `enqueueBudgetEvaluation(...)`.
4. `enqueueBudgetEvaluation` evaluates `Math.floor(Date.now() / 5000)` while constructing the BullMQ job options.

Previously, the test could freeze its upper bound after observing the Redis increment but immediately before production selected the next five-second bucket. Now every queue query includes all buckets from `firstBucket` through the bucket current at query time. That upper bound can only advance, so the job’s selected bucket cannot fall beyond it. The identified race is closed.

## 2. File-change scope since review-3

**Yes: the implementation correction is confined to `apps/api/src/app.test.ts`. No production file and no other test file changed after review-3.**

The current worktree is broadly dirty because the original task implementation and substantial unrelated repository churn remain uncommitted. Consequently, raw `git status --porcelain` still lists the original production files, both new tests, and many unrelated task files. `git diff --stat` likewise reports the original seven tracked production-file modifications and cannot include `app.test.ts` because that file remains untracked.

Within the requested historical interval:

- `review-3.md`: `2026-08-02 16:19:30`
- `apps/api/src/app.test.ts`: `2026-08-02 16:22:09`
- Latest production file, `apps/api/src/app.ts`: `2026-08-02 16:12:06`
- Other test, `ledger-events.route.test.ts`: `2026-08-02 16:09:56`

Thus the only API source/test implementation file modified after review-3 was `apps/api/src/app.test.ts`. `TASK.md` and `DELEGATION.md` were also updated as review/delegation metadata, but no production code or other test changed.

## 3. My API test run

Executed exactly from `/home/udai/PennyPilot`:

```sh
set -a && source .env && set +a && npm run test -w apps/api
```

Literal final tally:

```text
ℹ tests 793
ℹ suites 1
ℹ pass 793
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

**Exit code: 0.**

P8a, P8b, and P8c all passed. The Redis `allkeys-lru`/recommended `noeviction` message was informational and did not affect the result.

This confirms review-3’s 557-pass/11-failure result was caused by running without the required environment being exported; it was not a repository test failure.

## 4. Final acceptance verdict

- AC1: satisfied.
- AC2: satisfied.
- AC3: satisfied.
- AC4: satisfied.
- AC5: satisfied robustly now that P8a’s polling race is fixed.
- AC6: satisfied for the task’s changes. My correctly configured API run passed 793/793; the prior independent verification also recorded successful typecheck and clean lint for every task-changed file. Its repository-wide lint failure came exclusively from the unrelated untracked `scripts/tasks-to-issues.mjs`, not this task.
- AC7: satisfied; the fire-and-forget `queueMicrotask` behavior is documented and correctly accommodated by polling tests.

**The task is ready to be marked COMPLETE with no remaining blocking findings.**