# Investigation 1 — Cross-module FK graph and schema decomposition

**Scope**: `apps/api/src/db/schema.ts`, `apps/api/src/db/core-schema.ts`,
and every `apps/api/src/modules/<domain>/schema.ts`.

---

## 1. TABLE INVENTORY

### 1a. `db/core-schema.ts`

| JS identifier | SQL name | Line |
|---|---|---|
| `users` | `users` | core-schema.ts:11 |

### 1b. `db/schema.ts` — all 50 `pgTable()` definitions

| JS identifier | SQL name | Line |
|---|---|---|
| `userProfiles` | `user_profiles` | 38 |
| `familyMembers` | `family_members` | 66 |
| `aiSettings` | `ai_settings` | 107 |
| `accounts` | `accounts` | 153 |
| `categories` | `categories` | 211 |
| `resources` | `resources` | 264 |
| `transactions` | `transactions` | 283 |
| `userTasks` | `user_tasks` | 387 |
| `transactionSplits` | `transaction_splits` | 429 |
| `transferLinks` | `transfer_links` | 446 |
| `imports` | `imports` | 471 |
| `importRows` | `import_rows` | 493 |
| `importPresets` | `import_presets` | 526 |
| `merchantRules` | `merchant_rules` | 544 |
| `budgets` | `budgets` | 562 |
| `budgetLines` | `budget_lines` | 578 |
| `budgetAlerts` | `budget_alerts` | 597 |
| `notifications` | `notifications` | 616 |
| `recurringTemplates` | `recurring_templates` | 649 |
| `goals` | `goals` | 692 |
| `alertLedger` | `alert_ledger` | 721 |
| `subscriptionDismissals` | `subscription_dismissals` | 735 |
| `projectionSettings` | `projection_settings` | 749 |
| `notificationPrefs` | `notification_prefs` | 759 |
| `attachments` | `attachments` | 779 |
| `transactionLinks` | `transaction_links` | 795 |
| `cardDetails` | `card_details` | 829 |
| `cardIssuerSettings` | `card_issuer_settings` | 864 |
| `cardStatements` | `card_statements` | 897 |
| `bankDetails` | `bank_details` | 940 |
| `retirementDetails` | `retirement_details` | 961 |
| `overdraftDetails` | `overdraft_details` | 992 |
| `insurancePolicies` | `insurance_policies` | 1033 |
| `insuranceHealthCards` | `insurance_health_cards` | 1093 |
| `rewardEntries` | `reward_entries` | 1114 |
| `statementReconciliations` | `statement_reconciliations` | 1153 |
| `emiDetails` | `emi_details` | 1198 |
| `holdings` | `holdings` | 1265 |
| `accountNpsDetails` | `account_nps_details` | 1305 |
| `npsDetails` | `nps_details` | 1323 |
| `goldDetails` | `gold_details` | 1343 |
| `holdingValuations` | `holding_valuations` | 1359 |
| `holdingEvents` | `holding_events` | 1387 |
| `sips` | `sips` | 1447 |
| `netWorthSnapshots` | `net_worth_snapshots` | 1508 |
| `mailboxAccounts` | `mailbox_accounts` | 1541 |
| `mailboxCredentials` | `mailbox_credentials` | 1571 |
| `emailIngestions` | `email_ingestions` | 1610 |
| `extractedTransactions` | `extracted_transactions` | 1659 |
| `aiEvents` | `ai_events` | 1739 |

**Total: 51 tables** (1 in core-schema.ts + 50 in schema.ts).

### 1c. `db/schema.ts` — all 38 `pgEnum()` definitions

