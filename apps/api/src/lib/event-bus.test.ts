import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventBus } from "./event-bus.ts";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function mockLogger() {
  const logs: unknown[] = [];
  const logger = {
    error: (msg: string, ctx?: Record<string, unknown>) => {
      logs.push({ msg, ...ctx });
    },
  };
  return { logger, logs };
}

describe("EventBus", () => {
  it("emit delivers payload to subscriber", async () => {
    const { logger } = mockLogger();
    const bus = new EventBus(logger);
    let received: { userId: string } | null = null;

    bus.on("ledger.mutated", (payload) => {
      received = payload;
    });

    bus.emit("ledger.mutated", { userId: "user123" });
    await flush();

    assert.deepEqual(received, { userId: "user123" });
  });

  it("emit with no subscribers is a no-op", () => {
    const { logger } = mockLogger();
    const bus = new EventBus(logger);

    // Should not throw
    bus.emit("ledger.mutated", { userId: "user123" });
  });

  it("multiple subscribers all receive the payload", async () => {
    const { logger } = mockLogger();
    const bus = new EventBus(logger);
    const received: { userId: string }[] = [];

    bus.on("ledger.mutated", (payload) => {
      received.push(payload);
    });
    bus.on("ledger.mutated", (payload) => {
      received.push(payload);
    });
    bus.on("ledger.mutated", (payload) => {
      received.push(payload);
    });

    bus.emit("ledger.mutated", { userId: "user456" });
    await flush();

    assert.equal(received.length, 3);
    assert.deepEqual(received[0], { userId: "user456" });
    assert.deepEqual(received[1], { userId: "user456" });
    assert.deepEqual(received[2], { userId: "user456" });
  });

  it("sync-throwing handler: error logged, other subscribers still run", async () => {
    const { logger, logs } = mockLogger();
    const bus = new EventBus(logger);
    let normalHandlerRan = false;

    bus.on("ledger.mutated", () => {
      throw new Error("sync failure");
    });
    bus.on("ledger.mutated", (payload) => {
      normalHandlerRan = true;
      assert.equal(payload.userId, "user789");
    });

    bus.emit("ledger.mutated", { userId: "user789" });
    await flush();

    assert.equal(normalHandlerRan, true);
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0], {
      msg: "domain event subscriber failed",
      event: "ledger.mutated",
      err: "sync failure",
    });
  });

  it("async-rejecting handler: error logged, other subscribers still run", async () => {
    const { logger, logs } = mockLogger();
    const bus = new EventBus(logger);
    let normalHandlerRan = false;

    bus.on("ledger.mutated", async () => {
      throw new Error("async rejection");
    });
    bus.on("ledger.mutated", (payload) => {
      normalHandlerRan = true;
      assert.equal(payload.userId, "userABC");
    });

    bus.emit("ledger.mutated", { userId: "userABC" });
    await flush();

    assert.equal(normalHandlerRan, true);
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0], {
      msg: "domain event subscriber failed",
      event: "ledger.mutated",
      err: "async rejection",
    });
  });

  it("emit() returns void without handler having started (deferred-promise test)", async () => {
    const { logger } = mockLogger();
    const bus = new EventBus(logger);
    let flag = false;

    bus.on("ledger.mutated", () => {
      flag = true;
    });

    bus.emit("ledger.mutated", { userId: "userDEF" });
    assert.equal(flag, false, "handler should not have run yet");

    await flush();
    assert.equal(flag, true, "handler should have run after flush");
  });

  it("unsubscribe prevents future delivery", async () => {
    const { logger } = mockLogger();
    const bus = new EventBus(logger);
    let callCount = 0;

    const unsub = bus.on("ledger.mutated", () => {
      callCount++;
    });

    unsub();
    bus.emit("ledger.mutated", { userId: "userGHI" });
    await flush();

    assert.equal(callCount, 0);
  });

  it("unsubscribe is idempotent", async () => {
    const { logger } = mockLogger();
    const bus = new EventBus(logger);

    const unsub = bus.on("ledger.mutated", () => {});

    // Should not throw
    unsub();
    unsub();
  });

  it("removeAll prevents future delivery", async () => {
    const { logger } = mockLogger();
    const bus = new EventBus(logger);
    let callCount = 0;

    bus.on("ledger.mutated", () => {
      callCount++;
    });

    bus.removeAll();
    bus.emit("ledger.mutated", { userId: "userJKL" });
    await flush();

    assert.equal(callCount, 0);
  });

  it("subscriber-list snapshot: unsubscribing after emit but before microtask runs doesn't cancel already-scheduled delivery", async () => {
    const { logger } = mockLogger();
    const bus = new EventBus(logger);
    let callCount = 0;

    const unsub = bus.on("ledger.mutated", () => {
      callCount++;
    });

    bus.emit("ledger.mutated", { userId: "userMNO" });
    unsub(); // unsubscribe immediately after emit, before microtask runs

    await flush();

    assert.equal(callCount, 1, "handler was already scheduled, so it should have run");
  });

  it("duplicate registrations: same handler registered twice fires twice", async () => {
    const { logger } = mockLogger();
    const bus = new EventBus(logger);
    let callCount = 0;

    const handler = () => { callCount++; };

    const unsub1 = bus.on("ledger.mutated", handler);
    const unsub2 = bus.on("ledger.mutated", handler);

    bus.emit("ledger.mutated", { userId: "userDUP" });
    await flush();
    assert.equal(callCount, 2, "same handler should fire twice");

    // Unsubscribe one registration
    unsub1();
    callCount = 0;
    bus.emit("ledger.mutated", { userId: "userDUP" });
    await flush();
    assert.equal(callCount, 1, "only one registration remains");

    // Unsubscribe second registration
    unsub2();
    callCount = 0;
    bus.emit("ledger.mutated", { userId: "userDUP" });
    await flush();
    assert.equal(callCount, 0, "no registrations remain");
  });

  it("@ts-expect-error: emitting unknown event name", () => {
    const { logger } = mockLogger();
    const bus = new EventBus(logger);

    // @ts-expect-error — unknown event is a compile error
    bus.emit("unknown.event", { userId: "x" });
  });

  it("@ts-expect-error: wrong payload shape", () => {
    const { logger } = mockLogger();
    const bus = new EventBus(logger);

    // @ts-expect-error — wrong payload shape is a compile error
    bus.emit("ledger.mutated", { wrong: true });
  });
});
