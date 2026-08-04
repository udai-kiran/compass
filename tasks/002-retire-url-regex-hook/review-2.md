## Review outcome

The revised plan is substantially improved and resolves most review-1 findings. However, it is not yet ready for `APPROVED` unchanged.

Two test-plan issues remain:

1. P8a’s “minimal fake app object” will not type-check when passed to a function declared as `registerLedgerCacheSubscriber(app: FastifyInstance)`, unless it is unsafely cast or the function’s dependency type is narrowed.
2. P8a is still asynchronous and racy: calling `EventBus.emit()` and immediately asserting that the Redis stub ran does not wait for the queued microtask or the async subscriber.

There is also a new verification error: T5 cannot return no matches because `apps/api/src/jobs/index.ts` contains the definition of `enqueueBudgetEvaluation` itself.

With those corrections, the plan can move to `APPROVED`.

## Review-1 findings

### 1. High #1: recurring-template deletion invalidation — resolved

The revised plan is correct to emit `ledger.mutated` after successful `DELETE /api/recurring/:id`.

`getForecast()` in `apps/api/src/services/cashflow.ts`:

- Executes inside `cached(redis, userId, "forecast:90", TTL, ...)`.
- Queries active `recurringTemplates`.
- Uses those templates to construct forecast obligations.

The current delete handler in `apps/api/src/routes/recurring.ts` successfully calls `deleteTemplate()` and returns without any explicit invalidation, relying on the existing URL hook. Once that hook is removed, an explicit event is necessary or the cached forecast can retain the deleted obligation until its TTL expires.

The proposed placement—after `await deleteTemplate(...)` succeeds—is correct and success-only. The plan also correctly explains that `ledger.mutated` has the broader practical meaning “ledger-derived cached views may have changed.”

Status: genuinely resolved.

### 2. High #2: AC2/T5 “exactly one place” overclaim — conceptually resolved, but T5 command is still wrong

The revised AC2 now limits its invariant to:

- `transactions.ts`
- `transfers.ts`
- `imports.ts`
- `inbox.ts`
- `recurring.ts`
- The recurring worker and boot-catchup paths in `jobs/index.ts`

It explicitly leaves `budgets.ts`, `sips.ts`, and `emis.ts` unchanged. That framing is internally consistent: “exactly one place” now applies only within the migrated set, not across the entire application.

The current source confirms the listed exceptions:

- `routes/budgets.ts` directly calls both `invalidateUserCache` and `enqueueBudgetEvaluation`.
- `routes/sips.ts` directly calls `invalidateUserCache` in six handlers.
- `routes/emis.ts` directly calls both functions after `materializeDue()`, with an invalidation-only fallback when no users materialize.

Those routes were never covered by the old URL regex, so leaving them untouched is a coherent non-goal.

However, T5 says this command should return nothing:

```sh
rg -n 'invalidateUserCache|enqueueBudgetEvaluation' \
  apps/api/src/routes/transactions.ts \
  apps/api/src/routes/transfers.ts \
  apps/api/src/routes/imports.ts \
  apps/api/src/routes/inbox.ts \
  apps/api/src/routes/recurring.ts \
  apps/api/src/jobs/index.ts
```

That cannot return nothing because `jobs/index.ts` defines and exports `enqueueBudgetEvaluation`:

```ts
export async function enqueueBudgetEvaluation(...)
```

The definition is intentionally untouched by this task and will match T5 even after all targeted direct calls are removed.

T5 should search specifically for call expressions, or treat `jobs/index.ts` separately. For example:

```sh
rg -n 'invalidateUserCache\(|await enqueueBudgetEvaluation\(' \
  apps/api/src/routes/transactions.ts \
  apps/api/src/routes/transfers.ts \
  apps/api/src/routes/imports.ts \
  apps/api/src/routes/inbox.ts \
  apps/api/src/routes/recurring.ts
```

Then separately inspect the recurring worker/boot sections of `jobs/index.ts`, or use a pattern that excludes the function declaration.

Status: the acceptance-criterion overclaim is resolved, but its verification command still requires correction.

### 3. Medium #3: universal mutation-coverage overclaim — resolved

The revised plan accurately identifies both pre-existing gaps:

- `recordEpfContribution()` calls `createTransaction()` inside a DB transaction and is reached through `POST /api/epf-contributions`.
- `logPremium()` at `services/insurance.ts:322` calls `createTransaction()` and is reached through the insurance route.

Neither URL was matched by the existing regex, so excluding them does not introduce a new regression. The revised Objective expressly says the task does not claim universal coverage, and the Non-Goals section explicitly records both gaps.