| JS identifier | SQL name | Line | Owned by |
|---|---|---|---|
| `familyRelationship` | `family_relationship` | 47 | system |
| `educationStage` | `education_stage` | 55 | system |
| `aiProvider` | `ai_provider` | 92 | automation |
| `accountType` | `account_type` | 126 | ledger |
| `categoryKind` | `category_kind` | 206 | ledger |
| `expenseNecessity` | `expense_necessity` | 209 | ledger |
| `transactionSource` | `transaction_source` | 251 | ledger |
| `resourceKind` | `resource_kind` | 253 | ledger |
| `importStatus` | `import_status` | 469 | ingest |
| `budgetPeriod` | `budget_period` | 560 | planning |
| `recurringFrequency` | `recurring_frequency` | 634 | ledger |
| `recurringKind` | `recurring_kind` | 641 | ledger |
| `goalType` | `goal_type` | 681 | planning |
| `cardNetwork` | `card_network` | 813 | credit |
| `bankAccountSubtype` | `bank_account_subtype` | 923 | credit |
| `insuranceKind` | `insurance_kind` | 1007 | protection |
| `vehicleKind` | `vehicle_kind` | 1008 | protection |
| `healthType` | `health_type` | 1009 | protection |
| `premiumFrequency` | `premium_frequency` | 1017 | protection |
| `assetClass` | `asset_class` | 1238 | investments |
| `gainsTaxClass` | `gains_tax_class` | 1255 | investments |
| `npsTier` | `nps_tier` | 1302 | investments |
| `goldForm` | `gold_form` | 1340 | investments |
| `holdingEventType` | `holding_event_type` | 1380 | investments |
| `holdingEventSource` | `holding_event_source` | 1385 | investments |
| `sipTargetKind` | `sip_target_kind` | 1424 | investments |
| `sipStatus` | `sip_status` | 1425 | investments |
| `sipFundingSource` | `sip_funding_source` | 1426 | investments |
| `sipFrequency` | `sip_frequency` | 1433 | investments |
| `mailboxProvider` | `mailbox_provider` | 1533 | ingest |
| `mailboxStatus` | `mailbox_status` | 1534 | ingest |
| `emailClass` | `email_class` | 1588 | ingest |
| `emailIngestStatus` | `email_ingest_status` | 1597 | ingest |
| `extractedTxnStatus` | `extracted_txn_status` | 1637 | ingest |
| `txnDirection` | `txn_direction` | 1645 | ingest |
| `extractedTxnIntent` | `extracted_txn_intent` | 1651 | ingest |
| `aiEventKind` | `ai_event_kind` | 1722 | automation |
| `aiEventStatus` | `ai_event_status` | 1730 | automation |

---

## 2. OWNING-MODULE MAP

Every module's `schema.ts` re-exports a subset of tables from `db/schema.ts`. The
mapping is derived from reading each file directly.

### 2a. Module → tables owned

**core** (`db/core-schema.ts`):
- `users`

**system** (`modules/system/schema.ts:30-38`):
- `userProfiles`, `familyMembers`, `notifications`, `alertLedger`, `notificationPrefs`
- Enums: `familyRelationship`, `educationStage`

**ledger** (`modules/ledger/schema.ts:24-43`):
- `accounts`, `categories`, `resources`, `transactions`, `transactionSplits`,
  `transferLinks`, `transactionLinks`, `merchantRules`, `recurringTemplates`,
  `userTasks`, `attachments`
- Enums: `accountType`, `categoryKind`, `expenseNecessity`, `transactionSource`,
  `resourceKind`, `recurringFrequency`, `recurringKind`

**credit** (`modules/credit/schema.ts:26-37`):
- `cardDetails`, `cardIssuerSettings`, `cardStatements`, `bankDetails`,
  `overdraftDetails`, `rewardEntries`, `statementReconciliations`, `emiDetails`
- Enums: `cardNetwork`, `bankAccountSubtype`

**investments** (`modules/investments/schema.ts:28-47`):
- `holdings`, `accountNpsDetails`, `npsDetails`, `goldDetails`, `holdingValuations`,
  `holdingEvents`, `sips`, `netWorthSnapshots`
- Enums: `assetClass`, `gainsTaxClass`, `npsTier`, `goldForm`, `holdingEventType`,
  `holdingEventSource`, `sipTargetKind`, `sipStatus`, `sipFundingSource`, `sipFrequency`

**protection** (`modules/protection/schema.ts:25-33`):
- `retirementDetails`, `insurancePolicies`, `insuranceHealthCards`
- Enums: `insuranceKind`, `vehicleKind`, `healthType`, `premiumFrequency`

**planning** (`modules/planning/schema.ts:24-33`):
- `budgets`, `budgetLines`, `budgetAlerts`, `goals`, `subscriptionDismissals`,
  `projectionSettings`
- Enums: `budgetPeriod`, `goalType`

**automation** (`modules/automation/schema.ts:24-30`):
- `aiSettings`, `aiEvents`
- Enums: `aiProvider`, `aiEventKind`, `aiEventStatus`

**ingest** (`modules/ingest/schema.ts:26-42`):
- `imports`, `importRows`, `importPresets`, `mailboxAccounts`, `mailboxCredentials`,
  `emailIngestions`, `extractedTransactions`
- Enums: `importStatus`, `mailboxProvider`, `mailboxStatus`, `emailClass`,
  `emailIngestStatus`, `extractedTxnStatus`, `txnDirection`, `extractedTxnIntent`

### 2b. FLAT (unassigned) tables

**None.** All 50 tables in `db/schema.ts` are re-exported by exactly one module.
There are no orphaned table definitions. The "flat services" listed in
`apps/api/src/services/` (anomaly, autopilot, balances, cache, ownership, periods)
are helper services without their own tables — they query tables owned by the
modules listed above (see §7 below).

---

## 3. FK EDGE EXTRACTION

Full list of all `.references()` calls, annotated with source and target modules.
`users.id` target is written as `core` throughout. The `AnyPgColumn` wrapper
(lines 197, 333, 343, 344–358) signals a same-file forward reference in the current
monolithic schema; it does not indicate a table-level cycle.

