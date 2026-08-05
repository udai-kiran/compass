# Investigation-2: Cross-Module Port Map (SP1 raw-material)

Date: 2026-08-05  
Brief: read-only; no files changed.

---

## 1. NET WORTH AGGREGATOR

### Current call path

`modules/investments/services/networth.ts`

**`computeNetWorth(db, userId, asOf)` — lines 52–96**

The function does two cross-module reads:

1. **lines 57–67** — raw `sql` template (no Drizzle ORM table reference, just string table names) that
   joins `accounts` and `transactions` directly to compute each account's balance-at-date:
   ```sql
   select a.type, coalesce(a.opening_balance_paise + coalesce(t.total, 0), 0)::bigint as balance
   from accounts a
   left join (
     select account_id, sum(amount_paise) as total
     from transactions
     where user_id = $userId and deleted_at is null and date <= $asOf
     group by account_id
   ) t on t.account_id = a.id
   where a.user_id = $userId and a.archived_at is null
   ```
   Table names `accounts` and `transactions` are bare string literals — no TypeScript import from
   `modules/ledger` at all. The classification of those balances into buckets (`ACCOUNT_BUCKET`,
   lines 29–49) is inline in the same file.

2. **line 90** — `portfolioValue(db, userId, asOf)` imported from `./holdings.ts` (same module, fine).

`snapshotAllUsers` (line 196) additionally touches `users` from `../../../db/schema.ts` (core schema,
not a module boundary).

**Who else calls networth from a different module:**  
`modules/credit/services/reconciliation-writes.ts:9` imports `repairSnapshots` from
`../../investments/services/networth.ts` — used at line 332 in `absorbCarryover` to trigger a
fire-and-forget net-worth repair after an opening-balance mutation.

### Data ownership vs. reader

| Data | Owned by | Read by |
|------|----------|---------|
| `accounts` (type, opening_balance, user_id, archived_at) | ledger | investments/networth (raw SQL) |
| `transactions` (amount_paise, account_id, date, deleted_at) | ledger | investments/networth (raw SQL) |
| `net_worth_snapshots` | investments | investments/networth ✓ |
| `holdings` / portfolio value | investments | investments/networth ✓ |

**No import from `modules/ledger`** anywhere in `networth.ts` — the raw-SQL access entirely bypasses
Drizzle's module-scoped table objects.

### Proposed port (NetWorthContributor)

Each module that contributes balances to the net-worth sheet implements this interface:

```typescript
// modules/ledger/ports/networth-contributor.ts  (ledger owns the implementation)
export interface AccountBalanceEntry {
  type: AccountType;
  balancePaise: number;          // signed: loans/cards negative
}

export interface LedgerBalanceAtDate {
  accountBalancesAtDate(
    db: Db,
    userId: string,
    asOf: string,
  ): Promise<AccountBalanceEntry[]>;
}
```

The ledger module exposes one function that replicates the current raw-SQL balance-at-date logic. The
investments/networth module calls this port function rather than inlining the SQL. The `ACCOUNT_BUCKET`
classification map stays in investments/networth (it is the consumer's concern, not the producer's).

For the protection/insurance bucket: `ACCOUNT_BUCKET` already maps `insurance: null` — insurance
policies are NOT balance-contributing assets and already pass through `computeNetWorth` as a no-op
(line 84: `if (bucket === null) continue`). The protection module has no NetWorthContributor role
today; the port design does not need to add one.

**The credit→investments coupling** (`reconciliation-writes.ts:332 → repairSnapshots`) is a separate
issue: credit should not need to know the investments module exists. Proposed fix: expose a
`NetWorthRepairer` port that investments provides, so credit depends on the abstraction:

```typescript
export interface NetWorthRepairer {
  repairSnapshots(
    db: Db,
    redis: Pick<Redis, "set" | "eval">,
    userId: string,
    from: string,
  ): Promise<SnapshotRepair>;
}
```

---

## 2. REWARD EARN-RATE LOOKUP

