/**
 * Compass Drizzle schema barrel — single entry point for Drizzle Kit.
 *
 * This file is a pure re-export barrel: it contains ZERO inline `pgTable()` or
 * `pgEnum()` definitions. All table/enum definitions live in one of:
 *
 *   - `./core-schema.ts`           — shared identity leaf (users)
 *   - `./shared/<layer>.ts`        — inter-module shared tables/enums (15 tables, 25 enums)
 *   - `../modules/<domain>/schema.ts` — domain-resident tables/enums (54 tables, 26 enums)
 *
 * Drizzle Kit resolves the full schema graph from this single entry point
 * (configured in drizzle.config.ts). The export set is exactly 71 tables
 * (72 domain + users) and 53 enums, each exported exactly once.
 */

export { users } from "./core-schema.ts";

export * from "./shared/foundation.ts";
export * from "./shared/hubs.ts";
export * from "./shared/persons.ts";
export * from "./shared/recurring.ts";
export * from "./shared/spines.ts";
export * from "./shared/ledger.ts";

export {
  userProfiles,
  notifications,
  alertLedger,
  notificationPrefs,
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
  cardOffers,
  rewardRules,
  rewardPointLots,
  cardNetwork,
  bankAccountSubtype,
  cardOfferDiscountKind,
  rewardRedemptionRoute,
  rewardCapPeriod,
} from "../modules/credit/schema.ts";

export {
  accountNpsDetails,
  npsDetails,
  goldDetails,
  holdingValuations,
  holdingEvents,
  netWorthSnapshots,
  depositDetails,
  npsTier,
  goldForm,
  holdingEventType,
  holdingEventSource,
  depositKind,
  compoundingFrequency,
  interestDisposition,
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

export {
  households,
  householdMembers,
  householdInvites,
  householdRole,
  sharingGrants,
  sharingResourceType,
  splitRule,
  splits,
  splitShares,
  settlements,
} from "../modules/household/schema.ts";

export {
  catalogItems,
  priceSources,
  shoppingLists,
  shoppingListItems,
  priceObservations,
  pantryItems,
  cartDrafts,
  cartDraftItems,
  habitProfiles,
  serviceabilityChecks,
  receipts,
  receiptLines,
  shoppingListStatus,
  shoppingListItemStatus,
  normalizedUnit,
  priceSourceKind,
  cartDraftStatus,
  deliveryEtaBandEnum,
  receiptStatus,
  receiptLineMatchStatus,
} from "../modules/shopping/schema.ts";

export {
  taxRegimePreferences,
  taxRegimeEnum,
  regimeSourceEnum,
  payslips,
  payslipComponents,
  incomeEvents,
  incomeEventStatus,
  incomeKind,
  incomeSourceKind,
  epfContributions,
  deductionEntries,
  deductionSection,
  deductionKind,
  eightyDGroup,
  capitalLossCarryforward,
  capitalLossSetoffApplications,
  taxStatements,
  taxStatementKind,
  taxStatementStatus,
  taxLineMatchStatus,
  taxStatementLines,
} from "../modules/tax/schema.ts";

export {
  vehicleDetails,
  vehicleOdometerReadings,
} from "../modules/vehicles/schema.ts";