### 3a. Intra-module FK edges (same module on both sides)

| Source table (module) | Column | Target table (module) | Line |
|---|---|---|---|
| `transactionSplits` (ledger) | `transactionId` | `transactions` (ledger) | 435 |
| `transactionSplits` (ledger) | `categoryId` | `categories` (ledger) | 438 |
| `transferLinks` (ledger) | `outTransactionId` | `transactions` (ledger) | 456 |
| `transferLinks` (ledger) | `inTransactionId` | `transactions` (ledger) | 460 |
| `importRows` (ingest) | `importId` | `imports` (ingest) | 499 |
| `budgetLines` (planning) | `budgetId` | `budgets` (planning) | 584 |
| `userTasks` (ledger) | `transactionId` | `transactions` (ledger) | 396 |
| `attachments` (ledger) | `transactionId` | `transactions` (ledger) | 785 |
| `transactionLinks` (ledger) | `transactionId` | `transactions` (ledger) | 801 |
| `insuranceHealthCards` (protection) | `policyId` | `insurancePolicies` (protection) | 1099 |
| `npsDetails` (investments) | `holdingId` | `holdings` (investments) | 1326 |
| `goldDetails` (investments) | `holdingId` | `holdings` (investments) | 1346 |
| `holdingValuations` (investments) | `holdingId` | `holdings` (investments) | 1365 |
| `holdingEvents` (investments) | `holdingId` | `holdings` (investments) | 1393 |
| `holdingEvents` (investments) | `sipId` | `sips` (investments) | 1415 |
| `extractedTransactions` (ingest) | `ingestionId` | `emailIngestions` (ingest) | 1668 |
| `emailIngestions` (ingest) | `mailboxId` | `mailboxAccounts` (ingest) | 1617 |
| `transactions` (ledger) | `accountId` | `accounts` (ledger) | 292 |
| `transactions` (ledger) | `categoryId` | `categories` (ledger) | 303 |
| `transactions` (ledger) | `resourceId` | `resources` (ledger) | 336 |
| `transactions` (ledger) | `recurringTemplateId` | `recurringTemplates` (ledger) | 344 |
| `recurringTemplates` (ledger) | `accountId` | `accounts` (ledger) | 658 |
| `recurringTemplates` (ledger) | `categoryId` | `categories` (ledger) | 659 |
| `recurringTemplates` (ledger) | `resourceId` | `resources` (ledger) | 672 |

> **Correction (Codex plan review-1, coordinator-validated):** the 7 rows above
> were originally listed under §3b as cross-module edges. All have `ledger` on
> both endpoints in the current module assignment, so they are intra-module and
> require no cross-file import. They belong here in §3a. (Under the Policy B
> decomposition their targets move to the shared layer, but that is a *future*
> home, not the current-state classification this graph records.)

### 3b. Cross-module FK edges

Every edge here would require a cross-file ES-module import when tables are
physically split into their module files.

