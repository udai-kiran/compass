/**
 * Typed in-process domain event bus.
 *
 * Fire-and-forget delivery with per-subscriber error isolation.
 * Handlers are dispatched via queueMicrotask — zero subscriber code
 * runs synchronously inside emit().
 */

/** Extend this interface as domain events are added. */
export interface EventMap {
  "ledger.mutated": { userId: string };
}

/** Minimal logger — deliberately decoupled from Fastify/Pino. */
export interface EventBusLogger {
  error(msg: string, ctx?: Record<string, unknown>): void;
}

type Handler<T> = (payload: T) => void | Promise<void>;

type AnyHandler = Handler<EventMap[keyof EventMap]>;

type Subscription = { handler: AnyHandler; active: boolean };

export class EventBus {
  private subs: Map<keyof EventMap, Subscription[]>;
  private log: EventBusLogger;

  constructor(logger: EventBusLogger) {
    this.log = logger;
    this.subs = new Map();
  }

  /**
   * Subscribe to an event. Returns an idempotent unsubscribe function.
   */
  on<K extends keyof EventMap>(
    event: K,
    handler: Handler<EventMap[K]>,
  ): () => void {
    let list = this.subs.get(event);
    if (!list) {
      list = [];
      this.subs.set(event, list);
    }
    const sub: Subscription = { handler, active: true };
    list.push(sub);

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      sub.active = false;
      const arr = this.subs.get(event);
      if (arr) {
        const idx = arr.indexOf(sub);
        if (idx !== -1) arr.splice(idx, 1);
      }
    };
  }

  /**
   * Emit an event. Returns void synchronously.
   * Each subscriber is dispatched via queueMicrotask with its own error boundary.
   */
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const list = this.subs.get(event);
    if (!list || list.length === 0) return;

    // Snapshot so mutations during dispatch are safe
    const snapshot = [...list];

    for (const sub of snapshot) {
      if (!sub.active) continue;
      queueMicrotask(() => {
        try {
          const result = sub.handler(payload);
          if (result && typeof result === "object" && "catch" in result) {
            (result as Promise<void>).catch((err: unknown) => {
              this.log.error("domain event subscriber failed", {
                event: event as string,
                err: err instanceof Error ? err.message : String(err),
              });
            });
          }
        } catch (err: unknown) {
          this.log.error("domain event subscriber failed", {
            event: event as string,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      });
    }
  }

  /** Remove all subscriptions. Called on app close. */
  removeAll(): void {
    this.subs.clear();
  }
}