### Where it lives

`modules/credit/services/rewards.ts`

- `getCardEarnRate(db, userId, accountId)` — **lines 58–65**: reads
  `card_details.earn_rate_per_100` for the given account after ownership check via `ownedCardAccount`.
- `earnedRewardPoints(spendPaise, earnRatePer100)` — **lines 89–103**: pure calculator, no DB.

### Current consumers (cross-module)

**None.** The grep produces zero cross-module imports of `rewards.ts`. Both functions are defined,
exported, and documented but currently consumed only within the credit module boundary. No other module
currently calls `getCardEarnRate` or `earnedRewardPoints`.

The roadmap reference "task 1.2" refers to this as a *planned* port surface, not an existing raw
cross-domain read. The earn-rate data (stored per card in `card_details.earn_rate_per_100`) belongs to
the credit module; the moment automation/autopilot needs to advise "use card X to earn rewards", it will
need this data cross-module.

### Proposed port shape (for when consumed)

```typescript
// modules/credit/ports/earn-rate-port.ts
export interface CardEarnRate {
  accountId: string;
  earnRatePer100: number | null;   // null = "not configured"
}

export interface EarnRateProvider {
  getEarnRate(
    db: Db,
    userId: string,
    accountId: string,
  ): Promise<number | null>;

  // pure math, no DB; can be re-exported as a standalone utility
  earnedPoints(spendPaise: number, earnRatePer100: number): number;
}
```

The credit module implements this. Any future consumer (automation, planning insights) depends on the
port, not on `modules/credit/services/rewards.ts` directly.

---

## 3. GOAL PROJECTIONS

### Current call path

The projection math itself (`modules/planning/services/goal-projection.ts`) is **pure** — no imports
beyond its own types. The cross-module dependencies are all in the coordinator:

**`modules/planning/services/goals.ts:getGoalProgress` (lines 269–384):**

| Line | What it calls | Cross-module target | Data owned by |
|------|---------------|--------------------|-|
| 38 | `listAccounts(db, userId)` | `modules/ledger/services/accounts.ts` | ledger |
| 39 | `getPortfolio(db, userId)` | `modules/investments/services/holdings.ts` | investments |
| 47 | `committedForGoal(db, userId, g.id)` | `modules/investments/services/sip-commitments.ts` | investments |
| 43 | `createNotification(...)` | `modules/system/services/notifications.ts` | system |
| 45 | `prefEnabled(...)` | `modules/system/services/prefs.ts` | system |

**`modules/investments/services/sip-commitments.ts:committedForGoal` (line 6):**

```
modules/investments/services/sip-commitments.ts:6
  import { accountAllocationClass, holdingAllocationClass } from "../../planning/services/goal-allocation.ts"
```

This creates a **cycle**: planning → investments → planning.

**`modules/investments/services/goal-networth.ts` (line 6):**

```
modules/investments/services/goal-networth.ts:6
  import { listAccounts } from "../../ledger/services/accounts.ts"
```

`netWorthByGoal` calls `listAccounts` (ledger) and `getPortfolio` (same module). It also reads the
`goals` table directly via `../../../db/schema.ts` (line 5), which is an investments-module function
reading the planning-module's table.

### The planning ↔ investments cycle

```
planning/services/goals.ts
  → investments/services/holdings.ts (getPortfolio)
  → investments/services/sip-commitments.ts (committedForGoal)
      → planning/services/goal-allocation.ts (accountAllocationClass, holdingAllocationClass)
```

`goal-allocation.ts` contains only **pure functions** (no DB, no I/O) that map `AccountType` /
`AssetClass`+`GainsTaxClass` to `"equity" | "debt" | "other"`. These are domain classification
primitives that belong to neither module exclusively — the cycle exists because they happen to live in
`modules/planning`.

### Proposed ports

**Port A — GoalAssetReader (planning consumes, ledger+investments implement):**