| Source table (owner) | Column | Target table (owner) | Line |
|---|---|---|---|
| `userProfiles` (system) | `userId` | `users` (core) | 40 |
| `familyMembers` (system) | `userId` | `users` (core) | 72 |
| `aiSettings` (automation) | `userId` | `users` (core) | 109 |
| `accounts` (ledger) | `userId` | `users` (core) | 159 |
| `accounts` (ledger) | `goalId` | `goals` (planning) | 197 |
| `categories` (ledger) | `userId` | `users` (core) | 216 |
| `resources` (ledger) | `userId` | `users` (core) | 268 |
| `transactions` (ledger) | `userId` | `users` (core) | 289 |
| `transactions` (ledger) | `policyId` | `insurancePolicies` (protection) | 333 |
| `transactions` (ledger) | `sipId` | `sips` (investments) | 343 |
| `transactions` (ledger) | `reconciledStatementId` | `statementReconciliations` (credit) | 354 |
| `userTasks` (ledger) | `userId` | `users` (core) | 390 |
| `transferLinks` (ledger) | `userId` | `users` (core) | 451 |
| `merchantRules` (ledger) | `userId` | `users` (core) | 549 |
| `imports` (ingest) | `userId` | `users` (core) | 475 |
| `imports` (ingest) | `accountId` | `accounts` (ledger) | 480 |
| `importPresets` (ingest) | `userId` | `users` (core) | 530 |
| `importPresets` (ingest) | `accountId` | `accounts` (ledger) | 535 |
| `budgets` (planning) | `userId` | `users` (core) | 567 |
| `budgetLines` (planning) | `categoryId` | `categories` (ledger) | 587 |
| `budgetAlerts` (planning) | `userId` | `users` (core) | 602 |
| `budgetAlerts` (planning) | `categoryId` | `categories` (ledger) | 607 |
| `notifications` (system) | `userId` | `users` (core) | 621 |
| `recurringTemplates` (ledger) | `userId` | `users` (core) | 654 |
| `goals` (planning) | `userId` | `users` (core) | 697 |
| `alertLedger` (system) | `userId` | `users` (core) | 726 |
| `subscriptionDismissals` (planning) | `userId` | `users` (core) | 740 |
| `projectionSettings` (planning) | `userId` | `users` (core) | 752 |
| `notificationPrefs` (system) | `userId` | `users` (core) | 765 |
| `notificationPrefs` (system) | `accountId` | `accounts` (ledger) | 769 |
| `cardDetails` (credit) | `accountId` | `accounts` (ledger) | 832 |
| `cardDetails` (credit) | `userId` | `users` (core) | 834 |
| `cardIssuerSettings` (credit) | `userId` | `users` (core) | 869 |
| `cardStatements` (credit) | `accountId` | `accounts` (ledger) | 903 |
| `cardStatements` (credit) | `userId` | `users` (core) | 905 |
| `bankDetails` (credit) | `accountId` | `accounts` (ledger) | 943 |
| `bankDetails` (credit) | `userId` | `users` (core) | 945 |
| `retirementDetails` (protection) | `accountId` | `accounts` (ledger) | 964 |
| `retirementDetails` (protection) | `userId` | `users` (core) | 966 |
| `overdraftDetails` (credit) | `accountId` | `accounts` (ledger) | 995 |
| `overdraftDetails` (credit) | `userId` | `users` (core) | 997 |
| `insurancePolicies` (protection) | `userId` | `users` (core) | 1039 |
| `insurancePolicies` (protection) | `resourceId` | `resources` (ledger) | 1048 |
| `insuranceHealthCards` (protection) | `userId` | `users` (core) | 1100 |
| `rewardEntries` (credit) | `userId` | `users` (core) | 1119 |
| `rewardEntries` (credit) | `accountId` | `accounts` (ledger) | 1123 |
| `rewardEntries` (credit) | `ingestionId` | `emailIngestions` (ingest) | 1133 |
| `statementReconciliations` (credit) | `userId` | `users` (core) | 1159 |
| `statementReconciliations` (credit) | `accountId` | `accounts` (ledger) | 1162 |
| `statementReconciliations` (credit) | `ingestionId` | `emailIngestions` (ingest) | 1168 |
| `emiDetails` (credit) | `userId` | `users` (core) | 1203 |
| `emiDetails` (credit) | `templateId` | `recurringTemplates` (ledger) | 1201 |
| `emiDetails` (credit) | `loanAccountId` | `accounts` (ledger) | 1217 |
| `holdings` (investments) | `userId` | `users` (core) | 1270 |
| `holdings` (investments) | `goalId` | `goals` (planning) | 1294 |
| `accountNpsDetails` (investments) | `accountId` | `accounts` (ledger) | 1308 |
| `accountNpsDetails` (investments) | `userId` | `users` (core) | 1311 |
| `npsDetails` (investments) | `userId` | `users` (core) | 1329 |
| `goldDetails` (investments) | `userId` | `users` (core) | 1349 |
| `sips` (investments) | `userId` | `users` (core) | 1451 |
| `sips` (investments) | `goalId` | `goals` (planning) | 1456 |
| `sips` (investments) | `sourceAccountId` | `accounts` (ledger) | 1459 |
| `sips` (investments) | `targetHoldingId` | `holdings` (investments) | 1462 |
| `sips` (investments) | `targetAccountId` | `accounts` (ledger) | 1466 |
| `netWorthSnapshots` (investments) | `userId` | `users` (core) | 1512 |
| `mailboxAccounts` (ingest) | `userId` | `users` (core) | 1546 |
| `mailboxCredentials` (ingest) | `userId` | `users` (core) | 1576 |
| `extractedTransactions` (ingest) | `userId` | `users` (core) | 1663 |
| `extractedTransactions` (ingest) | `suggestedAccountId` | `accounts` (ledger) | 1679 |
| `extractedTransactions` (ingest) | `suggestedCategoryId` | `categories` (ledger) | 1683 |
| `extractedTransactions` (ingest) | `transactionId` | `transactions` (ledger) | 1699 |
| `extractedTransactions` (ingest) | `matchedTransactionId` | `transactions` (ledger) | 1707 |
| `aiEvents` (automation) | `userId` | `users` (core) | 1743 |
| `aiEvents` (automation) | `ingestionId` | `emailIngestions` (ingest) | 1752 |
| `aiEvents` (automation) | `accountId` | `accounts` (ledger) | 1753 |

### 3c. Inbound FK degree (tables most referenced across modules)

This counts FK columns pointing INTO each table from OTHER modules only.

