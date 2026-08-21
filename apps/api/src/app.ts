import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type pg from "pg";
import type { Redis } from "ioredis";
import type { Config } from "./config.ts";
import { createPool } from "./infra/db.ts";
import { createRedis } from "./infra/redis.ts";
import { createDb, type Db } from "./db/index.ts";
import { startJobs, type Queues } from "./jobs/index.ts";
import multipart from "@fastify/multipart";
import compress from "@fastify/compress";
import { setupAuth } from "./plugins/auth.ts";
import { setupSecurity } from "./plugins/security.ts";
import { systemRoutes } from "./modules/system/plugin.ts";
import { ledgerRoutes } from "./modules/ledger/plugin.ts";
import { ingestRoutes } from "./modules/ingest/plugin.ts";
import { investmentsRoutes } from "./modules/investments/plugin.ts";
import { creditRoutes } from "./modules/credit/plugin.ts";
import { protectionRoutes } from "./modules/protection/plugin.ts";
import { automationRoutes } from "./modules/automation/plugin.ts";
import { planningRoutes } from "./modules/planning/plugin.ts";
import { householdRoutes } from "./modules/household/plugin.ts";
import { shoppingRoutes } from "./modules/shopping/plugin.ts";
import { invalidateUserCache } from "./lib/cache.ts";
import { enqueueBudgetEvaluation } from "./jobs/index.ts";
import { createStorage, type Storage } from "./lib/storage.ts";
import { EventBus } from "./lib/event-bus.ts";
import { assertNoLegacyShapes, findInconsistentPostings } from "./modules/ledger/services/reconcile-postings.ts";

declare module "fastify" {
  interface FastifyInstance {
    config: Config;
    pg: pg.Pool;
    db: Db;
    redis: Redis;
    queues: Queues;
    storage: Storage;
    eventBus: EventBus;
  }
}

/**
 * Write-through invalidation: any successful ledger mutation refreshes cached
 * aggregates and queues a (debounced) budget evaluation. Replaces the old
 * URL-regex request hook — callers now emit `ledger.mutated` explicitly from
 * the route/job layer instead of this being inferred from `req.url`.
 *
 * Must be registered before `startJobs(app)` — boot-catchup emits during
 * `startJobs`, and a subscriber registered after that would silently miss them.
 */
export function registerLedgerCacheSubscriber(app: FastifyInstance): void {
  app.eventBus.on("ledger.mutated", async ({ userId }) => {
    await invalidateUserCache(app.redis, userId);
    await enqueueBudgetEvaluation(app, userId);
  });
}