```typescript
// In modules/ledger/ports/goal-reader-port.ts
export interface AccountForGoal {
  id: string; name: string; type: AccountType; balancePaise: number;
  goalId: string | null; archivedAt: string | null; accountLast4: string | null;
}
export interface GoalAccountReader {
  listAccountsWithGoals(db: Db, userId: string): Promise<AccountForGoal[]>;
}

// In modules/investments/ports/goal-reader-port.ts
export interface PositionForGoal {
  id: string; name: string; assetClass: AssetClass; gainsTaxClass: GainsTaxClass;
  currentValuePaise: number; goalId: string | null; archived: boolean; folioNumber: string | null;
}
export interface GoalPortfolioReader {
  getPortfolioPositionsForGoal(db: Db, userId: string): Promise<PositionForGoal[]>;
}
export interface SipCommitmentReader {
  committedForGoal(db: Db, userId: string, goalId: string): Promise<{
    committedEquityPaise: number; committedDebtPaise: number;
  }>;
}
```

**Port B — Break the allocation-classification cycle:**

Move `accountAllocationClass`, `holdingAllocationClass`, `allocationPercentages`, and
`GoalAllocationClass` to `packages/shared/src/goal-allocation.ts`. These are pure domain enumerations
with no side effects; `@compass/shared` already holds similar pure classifiers (`accountCanHaveGoal`,
`isLiabilityAccount`, `isRetirementAccount`). Once moved, the import in
`investments/sip-commitments.ts:6` targets `@compass/shared` rather than a peer module — the cycle
disappears.

**Port C — NotificationWriter (planning + other modules → system):**

Multiple modules call `createNotification` and `prefEnabled` from `modules/system`. Rather than each
module importing `system` directly, system exposes a thin port that other modules receive via injection:

```typescript
export interface NotificationWriter {
  createNotification(db: DbOrTx, userId: string,
    input: { type: string; title: string; body?: string; data?: unknown }): Promise<void>;
  prefEnabled(db: Db, userId: string, pref: string): Promise<boolean>;
}
```

---

## 4. FULL CROSS-MODULE IMPORT MAP (all files:lines)

Every service/route in `modules/<D>` that imports from a different `modules/<E>`:

### automation → ingest
- `modules/automation/routes/ai.ts:20` → `../../ingest/services/mailboxes.ts` (`mailboxSecret`)

### automation → planning
- `modules/automation/services/summary.ts:5` → `../../planning/services/reports.ts` (`buildReport`)
- `modules/automation/services/summary.ts:6` → `../../planning/services/insights.ts` (`getInsights`)
- `modules/automation/services/tools.ts:6` → `../../planning/services/reports.ts` (`buildReport`)
- `modules/automation/services/tools.ts:7` → `../../planning/services/budgets.ts` (`getUtilization`)
- `modules/automation/services/tools.ts:8` → `../../planning/services/insights.ts` (`getInsights`)
- `modules/automation/services/tools.ts:10` → `../../planning/services/goals.ts` (`listGoals`)

### automation → ledger
- `modules/automation/services/tools.ts:9` → `../../ledger/services/search.ts` (`search`)

### credit → investments
- `modules/credit/services/reconciliation-writes.ts:9` → `../../investments/services/networth.ts` (`repairSnapshots`)

### credit → ledger
- `modules/credit/routes/cards.ts:33` → `../../ledger/services/attachments.ts` (`MAX_ATTACHMENT_BYTES`)
- `modules/credit/services/bank-details.ts:8` → `../../ledger/services/accounts.ts` (`syncAccountLast4`)
- `modules/credit/services/card-statements.ts:8` → `../../ledger/services/attachments.ts` (`assertUploadable`)

### credit → system
- `modules/credit/services/alerts.ts:5` → `../../system/services/notifications.ts` (`createNotification`)

### credit → ingest (route level, not service)
- `modules/credit/routes/cards.ts:34` → `../../ingest/services/mailboxes.ts` (`mailboxSecret`)