| Target table (module) | Inbound cross-module FK columns | Referenced from modules |
|---|---|---|
| `accounts` (ledger) | 16 | credit (×7), investments (×3), ingest (×3), system (×1), protection (×1), automation (×1) — 2 further ledger-internal (transactions, recurringTemplates) excluded, 18 total inbound |
| `categories` (ledger) | 3 | planning (×2), ingest (×1) — ledger-internal (transactions, transactionSplits, recurringTemplates) excluded |
| `transactions` (ledger) | 2 | ingest (×2) |
| `goals` (planning) | 3 | investments (×2), ledger (×1) |
| `emailIngestions` (ingest) | 3 | credit (×2), automation (×1) |
| `recurringTemplates` (ledger) | 1 | credit (×1) |
| `resources` (ledger) | 1 | protection (×1) |
| `sips` (investments) | 1 | ledger (×1) |
| `statementReconciliations` (credit) | 1 | ledger (×1) |
| `insurancePolicies` (protection) | 1 | ledger (×1) |
| `holdings` (investments) | 0 | all inbound FKs (npsDetails, goldDetails, holdingValuations, holdingEvents, sips.targetHoldingId) are investments-internal |

**`accounts` is the dominant hub: 16 inbound cross-module FK columns from 6 different modules.**

> **Correction (Codex plan review-1, coordinator-validated):** `accounts` source
> breakdown is credit×7 / investments×3 / ingest×3 / system×1 / protection×1 /
> automation×1 (= 16 cross-module); `categories` cross-module inbound is 3 (not 4);
> `holdings` cross-module inbound is 0 (not 1 — `sips.targetHoldingId` is
> investments-internal). None of these change the SCC decomposition below.

---

## 4. MODULE-LEVEL DEPENDENCY GRAPH

Collapsing table edges to module edges (excluding all `→ users/core` arrows, which
every module has and which never create cycles since `core` has no outbound module
imports).

```
system      → ledger    (notificationPrefs.accountId → accounts)
ledger      → planning  (accounts.goalId → goals)
ledger      → protection(transactions.policyId → insurancePolicies)
ledger      → investments(transactions.sipId → sips)
ledger      → credit    (transactions.reconciledStatementId → statementReconciliations)
planning    → ledger    (budgetLines.categoryId → categories; budgetAlerts.categoryId → categories)
credit      → ledger    (cardDetails/cardStatements/bankDetails/overdraftDetails/rewardEntries/
                         statementReconciliations → accounts; emiDetails → accounts+recurringTemplates)
credit      → ingest    (rewardEntries.ingestionId → emailIngestions;
                         statementReconciliations.ingestionId → emailIngestions)
investments → ledger    (accountNpsDetails → accounts; sips.sourceAccountId → accounts;
                         sips.targetAccountId → accounts)
investments → planning  (holdings.goalId → goals; sips.goalId → goals)
protection  → ledger    (retirementDetails.accountId → accounts;
                         insurancePolicies.resourceId → resources)
ingest      → ledger    (imports.accountId → accounts; importPresets.accountId → accounts;
                         extractedTransactions → accounts + categories + transactions)
automation  → ingest    (aiEvents.ingestionId → emailIngestions)
automation  → ledger    (aiEvents.accountId → accounts)
```

**Cycle pairs at module level:**

1. `ledger ↔ planning` — accounts→goals and budgetLines/budgetAlerts→categories
2. `ledger ↔ credit` — transactions→statementReconciliations and all credit→accounts/recurringTemplates
3. `ledger ↔ investments` — transactions→sips and sips→accounts
4. `ledger ↔ protection` — transactions→insurancePolicies and retirementDetails/insurancePolicies→accounts/resources

There is also a **three-way cycle**:
`credit → ingest → ledger → credit`
- `credit` references `emailIngestions` (ingest)
- `ingest` references `transactions` (ledger) via extractedTransactions
- `ledger` references `statementReconciliations` (credit)

Non-cyclic modules (one-directional dependency only):
- `system → ledger` (ledger has no edge into system)
- `automation → ingest` (ingest has no edge into automation)
- `automation → ledger` (ledger has no edge into automation)
- `investments → planning` (planning has no edge into investments)

---

## 5. SCC DECOMPOSITION

### 5a. Table-level SCCs

**There are NO table-level FK cycles.** Every table is a singleton SCC. The FK
graph at the table level is a DAG. The `AnyPgColumn` forward references
(accounts→goals, transactions→insurancePolicies, transactions→sips,
transactions→statementReconciliations, transactions→recurringTemplates) are
same-file workarounds for declaration order, not cyclic references — goals,
insurancePolicies, sips, and statementReconciliations have no FK paths back to
accounts or transactions.

