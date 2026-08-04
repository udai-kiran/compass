## Review outcome

The plan is directionally sound, but it is not ready to implement unchanged. There are two substantive correctness problems:

1. Excluding recurring-template deletion is unsafe because the cached 90-day forecast reads `recurring_templates`.
2. The claim that all invalidation/evaluation calls will live in exactly one subscriber contradicts the explicitly out-of-scope direct callers in budgets, SIPs, and EMIs.

There are also gaps in the production mutation call graph, an asynchronous testing race, and verification commands that would not prove the stated acceptance criteria.

## Findings

### 1. High: recurring-template deletion must invalidate the forecast cache

The narrowing analysis incorrectly says that the three cached read areas never consume template state. `getForecast()` is wrapped in `cached()` and directly queries active `recurringTemplates` to construct projected obligations:

- [`cashflow.ts:55`](/home/udai/PennyPilot/apps/api/src/services/cashflow.ts:55) enters the `cached()` wrapper.
- [`cashflow.ts:83`](/home/udai/PennyPilot/apps/api/src/services/cashflow.ts:83) reads `recurringTemplates`.

Deleting a template therefore changes the value of `cache:<user>:<ver>:forecast:90`. If the delete route emits nothing, a previously cached forecast can continue showing the deleted obligation for up to the five-minute TTL.

The plan’s statement at [`TASK.md:24`](/home/udai/PennyPilot/tasks/002-retire-url-regex-hook/TASK.md:24) that cached reads never consume template state is false. P6 must retain invalidation for `DELETE /api/recurring/:id`.

Because the proposed event subscriber couples cache invalidation with budget evaluation, the simplest in-scope correction is to emit `ledger.mutated` after successful template deletion too. That causes a redundant budget evaluation, but it is safe and preserves the single-event design. A more semantically exact cache-only event would expand scope and is unnecessary for this task.

Recurring create and update also need cache invalidation even when `materializeDue()` creates no transaction, because they change that same forecast input. The existing `materializeNow` fallback does this, and the proposed fallback emit preserves it. Its event name is semantically broader than an actual ledger mutation, but the behavior is necessary.

### 2. High: AC2 and T5 contradict the plan’s non-goals

The current direct call sites are:

- Hook: [`app.ts:200`](/home/udai/PennyPilot/apps/api/src/app.ts:200) and [`app.ts:201`](/home/udai/PennyPilot/apps/api/src/app.ts:201)
- Recurring HTTP helper: [`recurring.ts:29`](/home/udai/PennyPilot/apps/api/src/routes/recurring.ts:29)
- Recurring job: [`jobs/index.ts:250`](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:250)
- Recurring boot catch-up: [`jobs/index.ts:377`](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:377)
- Budgets: [`budgets.ts:32`](/home/udai/PennyPilot/apps/api/src/routes/budgets.ts:32)
- SIPs: [`sips.ts:50`](/home/udai/PennyPilot/apps/api/src/routes/sips.ts:50), plus five more calls in that route file
- EMIs: [`emis.ts:29`](/home/udai/PennyPilot/apps/api/src/routes/emis.ts:29)

`enqueueBudgetEvaluation` is directly invoked by the hook, recurring paths, budgets, and EMIs. `invalidateUserCache` is also directly invoked by SIP routes.

The plan acknowledges budgets/SIPs/EMIs as non-goals at [`TASK.md:70`](/home/udai/PennyPilot/tasks/002-retire-url-regex-hook/TASK.md:70), but AC2 says the two functions will be called “from exactly one place” and T5 says the routes/jobs grep will show no direct calls. Both will necessarily fail if the non-goals are respected.

The scope can remain narrow, but the criteria must instead say:

- Among the five URL-prefix route families and recurring job paths being migrated, all invalidation/evaluation is driven by the subscriber.
- Existing direct calls in budgets, SIPs, and EMIs remain unchanged.

Alternatively, migrating every existing direct caller onto the event is coherent, but that is a larger cleanup than retiring this regex and should be an explicit scope expansion.

### 3. Medium: route-level emission fits the layering, but it is not a complete “every ledger mutation” architecture

Keeping `EventBus` out of services agrees with the repository convention that services accept a `Db | Tx` plus `userId`, while Fastify owns infrastructure wiring. Threading a Fastify instance or event bus into all services would weaken that separation. For the listed HTTP paths, emitting from the successful outer route is reasonable.

However, the plan’s broader claim that this covers every production ledger-mutating call path is not true. There are existing production services outside the listed route families that invoke transaction services or write ledger rows:

- `recordEpfContribution()` calls `createTransaction()`, reached through `POST /api/epf-contributions` in [`transactions.ts:52`](/home/udai/PennyPilot/apps/api/src/routes/transactions.ts:52).
- `logPremium()` calls `createTransaction()` in [`insurance.ts:322`](/home/udai/PennyPilot/apps/api/src/services/insurance.ts:322), reached through the insurance route.
- `createTransfer()` and inbox accept functions call transaction/transfer services internally, although their outer routes are included in the plan.
- Import commit performs its own transaction-related writes and auto-linking, with its outer route included.
- EMI materialization writes recurring ledger transactions and already has separate invalidation logic.

The EPF and insurance paths are not new background jobs or scripts, but they demonstrate the limitation of route emission: adding or reusing a ledger-writing service does not automatically produce an event. The proposed architecture removes URL coupling but replaces it with caller-discipline coupling.

For the explicitly scoped five route families, I found no unlisted production job, script, ingestor, extractor, or other non-test caller of `commitImport`, `rollbackImport`, inbox accept operations, or transaction CRUD that bypasses the identified outer paths. `materializeDue()` has the three known production callers:

- Recurring routes
- Recurring BullMQ handler
- Boot catch-up
- Additionally, the EMI route invokes it and already handles affected users separately at [`emis.ts:27`](/home/udai/PennyPilot/apps/api/src/routes/emis.ts:27)

Tests call these services directly, but service tests should not be expected to trigger infrastructure side effects.

Recommendation: retain route/job emission, but narrow the stated invariant to “all in-scope outer production callers emit.” Add a code comment or checklist noting that future non-HTTP callers must emit explicitly. Do not claim that the service layer itself guarantees emission.

### 4. Medium: the event changes awaited behavior to fire-and-forget behavior

The current `onResponse` hook awaits invalidation and enqueueing. The existing `EventBus.emit()` returns synchronously and dispatches subscribers through `queueMicrotask()` in [`event-bus.ts:58`](/home/udai/PennyPilot/apps/api/src/lib/event-bus.ts:58).

Consequences:

- A route can finish before Redis `INCR` completes.
- A recurring worker can finish and BullMQ can mark the materialization job successful before invalidation/enqueueing completes.
- Boot catch-up can proceed before its side effects complete.
- A test that emits and immediately reads `cachever:<userId>` is racy.
- Subscriber failures are logged but cannot fail the originating job or request.

This may be an acceptable deliberate move to best-effort side effects, especially because `enqueueBudgetEvaluation()` already catches its own queue errors. But it does not preserve today’s ordering semantics as the plan implies. The plan should explicitly accept this behavioral change.

Tests must wait for microtask dispatch and the asynchronous Redis operation to settle. A single `await Promise.resolve()` only starts an async subscriber and may not wait for Redis. A completion signal from a test subscriber, polling the version with a short deadline, or an extracted subscriber function invoked directly is more reliable.

### 5. Medium: P8’s throwaway route does not prove production wiring is URL-independent

P8(b) proposes manually registering an event bus, subscriber, and arbitrary route. That proves the manually constructed test harness has no URL dependency; it does not prove the subscriber in `app.ts` is wired correctly or that production contains no residual URL hook. It risks duplicating the exact code under test.

A cleaner strategy consistent with the repository’s `node:test` conventions is:

- Add a focused test for a production-exported wiring function, for example `registerLedgerMutationSubscriber(app)`, using stub Redis/queues or function dependencies.
- Add a minimal transaction-route injection test with a decorated `EventBus` or event-bus spy and assert that the successful route emits the expected user ID.
- Assert a failed mutation does not emit.
- Use static verification to ensure `app.ts` no longer contains the `onResponse` URL-matching hook.

If extracting a wiring function is judged unnecessary, the simpler minimum is:

- A route test that decorates `eventBus` with a spy and proves `POST /api/transactions` emits.
- Existing `EventBus` tests for dispatch behavior.
- Source-level grep/inspection proving the regex hook is gone.

There is no need for an arbitrary URL route. Once the production route explicitly calls `eventBus.emit`, its URL is visibly irrelevant.

Also, the cited `user-tasks.route.test.ts` warns that its harness intentionally does not use `buildApp()` because `startJobs()` performs global boot work and leaves an ingestor queue connection open. A new test should not call the real `buildApp()` merely to exercise the subscriber.

### 6. Medium: success-only emission needs careful handler restructuring

Several handlers currently use concise expressions such as:

```ts
reply.code(201).send(await createTransaction(...))
```

Adding `emit()` requires storing the successful result first, then emitting, then returning it. That is straightforward, but important: emission must occur only after the awaited service promise resolves.

