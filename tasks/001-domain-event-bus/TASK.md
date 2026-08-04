# Task: Domain Event Bus

## Status
COMPLETE

## Objective
A typed, in-process event emitter for `apps/api` so domain services announce what happened (e.g. `ledger.mutated`) instead of callers pattern-matching URLs. Fire-and-forget delivery with per-subscriber error isolation — a throwing subscriber never fails the request that emitted.

## Root Cause
Not applicable — net-new infrastructure. No EventEmitter or event-like pattern exists anywhere in `apps/api` or `packages/` today (confirmed by codebase grep). The only "event" pattern is the `onResponse` URL-regex hook in `app.ts:189-195` which triggers cache invalidation and budget evaluation after ledger writes — this is coarse, fragile, and will be replaced by event-bus subscribers in task 0.2.

## Scope
- `apps/api/src/lib/event-bus.ts` — the event bus implementation
- `apps/api/src/lib/event-bus.test.ts` — colocated tests (TDD)
- `apps/api/src/app.ts` — decorate `eventBus` on the Fastify instance + type augmentation
- No subscribers yet (task 0.2 migrates the `onResponse` hook)
- No event types beyond the minimal initial map (task 0.2/1.x will add real domain events)

## Dependencies
- none

## Plan
- P1: Define a typed event map interface (`EventMap`) with `ledger.mutated: { userId: string }` as the initial production event. No `noop` — tests use the real event or a test-local generic instantiation
- P2: Implement `EventBus` class with:
  - Constructor takes a logger interface: `{ error(msg: string, ctx?: Record<string, unknown>): void }`
  - `on(event, handler)` → returns an idempotent unsubscribe function
  - `emit(event, payload)` → returns `void` synchronously; each handler is dispatched via `queueMicrotask()` so zero sync work from handlers can block the emitting code path; each invocation is wrapped in its own try/catch error boundary that calls the logger
  - `removeAll()` — clears all subscriptions (for shutdown)
  - Subscriber list is snapshotted at emit time (copy-on-read) so mutations during dispatch are safe
  - Duplicate registrations allowed (same handler registered twice fires twice)
  - Emitting with no subscribers is a no-op
  - No payload logging by default (financial data safety)
- P3: Write colocated TDD tests covering: emit/subscribe, error isolation (sync throw + async reject), multiple subscribers per event, emit returns void without awaiting handlers (deferred-promise pattern), unsubscribe prevents delivery, removeAll prevents delivery, no-subscriber emit is harmless, subscriber-list snapshot during dispatch, @ts-expect-error compile-time tests for unknown event and wrong payload
- P4: Decorate on the Fastify instance: augment `FastifyInstance` with `eventBus: EventBus`, instantiate in `buildApp()` with Fastify's logger as the backing logger, decorate before route registration
- P5: Add a Fastify `onClose` hook to call `bus.removeAll()` for clean shutdown. Document in code comment that in-flight handlers may still reference closed resources (best-effort, no drain)

## Acceptance Criteria
- AC1: Typed event map — emitting an unknown event or a wrong payload is a compile error (proven via @ts-expect-error in tests)
- AC2: A subscriber that throws (sync) or rejects (async) is logged via the injected logger and swallowed; the emitting code path is unaffected
- AC3: `emit()` returns void synchronously and handlers are dispatched via `queueMicrotask` — proven by deferred-promise test showing handler hasn't started immediately after emit returns
- AC4: Unit tests cover: emit/subscribe, error isolation (sync + async), multiple subscribers, unsubscribe, removeAll, no-subscriber emit, subscriber-list snapshot during dispatch
- AC5: `on()` returns an idempotent unsubscribe function
- AC6: `app.eventBus` is accessible in route handlers (type-correct via Fastify module augmentation)
- AC7: `npm run typecheck` passes
- AC8: `npm run test -w apps/api` passes (existing + new tests)
- AC9: `npm run lint` passes

## Verification
- T1: `node --test apps/api/src/lib/event-bus.test.ts` — all new tests pass
- T2: `npm run typecheck` — zero errors
- T3: `npm run test -w apps/api` — full workspace test suite passes, no regressions
- T4: `npm run lint` — no lint errors

## Non-Goals
- No subscribers beyond the test harness (that's task 0.2)
- No persisted/durable events (BullMQ already handles that)
- No cross-process or cross-service events
- Not in `packages/shared` — this is API-internal infrastructure