/**
 * Registers every application route module (not the HTTP-level `multipart`/
 * `compress` plugins, which stay in `buildApp()` since they aren't routes).
 * Same URLs/methods as `buildApp()` always had — extracted so a hermetic test
 * (`app.route-snapshot.test.ts`) can build a minimal Fastify instance around
 * just this function and snapshot the resulting route table without booting
 * Postgres/Redis/storage/jobs/auth/security.
 *
 * As of task 1.1 (migrate-ledger), the 11 ledger route registrations that used
 * to sit here directly (accounts/categories/transactions/transfers/
 * transaction-links/attachments/rules/recurring/search/resources/user-tasks)
 * are collapsed into the single `ledgerRoutes` plugin registered below, in the
 * position the first of them (`accountRoutes`) used to occupy — see
 * `modules/ledger/plugin.ts`. As of task 1.2 (migrate-credit), the same
 * applies to the 4 credit route registrations (cards/emis/bank-details/
 * overdraft-details) — collapsed into the single `creditRoutes` plugin, in
 * the position `cardRoutes` used to occupy; `bankDetailsRoutes`/
 * `overdraftDetailsRoutes` used to register later (interleaved with
 * `retirementRoutes`/`accountNpsRoutes`), so this also moves them earlier in
 * registration order — see `modules/credit/plugin.ts`. As of task 1.3
 * (migrate-investments), the same applies to the 4 investments route
 * registrations (holdings/sips/networth/account-nps) — collapsed into the
 * single `investmentsRoutes` plugin, in the position `sipRoutes` used to
 * occupy; `accountNpsRoutes` used to register later (interleaved with
 * `retirementRoutes`) and `holdingRoutes`/`netWorthRoutes` used to register
 * after `insuranceRoutes` — see `modules/investments/plugin.ts` and
 * `tasks/010-migrate-investments/TASK.md` Root Cause's Scope decision 1 for
 * why `account-nps` belongs to investments rather than protection (task 1.4).
 * All three migrations change the raw `printRoutes()` tree (registration/
 * nesting structure) but not the canonical (method, path) surface — see
 * `route-surface.snapshot.txt` / `route-table.snapshot.txt` and
 * tasks/007-migrate-ledger/TASK.md's / tasks/008-migrate-credit/TASK.md's /
 * tasks/010-migrate-investments/TASK.md's Root Cause for why both snapshots
 * exist.
 *
 * As of task 1.5 (migrate-planning), the 8 planning route registrations that
 * used to sit here directly (budgets/dashboard/goals/cashflow/bills/insights/
 * reports) are collapsed into the single `planningRoutes` plugin registered
 * below, in the position `budgetRoutes` used to occupy; `projectionSettings`
 * was already collapsed into the same plugin (it registered at the end before
 * this migration). All 8 are now contiguous — see
 * `modules/planning/plugin.ts`.
 *
 * As of task 1.4 (migrate-protection), the 2 protection route registrations
 * (retirement/insurance) are collapsed into the single `protectionRoutes`
 * plugin, in the same position (`retirementRoutes` used to occupy, with
 * `insuranceRoutes` immediately after). Unlike the three earlier migrations,
 * wrapping two already-adjacent, already-in-order registrations in a plugin
 * does not change the raw `printRoutes()` tree — see
 * `route-table.snapshot.txt` whose regenerated content is expected
 * byte-identical.
 *
 * As of task 1.6 (migrate-automation), the 2 AI route registrations
 * (aiRoutes/aiEventRoutes) are collapsed into the single `automationRoutes`
 * plugin, in the same position (`aiRoutes` used to occupy, with
 * `aiEventRoutes` immediately after). Like protection, wrapping two
 * already-adjacent, already-in-order registrations in a plugin does not
 * change the raw `printRoutes()` tree — see `route-table.snapshot.txt`
 * whose regenerated content is expected byte-identical.
 *
 * As of task 1.7 (migrate-ingest), the 3 email→transaction route
 * registrations (imports/inbox/mailboxes) are collapsed into the single
 * `ingestRoutes` plugin, in the position `importRoutes` used to occupy.
 * `inboxRoutes`/`mailboxRoutes` used to register much later (after
 * `profileRoutes`, interleaved with other flat registrations) — like the
 * three earlier migrations that moved interleaved registrations together,
 * this legitimately restructures the raw `printRoutes()` tree — see
 * `modules/ingest/plugin.ts`.
 * As of task 1.8 (migrate-system), the 5 system route registrations that used
 * to sit here directly (health/auth/notifications/backup/profile) are collapsed
 * into the single `systemRoutes` plugin registered below, in the position
 * `healthRoutes` used to occupy. `notificationRoutes`/`backupRoutes`/
 * `profileRoutes` used to register much later (interleaved with other module
 * registrations), so collapsing all 5 into one contiguous plugin call, in the
 * position `healthRoutes` used to occupy, legitimately restructures the raw
 * `printRoutes()` tree (see `route-table.snapshot.txt`'s regenerated diff) but
 * does not change the canonical (method, path) surface
 * (`route-surface.snapshot.txt`).
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(systemRoutes);
  await app.register(ledgerRoutes);
  await app.register(ingestRoutes);
  await app.register(planningRoutes);
  await app.register(investmentsRoutes);
  await app.register(creditRoutes);
  await app.register(protectionRoutes);
  await app.register(automationRoutes);
  await app.register(householdRoutes);
  // First module registered with a Fastify prefix — see modules/shopping/plugin.ts.
  await app.register(shoppingRoutes, { prefix: "/api/shopping" });
}

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "production" ? "info" : "debug",
    },
    // Honour X-Forwarded-* from the reverse proxy so req.ip / req.protocol /
    // req.hostname reflect the real client for rate limiting, HSTS and CSRF.
    trustProxy: true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate("config", config);
  app.decorate("pg", createPool(config.DATABASE_URL));
  app.decorate("db", createDb(app.pg));
  app.decorate("redis", createRedis(config.REDIS_URL));
  app.decorate("storage", createStorage(config));
  await app.storage.ensureReady();
  // AI is per-user now (Settings → AI), resolved per request from ai_settings —
  // there is no global provider. See modules/automation/services/ai-settings.ts.

  const eventBus = new EventBus({
    error: (msg, ctx) => app.log.error(ctx ?? {}, msg),
  });
  app.decorate("eventBus", eventBus);
  // Every ledger-writing route/job emits "ledger.mutated" explicitly now that
  // there's no URL-based catch-all — new ledger-writing call sites must emit
  // it themselves (see EventMap in lib/event-bus.ts).
  registerLedgerCacheSubscriber(app);

  // Postings are the authority (PR-G1), so boot no longer REBUILDS them from
  // the legacy columns — doing that is what destroyed a transfer's second leg.
  // Two checks replace it, both before any BullMQ worker or HTTP traffic:
  //
  // 1. Refuse to start at all against a pre-recreate database. Single-shape
  //    code misreads the old two-row Clearing shape silently, so a hard stop is
  //    the only safe response.
  // 2. Report — never repair — any posting set that is not zero-sum or does not
  //    match a canonical shape.
  await assertNoLegacyShapes(app.db);
  await findInconsistentPostings(app.db)
    .then((problems) => {
      if (problems.length > 0)
        app.log.error(
          { count: problems.length, problems: problems.slice(0, 20) },
          "boot: inconsistent postings found — these transactions are corrupt and need a human",
        );
    })
    .catch((err: unknown) => app.log.error({ err }, "boot posting validation failed"));

  await startJobs(app);
  await setupAuth(app);
  await setupSecurity(app);

  app.addHook("onClose", async () => {
    await app.pg.end();
    app.redis.disconnect();
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Request does not match the schema",
        issues: err.validation.map((v) => ({
          path: v.instancePath,
          message: v.message,
        })),
      });
    }
    // Manual .parse() calls in handlers (multipart routes validate params/query
    // themselves) throw raw ZodErrors — a malformed request, not a server fault.
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Request does not match the schema",
        issues: err.issues.map((i) => ({
          path: `/${i.path.join("/")}`,
          message: i.message,
        })),
      });
    }
    const status = err.statusCode ?? 500;
    // HttpError carries a curated, safe message (e.g. AI provider outages) — pass
    // it through even at 5xx. Unexpected 5xx errors are logged and masked.
    if (status >= 500 && err.name !== "HttpError") {
      req.log.error(err);
      return reply.code(status).send({
        error: "Internal Server Error",
        message: "Something went wrong",
      });
    }
    return reply.code(status).send({ error: err.name, message: err.message });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: "Not Found", message: `Route ${req.method} ${req.url} not found` }),
  );

  await app.register(multipart);
  // gzip/brotli JSON responses above ~1KB (transaction pages, reports, aggregates).
  // Skips small bodies where compression overhead isn't worth it.
  await app.register(compress, { global: true, threshold: 1024 });
  await registerRoutes(app);

  // Best-effort cleanup; in-flight microtask handlers may still reference closed resources.
  app.addHook("onClose", () => {
    app.eventBus.removeAll();
  });

  return app;
}
