# Implementation: Batch 1 — R1, R2, R3

## Files Changed

### R1 — Remove `opening_balance_paise` addends

**`apps/api/src/modules/ledger/services/balances.ts`**
- Removed `a.opening_balance_paise as opening` from the SQL SELECT
- Removed `opening: string` from the raw-result type cast
- Replaced `Number(r.opening) + postingTotal` with a single `Number(r.posting_total)` assignment
- Collapsed the two consecutive safe-integer checks into one (on `balancePaise`)
- Updated JSDoc comment to reflect that column is always 0

**`apps/api/src/modules/ledger/services/average-balance.ts`**
- Removed `opening_balance_paise: string` from the `AccountRow` interface
- Removed `a.opening_balance_paise as opening_balance_paise` from the SQL SELECT
- Replaced `openingBalancePaise + carriedInDelta` with `carriedInDelta` directly (renamed to `carriedInPaise`)
- Removed the two `isSafeInteger` checks for `openingBalancePaise` and `carriedInDelta`; kept the single check on `carriedInPaise`
- Updated `AmbInputs.carriedInPaise` JSDoc comment

**`apps/api/src/modules/credit/services/cards.ts`**
- `listCardHolders` ~line 242: `acc.openingBalancePaise + Number(row.total)` → `Number(row.total)`
- `listCardHolders` ~line 249: `-(acc.openingBalancePaise + Number(row.at_close))` → `-Number(row.at_close)`
- `getCardActivity` ~line 338: `acc.openingBalancePaise + Number(agg.total)` → `Number(agg.total)`
- `getCardActivity` ~line 339: `-(acc.openingBalancePaise + Number(agg.at_close))` → `-Number(agg.at_close)`

### R2 — Primary-real-posting lateral ordering

**`apps/api/src/modules/ledger/services/user-tasks.ts`**
- Changed `order by p.id` to `order by (p.amount_paise < 0) desc, p.id` in `TASK_LATERAL_QUERY`

**`apps/api/src/modules/system/services/backup.ts`**
- Changed `order by p.id` to `order by (p.amount_paise < 0) desc, p.id` in `transactionsCsv`

**`apps/api/src/modules/investments/services/sip-installments.ts`**
- Added `targetAccountId: string` as 4th parameter to `linkedInstallmentRows`
- Added `and p.account_id = ${targetAccountId}` to the lateral's WHERE clause
- Removed `order by p.id` from the lateral (account filter makes it at most 1 row)
- Updated call site in `listSipInstallmentCandidates`: `linkedInstallmentRows(db, userId, sipId, sip.targetAccountId!)`

### R3 — Legacy-category readers

**`apps/api/src/modules/ingest/services/review-queue.ts`**
- Added `isNotNull` to drizzle-orm imports
- Added `accounts, postings` to db/schema imports
- Rewrote `applyHistoryCategory` query: replaced `innerJoin(categories, eq(categories.id, transactions.categoryId))` with three joins — `postings` (on transactionId), `accounts` (on accountId + systemKind IS NOT NULL + userId), `categories` (on categoryId + userId)
- SELECT now uses `categories.id` instead of `transactions.categoryId`
- Removed the `!` non-null assertion from `r.categoryId` (now always non-null via categories.id)

**`apps/api/src/modules/planning/services/bills.ts`**
- Added `left join lateral` for `cat` (counter-posting category) before the WHERE clause
- Changed `t.category_id` in SELECT to `cat.category_id`

**`apps/api/src/modules/automation/services/categorize.ts`**
- Replaced `t.category_id is null` with a `not exists (select 1 from postings cp join accounts ca ... where cp.category_id is not null)` subquery

---

## Complete git diff

### balances.ts

```diff
diff --git a/apps/api/src/modules/ledger/services/balances.ts b/apps/api/src/modules/ledger/services/balances.ts
index f0308ca..e3fcb1d 100644
--- a/apps/api/src/modules/ledger/services/balances.ts
+++ b/apps/api/src/modules/ledger/services/balances.ts
@@ -22,10 +22,8 @@ export interface AccountBalance {
  * The per-account activity total is summed from `postings` (dual-write mirror
  * of `transactions.amount_paise`), joined to the non-deleted parent transaction
  * for the date cut — see postings-balance-parity.test.ts for the parity proof.
- * `opening_balance_paise` remains an explicit addend: bank/cash accounts carry
- * their opening balance as a real `is_opening` transaction (already inside the
- * postings sum, column pinned at 0); other real-account types keep it on the
- * column with no posting.
+ * `opening_balance_paise` is always 0 (boot-time check enforces this), so
+ * the balance is the posting total only.
  */
 export async function bankCashBalances(
   db: Db,
@@ -32,7 +30,6 @@ export async function bankCashBalances(
 ): Promise<AccountBalance[]> {
   const res = await db.execute(sql`
     select a.id, a.name,
