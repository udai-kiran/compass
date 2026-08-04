# Plan Review: Domain Event Bus

## Verdict

All three blocking findings from `review-1.md` are resolved. I found no remaining blocking issues. The plan is ready for implementation.

## Resolution of previous blocking findings

1. **Deferred dispatch — resolved**

   P2 now explicitly requires each handler to be dispatched through `queueMicrotask()`. This guarantees that a handler’s synchronous prefix does not execute inside `emit()`.

   The plan also requires per-handler error isolation and tests that the handler has not started immediately after `emit()` returns. AC3 captures the intended scheduling semantics clearly.

2. **Logger dependency — resolved**

   P2 now injects a small logger interface through the `EventBus` constructor, avoiding any Fastify dependency in the bus itself. P4 supplies the application logger at the composition point.

   The plan also explicitly prohibits payload logging and requires both synchronous throws and asynchronous rejections to be logged and swallowed.

3. **Unsubscribe API — resolved**

   `on()` now returns an idempotent unsubscribe function. Unsubscription and `removeAll()` are included in both the test plan and acceptance criteria.

## Remaining blocking issues

None.

The scope, behavior, integration point, tests, acceptance criteria, and verification commands are sufficiently specified to begin implementation.

## Final non-blocking suggestions

- Clarify the logger call shape. The proposed interface is `error(msg, ctx?)`, while existing Fastify/Pino usage in the repository is object-first:

  ```ts
  app.log.error({ err, event }, "domain event subscriber failed");
  ```

  Either define an object-first logger interface compatible with that convention or pass a small adapter into `EventBus`. Ensure the structured context contains the event name and error, but not the payload.

- Make the asynchronous rejection boundary explicit in implementation. A plain synchronous `try/catch` around `handler(payload)` will not catch a later promise rejection. The microtask callback should either `await handler(payload)` inside an async `try/catch` or attach a rejection handler.

- Add a direct assertion that the unsubscribe function is idempotent; P3 currently says only that unsubscribe prevents delivery, while AC5 requires idempotence.

- Define the interaction between snapshot semantics and immediate unsubscription in the test. Because subscribers are snapshotted at emit time, calling the unsubscribe function after `emit()` but before its microtask runs should not cancel that already-emitted delivery. Unsubscription should affect subsequent emissions.

- Assert that one failing subscriber does not prevent another subscriber from running, and that logger calls include the event name and error exactly once. These behaviors are implied by the plan but deserve direct regression coverage.

- Add compile-time checks for inferred handler payload types and mismatched handler types, in addition to the listed unknown-event and wrong-payload cases.

- Consider replacing “zero sync work” with “no subscriber code runs synchronously.” `emit()` still performs bounded synchronous bookkeeping such as looking up and snapshotting subscribers and scheduling microtasks.

These are implementation clarifications and test-strengthening suggestions, not blockers.