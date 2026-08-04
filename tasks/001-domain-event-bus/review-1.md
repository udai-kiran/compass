## Blocking findings

1. **“Fire-and-forget” scheduling is underspecified and could still block requests.**

   Wrapping each handler in an async function or calling `void handler(payload)` does not defer handler invocation. Any synchronous work before the handler’s first `await` still runs inside `emit()`, and a CPU-heavy handler can delay the response path.

   The plan should explicitly choose deferred dispatch, such as `queueMicrotask()` or `setImmediate()`, and document the semantics. Each handler must be invoked inside its own error boundary so both synchronous throws and promise rejections are isolated.

   This matters because the referenced `AiObserver` pattern does not fully satisfy AC3: `report()` calls `observe(...)` synchronously before reaching its first `await`. It prevents awaiting observer completion but does not prevent the observer’s synchronous prefix from adding latency.

2. **The error-logging mechanism is missing from the design.**

   AC2 says subscriber failures are logged, but `EventBus` has no stated logger dependency. The plan needs to specify one, preferably injected into the constructor as a small logger interface or callback. Avoid importing or capturing the Fastify instance inside the bus; that would unnecessarily couple domain infrastructure to the HTTP framework.

   The error boundary should resemble:

   - deferred invocation;
   - separate `try/catch` per subscriber;
   - `await handler(payload)` inside that boundary;
   - structured logging of the event name and error;
   - no payload logging by default, because future event payloads may contain financial or personal data.

3. **Subscription lifetime and removal need an API, not only `removeAll()` at shutdown.**

   Long-lived static subscriptions registered once during startup would not leak, but the class is general-purpose and nothing prevents request-scoped or dynamically registered subscribers. Without `off()` or an unsubscribe result from `on()`, those subscribers can never be released before application shutdown.

   Make `on()` return an idempotent unsubscribe function, or add a typed `off(event, handler)`. Keep `removeAll()` for shutdown. Tests should cover unsubscription and preferably idempotent cleanup.

## Non-blocking findings

### Incorrect or conflicting assumptions

- The statement that no “event-like pattern exists anywhere in `apps/api` or `packages/`” is too broad. The repository uses `.on(...)` listeners for BullMQ, Redis, streams, and process signals. There does not appear to be an existing domain event bus, which is the relevant claim.
- “No subscribers yet” conflicts slightly with defining `ledger.mutated` as a production event. If task 0.2 will establish its final payload and publishers, defining it now may prematurely freeze an insufficient contract. `{ userId: string }` may be enough for invalidation, but future consumers may need mutation kind, affected aggregates, or correlation metadata.
- A production `noop` event solely for testing is unnecessary API pollution. Tests can instantiate `EventBus` with a local test event-map type if the class is generic. If `EventMap` is intentionally fixed and non-generic, test the real placeholder event instead.
- `onClose` currently closes PostgreSQL and Redis, while job setup registers another `onClose` hook. Adding another hook is conventional, but `removeAll()` does not cancel or wait for already-dispatched handlers. This limitation should be documented because resources may close while an in-flight subscriber still uses them.

### Event semantics and edge cases

The plan should state these semantics explicitly:

- Are subscribers dispatched concurrently or sequentially? Fire-and-forget usually implies independently/concurrently.
- Is registration order meaningful?
- Is the subscriber collection snapshotted at emit time? A handler adding or removing handlers during delivery should not unpredictably change the current dispatch.
- Are duplicate registrations allowed?
- What does emitting an event with no subscribers do? It should be a no-op.
- Does `removeAll()` remove every event or optionally one event?
- What happens when a handler never settles? It must not block other handlers, `emit()`, or shutdown unless a separate drain facility is deliberately added.

Wildcard events are not needed for the stated use case and would weaken straightforward event-to-payload typing. Leave them out until there is a concrete observability or auditing requirement.

A custom bus has no Node `EventEmitter` max-listener warning. That is acceptable for startup-only listeners. Once unsubscribe is supported, a configurable warning threshold could be added later, but it is not required for this task. Documenting that subscriptions should normally be application-scoped is sufficient.

### Regression risk

This change should not alter request behavior because the existing `onResponse` hook remains in place and no production subscribers or emitters are introduced. The main risks are integration-related:

- A decoration name collision would make Fastify throw during startup. `eventBus` currently appears unused, so the name is safe.
- Fastify module augmentation globally claims every `FastifyInstance` has `eventBus`, including manually created test instances that do not decorate it. The codebase already accepts this tradeoff for other decorations, but future route tests can become runtime-unsound if new routes access `app.eventBus` while their custom test app omits the decoration.
- Add an integration test that calls `buildApp()` only if its external dependencies can be isolated cheaply. Otherwise, a small Fastify test app decorated exactly as production is enough to prove `app.eventBus` accessibility without making the unit test depend on PostgreSQL, Redis, storage, and jobs.
- Ensure decoration occurs before route registration, as planned.

The unchanged `onResponse` hook means there should be no duplicate invalidation or budget evaluation in this task. That duplication becomes a concern only when task 0.2 adds active subscribers; migration sequencing should ensure publishers/subscribers and hook removal do not overlap unintentionally.

### Security and compatibility

- Do not log event payloads by default. Payloads may eventually contain account, transaction, or user information.
- Event handlers execute with process-level authority, so event names are not an authorization boundary. Publishers must emit only after authorization and successful transaction completion.
- For database-backed mutations, emitting before commit could notify subscribers about rolled-back state. The follow-up migration should define that domain events are emitted only after a successful commit, or use an outbox if stronger guarantees are ever required.
- This bus is process-local and lossy. Events disappear on crashes and are not shared across clustered API processes. That matches the non-goals, but consumers must remain best-effort and must not depend on exactly-once delivery.
- A burst of emissions can create unbounded pending promises because there is no backpressure. That is acceptable for lightweight cache invalidation/enqueue operations, but handlers should not perform expensive unbounded work. Durable or high-volume work belongs in BullMQ.
- Use type-only imports where applicable, `.ts` extensions for relative ESM imports, and no enums or parameter properties. An interface/type plus ordinary class fields is compatible with `erasableSyntaxOnly`.
- `Map`, `Set`, `queueMicrotask`, promises, and private fields are compatible with Node 24 native TypeScript. Avoid unsupported runtime TypeScript constructs even if they would type-check under a build pipeline.

### Tests

Yes, there should be a direct test proving `emit()` does not await handler completion. P3 mentions it, but AC4 omits it; AC4 should be updated so it cannot be dropped during implementation.

Use a deferred promise rather than elapsed-time assertions:

1. Register an async handler that records it started and then waits on a controlled promise.
2. Call `emit()`.
3. Assert `emit()` returned `undefined` without resolving the handler’s promise.
4. Yield according to the selected scheduler and assert the handler started.
5. Resolve the promise and assert eventual completion.

If true deferred invocation is required, also register a handler whose synchronous prefix changes a flag and assert that flag is still unchanged immediately after `emit()`. That distinguishes real deferral from merely ignoring the returned promise.

Additional tests should cover:

- synchronous handler throws;
- async handler rejects;
- one failing handler does not prevent other subscribers from running;
- multiple handlers are all invoked with the correct payload;
- no-subscriber emission is harmless;
- unsubscribe/off prevents later delivery;
- `removeAll()` prevents later delivery;
- subscriber-list mutation during dispatch has defined behavior;
- errors are logged once with event context;
- handlers receive the exact payload object intended by the contract.

Compile-time acceptance also needs explicit coverage. Runtime `node:test` tests cannot prove AC1. Add `@ts-expect-error` cases in a file included by `tsc`, or use an established type-test mechanism, for:

- unknown event name;
- wrong payload shape;
- handler payload inferred from its event name;
- mismatched handler type.

The repository conventions cited by the plan are correct:

- Node’s native `node:test` runner is used.
- Tests are colocated as `*.test.ts`.
- The API test script discovers `src/**/*.test.ts`.
- Relative ESM imports use `.ts`.
- Root typechecking includes the API workspace.
- `erasableSyntaxOnly`, `verbatimModuleSyntax`, and TypeScript-extension imports are configured.

### Fastify decoration versus DI

Decorating the Fastify instance is appropriate as the application-level composition point and is consistent with existing `config`, `db`, `redis`, `storage`, and `queues` decorations. It gives route plugins and hooks convenient access to the singleton bus.

It should not become the only dependency mechanism. Domain services should accept an `EventBus` or narrower publisher interface explicitly rather than accepting `FastifyInstance` merely to reach `app.eventBus`. A good split is:

- instantiate and decorate the singleton in `buildApp()`;
- routes obtain it from `app.eventBus`;
- routes pass the bus or a narrow `emit` interface into domain services;
- `EventBus` itself receives only a small logger dependency, not Fastify.

This preserves Fastify integration while keeping domain services independently testable. A dedicated Fastify plugin could improve encapsulation and decoration ordering, but for one application-wide decoration it is optional and not required for this task.