-           a.opening_balance_paise as opening,
            coalesce(p.total, 0) as posting_total
     from accounts a
     left join (
@@ -44,13 +41,9 @@ export async function bankCashBalances(
     where a.user_id = ${userId} and a.archived_at is null and a.type in ('bank', 'cash')
   `);
   return (
-    res.rows as Array<{ id: string; name: string; opening: string; posting_total: string }>
+    res.rows as Array<{ id: string; name: string; posting_total: string }>
   ).map((r) => {
-    const postingTotal = Number(r.posting_total);
-    if (!Number.isSafeInteger(postingTotal)) {
-      throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
-    }
-    const balancePaise = Number(r.opening) + postingTotal;
+    const balancePaise = Number(r.posting_total);
     if (!Number.isSafeInteger(balancePaise)) {
       throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
     }
```

### average-balance.ts

```diff
diff --git a/apps/api/src/modules/ledger/services/average-balance.ts b/apps/api/src/modules/ledger/services/average-balance.ts
index 0bd45fe..8a28701 100644
--- a/apps/api/src/modules/ledger/services/average-balance.ts
+++ b/apps/api/src/modules/ledger/services/average-balance.ts
@@ -131,7 +131,6 @@ export function ambShortfallPaise(...) {
 interface AccountRow {
   account_id: string;
-  opening_balance_paise: string;
   required_paise: string;
   first_activity: string | null;
   carried_in_delta: string;
 }
@@ -144,7 +143,7 @@ export interface AmbInputs {
   accountId: string;
-  /** balance carried into the month: opening-balance column + all txns before the 1st */
+  /** balance carried into the month: sum of all postings before the 1st */
   carriedInPaise: number;
@@ -211,7 +210,6 @@ export async function accountAverageBalances(...) {
   const accountRes = await db.execute(sql`
     select
       a.id as account_id,
-      a.opening_balance_paise as opening_balance_paise,
       coalesce(bd.required_amb_paise, 0) as required_paise,
@@ -258,15 +257,7 @@ export async function accountAverageBalances(...) {
   for (const row of accountRows) {
-    const openingBalancePaise = Number(row.opening_balance_paise);
-    if (!Number.isSafeInteger(openingBalancePaise)) {
-      throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
-    }
-    const carriedInDelta = Number(row.carried_in_delta);
-    if (!Number.isSafeInteger(carriedInDelta)) {
-      throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
-    }
-    const carriedInPaise = openingBalancePaise + carriedInDelta;
+    const carriedInPaise = Number(row.carried_in_delta);
     if (!Number.isSafeInteger(carriedInPaise)) {
```

### cards.ts

```diff
-    const balance = acc.openingBalancePaise + Number(row.total);
+    const balance = Number(row.total);
-    const owedAtClose = -(acc.openingBalancePaise + Number(row.at_close));
+    const owedAtClose = -Number(row.at_close);
-  const balancePaise = acc.openingBalancePaise + Number(agg.total);
-  const owedAtClose = -(acc.openingBalancePaise + Number(agg.at_close));
+  const balancePaise = Number(agg.total);
+  const owedAtClose = -Number(agg.at_close);
```

### user-tasks.ts

```diff
-    order by p.id
+    order by (p.amount_paise < 0) desc, p.id
```

### backup.ts

```diff
-      order by p.id
+      order by (p.amount_paise < 0) desc, p.id
```

### sip-installments.ts

```diff
 async function linkedInstallmentRows(
   db: Db,
   userId: string,
   sipId: string,
+  targetAccountId: string,
 ): Promise<...> {
-      where p.transaction_id = t.id and a.system_kind is null
-      order by p.id
+      where p.transaction_id = t.id and a.system_kind is null and p.account_id = ${targetAccountId}
-    linkedInstallmentRows(db, userId, sipId),
+    linkedInstallmentRows(db, userId, sipId, sip.targetAccountId!),
```

### review-queue.ts

```diff
-import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
+import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
-import { categories, transactions } from "../../../db/schema.ts";
+import { accounts, categories, postings, transactions } from "../../../db/schema.ts";
-      categoryId: transactions.categoryId,
+      categoryId: categories.id,
     .from(transactions)
-    .innerJoin(categories, eq(categories.id, transactions.categoryId))
+    .innerJoin(postings, eq(postings.transactionId, transactions.id))
+    .innerJoin(accounts, and(eq(accounts.id, postings.accountId), isNotNull(accounts.systemKind), eq(accounts.userId, transactions.userId)))
+    .innerJoin(categories, and(eq(categories.id, postings.categoryId), eq(categories.userId, transactions.userId)))
-    rows.map((r) => ({ ..., categoryId: r.categoryId!, ... })),
+    rows.map((r) => ({ ..., categoryId: r.categoryId, ... })),
```

### bills.ts

```diff
-    select t.merchant, t.date, p.amount_paise, a.id as account_id, t.category_id
+    select t.merchant, t.date, p.amount_paise, a.id as account_id, cat.category_id
     from postings p
     join accounts a on a.id = p.account_id
     join transactions t on t.id = p.transaction_id
+    left join lateral (
+      select c.id as category_id, c.name as category_name
+      from postings cp
+      join accounts ca on ca.id = cp.account_id and ca.system_kind is not null and ca.user_id = t.user_id
+      join categories c on c.id = cp.category_id and c.user_id = t.user_id
+      where cp.transaction_id = t.id
+      limit 1
+    ) cat on true
```

### categorize.ts

```diff
-      where t.user_id = ${userId} and t.deleted_at is null and t.category_id is null
+      where t.user_id = ${userId} and t.deleted_at is null
+        and not exists (
+          select 1 from postings cp
+          join accounts ca on ca.id = cp.account_id and ca.system_kind is not null
+          where cp.transaction_id = t.id and cp.category_id is not null
+        )
```

---

## Typecheck output + exit code

```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit

src/lib/postings-periods-parity.test.ts(16,3): error TS2305: Module '"../modules/ledger/services/transactions.ts"' has no exported member 'rebuildPostingsForTransaction'.
src/lib/postings-periods-parity.test.ts(489,45): error TS2339: Property 'transferLinkId' does not exist on type '{ transactionId: string; }'.
src/lib/postings-periods-parity.test.ts(507,59): error TS2551: Property 'outTransactionId' does not exist on type '{ transactionId: string; }'. Did you mean 'transactionId'?
src/lib/postings-periods-parity.test.ts(507,86): error TS2551: Property 'inTransactionId' does not exist on type '{ transactionId: string; }'. Did you mean 'transactionId'?
src/lib/postings-periods-parity.test.ts(507,103): error TS2554: Expected 4 arguments, but got 5.
src/lib/postings-periods-parity.test.ts(519,68): error TS2551: Property 'inTransactionId' does not exist on type '{ transactionId: string; }'. Did you mean 'transactionId'?
src/lib/postings-periods-parity.test.ts(520,60): error TS2551: Property 'outTransactionId' does not exist on type '{ transactionId: string; }'. Did you mean 'transactionId'?
src/modules/ingest/services/inbox.test.ts(1254,69): error TS2554: Expected 4 arguments, but got 5.
src/modules/ingest/services/inbox.test.ts(1667,68): error TS2554: Expected 4 arguments, but got 5.
src/modules/ledger/services/epf-contributions.test.ts(150,25): error TS2339: Property 'transferLinkId' does not exist on type '{ ... }'.
src/modules/ledger/services/postings-pr-e-parity.test.ts(522,76): error TS2551: Property 'outTransactionId' does not exist on type '{ transactionId: string; }'. Did you mean 'transactionId'?
src/modules/ledger/services/reconcile-postings.test.ts(8,10): error TS2305: Module '"./reconcile-postings.ts"' has no exported member 'reconcileUserPostings'.
src/modules/ledger/services/reconcile-postings.test.ts(296,27): error TS7006: Parameter 'f' implicitly has an 'any' type.
src/modules/system/services/backup.test.ts(34,36): error TS2305: Module '"../../ledger/services/reconcile-postings.ts"' has no exported member 'reconcileUserPostings'.
EXIT_CODE: 2
```

**Note:** All 14 errors are PRE-EXISTING — identical set before and after this batch's changes (verified by `git stash` + rerun). Every error is in a `*.test.ts` file or references `reconcile-postings.ts`, none in any production file touched here. No new errors were introduced.

## Lint output + exit code

```
> compass@0.1.0 lint
> eslint .

EXIT_CODE: 0
```

## Assumptions

- `opening_balance_paise` is verified always-0 via the boot check described in the delegation brief; removing the addend is semantically safe.
- The `accounts.systemKind` Drizzle field name was confirmed from `apps/api/src/db/shared/hubs.ts:117`.
- The lateral in `bills.ts` uses `limit 1` without ORDER BY since any counter posting's category is acceptable for subscription-suggestion purposes (consistent with the brief's design).
- `sip.targetAccountId!` at the call site is safe because `accountInstallmentSipIssue` (called just above) already rejects non-account-target SIPs.

## Unresolved risks

- The 14 pre-existing typecheck errors in test files remain; they are from prior PR-G1 work and are not in scope for this batch.
- `hasCategoryDimension()` in `bills.ts` (unchanged) acts as a pre-filter guaranteeing the `cat` lateral is non-null for subscription candidates; if that helper were removed the lateral could return null `category_id`.
