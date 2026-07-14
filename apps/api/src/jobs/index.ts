import { Queue, Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { evaluateBudgetAlerts } from "../services/notifications.ts";
import { evaluateBillReminders } from "../services/bills.ts";
import { evaluateCardDueReminders, evaluateCardUtilization } from "../services/cards.ts";
import { evaluateAnomalies } from "../services/anomaly.ts";
import { snapshotAllUsers } from "../services/networth.ts";
import { createEncryptedBackup } from "../services/backup.ts";
import { evaluateLargeTransactions, evaluateLowBalance, prefEnabled } from "../services/prefs.ts";
import { materializeDue } from "../services/recurring.ts";
import { invalidateUserCache } from "../services/cache.ts";

export interface Queues {
  system: Queue;
  alerts: Queue;
}

/**
 * Debounced budget evaluation: the delayed jobId dedupes — repeated ledger
 * writes within the window collapse into one evaluation. Never inline in the
 * write path.
 */
export async function enqueueBudgetEvaluation(app: FastifyInstance, userId: string): Promise<void> {
  try {
    await app.queues.alerts.add(
      "evaluate",
      { userId },
      { jobId: `eval-${userId}-${Math.floor(Date.now() / 5000)}`, delay: 5000, removeOnComplete: true, removeOnFail: true },
    );
  } catch (err) {
    app.log.warn({ err }, "failed to enqueue budget evaluation");
  }
}

/**
 * BullMQ foundation. Job schedulers are upserted at boot (idempotent), so
 * schedules survive restarts and live in Redis.
 */
export async function startJobs(app: FastifyInstance): Promise<void> {
  // BullMQ manages its own Redis connections; maxRetriesPerRequest: null is required.
  const connection = { url: app.config.REDIS_URL, maxRetriesPerRequest: null };

  const system = new Queue("system", { connection });
  system.on("error", (err) => app.log.error({ err }, "bullmq queue error"));
  await system.upsertJobScheduler("system.heartbeat", { every: 60_000 }, { name: "heartbeat" });
  // materialize due recurring transactions shortly after midnight, plus on boot (catch-up)
  await system.upsertJobScheduler(
    "recurring.materialize",
    { pattern: "10 0 * * *" },
    { name: "recurring.materialize" },
  );
  // bill/subscription due-date reminders, after materialization has advanced pointers
  await system.upsertJobScheduler(
    "bills.remind",
    { pattern: "20 0 * * *" },
    { name: "bills.remind" },
  );
  // credit-card payment due-date reminders
  await system.upsertJobScheduler(
    "cards.remind",
    { pattern: "25 0 * * *" },
    { name: "cards.remind" },
  );
  // nightly net-worth snapshot (one row per user per day, idempotent)
  await system.upsertJobScheduler(
    "networth.snapshot",
    { pattern: "30 0 * * *" },
    { name: "networth.snapshot" },
  );
  // weekly encrypted backup (Sundays 03:00)
  await system.upsertJobScheduler(
    "backup.weekly",
    { pattern: "0 3 * * 0" },
    { name: "backup.weekly" },
  );

  const alerts = new Queue("alerts", { connection });
  alerts.on("error", (err) => app.log.error({ err }, "bullmq alerts queue error"));

  const systemWorker = new Worker(
    "system",
    async (job) => {
      switch (job.name) {
        case "heartbeat":
          app.log.info({ job: job.name, id: job.id }, "system heartbeat");
          return;
        case "recurring.materialize": {
          const res = await materializeDue(app.db);
          if (res.created > 0) {
            app.log.info(res, "materialized recurring transactions");
            for (const userId of res.userIds) {
              await invalidateUserCache(app.redis, userId);
              await enqueueBudgetEvaluation(app, userId);
            }
          }
          return;
        }
        case "bills.remind": {
          const sent = await evaluateBillReminders(app.db);
          if (sent > 0) app.log.info({ sent }, "bill reminders sent");
          return;
        }
        case "cards.remind": {
          const sent = await evaluateCardDueReminders(app.db);
          if (sent > 0) app.log.info({ sent }, "card due reminders sent");
          return;
        }
        case "networth.snapshot": {
          const created = await snapshotAllUsers(app.db);
          if (created > 0) app.log.info({ created }, "net-worth snapshots created");
          return;
        }
        case "backup.weekly": {
          const res = await createEncryptedBackup(app.db, app.config);
          app.log.info(res, "encrypted backup written");
          return;
        }
        default:
          app.log.warn({ job: job.name }, "unknown job — no handler");
      }
    },
    { connection, concurrency: 5 },
  );
  systemWorker.on("failed", (job, err) => app.log.error({ job: job?.name, err }, "job failed"));
  systemWorker.on("error", (err) => app.log.error({ err }, "bullmq worker error"));

  const alertsWorker = new Worker(
    "alerts",
    async (job) => {
      const { userId } = job.data as { userId: string };
      const budget = (await prefEnabled(app.db, userId, "budget"))
        ? await evaluateBudgetAlerts(app.db, userId)
        : 0;
      const large = await evaluateLargeTransactions(app.db, userId);
      const low = await evaluateLowBalance(app.db, userId);
      const cardUtil = await evaluateCardUtilization(app.db, userId);
      const anomaly = await evaluateAnomalies(app.db, userId);
      if (budget + large + low + cardUtil + anomaly > 0) {
        app.log.info({ userId, budget, large, low, cardUtil, anomaly }, "alerts fired");
      }
    },
    { connection, concurrency: 2 },
  );
  alertsWorker.on("failed", (job, err) => app.log.error({ job: job?.name, err }, "alert job failed"));
  alertsWorker.on("error", (err) => app.log.error({ err }, "bullmq alerts worker error"));

  app.decorate("queues", { system, alerts });

  // catch up on recurring instances missed while the server was down
  const boot = await materializeDue(app.db).catch((err: unknown) => {
    app.log.error({ err }, "boot materialization failed");
    return { created: 0, userIds: [] };
  });
  if (boot.created > 0) {
    app.log.info(boot, "boot: materialized recurring transactions");
    for (const userId of boot.userIds) {
      await invalidateUserCache(app.redis, userId);
      await enqueueBudgetEvaluation(app, userId);
    }
  }
  // catch up on bill reminders too (server may have been down at 00:20)
  await evaluateBillReminders(app.db).catch((err: unknown) => {
    app.log.error({ err }, "boot bill reminders failed");
  });
  // ensure today's net-worth snapshot exists
  await snapshotAllUsers(app.db).catch((err: unknown) => {
    app.log.error({ err }, "boot net-worth snapshot failed");
  });

  app.addHook("onClose", async () => {
    await systemWorker.close();
    await alertsWorker.close();
    await system.close();
    await alerts.close();
  });
}