The plan’s route-emission design consequently guarantees caller discipline only for the enumerated migrated paths. It no longer claims service-layer or application-wide automatic coverage.

Status: genuinely resolved.

### 4. Medium #4: fire-and-forget behavior and asynchronous testing — behavior documented, P8b fixed, P8a still flawed

The revised “Accepted behavior change” paragraph accurately describes the current `EventBus.emit()` implementation:

- `emit()` returns `void` synchronously.
- Every subscriber is started through `queueMicrotask()`.
- Async subscriber failures are caught and logged by the event bus.
- The request, recurring worker, or boot path does not wait for cache invalidation or budget-enqueue completion.

That is a real ordering change from the current awaited hook/direct recurring calls. The plan now acknowledges it clearly.

P8b’s bounded Redis polling is a sound strategy. A single microtask wait would not be enough because the subscriber awaits an asynchronous Redis command. Polling the cache-version key until it changes or a short deadline expires verifies eventual completion without assuming exact scheduler or Redis timing.

The polling test should record the key’s baseline value before injection and wait for a change relative to that baseline. It should use a unique test user and bounded delay/deadline to avoid interference and hangs.

P8a, however, still says:

> calling `emit("ledger.mutated", { userId })` and asserting `invalidateUserCache` ran

If that means an immediate assertion, it retains the exact race identified in review-1. The stub cannot be expected to have run when `emit()` returns because even synchronous subscriber code is deferred to a microtask.

P8a needs an explicit completion mechanism, such as:

- A deferred promise resolved by the Redis `incr` stub, awaited with a timeout.
- A short bounded poll of the stub’s call count.
- An exported subscriber callback that can be invoked and awaited directly, while separately testing that registration attaches it to the event bus.

A completion promise from the stub is the cleanest choice.

There is also a misleading sentence in the accepted-change paragraph:

> nothing about this weakens error handling

The new behavior does weaken propagation and completion guarantees: subscriber failure can no longer affect the originating operation, and the originating worker may be marked successful first. The paragraph otherwise describes this correctly, so that sentence should be replaced with something like: “Failures remain isolated and logged, but they no longer propagate to or delay the originating request/job.”

Status: behavior analysis and P8b are resolved; P8a’s asynchronous test design is not fully resolved.

### 5. Medium #5: production wiring test design — direction resolved, fake typing introduces an implementation blocker

Extracting and exporting the real `registerLedgerCacheSubscriber` function is a good design. It avoids reimplementing production subscriber logic in a throwaway test harness.

The P8b route-injection test also fits the repository’s established conventions:

- Construct a lightweight Fastify instance.
- Decorate only the infrastructure needed by the route.
- Use real Postgres/Redis.
- Register the real authentication and security plugins.
- Register only the relevant route.
- Use `app.inject()`.
- Avoid `buildApp()` and its global boot jobs/queue connections.

That matches `user-tasks.route.test.ts`.

However, P8a’s proposed “minimal fake app object” will not type-check against:

```ts
registerLedgerCacheSubscriber(app: FastifyInstance): void
```

A plain object such as `{ redis, queues, eventBus, log }` is not structurally assignable to `FastifyInstance`, which requires the complete Fastify server interface and all augmented decorations. This is a genuine new flaw in the revised plan.

The plan should choose one of these approaches:

1. Narrow the function parameter to the dependencies it actually uses, preferably through a named type:

```ts
type LedgerCacheSubscriberApp = Pick<
  FastifyInstance,
  "eventBus" | "redis" | "queues" | "log"
>;

export function registerLedgerCacheSubscriber(
  app: LedgerCacheSubscriberApp,
): void {
  // ...
}
```

A fake must then provide all four dependencies, including a real/stub `queues.alerts.add`.

2. Construct a real Fastify instance in P8a and decorate it with the required stubs.

3. Extract the actual async subscriber body as a separately testable function with narrow dependencies, then have `registerLedgerCacheSubscriber()` only register that callback.

An unsafe `as FastifyInstance` cast would make the test compile but would hide missing runtime dependencies and should not be the planned solution.

P8a also says `queues` may be omitted because `enqueueBudgetEvaluation()` catches failures. Runtime access to `app.queues.alerts.add` is indeed inside its `try`, so an absent `queues` value would be caught. Its catch then calls `app.log.warn`, so the logger still must be present. Nevertheless, deliberately triggering a caught `TypeError` is a poor subscriber test and fails to verify the subscriber’s second required side effect.

P8a should provide:

```ts
queues: {
  alerts: {
    add: async (...) => { /* record call */ }
  }
}
```

or an appropriately typed stub, and assert both:

- Redis `INCR cachever:<userId>` was requested.
- The alerts queue received the expected debounced evaluation job.

Otherwise P8a proves only half of `registerLedgerCacheSubscriber`’s contract.

Status: the production-wiring strategy is sound, but the proposed minimal fake does not type-check and should not omit the queue dependency.

### 6. Medium #6: success-only restructuring — resolved

The revised P2–P5 explicitly require:

- Awaiting the service result first.
- Emitting only after success.
- Emitting outside service-owned DB transactions.
- Storing results from concise handlers before emitting.
- Accepting harmless over-invalidation for successful zero-row bulk/no-op results.

P6 and P7 correctly use `res.userIds` as the authoritative fan-out list.

Status: genuinely resolved.

### 7. Medium #7: event-name semantics — resolved

The plan now explicitly says `ledger.mutated` means, in practice, “ledger-derived cached views may have changed.” It explains why recurring template create/update/delete events are valid even without a transaction-row mutation.

Status: genuinely resolved.

### 8. Low #8: subscriber registration order — resolved

The revised plan requires registration immediately after decorating `eventBus` and before `await startJobs(app)`. This is correct because `startJobs()` executes the recurring boot catch-up and can emit during application construction.

Status: genuinely resolved.

### 9. Low #9: ineffective regex-hook verification — resolved

T4 now uses:

```sh
rg -n "onResponse" apps/api/src/app.ts
```

and requires direct inspection of `app.ts`. This will reliably detect the existing hook and avoids the basic-`grep` metacharacter problem from review-1.

Status: genuinely resolved.

## Additional new findings

### Medium: T5 necessarily matches the function definition

As described above, `jobs/index.ts` owns the definition of `enqueueBudgetEvaluation`, so including that file in an unqualified name search cannot produce the expected empty result. This is a verification false failure, not a production design problem.

### Medium: P8a tests only invalidation, not budget-evaluation enqueueing

The subscriber’s production contract consists of two ordered actions:

1. `invalidateUserCache`
2. `enqueueBudgetEvaluation`

P8a currently proposes asserting only the first and suggests omitting the queue entirely. This would allow a broken subscriber that never enqueues budget evaluation to pass its focused wiring test. Provide a queue stub and verify both calls.

### Low: P8c must wait long enough to distinguish “no event” from “event not delivered yet”

For a malformed request, immediately seeing an unchanged cache version is insufficient evidence because a wrongly emitted event might still be queued.

The negative test should:

- Record the baseline.
- Inject the failing request.
- Wait through a small bounded quiet period that is long enough for queued microtasks and Redis operations under the test environment.
- Confirm the value remains at the baseline.

A spy event bus can provide a more deterministic success-only negative test: assert that `emit` was never called for the 400 response. The Redis negative remains useful end-to-end, but its timing requirement should be explicit.

### Low: P8a’s queue-error rationale should be removed

Although `enqueueBudgetEvaluation()` catches an absent `app.queues` access at runtime, intentionally relying on that catch:

- Produces a warning.
- Does not verify enqueueing.
- Conflicts with the declared Fastify type.
- Makes a wiring defect appear to be expected behavior.

The fake should contain a queue stub instead.

## Final determination

The substantive production plan is now correct:

- Recurring deletion invalidates the forecast.
- The migrated-set claim is properly scoped.
- Budgets/SIPs/EMIs are accurately documented as unchanged direct callers.
- EPF and insurance are accurately documented pre-existing gaps.
- Event semantics and fire-and-forget ordering are explicit.
- Route/job emissions are success-only and use correct user fan-out.
- Subscriber registration precedes boot catch-up.
- The production-wiring and route-injection testing approach is appropriate.

The plan should not move to `APPROVED` until these concrete edits are made:

1. Give `registerLedgerCacheSubscriber` a narrow dependency type, or use a real decorated Fastify instance in P8a; do not pass a plain minimal object to a `FastifyInstance` parameter through an unsafe cast.
2. Make P8a explicitly await a completion signal after `emit()`.
3. Stub `queues.alerts.add` and verify both cache invalidation and budget-evaluation enqueueing.
4. Make P8c’s negative assertion asynchronous/deterministic.
5. Fix T5 so it does not match the intentional `enqueueBudgetEvaluation` function definition in `jobs/index.ts`.
6. Reword the claim that fire-and-forget delivery does not weaken error handling, because it does remove propagation and completion guarantees.

After those targeted corrections, the plan is suitable for approval and implementation.