Verification of the key potential cycles:
- `accounts → goals → users` — dead end, goals has no FK to accounts. Not a cycle.
- `transactions → sips → accounts → goals → users` — dead end. Not a cycle.
- `transactions → statementReconciliations → accounts → goals → users` — dead end.
- `transactions → insurancePolicies → resources → users` — dead end.
- `holdingEvents → sips → holdings → goals → users` — dead end.

### 5b. Module-level SCCs

The module-level directed graph (from §4) has one large SCC:

**SCC-1 (size 5): {ledger, planning, credit, investments, protection}**

All five are mutually reachable:
- ledger→planning→ledger (via accounts.goalId and budgetLines.categoryId)
- ledger→credit→ledger (via transactions.reconciledStatementId and statementReconciliations.accountId)
- ledger→investments→ledger (via transactions.sipId and sips.sourceAccountId)
- ledger→protection→ledger (via transactions.policyId and retirementDetails.accountId)
- credit→ingest→ledger→credit (the three-way cycle makes ingest a transient member
  in paths between credit and ledger, but `ingest` itself is NOT in SCC-1 because
  SCC-1 members cannot reach `ingest` except via `ledger→credit→ingest` and then
  there is no path from ingest back into SCC-1 that doesn't go through ledger,
  meaning ingest IS in the cycle path but the SCC tester finds that
  ingest→ledger→credit→ingest is a 3-cycle, making ingest part of SCC-2.)

**Revised SCC analysis with the three-way cycle:**

Actually, testing reachability:
- From `ingest`: ingest→ledger→credit→ingest (**ingest IS reachable from itself**)
- So `ingest`, `ledger`, and `credit` form a 3-cycle.
- Since `ledger` is already in SCC-1, and `ingest` can reach `ledger` (and `ledger`
  can reach `ingest` via `ledger→credit→ingest`), `ingest` is also in SCC-1.

**Final SCC-1 (size 6): {ledger, planning, credit, investments, protection, ingest}**

Singleton SCCs (no cycles back into themselves):
- `core` — no outbound module edges
- `system` — outbound to ledger; ledger has no edge back to system
- `automation` — outbound to ledger and ingest; neither has an edge back to automation

### 5c. Consequence for physical relocation

Since there are no TABLE-level cycles, every table can in principle live in its
own module file. But the MODULE-level SCC (ledger+planning+credit+investments+
protection+ingest) means that naively putting each module's tables in
`modules/<domain>/schema.ts` would require those files to import each other,
creating ES-module import cycles. Tables that sit at the intersections of these
cross-module dependencies must be extracted to a shared core file to make the
module graph a DAG.

---

## 6. PROPOSED FINAL HOME FOR EVERY TABLE