### ingest → ledger
- `modules/ingest/services/imports.ts:18` → `../../ledger/services/merchants.ts` (`getMerchantRules`, `normalizeMerchant`)
- `modules/ingest/services/imports.ts:20` → `../../ledger/services/transfers.ts` (`autoLinkTransfers`)
- `modules/ingest/services/review-actions.ts:6` → `../../ledger/services/transactions.ts` (`createTransaction`)
- `modules/ingest/services/review-actions.ts:7` → `../../ledger/services/transfers.ts` (`autoLinkTransfers`)
- `modules/ingest/services/review-queue.ts:6` → `../../ledger/services/merchants.ts` (`getMerchantRules`, `normalizeMerchant`)
- `modules/ingest/services/review-queue.ts:7` → `../../ledger/services/transfers.ts` (`TRANSFER_WINDOW_DAYS`)
- `modules/ingest/services/transfer-classification.ts:8` → `../../ledger/services/transactions.ts` (`createTransaction`)
- `modules/ingest/services/transfer-classification.ts:9` → `../../ledger/services/transfers.ts` (`linkTransfer`, `TRANSFER_WINDOW_DAYS`)

### ingest → investments (utility borrowing)
- `modules/ingest/services/transfer-classification.ts:7` → `../../investments/services/sip-lifecycle.ts` (`isUniqueViolation`)

  Note: `isUniqueViolation` is a pure Postgres error inspector utility that has nothing to do with
  investments domain. It should be moved to `lib/errors.ts` (or similar) to stop this false dependency.

### investments → ledger
- `modules/investments/services/goal-networth.ts:6` → `../../ledger/services/accounts.ts` (`listAccounts`)

### investments → planning (creates the cycle)
- `modules/investments/services/sip-commitments.ts:6` → `../../planning/services/goal-allocation.ts`
  (`accountAllocationClass`, `holdingAllocationClass`, `GoalAllocationClass`)

### ledger → credit
- `modules/ledger/services/recurring.ts:12` → `../../credit/services/emis.ts` (`lockAccountPair`, `stepAmortization`)

  The recurring template's EMI branch (lines 256, 276) calls credit's amortization logic and account
  lock. These are domain-specific helpers that belong to credit; ledger should not import them.
  Proposed port:
  ```typescript
  export interface EmiAmortizationStepper {
    lockAccountPair(trx, userId, idA, idB): Promise<Map<string, {type, archivedAt}>>;
    stepAmortization(balance, rateBps, amount): {principal, interest, balance};
  }
  ```

### ledger → investments (utility borrowing)
- `modules/ledger/services/transactions.ts:18` → `../../investments/services/sip-lifecycle.ts` (`isUniqueViolation`)

  Same note as above — `isUniqueViolation` is a DB-error utility. Move to `lib/errors.ts`.

### planning → investments
- `modules/planning/services/cashflow.ts:12` → `../../investments/services/sip-schedule.ts` (`sipOccurrencesInWindow`)
- `modules/planning/services/goals.ts:39` → `../../investments/services/holdings.ts` (`getPortfolio`)
- `modules/planning/services/goals.ts:47` → `../../investments/services/sip-commitments.ts` (`committedForGoal`)

### planning → ledger
- `modules/planning/services/bills.ts:9` → `../../ledger/services/recurring.ts` (`advanceDate`)
- `modules/planning/services/cashflow.ts:11` → `../../ledger/services/recurring.ts` (`advanceDate`)
- `modules/planning/services/dashboard.ts:15` → `../../ledger/services/transactions.ts` (`listTransactions`)
- `modules/planning/services/goals.ts:38` → `../../ledger/services/accounts.ts` (`listAccounts`)

### planning → system
- `modules/planning/services/bills.ts:7` → `../../system/services/notifications.ts` (`createNotification`)
- `modules/planning/services/bills.ts:8` → `../../system/services/prefs.ts` (`prefEnabled`)
- `modules/planning/services/goals.ts:43` → `../../system/services/notifications.ts` (`createNotification`)
- `modules/planning/services/goals.ts:45` → `../../system/services/prefs.ts` (`prefEnabled`)

