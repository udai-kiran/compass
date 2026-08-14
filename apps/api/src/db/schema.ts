/**
 * Compass Drizzle schema barrel — single entry point for Drizzle Kit.
 *
 * This file is a pure re-export barrel: it contains ZERO inline `pgTable()` or
 * `pgEnum()` definitions. All table/enum definitions live in one of:
 *
 *   - `./core-schema.ts`           — shared identity leaf (users)
 *   - `./shared/<layer>.ts`        — inter-module shared tables/enums (12 tables, 22 enums)
 *   - `../modules/<domain>/schema.ts` — domain-resident tables/enums (38 tables, 16 enums)
 *
 * Drizzle Kit resolves the full schema graph from this single entry point
 * (configured in drizzle.config.ts). The export set is exactly 49 tables
 * (48 domain + users) and 38 enums, each exported exactly once.
 */

export { users } from "./core-schema.ts";

export * from "./shared/foundation.ts";
export * from "./shared/hubs.ts";
export * from "./shared/recurring.ts";
export * from "./shared/spines.ts";
export * from "./shared/ledger.ts";

export {
  userProfiles,
  familyMembers,
  notifications,
  alertLedger,
  notificationPrefs,
  familyRelationship,
  educationStage,
} from "../modules/system/schema.ts";

export {
  transactionLinks,
  merchantRules,
  userTasks,
  attachments,
} from "../modules/ledger/schema.ts";

export {
  cardDetails,
  cardIssuerSettings,
  cardStatements,
  bankDetails,
  overdraftDetails,
  rewardEntries,
  emiDetails,
  cardNetwork,
  bankAccountSubtype,
} from "../modules/credit/schema.ts";

export {
  accountNpsDetails,
  npsDetails,
  goldDetails,
  holdingValuations,
  holdingEvents,
  netWorthSnapshots,
  npsTier,
  goldForm,
  holdingEventType,
  holdingEventSource,
} from "../modules/investments/schema.ts";

export {
  retirementDetails,
  insuranceHealthCards,
} from "../modules/protection/schema.ts";

export {
  budgets,
  budgetLines,
  budgetAlerts,
  subscriptionDismissals,
  projectionSettings,
  budgetPeriod,
} from "../modules/planning/schema.ts";

export {
  imports,
  importRows,
  importPresets,
  mailboxCredentials,
  extractedTransactions,
  importStatus,
  extractedTxnStatus,
  txnDirection,
  extractedTxnIntent,
} from "../modules/ingest/schema.ts";

export {
  aiSettings,
  aiEvents,
  aiProvider,
  aiEventKind,
  aiEventStatus,
} from "../modules/automation/schema.ts";