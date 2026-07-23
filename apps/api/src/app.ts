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
import { healthRoutes } from "./routes/health.ts";
import { authRoutes } from "./routes/auth.ts";
import { accountRoutes } from "./routes/accounts.ts";
import { categoryRoutes } from "./routes/categories.ts";
import { transactionRoutes } from "./routes/transactions.ts";
import { transferRoutes } from "./routes/transfers.ts";
import { attachmentRoutes } from "./routes/attachments.ts";
import { importRoutes } from "./routes/imports.ts";
import { ruleRoutes } from "./routes/rules.ts";
import { budgetRoutes } from "./routes/budgets.ts";
import { dashboardRoutes } from "./routes/dashboard.ts";
import { notificationRoutes } from "./routes/notifications.ts";
import { recurringRoutes } from "./routes/recurring.ts";
import { goalRoutes } from "./routes/goals.ts";
import { sipRoutes } from "./routes/sips.ts";
import { cashflowRoutes } from "./routes/cashflow.ts";
import { billRoutes } from "./routes/bills.ts";
import { cardRoutes } from "./routes/cards.ts";
import { emiRoutes } from "./routes/emis.ts";
import { retirementRoutes } from "./routes/retirement.ts";
import { accountNpsRoutes } from "./routes/account-nps.ts";
import { bankDetailsRoutes } from "./routes/bank-details.ts";
import { overdraftDetailsRoutes } from "./routes/overdraft-details.ts";
import { insuranceRoutes } from "./routes/insurance.ts";
import { holdingRoutes } from "./routes/holdings.ts";
import { netWorthRoutes } from "./routes/networth.ts";
import { insightRoutes } from "./routes/insights.ts";
import { reportRoutes } from "./routes/reports.ts";
import { searchRoutes } from "./routes/search.ts";
import { backupRoutes } from "./routes/backup.ts";
import { aiRoutes } from "./routes/ai.ts";
import { aiEventRoutes } from "./routes/ai-events.ts";
import { projectionSettingsRoutes } from "./routes/projection-settings.ts";
import { inboxRoutes } from "./routes/inbox.ts";
import { mailboxRoutes } from "./routes/mailboxes.ts";
import { invalidateUserCache } from "./services/cache.ts";
import { enqueueBudgetEvaluation } from "./jobs/index.ts";
import { createStorage, type Storage } from "./lib/storage.ts";

declare module "fastify" {
  interface FastifyInstance {
    config: Config;
    pg: pg.Pool;
    db: Db;
    redis: Redis;
    queues: Queues;
    storage: Storage;
  }
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
  // there is no global provider. See services/ai-settings.ts.
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
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(categoryRoutes);
  await app.register(transactionRoutes);
  await app.register(transferRoutes);
  await app.register(attachmentRoutes);
  await app.register(importRoutes);
  await app.register(ruleRoutes);
  await app.register(budgetRoutes);
  await app.register(dashboardRoutes);
  await app.register(notificationRoutes);
  await app.register(recurringRoutes);
  await app.register(goalRoutes);
  await app.register(sipRoutes);
  await app.register(cashflowRoutes);
  await app.register(billRoutes);
  await app.register(cardRoutes);
  await app.register(emiRoutes);
  await app.register(retirementRoutes);
  await app.register(accountNpsRoutes);
  await app.register(bankDetailsRoutes);
  await app.register(overdraftDetailsRoutes);
  await app.register(insuranceRoutes);
  await app.register(holdingRoutes);
  await app.register(netWorthRoutes);
  await app.register(insightRoutes);
  await app.register(reportRoutes);
  await app.register(searchRoutes);
  await app.register(backupRoutes);
  await app.register(aiRoutes);
  await app.register(aiEventRoutes);
  await app.register(projectionSettingsRoutes);
  await app.register(inboxRoutes);
  await app.register(mailboxRoutes);

  // write-through invalidation: any successful ledger write refreshes cached
  // aggregates and queues a (debounced) budget evaluation
  app.addHook("onResponse", async (req, reply) => {
    if (req.method === "GET" || reply.statusCode >= 400 || !req.session) return;
    if (/^\/api\/(transactions|transfers|imports|recurring|inbox)/.test(req.url)) {
      await invalidateUserCache(app.redis, req.session.userId);
      await enqueueBudgetEvaluation(app, req.session.userId);
    }
  });

  return app;
}