For bulk actions, the plan currently emits after every successful call. Verify whether a successful bulk result can represent zero affected rows. If so, this is harmless over-invalidation, but it should be recognized.

For import commit and rollback, successful no-op/repeated behavior also matters:

- Emitting after a successful result is safe even if zero rows changed.
- Do not emit before transaction commit or from inside a transaction that may later roll back.

For `materializeDue`, use `res.userIds`, not merely `res.created > 0`, as the authoritative fan-out. The current implementation pairs them, but user IDs are the actual invalidation targets.

### 7. Medium: event naming does not match every required emission

The plan calls the event `ledger.mutated`, yet recurring create/update with no materialization still emit solely to refresh a forecast derived from template state. Recurring template deletion must do the same.

That is tolerable for a small refactor, but the plan should state explicitly that the event currently means “ledger-derived cached views may have changed,” not strictly “a transaction row was written.” Otherwise later maintainers may repeat the same mistaken narrowing.

The alternative—separate `cache.inputsChanged` and `ledger.mutated` events—would be cleaner semantically but oversized for this task.

### 8. Low: subscriber registration order does matter for boot catch-up

P1 says registration order does not matter because handlers run only on a later emit. Once `startJobs()` itself emits during boot catch-up, registration must occur before `await startJobs(app)`.

The proposed location immediately after `app.decorate("eventBus", eventBus)` is correct, but the rationale at [`TASK.md:45`](/home/udai/PennyPilot/tasks/002-retire-url-regex-hook/TASK.md:45) is incorrect. If registration moved below `startJobs`, boot-catch-up events would be lost.

Route registration ordering is otherwise not a problem because routes do not execute during registration.

### 9. Low: T4 does not reliably test what it claims

The proposed command:

```sh
grep -rn "api/(transactions|transfers|imports|recurring|inbox)" apps/api/src
```

uses basic grep syntax, where unescaped parentheses and `|` are generally literals. It can return no matches even while the current regex hook remains.

Use `rg` with the precise construct, for example:

```sh
rg -n 'req\.url|onResponse|transactions\|transfers\|imports\|recurring\|inbox' apps/api/src/app.ts
```

More directly, review the resulting `app.ts` and assert no URL-dependent invalidation hook remains.

T5 must also be corrected for the budgets/SIPs/EMIs exceptions described above.

## Answers to the requested questions

1. The routes-emit design is consistent with the current service-layer convention and is preferable to passing Fastify/EventBus into services. For the named imports/inbox/transaction/transfer/recurring operations, the production outer callers are substantially complete, including the known recurring job and boot paths. However, it is not a universal guarantee: EPF contribution, insurance premium logging, EMI materialization, and composite services demonstrate that ledger writes occur outside the listed routes. The plan must state an in-scope caller invariant rather than “every ledger-mutating path.”

2. Narrowing imports staging and inbox reject/restore/unmatch is safe with respect to the versioned aggregate cache: those operations do not affect dashboard, trends, forecast, or insights inputs. The other Redis uses are sessions, rate limiting, recent searches, locks, and AI-related state; they do not depend on this cache-version increment. No BullMQ job consumes import staging or inbox status through this invalidation path. Recurring-template deletion is not safe to exclude because the cached forecast reads active recurring templates directly.

3. The raw current call-site list includes the hook, recurring route helper, recurring worker, boot catch-up, budgets, SIPs, and EMIs. The plan identifies the hook and recurring sites and mentions budgets/SIPs/EMIs only under non-goals. Therefore the Scope section is not a complete list of all current calls, and AC2/T5 are inaccurate as written.

4. P8’s arbitrary-route harness is not strong evidence because it duplicates the wiring. Prefer a focused production subscriber-wiring test plus a route emission spy, with an explicit wait for asynchronous EventBus delivery. Static inspection/grep should prove the absence of URL matching. This is simpler and better aligned with the existing lightweight `node:test` style.

5. Principal regression risks are stale forecast data after template deletion, fire-and-forget ordering/error semantics, racy tests, lost boot events if registration moves below `startJobs`, and future service reuse without a corresponding outer emission. The plan should also cover failure/no-op behavior explicitly and reconcile its event semantics with template-only changes.

6. The intended scope is appropriately small if it remains “replace this URL hook and migrate the recurring direct paths.” It should not absorb all budgets/SIPs/EMIs/EPF/insurance cleanup unless the task is deliberately broadened. It otherwise respects `CLAUDE.md`: services remain `Db | Tx` plus `userId`, imports use `.ts`, no backend build step is introduced, and no money representation changes are involved. The necessary scope correction is to keep recurring-template deletion invalidating, revise the overbroad acceptance criteria, and strengthen the test/verification strategy.