### protection → ledger
- `modules/protection/services/insurance.ts:20` → `../../ledger/services/attachments.ts` (`assertUploadable`)
- `modules/protection/services/insurance.ts:21` → `../../ledger/services/transactions.ts` (`createTransaction`)
- `modules/protection/services/insurance.ts:22` → `../../ledger/services/resources.ts` (`assertOwnedResource`)
- `modules/protection/routes/insurance.ts:12` → `../../ledger/services/attachments.ts` (`MAX_ATTACHMENT_BYTES`)

### system → automation (route level)
- `modules/system/routes/auth.ts:20` → `../../automation/services/ai-settings.ts` (`getAiSettings`, `getUserAiProvider`)

### system → ingest (route level)
- `modules/system/routes/auth.ts:21` → `../../ingest/services/mailboxes.ts` (`mailboxSecret`)

### system → ledger
- `modules/system/services/auth.ts:8` → `../../ledger/services/categories.ts` (`seedDefaultCategories`)
- `modules/system/services/demo.ts:27` → `../../ledger/services/categories.ts` (`seedDefaultCategories`)

### system → planning (creates a cycle)
- `modules/system/services/notifications.ts:8` → `../../planning/services/budgets.ts` (`getUtilization`)

  The `evaluateBudgetAlerts` function in system/notifications calls planning's `getUtilization` to
  check spend thresholds. This means system → planning while planning → system (goals.ts, bills.ts).
  Proposed resolution: move `evaluateBudgetAlerts` out of system/notifications and into
  planning/budgets (it is a planning concern), leaving `createNotification` as a simple write helper
  that planning calls without importing anything back from system.

---

## 5. CYCLE SUMMARY

| Cycle | Files involved | Resolution approach |
|-------|---------------|---------------------|
| planning ↔ investments | `planning/goals.ts` → `investments/sip-commitments.ts` → `planning/goal-allocation.ts` | Move `goal-allocation.ts` pure functions to `@compass/shared` |
| system ↔ planning | `system/notifications.ts` → `planning/budgets.ts` → (planning calls createNotification back) | Move `evaluateBudgetAlerts` into planning/budgets; system only provides `createNotification` write |

No other strict cycles in the service layer (route-level imports are not cycles since routes are never
imported back).

---

## 6. UTILITY BORROWING (not domain coupling)

Two files import `isUniqueViolation` from `investments/sip-lifecycle.ts` purely for its
Postgres-error parsing logic:

- `modules/ledger/services/transactions.ts:18`
- `modules/ingest/services/transfer-classification.ts:7`

This is not a domain dependency — it should be moved to `apps/api/src/lib/errors.ts` alongside
`pgError` (which it already calls). Once relocated, both false cross-module edges disappear.

---

## 7. ASSUMPTIONS

- Protection's `insurance_policies` table is NOT part of the balance-sheet computation. Confirmed by
  `ACCOUNT_BUCKET[insurance] = null` in networth.ts:48. The protection module has no
  NetWorthContributor role.
- The `goals` table is owned by planning, but `investments/goal-networth.ts:94` reads it via
  `../../../db/schema.ts` (global barrel). This is a separate schema-ownership concern for SP2
  rather than a behavioral port concern for SP1.
- Route-level cross-module imports (e.g. `MAX_ATTACHMENT_BYTES`, `mailboxSecret`) are considered
  infrastructure constants, not domain ports. They are listed above but are lower priority for SP1.

## 8. UNRESOLVED RISKS

- The raw SQL in `computeNetWorth` uses bare table-name strings, not Drizzle table references. Any
  SP2 physical rename of the `accounts`/`transactions` tables would not be caught by TypeScript — the
  LedgerBalanceAtDate port proposed above would make the compile-time safety explicit.
- The bidirectional planning↔investments cycle through `goal-allocation.ts` means SP1 cannot add clean
  ports without first moving the classification functions, or the new port interfaces would still
  carry the cycle in their implementations.