> **SUPERSEDED — decision recorded 2026-08-05.** §6 documents the *minimal* cut
> (Policy A: 7-table shared) that makes only the MODULE import graph acyclic while
> leaving 4 acyclic sibling-module schema imports. The task chose **Policy B
> (layered)** instead — it satisfies AC2 as written ("no module imports another
> module's schema slice", full stop). Under Policy B the shared surface is ~12
> cross-domain table definitions split into DAG-depth-ordered layer files behind
> the unchanged single `db/schema.ts` Drizzle barrel. §6 below is retained as the
> analysis of the minimal cut; the authoritative per-layer table assignment lives
> in the SP2 plan (`tasks/020-cross-module-ports/`). The FK graph and SCC
> decomposition in §1–§5 remain fully valid and are policy-independent.

### 6a. Minimum shared-core set

To break all module-level cycles, the following tables must be elevated to a
shared file (call it `db/shared-schema.ts` to keep `db/core-schema.ts` narrow per
the CLAUDE.md note about it being "deliberately narrow"):

| Table | Current owner | Reason for elevation |
|---|---|---|
| `accounts` | ledger | 16 inbound FK columns from 6 modules; accounts.goalId→goals creates ledger↔planning back-edge |
| `goals` | planning | accounts.goalId references it; if both accounts+goals go to shared, the ledger↔planning cycle dissolves |
| `categories` | ledger | budgetLines/budgetAlerts (planning) and extractedTransactions (ingest) reference it; moves planning→ledger edge to planning→shared |
| `resources` | ledger | insurancePolicies (protection) references it; moves protection→ledger edge to protection→shared |
| `recurringTemplates` | ledger | emiDetails (credit) references it; moves credit→ledger edge to credit→shared |
| `mailboxAccounts` | ingest | emailIngestions references it; if emailIngestions goes to shared, mailboxAccounts must follow to keep emailIngestions intra-shared |
| `emailIngestions` | ingest | credit (×2 FK columns) and automation reference it; moving it breaks credit→ingest and automation→ingest edges; without those edges the three-way credit↔ingest↔ledger cycle dissolves |

After moving these 7 tables to `db/shared-schema.ts`, the module graph becomes a DAG:

```
db/core-schema.ts  (users)
        ↑
db/shared-schema.ts (accounts, goals, categories, resources, recurringTemplates,
                     mailboxAccounts, emailIngestions)
  — imports core only; no module imports
        ↑
modules/ledger     → shared, investments, credit, protection
modules/investments→ shared
modules/credit     → shared
modules/protection → shared
modules/planning   → shared
modules/ingest     → shared, ledger  (extractedTransactions→transactions)
modules/system     → shared
modules/automation → shared
```

`ingest→ledger` remains (extractedTransactions.transactionId → transactions), but
`ledger` has no edge back into `ingest` after the mailboxAccounts/emailIngestions
move. One-directional, no cycle.

`ledger→{investments, credit, protection}` remains (transactions.sipId,
transactions.reconciledStatementId, transactions.policyId), but these modules
now only reference `shared` (not `ledger`), so there are no back-edges. No cycles.

### 6b. Table-by-table proposed home

#### db/core-schema.ts (unchanged)
- `users`

#### db/shared-schema.ts (new file — the "hub" tables)
- `accounts` (moved from ledger)
- `goals` (moved from planning)
- `categories` (moved from ledger)
- `resources` (moved from ledger)
- `recurringTemplates` (moved from ledger; its internal refs to accounts/categories/resources stay intra-shared)
- `mailboxAccounts` (moved from ingest)
- `emailIngestions` (moved from ingest)

Enums that travel with these tables into `db/shared-schema.ts`:
`accountType`, `categoryKind`, `expenseNecessity`, `transactionSource`,
`resourceKind`, `recurringFrequency`, `recurringKind`, `goalType`,
`mailboxProvider`, `mailboxStatus`, `emailClass`, `emailIngestStatus`

#### modules/ledger/schema.ts (physical pgTable definitions)
Remaining after extracting to shared:
- `transactions`, `transactionSplits`, `transferLinks`, `transactionLinks`,
  `merchantRules`, `userTasks`, `attachments`

ledger's cross-module imports: `accounts`, `categories`, `resources`,
`recurringTemplates` from `db/shared-schema.ts`; `sips` from modules/investments;
`statementReconciliations` from modules/credit; `insurancePolicies` from modules/protection.

#### modules/investments/schema.ts (physical pgTable definitions)
- `holdings`, `accountNpsDetails`, `npsDetails`, `goldDetails`, `holdingValuations`,
  `holdingEvents`, `sips`, `netWorthSnapshots`

investments' imports from shared: `accounts` (×3 in sips), `goals` (×2 in holdings/sips).
No import from ledger, credit, protection, or planning. ✓

#### modules/credit/schema.ts (physical pgTable definitions)
- `cardDetails`, `cardIssuerSettings`, `cardStatements`, `bankDetails`,
  `overdraftDetails`, `rewardEntries`, `statementReconciliations`, `emiDetails`

credit's imports from shared: `accounts` (×5), `recurringTemplates` (×1 in emiDetails),
`emailIngestions` (×2 in rewardEntries/statementReconciliations).
No import from ledger, investments, protection, planning, or ingest. ✓

#### modules/protection/schema.ts (physical pgTable definitions)
- `retirementDetails`, `insurancePolicies`, `insuranceHealthCards`

protection's imports from shared: `accounts` (×1), `resources` (×1).
No import from ledger, credit, investments, or planning. ✓

#### modules/planning/schema.ts (physical pgTable definitions)
Remaining after goals moves to shared:
- `budgets`, `budgetLines`, `budgetAlerts`, `subscriptionDismissals`,
  `projectionSettings`

planning's imports from shared: `goals` is already in shared (no planning→ledger edge any more);
`categories` from shared for budgetLines/budgetAlerts.
No import from ledger, credit, investments, protection, or ingest. ✓

#### modules/ingest/schema.ts (physical pgTable definitions)
Remaining after mailboxAccounts/emailIngestions move to shared:
- `imports`, `importRows`, `importPresets`, `mailboxCredentials`,
  `extractedTransactions`

ingest's imports from shared: `accounts` (×3 in imports/importPresets/extractedTransactions),
`categories` (×1 in extractedTransactions), `emailIngestions` from shared.
ingest's imports from modules/ledger: `transactions` (×2 in extractedTransactions.transactionId/matchedTransactionId).
**This is the only surviving ingest→ledger edge.** ledger has no edge into ingest. ✓

#### modules/system/schema.ts (physical pgTable definitions)
- `userProfiles`, `familyMembers`, `notifications`, `alertLedger`,
  `notificationPrefs`

system's imports from shared: `accounts` (notificationPrefs.accountId).
No import from any other module. ✓

#### modules/automation/schema.ts (physical pgTable definitions)
- `aiSettings`, `aiEvents`

automation's imports from shared: `accounts` (aiEvents.accountId),
`emailIngestions` from shared.
No import from ledger, ingest, or any other module. ✓

### 6c. Tables flagged for special attention

**`accounts`** — highest inbound FK degree (16 cross-module columns); already uses
`AnyPgColumn` for its forward reference to `goals` (same file currently).
Moving to shared resolves all cycles. Every module's schema.ts that currently
reaches into `db/schema.ts` for `accounts` would re-point to `db/shared-schema.ts`.

**`transactions`** — 6 inbound FK columns but all are intra-ledger or from `ingest`.
Since only two modules reference it (ledger-internal + ingest), it does NOT need
to go to shared. It stays in modules/ledger. The ledger→investments/credit/protection
edges it creates are one-directional after the hub tables are extracted.

**`goals`** — 3 inbound FK columns from 2 modules (ledger via accounts, investments
via holdings+sips). Must go to shared. Cannot stay in planning while accounts stays
in ledger: accounts.goalId creates a forward reference that in a split world would
force ledger to import planning.

**`emailIngestions`** — 3 inbound FK columns (credit ×2, automation ×1). Key
observation: it also has an inbound FK from `extractedTransactions` (ingest-internal
after the move). Moving it to shared breaks the three-way
credit→ingest→ledger→credit cycle.

**`users`** — stays in `db/core-schema.ts`. Never gains additional tables per
CLAUDE.md ("deliberately narrow").

---

## 7. FLAT-SERVICE TABLE TIES

The following services in `apps/api/src/services/` have no tables of their own.
They are not yet migrated into a module. Their table usage is mapped here to
inform Phase-1 completion (SP3 rehoming).

| Flat service | Tables queried | Table owner(s) | Notes |
|---|---|---|---|
| `anomaly.ts` | `alertLedger`, `categories` (Drizzle imports); raw SQL on `transactions` | system, ledger/shared | Calls `periods.ts` for aggregates |
| `autopilot.ts` | `alertLedger`, `users` (Drizzle imports) | system, core | Orchestration; delegates to planning module services |
| `balances.ts` | `accounts`, `transactions` (raw SQL only, no Drizzle table imports) | shared (accounts), ledger (transactions) | Pure SQL utility |
| `cache.ts` | None (Redis only) | — | No DB tables |
| `ownership.ts` | `accounts`, `categories`, `goals`, `holdings` (Drizzle imports) | shared (accounts, categories, goals), investments (holdings) | Ownership-guard helpers used across many routes |
| `periods.ts` | Raw SQL on `transactions`, `transaction_splits`, `categories` (no Drizzle imports) | ledger (transactions/splits), shared (categories) | Date/period math + spend aggregates |

`cache.ts` and `periods.ts` are pure utilities (Redis and date arithmetic respectively)
with no table ownership. `balances.ts` and `ownership.ts` are cross-cutting helpers
used by many domains; they are natural candidates for a `modules/core/` or
`modules/shared/` service layer (SP3 scope, not designed here).

---

## Summary of Surprising Findings

1. **No table-level FK cycles exist.** The graph is a DAG at the table level. All
   complexity is at the module level.

2. **A three-way module cycle exists** (credit → ingest → ledger → credit) that is
   not visible from looking at any single pair of modules. The `emailIngestions`
   table is the key pivot: credit holds FKs into it, and ingest holds FKs into
   ledger (via `extractedTransactions`), which holds a FK into credit's
   `statementReconciliations`. Moving `emailIngestions` to shared breaks all
   three legs simultaneously.

3. **`accounts` has 16 inbound cross-module FK columns** — substantially more than
   any other table. It is the dominant hub and MUST leave ledger for shared-schema.

4. **All 50 tables in `db/schema.ts` are already module-owned.** There are zero
   orphaned/flat tables. The flat *services* (anomaly, autopilot, balances,
   cache, ownership, periods) use tables owned by modules but own none themselves.

5. **The module-level SCC has 6 members** (ledger + planning + credit + investments
   + protection + ingest), not 5 as implied by the existing module schema.ts
   comments which only mention 4 bidirectional pairs. The ingest module is
   structurally in the SCC via the three-way cycle.

6. **`recurringTemplates`** must go to shared because `emiDetails` (credit) has a
   cascading FK into it. This is easy to miss since `emiDetails` is the only
   cross-module reference, but it is enough to maintain the ledger↔credit cycle
   if recurringTemplates stays in ledger.

7. **`goals`** must go to shared even though it is planning-owned, because
   `accounts.goalId` (ledger) references it AND `holdings/sips` (investments)
   reference it. Keeping goals in planning would force both ledger and investments
   to import planning, while planning already imports ledger (for categories).

8. **`categories`** must go to shared (not stay in ledger) because planning's
   `budgetLines`/`budgetAlerts` reference it. Without this move, planning → ledger
   persists as a back-edge.
