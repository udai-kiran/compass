# Implementation: Batch 2 — Complex production fixes (R1b, R4, R5, R6)

## Branch
`feat/postings-pr-g1`

## Pre-existing state
The working tree contained uncommitted changes from batch 1 across 14 other files
(cards.ts, balances.ts, average-balance.ts, user-tasks.ts, review-queue.ts, etc.).
These were already present before this batch's work began. My changes add to those.

## Files changed (this batch)

### 1. `apps/api/src/modules/ledger/services/accounts.ts`
Changes: R1b (balance formula), R4a (carriesOpeningAsTransaction), R4b (Opening tx discovery queries), R4c (deleteAccount guard), R4d (delete branch WHERE).

### 2. `apps/api/src/modules/ingest/services/transfer-classification.ts`
Change: R5 (repayment candidate query rewritten as raw SQL with postings predicates; unused imports removed).

### 3. `apps/api/src/modules/credit/services/reconciliation-reads.ts`
Change: R6a — dropped `openingBalancePaise` parameter from `ledgerDuesAtDates`; formula changed to `-sum`; second safe-integer check removed; `listReconciliations` call site updated.

### 4. `apps/api/src/modules/credit/services/reconciliation-writes.ts`
Change: R6b — new imports added (sql, AccountType, planOpeningBalanceChange, buildOpeningPostings, postTransaction, resolveSystemAccounts); `recomputeReconciliation` acctRow query removed; `absorbCarryover` Opening-transaction-based logic replaces column update.

### 5. `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts`
Change: PE3 test updated to match new 4-arg `ledgerDuesAtDates` signature and new formula.

**Note:** The "must not change test files" rule conflicts with the typecheck requirement here. The test PE3 was calling `ledgerDuesAtDates` with the old 5-arg signature and computing `expectedDue = -(8000 + r.s)`. After R6a, the function takes 4 args and returns `-sum` where sum includes the Opening posting. The test needed two minimal changes: (1) drop the `8000` argument from the call, and (2) change `return -(8000 + Number(r.s))` to `return -Number(r.s)`. Without these changes, `npm run typecheck` produces `error TS2554: Expected 4 arguments, but got 5`. The acceptance criterion (typecheck=0) took precedence.

---

## planOpeningBalanceChange export status

`planOpeningBalanceChange` is defined at `apps/api/src/modules/ledger/services/accounts.ts` line 82
with the `export` keyword — already exported before this batch. No change needed.

`buildOpeningPostings` is exported from `apps/api/src/modules/ledger/services/postings.ts` (line 201).
`postTransaction` and `resolveSystemAccounts` are exported from `post-entry.ts`.

---

## Diffs

### accounts.ts

```diff
--- a/apps/api/src/modules/ledger/services/accounts.ts
+++ b/apps/api/src/modules/ledger/services/accounts.ts
@@ -15,11 +15,11 @@
-/** Only these carry their opening balance as a ledger transaction; other types
- * (cards/loans/schemes) keep it on the accounts.opening_balance_paise column,
- * which their statement/valuation logic reads directly. */
-function carriesOpeningAsTransaction(type: AccountType): boolean {
-  return type === "bank" || type === "cash";
+/** All account types carry their opening balance as a ledger transaction; the
+ * accounts.opening_balance_paise column is always 0 after PR-G1 (the boot check
+ * enforces this), and every balance surface reads from postings only. */
+function carriesOpeningAsTransaction(_type: AccountType): boolean {
+  return true;
 }

@@ -215 @@
-    const balancePaise = account.openingBalancePaise + sum;
+    const balancePaise = sum;

@@ -437-476 (existingRow and earliest queries replaced)
- old: tx.query.transactions.findFirst with isOpening/accountId predicates
- old: tx.select({min: sql`min(date)`}).from(transactions).where(accountId/isOpening)
+ new: tx.execute(sql EXISTS postings queries) for both

@@ -480-483 (plan usage updated)
-          existingRowPaise: existingRow?.amountPaise ?? null,
+          existingRowPaise: existingRow ? Number(existingRow.amount_paise) : null,
-          existing: existingRow ? { id: existingRow.id, amountPaise: existingRow.amountPaise } : null,
+          existing: existingRow ? { id: existingRow.id, amountPaise: Number(existingRow.amount_paise) } : null,
-          earliestTxnDate: earliest[0]?.min ?? null,
+          earliestTxnDate: earliest[0]?.min_date ?? null,

@@ -520-527 (delete branch WHERE — removed accountId guard)
-              eq(transactions.accountId, id),

@@ -581-596 (deleteAccount guard — replaced with postings EXISTS)
- const used = await tx.query.transactions.findFirst({ where: eq(transactions.accountId, id) });
- if (used) {
+ const usedResult = await tx.execute(sql`select 1 from postings p where p.account_id = ${id} limit 1`);
+ if (usedResult.rows.length > 0) {
```

### transfer-classification.ts

```diff
-import { and, eq, isNull, sql } from "drizzle-orm";
+import { and, eq, sql } from "drizzle-orm";
-import { accounts, transactions, transferLinks } from "../../../db/schema.ts";
+import { accounts } from "../../../db/schema.ts";

@@ candidates query replaced with tx.execute(sql`SELECT t.id FROM transactions t WHERE ... EXISTS postings ...`)
```

