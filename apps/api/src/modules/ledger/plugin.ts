import type { FastifyInstance } from "fastify";
import { accountRoutes } from "./routes/accounts.ts";
import { categoryRoutes } from "./routes/categories.ts";
import { transactionRoutes } from "./routes/transactions.ts";
import { transferRoutes } from "./routes/transfers.ts";
import { attachmentRoutes } from "./routes/attachments.ts";
import { transactionLinkRoutes } from "./routes/transaction-links.ts";
import { ruleRoutes } from "./routes/rules.ts";
import { recurringRoutes } from "./routes/recurring.ts";
import { searchRoutes } from "./routes/search.ts";
import { resourceRoutes } from "./routes/resources.ts";
import { userTaskRoutes } from "./routes/user-tasks.ts";

/**
 * `modules/ledger/` — the largest domain, first of 8 Phase-1 module
 * migrations (task 1.1). Same `modules/<domain>/` convention task 0.3
 * introduced: `schema.ts` (physically defines ledger's 6 resident tables (its enums live in the shared
 * layers) and re-exports the shared tables/enums that make up its schema surface from `db/shared/*`), `services/`,
 * `routes/`, `plugin.ts` (this file).
 *
 * Registers all 11 ledger route groups internally, replacing the 11 separate
 * `app.register(...)` calls `app.ts` used to make directly. Same URLs, same
 * handler bodies, same `ledger.mutated` emission — pure relocation, no
 * behavioral change. This collapses 11 interleaved flat registrations into
 * one contiguous plugin call, which legitimately restructures Fastify's raw
 * `printRoutes()` tree (see route-table.snapshot.txt's regenerated diff) but
 * does not change the canonical (method, path) surface
 * (route-surface.snapshot.txt) — see tasks/007-migrate-ledger/TASK.md Root
 * Cause for why the identity gate is split in two.
 */
export async function ledgerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(accountRoutes);
  await app.register(categoryRoutes);
  await app.register(transactionRoutes);
  await app.register(transferRoutes);
  await app.register(attachmentRoutes);
  await app.register(transactionLinkRoutes);
  await app.register(ruleRoutes);
  await app.register(recurringRoutes);
  await app.register(searchRoutes);
  await app.register(resourceRoutes);
  await app.register(userTaskRoutes);
}
