# Sonnet Worker Delegation

## Task
001 — Domain Event Bus

## Approved Plan
- P1: Define typed `EventMap` interface with `"ledger.mutated": { userId: string }` in `apps/api/src/lib/event-bus.ts`
- P2: Implement `EventBus` class:
  - Constructor takes `{ error(msg: string, ctx?: Record<string, unknown>): void }` logger
  - `on<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void | Promise<void>)` → returns idempotent unsubscribe function
  - `emit<K extends keyof EventMap>(event: K, payload: EventMap[K])` → returns `void`; for each subscriber snapshot the list, then schedule each via `queueMicrotask(() => { async wrapper: try { await handler(payload) } catch(e) { logger.error(...) } })`
  - `removeAll()` → clears all subscriptions
  - No payload in logs, include event name + error
- P3: Write colocated TDD tests at `apps/api/src/lib/event-bus.test.ts`
- P4: Decorate `eventBus` on Fastify instance in `apps/api/src/app.ts`
- P5: Add `onClose` hook calling `bus.removeAll()`

## Files and Symbols
- **CREATE** `apps/api/src/lib/event-bus.ts` — `EventMap` interface, `EventBusLogger` type, `EventBus` class
- **CREATE** `apps/api/src/lib/event-bus.test.ts` — all unit tests
- **MODIFY** `apps/api/src/app.ts` — import EventBus, augment FastifyInstance, decorate, onClose hook

## Required Changes

### `apps/api/src/lib/event-bus.ts`
```typescript
// Typed event map — extend as domain events are added
export interface EventMap {
  "ledger.mutated": { userId: string };
}

// Minimal logger interface — do NOT couple to Fastify/Pino
export interface EventBusLogger {
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export class EventBus {
  private subs = new Map<keyof EventMap, Set<(payload: any) => void | Promise<void>>>();
  private log: EventBusLogger;

  constructor(logger: EventBusLogger) { this.log = logger; }

  on<K extends keyof EventMap>(
    event: K,
    handler: (payload: EventMap[K]) => void | Promise<void>,
  ): () => void {
    // add to set, return idempotent unsubscribe
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    // snapshot subscribers, schedule each via queueMicrotask
    // inside microtask: async try/catch, log errors with event name (no payload)
  }

  removeAll(): void {
    // clear map
  }
}
```

### `apps/api/src/lib/event-bus.test.ts`
Tests (using `node:test` and `assert`):
1. emit delivers payload to subscriber (use setTimeout/setImmediate to let microtasks flush)
2. emit with no subscribers is a no-op (no throw)
3. multiple subscribers all receive the payload
4. sync-throwing handler: error logged, other subscribers still run
5. async-rejecting handler: error logged, other subscribers still run
6. emit() returns void without handler having started (deferred-promise test)
7. unsubscribe prevents future delivery
8. unsubscribe is idempotent (calling twice doesn't throw)
9. removeAll prevents future delivery
10. subscriber-list snapshot: unsubscribing during dispatch doesn't cancel already-scheduled delivery
11. @ts-expect-error: emitting unknown event name is a compile error
12. @ts-expect-error: emitting with wrong payload shape is a compile error

### `apps/api/src/app.ts`
- Add `import { EventBus } from "./lib/event-bus.ts";`
- In the `declare module "fastify"` block, add `eventBus: EventBus;` to `FastifyInstance`
- After creating the Fastify instance but before registering plugins/routes:
  ```typescript
  const eventBus = new EventBus({ error: (msg, ctx) => app.log.error(ctx ?? {}, msg) });
  app.decorate("eventBus", eventBus);
  ```
- Before `return app`, add:
  ```typescript
  app.addHook("onClose", () => { app.eventBus.removeAll(); });
  ```

## Must Not Change
- The existing `onResponse` hook (lines 189-195) — that's task 0.2
- Any existing service, route, or test file
- `packages/shared/` — events are API-internal
- The `config.ts`, `plugins/`, `routes/`, `services/` directories

## Acceptance Criteria
- AC1: @ts-expect-error tests prove unknown event / wrong payload are compile errors
- AC2: Tests prove sync throw + async reject are logged and swallowed
- AC3: Deferred-promise test proves emit() returns before handler starts
- AC4: Tests cover all 12 cases listed above
- AC5: on() returns idempotent unsubscribe function (tested)
- AC6: app.eventBus is type-correct (proven by typecheck passing with the augmentation)
- AC7: `npm run typecheck` passes
- AC8: `npm run test -w apps/api` passes
- AC9: `npm run lint` passes

## Commands
1. Write `apps/api/src/lib/event-bus.ts`
2. Write `apps/api/src/lib/event-bus.test.ts`
3. Modify `apps/api/src/app.ts`
4. Run: `node --test apps/api/src/lib/event-bus.test.ts`
5. Run: `npm run typecheck`
6. Run: `npm run test -w apps/api`
7. Run: `npm run lint`

## Required Evidence
- Complete content of both new files
- Complete diff of `apps/api/src/app.ts`
- Literal output of commands 4-7 with exit codes
- Any plan deviations or blockers