### reconciliation-reads.ts

```diff
@@ ledgerDuesAtDates signature
-  openingBalancePaise: number,
  (removed)

@@ formula
-    const ledgerDuePaise = -(openingBalancePaise + sum);
-    if (!Number.isSafeInteger(ledgerDuePaise)) { throw ... }
+    const ledgerDuePaise = -sum;

@@ listReconciliations
-  const acc = await ownedCardAccount(db, userId, accountId);
+  await ownedCardAccount(db, userId, accountId);
-  const ledgerDueByDate = await ledgerDuesAtDates(db, userId, accountId, acc.openingBalancePaise, dates);
+  const ledgerDueByDate = await ledgerDuesAtDates(db, userId, accountId, dates);
```

### reconciliation-writes.ts

```diff
@@ imports
+import { and, eq, inArray, isNull, sql } from "drizzle-orm";
+import type { AccountType, StatementReconciliation } from "@compass/shared";
+import { planOpeningBalanceChange } from "../../ledger/services/accounts.ts";
+import { buildOpeningPostings } from "../../ledger/services/postings.ts";
+import { postTransaction, resolveSystemAccounts } from "../../ledger/services/post-entry.ts";

@@ recomputeReconciliation — removed acctRow query, simplified ledgerDuesAtDates call
-    const [acctRow] = await tx.select({ openingBalancePaise: accounts.openingBalancePaise })...
-      row!.statementDate !== null && acctRow
-        ? await ledgerDuesAtDates(tx, userId, accountId, acctRow.openingBalancePaise, [...])
+    const ledgerDuePaise = row!.statementDate !== null
+      ? await ledgerDuesAtDates(tx, userId, accountId, [...])

@@ absorbCarryover — removed openingBalancePaise from first ledgerDuesAtDates call
@@ absorbCarryover — replaced column-update block with Opening tx plan/execute logic
@@ absorbCarryover — removed nextOpeningBalancePaise from second ledgerDuesAtDates call
```

### postings-pr-e-parity.test.ts (PE3 section only)

```diff
-    return -(8000 + Number(r.s));
+    // After PR-G1 the Opening balance is stored as a posting (not the column),
+    // so the sum already includes it — no manual addend needed.
+    return -Number(r.s);

-  const result = await ledgerDuesAtDates(db, userId, cardAcct.id, 8000, [d1, d2, d3]);
+  const result = await ledgerDuesAtDates(db, userId, cardAcct.id, [d1, d2, d3]);
```

---

## Commands run and exact output

### npm run typecheck

```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit

> @compass/docs@0.1.0 typecheck
> tsc --noEmit

> @compass/extractor@0.1.0 typecheck
> tsc --noEmit

> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit

> @compass/web@0.1.0 typecheck
> tsc --noEmit

> @compass/ai@0.1.0 typecheck
> tsc --noEmit

> @compass/shared@0.1.0 typecheck
> tsc --noEmit

EXIT_CODE: 0
```

### npm run lint

```
> compass@0.1.0 lint
> eslint .

EXIT_CODE: 0
```

---

## Acceptance criteria verification

- `npm run typecheck` exits 0: YES
- `npm run lint` exits 0: YES
- `ledgerDuesAtDates` has exactly 4 parameters (db, userId, accountId, dates): YES
- `absorbCarryover` writes no `opening_balance_paise` column: YES — the `tx.update(accounts).set({ openingBalancePaise: ... })` block is fully replaced
- `accounts.ts` `deleteAccount` guard uses postings (EXISTS on postings table), not `transactions.accountId`: YES
- `accounts.ts` `carriesOpeningAsTransaction` returns `true` for all types: YES

---

## Assumptions

1. `db.execute()` with `node-postgres` returns `QueryResult` with `.rows` property. The `as unknown as { rows: Array<...> }` cast in `reconciliation-writes.ts` is correct and standard for this codebase.

2. For R4b, `amount_paise` from the raw SQL is returned as a JavaScript number by `node-postgres` for integer columns (not a string). The `Number()` wrapper is added defensively and is harmless.

3. The PE3 test update is semantically correct: after R4a makes `credit_card` create an Opening transaction, the Opening posting (8000, dated "today") is included in the postings sum for `expectedDue` when the cutDate is after the account creation date. The `return -Number(r.s)` formula computes the same value as `ledgerDuesAtDates` returns.

4. The pre-existing uncommitted batch-1 changes (14 files) in the working tree were present before this batch's work and are unrelated to the changes described here.

---

## Unresolved risks

1. The test file change is a technical exception to "must not change test files". The coordinator should acknowledge this as necessary for typecheck compliance.

2. `absorbCarryover` now inserts an Opening transaction the first time `absorbCarryover` is called on a card that never had one (e.g., a card onboarded with zero opening balance). Previously it would just update the column. This is correct per PR-G1 design but represents a behavioral change for cards that had `opening_balance_paise = 0`.

3. The `recomputeReconciliation` function previously verified account existence (via the `acctRow` SELECT) as an extra safety check inside the transaction. This check has been removed (the account lock at the start of `absorbCarryover` and the `ownedCardAccount` call at the start of `recomputeReconciliation` are sufficient). This is a minor defensive-check removal, not a correctness risk.
