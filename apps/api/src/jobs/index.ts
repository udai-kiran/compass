import { Queue, Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { INGESTOR_QUEUE } from "@compass/shared";
import { evaluateBudgetAlerts } from "../services/notifications.ts";
import { evaluateBillReminders } from "../services/bills.ts";
import { evaluateCardDueReminders, evaluateCardUtilization } from "../services/cards.ts";
import { evaluateAnomalies } from "../services/anomaly.ts";
import { runAutopilotReview, runGoalReview } from "../services/autopilot.ts";
import {
  closePreviousDay,
  isSystemicFailure,
  snapshotAllUsers,
  type SnapshotPassResult,
} from "../services/networth.ts";
import { createEncryptedBackup } from "../services/backup.ts";
import { evaluateLargeTransactions, evaluateLowBalance, prefEnabled } from "../services/prefs.ts";
import { materializeDue } from "../services/recurring.ts";
import { invalidateUserCache } from "../services/cache.ts";

export interface Queues {
  system: Queue;
  alerts: Queue;
  /** producer for the ingestor "run a sync pass now" signal; consumed by apps/ingestor */
  ingestor: Queue;
}

/**
 * Queue an ingestor sync pass to run after `windowMinutes` (a rolling delay).
 * The jobId is stable per user, so repeated requests while a run is still
 * pending coalesce into one — the first request's window stands.
 */
export async function enqueueIngestorRun(
  app: FastifyInstance,
  userId: string,
  windowMinutes: number,
): Promise<void> {
  await app.queues.ingestor.add(
    "run",
    { userId },
    {
      jobId: `ingestor-run-${userId}`,
      delay: windowMinutes * 60_000,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
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

/** How many individual snapshot failures get their own log line before sampling. */
const SNAPSHOT_FAILURE_LOG_LIMIT = 10;

/**
 * Log the user-days a snapshot pass could not compute.
 *
 * Failures are isolated per row so one bad user can't deny everyone else a
 * snapshot, which means nothing surfaces them unless it happens here. Each gets a
 * line with its userId, date and error — an aggregate count tells an operator
 * something broke but not what to look at. Capped, though: a shared-dependency
 * outage during close-out fails up to 46 user-days *per user*, and drowning the
 * log is its own outage, so past the limit only the total is reported.
 */
function logSnapshotPass(app: FastifyInstance, pass: SnapshotPassResult, what: string): void {
  for (const f of pass.failures.slice(0, SNAPSHOT_FAILURE_LOG_LIMIT)) {
    app.log.error({ userId: f.userId, date: f.date, err: f.error, pass: what }, "net-worth snapshot failed for user");
  }
  if (pass.failures.length > 0) {
    app.log.warn(
      {
        pass: what,
        failed: pass.failures.length,
        processed: pass.processed,
        logged: Math.min(pass.failures.length, SNAPSHOT_FAILURE_LOG_LIMIT),
      },
      "net-worth snapshot failures",
    );
  }
}

/**
 * Log every pass, then fail the job if any one of them failed *completely*.
 *
 * All-failed is systemic (schema drift, database down), not one user's bad data,
 * so it must throw — otherwise BullMQ shows a green run while history silently
 * stops updating. Each pass is judged on its own: `processed` counts users in the
 * daily snapshot and user-days in the sweep, so judging a combined total let a
 * healthy half mask a collapsed one. Same convention as the autopilot handlers.
 */
function reportSnapshotPasses(
  app: FastifyInstance,
  passes: Array<{ what: string; pass: SnapshotPassResult }>,
): void {
  for (const { what, pass } of passes) logSnapshotPass(app, pass, what);
  const dead = passes.filter((p) => isSystemicFailure(p.pass));
  if (dead.length > 0) {
    throw new Error(
      dead.map((d) => `${d.what} failed for all ${d.pass.processed} rows`).join("; "),
    );
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
  // nightly net-worth snapshot (one row per user per day, recomputed in place).
  //
  // Pinned to UTC for the same reason as the close-out below: the date a snapshot
  // is filed under comes from `snapshotDay()`, which is `toISOString()` and so
  // always UTC. Left to the process timezone this fires at whatever instant local
  // 00:30 happens to be — under a positive offset (Asia/Kolkata, this app's
  // audience) that is still the *previous* UTC date, so the row would be stamped
  // with a day several hours short of ending, and the two net-worth jobs would
  // disagree about which day "today" is.
  await system.upsertJobScheduler(
    "networth.snapshot",
    { pattern: "30 0 * * *", tz: "Etc/UTC" },
    { name: "networth.snapshot" },
  );
  // ...then close out the day that just ended, once its transactions are all in.
  // Without this the 00:30 row above is the only record of a day, taken before
  // anything was entered, so history permanently understates it.
  //
  // Also pinned to UTC, so it fires just after the ledger day it closes actually
  // ends. Left to the process TZ, a positive-offset zone would run this while UTC
  // is still on the previous date and close out the wrong day.
  await system.upsertJobScheduler(
    "networth.snapshot.close",
    { pattern: "5 0 * * *", tz: "Etc/UTC" },
    { name: "networth.snapshot.close" },
  );
  // weekly encrypted backup (Sundays 03:00)
  await system.upsertJobScheduler(
    "backup.weekly",
    { pattern: "0 3 * * 0" },
    { name: "backup.weekly" },
  );
  // Autopilot review: forward-looking heads-ups (cash-flow shortfall), after the
  // net-worth snapshot has refreshed today's balances
  await system.upsertJobScheduler(
    "autopilot.review",
    { pattern: "40 0 * * *" },
    { name: "autopilot.review" },
  );
  // Weekly goal review: asset-allocation + contribution proposals (Mondays 06:00)
  await system.upsertJobScheduler(
    "autopilot.goals",
    { pattern: "0 6 * * 1" },
    { name: "autopilot.goals" },
  );

  const alerts = new Queue("alerts", { connection });
  alerts.on("error", (err) => app.log.error({ err }, "bullmq alerts queue error"));

  // Producer only — the ingestor container runs the worker for this queue.
  const ingestor = new Queue(INGESTOR_QUEUE, { connection });
  ingestor.on("error", (err) => app.log.error({ err }, "bullmq ingestor queue error"));

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
          const pass = await snapshotAllUsers(app.db);
          if (pass.written > 0) app.log.info({ written: pass.written }, "net-worth snapshots written");
          // Throws if every user failed, so report last — the successful writes are
          // worth logging either way.
          reportSnapshotPasses(app, [{ what: "net-worth snapshot", pass }]);
          return;
        }
        // Close out the day that just ended, then refresh the days before it.
        // The 00:30 run records a day before its transactions are entered, and
        // imports routinely backdate entries into days already snapshotted — so a
        // single-day pass would leave those days understated for good. Snapshots
        // are derived, so recomputing is always safe.
        case "networth.snapshot.close": {
          const { date, close, sweep } = await closePreviousDay(app.db);
          if (close.written > 0 || sweep.refreshed > 0) {
            app.log.info(
              { closed: close.written, refreshed: sweep.refreshed, date },
              "net-worth snapshots closed out",
            );
          }
          // Judged separately: a healthy close must not mask a sweep that failed
          // every row, nor the reverse.
          reportSnapshotPasses(app, [
            { what: "net-worth day close", pass: close },
            { what: "net-worth recompute sweep", pass: sweep },
          ]);
          return;
        }
        case "backup.weekly": {
          const res = await createEncryptedBackup(app.db, app.config);
          app.log.info(res, "encrypted backup written");
          return;
        }
        case "autopilot.review": {
          const res = await runAutopilotReview(app.db, app.redis);
          for (const e of res.errors) {
            app.log.error({ userId: e.userId, err: e.error }, "autopilot: cash-runway failed for user");
          }
          if (res.fired > 0) app.log.info({ fired: res.fired }, "autopilot: cash-flow heads-ups sent");
          // Every user failing is systemic (schema drift, forecast dep down) — fail
          // the job so it shows red, rather than logging a silent "success".
          if (res.processed > 0 && res.errors.length === res.processed) {
            throw new Error(`autopilot review failed for all ${res.processed} users`);
          }
          return;
        }
        case "autopilot.goals": {
          const res = await runGoalReview(app.db);
          for (const e of res.errors) {
            app.log.error({ userId: e.userId, err: e.error }, "autopilot: goal review failed for user");
          }
          if (res.fired > 0) app.log.info({ fired: res.fired }, "autopilot: goal proposals sent");
          if (res.processed > 0 && res.errors.length === res.processed) {
            throw new Error(`autopilot goal review failed for all ${res.processed} users`);
          }
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

  app.decorate("queues", { system, alerts, ingestor });

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
  // Boot must never be blocked by this, so an all-failed pass is logged, not thrown.
  await snapshotAllUsers(app.db)
    .then((pass) => logSnapshotPass(app, pass, "boot net-worth snapshot"))
    .catch((err: unknown) => {
      app.log.error({ err }, "boot net-worth snapshot failed");
    });

  app.addHook("onClose", async () => {
    await systemWorker.close();
    await alertsWorker.close();
    await system.close();
    await alerts.close();
  });
}
