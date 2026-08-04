Implementation review verdict: **NOT READY TO MARK COMPLETE**.

The production implementation satisfies P1–P7 and AC1–AC4/AC7. However, P8a contains a real bucket-boundary race, and the required AC6 verification does not currently pass.

## Findings

### Blocking

1. **P8a can falsely fail across a 5-second debounce boundary.**

   In [app.test.ts](/home/udai/PennyPilot/apps/api/src/app.test.ts:77), candidate job IDs are fixed using the interval from immediately before `emit()` through the moment the cache-version poll observes the increment:

   - `beforeEmit` is captured at line 77.
   - Cache invalidation is observed at lines 81–90.
   - `lastBucket` is fixed from `afterEmit` at lines 96–100.
   - Only those precomputed IDs are polled at lines 103–112.

   But the subscriber awaits cache invalidation before calling `enqueueBudgetEvaluation`:

   - [app.ts](/home/udai/PennyPilot/apps/api/src/app.ts:85) awaits `invalidateUserCache`.
   - It then calls `enqueueBudgetEvaluation` at line 87.
   - The actual job ID uses `Date.now()` inside [jobs/index.ts](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:59).

   The test can observe the Redis increment just before a 5-second boundary, set `lastBucket` to the old bucket, and then the subscriber can resume and enqueue into the next bucket. The subsequent poll never considers that job ID.

   This is a narrow race, but it is genuine and makes the required subscriber proof flaky. The poll should dynamically include the current bucket on each iteration, record a time after the job is found, or query the queue for the matching user/job rather than freezing candidates before enqueue completion.

2. **AC6 is not satisfied by the current repository verification results.**

   Executed from the repository root:

   - `npm run typecheck`: **passed**, exit code 0.
   - `npm run lint`: **failed**, exit code 1.
   - `npm run test -w apps/api`: **failed**, exit code 1.

   Lint’s 16 errors are all in the unrelated, untracked `scripts/tasks-to-issues.mjs`, rather than this implementation diff. Nevertheless, AC6 literally requires the command to pass.

   The API suite reported 557 passes and 11 failures. The failures are caused by missing `DATABASE_URL`, `REDIS_URL`, and `SESSION_SECRET`, including both new tests and several pre-existing database-backed tests. Therefore there is no evidence that the two new integration tests actually pass against live dependencies.

   This is partly an environment/repository-state verification blocker rather than demonstrated production-code breakage, but AC6 cannot receive a satisfied verdict until the prescribed commands pass in the intended test environment.

### Non-blocking

1. **The P8c cache assertion does not independently prove anything about failed-route invalidation.**

   [ledger-events.route.test.ts](/home/udai/PennyPilot/apps/api/src/routes/ledger-events.route.test.ts:191) asserts that `cachever:<userId>` is absent, but this test harness deliberately does not register `registerLedgerCacheSubscriber`. Consequently, the cache would remain unchanged even if the route emitted erroneously.

   The observer assertion at lines 186–189 is the meaningful negative proof and correctly satisfies P8c. The extra cache assertion is harmless but evidentially redundant.

2. **The 500 ms integration polling windows may be sensitive to a heavily loaded Redis/CI host.**

   Both new tests follow the approved 300–500 ms guidance, so this is not a plan violation. Increasing the bound would improve resilience without changing semantics.

## Plan-item review

- **P1 — Satisfied.** The regex-based `onResponse` hook is deleted. `registerLedgerCacheSubscriber` is exported at [app.ts](/home/udai/PennyPilot/apps/api/src/app.ts:84), subscribes to `ledger.mutated`, and invokes cache invalidation followed by budget evaluation. It is registered immediately after the event-bus decoration at lines 116–120 and before `startJobs(app)` at line 122.

- **P2 — Satisfied.** All five scoped transaction handlers emit after their awaited service operation succeeds: create, update, delete, set splits, and bulk action. The out-of-scope EPF-contribution route remains unchanged.

- **P3 — Satisfied.** Link, record, and unlink transfer handlers all emit after successful awaited service calls.

- **P4 — Satisfied.** Import commit and rollback emit after successful service completion. Upload/staging, mapping, row edit, and delete-uncommitted do not emit.

- **P5 — Satisfied.** Inbox accept, repayment, and transfer emit after successful service completion. Reject, restore, and unmatch do not emit.

- **P6 — Satisfied.** `materializeNow` emits once for each returned `userId`, and its empty-result branch emits for the requesting user. Recurring-template deletion emits after `deleteTemplate` succeeds. This deletion emit is correct because [cashflow.ts](/home/udai/PennyPilot/apps/api/src/services/cashflow.ts:55) caches `getForecast()`, whose computation directly reads active `recurringTemplates`.

- **P7 — Satisfied.** The recurring worker and boot catch-up both emit per returned user ID at [jobs/index.ts](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:249) and [jobs/index.ts](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:375). Their former direct invalidation/enqueue calls and the cache import are removed. `enqueueBudgetEvaluation` itself remains unchanged.

- **P8 — Not fully satisfied.** P8b and P8c have the required real-event-bus observer and asynchronous wait behavior. P8a uses real Fastify, Redis, BullMQ, and production subscriber wiring and asserts both effects, but its frozen job-ID candidates introduce the race described above. Its execution also could not be verified without the required environment.

## Acceptance-criteria verdicts

- **AC1 — Satisfied.** The URL-regex hook is gone. No production `onResponse` hook or matching URL regex remains.

- **AC2 — Satisfied.** Within the migrated files, direct invalidation/enqueue call sites are removed. The subscriber in `app.ts` is the single migrated-path call site. `budgets.ts`, `sips.ts`, and `emis.ts` have no diff and retain their existing direct behavior.

- **AC3 — Satisfied.** Every explicitly scoped route and both recurring job paths emit with the authoritative user ID. Explicitly excluded import and inbox handlers do not emit.

- **AC4 — Satisfied.** `enqueueBudgetEvaluation` remains unchanged, including its 5-second job-ID bucket and delay.

- **AC5 — Not satisfied robustly.** The tests have the intended architecture, but P8a’s bucket-boundary race means the two-effect subscriber proof is not deterministic.

- **AC6 — Not satisfied.** Typecheck passes; lint and the API test command do not currently pass. Lint failure is unrelated to the reviewed diff, while tests are blocked by absent service environment variables.

- **AC7 — Satisfied.** `EventBus.emit()` remains unmodified and dispatches subscribers asynchronously via `queueMicrotask`. The resulting fire-and-forget completion behavior is explicitly accepted and documented in `TASK.md`.

No service-layer convention violations, missing `.ts` extensions, unsafe Fastify casts, unintended protected-file changes, or production correctness regressions were found. The task should remain incomplete until the P8a race is corrected and AC6 is successfully verified in a properly configured repository/test environment.