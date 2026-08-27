import { Queue, Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { EXTRACT_QUEUE, INGESTOR_QUEUE } from "@compass/shared";
import { evaluateBudgetAlerts } from "../modules/system/services/notifications.ts";
import { evaluateBillReminders } from "../modules/planning/services/bills.ts";
import {
  evaluateCardDueReminders,
  evaluateCardUtilization,
} from "../modules/credit/services/alerts.ts";
import { materializeCardDueTasks } from "../modules/credit/services/card-due-tasks.ts";
import { evaluateAnomalies } from "../modules/automation/services/anomaly.ts";
import { runAutopilotReview, runGoalReview } from "../modules/automation/services/autopilot.ts";
import {
  closePreviousDay,
  isSystemicFailure,
  snapshotAllUsers,
  type SnapshotPassResult,
} from "../modules/investments/services/networth.ts";
import { createEncryptedBackup } from "../modules/system/services/backup.ts";
import {
  evaluateLargeTransactions,
  evaluateLowBalance,
  prefEnabled,
} from "../modules/system/services/prefs.ts";
import { materializeDue } from "../modules/ledger/services/recurring.ts";
import { runTaxDeadlineNudges } from "../modules/tax/services/deadline-nudges.ts";

export interface Queues {
  system: Queue;
  alerts: Queue;
  /** producer for the ingestor "run a sync pass now" signal; consumed by apps/ingestor */
  ingestor: Queue;
  /** producer for the extractor "reprocess this ingestion" retry; consumed by apps/extractor */
  extract: Queue;
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
      {
        jobId: `eval-${userId}-${Math.floor(Date.now() / 5000)}`,
        delay: 5000,
        removeOnComplete: true,
        removeOnFail: true,
      },
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
    app.log.error(
      { userId: f.userId, date: f.date, err: f.error, pass: what },
      "net-worth snapshot failed for user",
    );
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
 * Cron timezone for every job whose handler derives a `YYYY-MM-DD` "today" from
 * `toISOString()` — i.e. a UTC date label.
 *
 * Those two things have to agree. Left on the process timezone, a "00:10" cron
 * fires at whatever instant local midnight is: under a positive offset
 * (Asia/Kolkata, this app's audience) that is 18:40 UTC the *previous* day, so
 * the handler stamps a UTC date that still has hours left to run, and the
 * nightly chain executes in a different order than the clock times suggest.
 *
 * Pinning the cron is the smaller change; the alternative is threading a
 * timezone through every date derivation in every service.
 */
const LEDGER_DAY_TZ = "Etc/UTC";

/**
 * Which nightly schedulers must share `LEDGER_DAY_TZ`, and which must not.
 *
 * Exported for the test that pins this: the schedulers themselves are registered
 * inside `startJobs`, which needs a live Redis, so the invariant would otherwise
 * be unverifiable. Keep this in sync with the `upsertJobScheduler` calls below —
 * the test asserts every id listed here appears there with the matching timezone.
 */
export const LEDGER_DAY_SCHEDULERS = [
  "recurring.materialize",
  "bills.remind",
  "cards.remind",
  "networth.snapshot",
  "networth.snapshot.close",
  "autopilot.review",
  "autopilot.goals",
  "tax.deadline-nudges",
] as const;

/** Schedulers with no ledger-date dependency, deliberately left on local time. */
export const LOCAL_TIME_SCHEDULERS = ["backup.weekly"] as const;

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
  // The nightly chain below runs in ascending clock order and every step compares
  // against a UTC date label, so all of them are pinned to LEDGER_DAY_TZ. The
  // ordering is deliberate — materialize, then remind, then snapshot, then review
  // — and only holds if they share one timezone.
  //
  // materialize due recurring transactions shortly after midnight, plus on boot (catch-up)
  await system.upsertJobScheduler(
    "recurring.materialize",
    { pattern: "10 0 * * *", tz: LEDGER_DAY_TZ },
    { name: "recurring.materialize" },
  );
  // bill/subscription due-date reminders, after materialization has advanced pointers
  await system.upsertJobScheduler(
    "bills.remind",
    { pattern: "20 0 * * *", tz: LEDGER_DAY_TZ },
    { name: "bills.remind" },
  );
  // credit-card payment due-date reminders
  await system.upsertJobScheduler(
    "cards.remind",
    { pattern: "25 0 * * *", tz: LEDGER_DAY_TZ },
    { name: "cards.remind" },
  );
  // nightly net-worth snapshot (one row per user per day, recomputed in place).
  // The date it files under comes from `snapshotDay()`, i.e. `toISOString()`.
  await system.upsertJobScheduler(
    "networth.snapshot",
    { pattern: "30 0 * * *", tz: LEDGER_DAY_TZ },
    { name: "networth.snapshot" },
  );
  // ...then close out the day that just ended, once its transactions are all in.
  // Without this the 00:30 row above is the only record of a day, taken before
  // anything was entered, so history permanently understates it. Runs at 00:05 so
  // it lands just after the ledger day it closes actually ends.
  await system.upsertJobScheduler(
    "networth.snapshot.close",
    { pattern: "5 0 * * *", tz: LEDGER_DAY_TZ },
    { name: "networth.snapshot.close" },
  );
  // weekly encrypted backup (Sundays 03:00). Deliberately NOT pinned: it dumps
  // whatever is in the database at the time and only uses a timestamp to name the
  // file, so it has no ledger-date to agree with — a host that wants its backup at
  // local 03:00 should get local 03:00.
  await system.upsertJobScheduler(
    "backup.weekly",
    { pattern: "0 3 * * 0" },
    { name: "backup.weekly" },
  );
  // Autopilot review: forward-looking heads-ups (cash-flow shortfall), after the
  // net-worth snapshot has refreshed today's balances — which requires sharing the
  // snapshot's timezone, or "after" is only true on a UTC host.
  await system.upsertJobScheduler(
    "autopilot.review",
    { pattern: "40 0 * * *", tz: LEDGER_DAY_TZ },
    { name: "autopilot.review" },
  );
  // Weekly goal review: asset-allocation + contribution proposals (Mondays 06:00).
  // Pinned too: it keys dedupe state by ISO week, so a drifting day boundary would
  // let one week's proposal fire twice.
  await system.upsertJobScheduler(
    "autopilot.goals",
    { pattern: "0 6 * * 1", tz: LEDGER_DAY_TZ },
    { name: "autopilot.goals" },
  );
  // Tax deadline nudges: 80C/80D headroom escalation and advance-tax reminders.
  // Pinned to LEDGER_DAY_TZ: derives today's UTC date and must agree with the
  // FY boundary (31 March) computed from that same date string.
  await system.upsertJobScheduler(
    "tax.deadline-nudges",
    { pattern: "35 0 * * *", tz: LEDGER_DAY_TZ },
    { name: "tax.deadline-nudges" },
  );

  const alerts = new Queue("alerts", { connection });
  alerts.on("error", (err) => app.log.error({ err }, "bullmq alerts queue error"));

  // Producer only — the ingestor container runs the worker for this queue.
  const ingestor = new Queue(INGESTOR_QUEUE, { connection });
  ingestor.on("error", (err) => app.log.error({ err }, "bullmq ingestor queue error"));

  // Producer only — the extractor container runs the worker for this queue.
  // Used to retry a failed ingestion from the Event Log (see modules/ingest/services/ingestions.ts).
  const extract = new Queue(EXTRACT_QUEUE, { connection });
  extract.on("error", (err) => app.log.error({ err }, "bullmq extract queue error"));

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
              app.eventBus.emit("ledger.mutated", { userId });
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
          // Notification evaluation and task materialisation get their own
          // try/catch, in both directions: a materialisation failure must not
          // suppress the existing due-date notification, and a notification
          // failure must not prevent materialisation from being attempted.
          try {
            const sent = await evaluateCardDueReminders(app.db);
            if (sent > 0) app.log.info({ sent }, "card due reminders sent");
          } catch (err) {
            app.log.error({ err }, "card due reminders failed");
          }
          try {
            const materialized = await materializeCardDueTasks(app.db);
            if (materialized > 0) app.log.info({ materialized }, "card due tasks materialized");
          } catch (err) {
            app.log.error({ err }, "card due task materialization failed");
          }
          return;
        }
        case "networth.snapshot": {
          const pass = await snapshotAllUsers(app.db);
          if (pass.written > 0)
            app.log.info({ written: pass.written }, "net-worth snapshots written");
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
            app.log.error(
              { userId: e.userId, err: e.error },
              "autopilot: cash-runway failed for user",
            );
          }
          if (res.fired > 0)
            app.log.info({ fired: res.fired }, "autopilot: cash-flow heads-ups sent");
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
            app.log.error(
              { userId: e.userId, err: e.error },
              "autopilot: goal review failed for user",
            );
          }
          if (res.fired > 0) app.log.info({ fired: res.fired }, "autopilot: goal proposals sent");
          if (res.processed > 0 && res.errors.length === res.processed) {
            throw new Error(`autopilot goal review failed for all ${res.processed} users`);
          }
          return;
        }
        case "tax.deadline-nudges": {
          const res = await runTaxDeadlineNudges(app.db);
          for (const e of res.errors) {
            app.log.error(
              { userId: e.userId, err: e.error },
              "tax deadline nudges: evaluation failed for user",
            );
          }
          if (res.fired > 0) app.log.info({ fired: res.fired }, "tax deadline nudges sent");
          // Every user failing is systemic — fail the job so it shows red in BullMQ.
          if (res.processed > 0 && res.errors.length === res.processed) {
            throw new Error(`tax deadline nudges failed for all ${res.processed} users`);
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
  alertsWorker.on("failed", (job, err) =>
    app.log.error({ job: job?.name, err }, "alert job failed"),
  );
  alertsWorker.on("error", (err) => app.log.error({ err }, "bullmq alerts worker error"));

  app.decorate("queues", { system, alerts, ingestor, extract });

  // catch up on recurring instances missed while the server was down
  const boot = await materializeDue(app.db).catch((err: unknown) => {
    app.log.error({ err }, "boot materialization failed");
    return { created: 0, userIds: [] };
  });
  if (boot.created > 0) {
    app.log.info(boot, "boot: materialized recurring transactions");
    for (const userId of boot.userIds) {
      app.eventBus.emit("ledger.mutated", { userId });
    }
  }
  // catch up on bill reminders too (server may have been down at 00:20)
  await evaluateBillReminders(app.db).catch((err: unknown) => {
    app.log.error({ err }, "boot bill reminders failed");
  });
  // catch up on card-due task materialization too — NOT a historical-due
  // recovery (a card whose whole remind window elapsed while the server was
  // down stays unmaterialized for that cycle either way, see
  // card-due-tasks.ts), but it does let an instance that reboots while the
  // window is still open materialize on this pass instead of waiting for the
  // next 00:25 tick. Separately caught so it can't suppress, or be suppressed
  // by, any other boot pass.
  await materializeCardDueTasks(app.db)
    .then((materialized) => {
      if (materialized > 0) app.log.info({ materialized }, "boot: materialized card due tasks");
    })
    .catch((err: unknown) => {
      app.log.error({ err }, "boot card due task materialization failed");
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
    await ingestor.close();
    await extract.close();
  });
}
