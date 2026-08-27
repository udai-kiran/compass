import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { Queue } from "bullmq";
import { loadConfig } from "./config.ts";
import { createRedis } from "./infra/redis.ts";
import { EventBus } from "./lib/event-bus.ts";
import { registerLedgerCacheSubscriber } from "./app.ts";

// Unit test of the exported `registerLedgerCacheSubscriber` wiring (task
// 002-retire-url-regex-hook, P8a) against a real, minimally-decorated Fastify
// instance — not a duck-typed fake object. `EventBus.emit()` is
// queueMicrotask-dispatched (see lib/event-bus.ts), so every assertion below
// is a bounded poll rather than an immediate check after `emit()`.
//
// Needs a real Redis connection (REDIS_URL) — plus DATABASE_URL/SESSION_SECRET
// so `loadConfig()` doesn't refuse to boot. Export them (see apps/api/.env)
// before running `npm run test -w apps/api`.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `app.test.ts needs ${name} set (a real Redis-backed subscriber test) — ` +
        "export it (see apps/api/.env) before running `npm run test -w apps/api`.",
    );
  }
  return value;
}
requireEnv("DATABASE_URL");
requireEnv("REDIS_URL");
requireEnv("SESSION_SECRET");

/** Poll `check()` every `intervalMs` until it returns a truthy value, or give up after `timeoutMs`. */
async function pollUntil<T>(
  check: () => Promise<T>,
  isDone: (value: T) => boolean,
  timeoutMs = 500,
  intervalMs = 10,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  for (;;) {
    last = await check();
    if (isDone(last)) return last;
    if (Date.now() >= deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

test("registerLedgerCacheSubscriber: ledger.mutated invalidates the user's cache version and enqueues a debounced budget-eval job", async (t) => {
  const config = loadConfig();
  const app = Fastify({ logger: false });
  const redis = createRedis(config.REDIS_URL);
  // Mirror jobs/index.ts's exact BullMQ connection construction.
  const connection = { url: config.REDIS_URL, maxRetriesPerRequest: null };
  const alerts = new Queue("alerts", { connection });
  const eventBus = new EventBus({ error: () => {} });

  app.decorate("redis", redis);
  app.decorate("queues", { system: alerts, alerts, ingestor: alerts, extract: alerts });
  app.decorate("eventBus", eventBus);

  t.after(async () => {
    await app.close();
    await alerts.close();
    redis.disconnect();
  });

  registerLedgerCacheSubscriber(app);

  const userId = randomUUID();
  const cacheKey = `cachever:${userId}`;
  const baseline = await redis.get(cacheKey);

  const beforeEmit = Date.now();
  app.eventBus.emit("ledger.mutated", { userId });

  // (a) cache-version bump — bounded poll, never assert immediately after emit().
  const afterVersion = await pollUntil(
    () => redis.get(cacheKey),
    (v) => v !== baseline,
  );
  assert.notEqual(
    afterVersion,
    baseline,
    `expected cachever:${userId} to change from its baseline (${String(baseline)}) after ledger.mutated`,
  );

  // (b) debounced budget-eval job actually enqueued — same 5s-bucket jobId
  // enqueueBudgetEvaluation computes. The subscriber awaits cache invalidation
  // before calling enqueueBudgetEvaluation, so its own Date.now() call can
  // land after our cache-version poll noticed the bump. Recompute the
  // candidate range fresh on every poll iteration (never frozen at an earlier
  // snapshot) so the upper bound can only grow, and can't miss the bucket the
  // job actually landed in.
  const firstBucket = Math.floor(beforeEmit / 5000);
  let lastBucketAtFailure = firstBucket;

  const foundJob = await pollUntil(
    async () => {
      const lastBucket = Math.floor(Date.now() / 5000);
      lastBucketAtFailure = lastBucket;
      const candidateJobIds = Array.from(
        { length: lastBucket - firstBucket + 1 },
        (_, i) => `eval-${userId}-${firstBucket + i}`,
      );
      for (const jobId of candidateJobIds) {
        const job = await alerts.getJob(jobId);
        if (job) return job;
      }
      return undefined;
    },
    (job) => job !== undefined,
  );
  assert.ok(
    foundJob,
    `expected the alerts queue to contain a debounced budget-eval job for user ${userId} in bucket range [${firstBucket}, ${lastBucketAtFailure}]`,
  );
  assert.equal((foundJob!.data as { userId: string }).userId, userId);
});
