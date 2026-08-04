## Review verdict

Changes requested. One blocking correctness defect violates the approved P2 behavior, and the test suite does not cover it. No app integration regression or payload-logging issue was found.

## Blocking finding

1. Duplicate registrations do not work as specified

[event-bus.ts](/home/udai/PennyPilot/apps/api/src/lib/event-bus.ts:24) stores subscribers in a `Set`, and [line 44](/home/udai/PennyPilot/apps/api/src/lib/event-bus.ts:44) adds the handler by identity. Registering the same function twice therefore creates only one subscription and invokes it once.

P2 explicitly requires: “Duplicate registrations allowed (same handler registered twice fires twice).”

This also makes unsubscribe semantics incorrect for duplicate registrations: each `on()` call should represent an independent subscription, but either returned unsubscribe currently deletes the sole shared entry.

Use independent registration records or an array so duplicate function references remain distinct. Add a regression test that:

- Registers the same handler twice.
- Verifies one emit invokes it twice.
- Unsubscribes one registration.
- Verifies the next emit invokes it once.
- Unsubscribes the second registration and verifies no further delivery.

## Non-blocking findings

1. The 12 tests omit the duplicate-registration requirement

The “multiple subscribers” test at [event-bus.test.ts:41](/home/udai/PennyPilot/apps/api/src/lib/event-bus.test.ts:41) uses three different function objects. It therefore cannot detect the `Set` deduplication defect.

P3/AC4’s enumerated test cases are otherwise present, but P2’s explicit behavior is unproven.

2. AC8 could not be verified in the current environment

`npm run test -w apps/api` failed: 556 tests passed and 9 failed because `DATABASE_URL` was not set for existing database-backed tests. The new 12-test EventBus suite passed within that run.

These failures do not indicate an EventBus regression, but AC8 is not currently proven.

3. AC9 could not be verified repository-wide

`npm run lint` failed with 16 pre-existing/unrelated `no-undef` errors in `scripts/tasks-to-issues.mjs` concerning `process` and `console`. No lint errors were reported in the three reviewed files, but AC9 as written is not satisfied by the current checkout.

4. The “deferred-promise test” is named more strongly than implemented

[event-bus.test.ts:115](/home/udai/PennyPilot/apps/api/src/lib/event-bus.test.ts:115) correctly proves that no handler code begins synchronously, which satisfies AC3. It does not actually use a deferred promise or explicitly assert the returned value is `undefined`. This is a test-description/precision issue, not an implementation failure.

## Plan and acceptance-criteria matrix

| Item | Result | Evidence |
|---|---|---|
| P1 | Pass | `EventMap` contains only `"ledger.mutated": { userId: string }` at [event-bus.ts:10](/home/udai/PennyPilot/apps/api/src/lib/event-bus.ts:10). |
| P2 | Fail | Typed API, synchronous `void` emit, microtask dispatch, snapshotting, isolation, no-subscriber behavior, and cleanup are implemented. Duplicate handler registrations are incorrectly deduplicated by the `Set`. |
| P3 | Partial | All 12 delegated tests exist and pass, but duplicate registration is not tested. |
| P4 | Pass | `.ts` import, Fastify augmentation, logger adapter, and decoration before jobs/plugins/routes appear at [app.ts:61](/home/udai/PennyPilot/apps/api/src/app.ts:61), [app.ts:63](/home/udai/PennyPilot/apps/api/src/app.ts:63), and [app.ts:97](/home/udai/PennyPilot/apps/api/src/app.ts:97). |
| P5 | Pass | `onClose` invokes `removeAll()` and documents best-effort/no-drain behavior at [app.ts:205](/home/udai/PennyPilot/apps/api/src/app.ts:205). |
| AC1 | Pass | Both invalid calls have effective `@ts-expect-error` directives at [event-bus.test.ts:191](/home/udai/PennyPilot/apps/api/src/lib/event-bus.test.ts:191); typecheck passes, meaning the directives suppress real errors rather than being unused. |
| AC2 | Pass | Sync throws and async rejections are separately caught, logged without payloads, and do not prevent another subscriber from running. Both tests pass. |
| AC3 | Pass | `emit()` is explicitly typed `void`, handlers are queued with `queueMicrotask`, and the test proves the handler has not begun immediately after emission. |
| AC4 | Pass as literally enumerated; coverage gap against P2 | All listed AC4 behaviors are tested, but duplicate registration is absent. |
| AC5 | Pass | Unsubscribe has a `removed` guard and is tested with two calls. |
| AC6 | Pass | `FastifyInstance` augmentation exposes `eventBus`; project typecheck passes. |
| AC7 | Pass | `npm run typecheck` exited 0. |
| AC8 | Unverified/failing environment | Full API suite exited 1 due to nine tests requiring an unset `DATABASE_URL`; EventBus tests passed. |
| AC9 | Unverified/failing repository state | Lint exited 1 due only to unrelated errors in `scripts/tasks-to-issues.mjs`. |

## Security and regression assessment

- No event payload is logged. Failure logs contain only the fixed message, event name, and normalized error text.
- Each subscriber has an independent synchronous/async error boundary; one subscriber’s failure does not suppress others or propagate through `emit()`.
- `emit()` executes no subscriber code synchronously.
- The existing URL-based `onResponse` hook remains unchanged, as required.
- Decoration occurs before job, plugin, and route registration, so route handlers can access `app.eventBus`.
- The logger adapter correctly converts the EventBus `(message, context)` interface to Pino/Fastify’s `(context, message)` call shape.
- The app shutdown addition is additive and type-correct. Its comment accurately warns that already-scheduled handlers are not drained.
- Conventions pass: `.ts` imports are used, tests use `node:test`, no enums or non-erasable TypeScript constructs were introduced, and `erasableSyntaxOnly` typechecking succeeds.