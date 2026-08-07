# Sonnet Worker Delegation — PR-C

## Task
021-postings-model PR-C: `lib/periods.ts` income/expense/spend/necessity → postings

## Approved Plan
- PC1: `spentByCategory` — single query on Expenses postings (`a.system_kind = 'expenses'`,
  `p.amount_paise > 0`) grouped by `p.category_id`. Transfer excluded by NOT EXISTS
  (Clearing posting). Opening excluded naturally (no Expenses posting for opening rows).
  Replaces the two-query nonSplit+splitParts pattern.
- PC2: `spendByNecessity` — same single-query pattern as PC1 on Expenses postings,
  joining `transactions t` for `t.necessity` (tx-level override) and `categories c ON
  c.id = p.category_id AND c.user_id = t.user_id`. Replaces the two-query pattern.
- PC3: `incomeExpense` — real postings (`a.system_kind IS NULL`, one per transaction),
  two CASE branches for income/expense. Transfer + opening excluded by NOT EXISTS
  (a2.system_kind IN ('clearing', 'opening')). D4 liability check: income CASE only
  includes `a.type NOT IN (LIABILITY_TYPES)`.
- PC5: Opening rows excluded naturally for PC1/PC2; explicitly for PC3 via NOT EXISTS.
- PC6: Range-check every derived monetary value before returning; HttpError(500) same
  as PR-B pattern.
- PC8: Existing DB-backed tests in recurring.test.ts and inbox.test.ts remain valid
  (service-layer transactions dual-write to postings; parity holds).
- PC10: Update stale docs in periods.ts (spendByNecessity two-statement comment,
  LIABILITY_TYPES_SQL alias comment).
- New parity test: `postings-periods-parity.test.ts` (DB-backed) proving parity
  across all required cases.

## Files and Symbols

### Primary implementation file
- `apps/api/src/lib/periods.ts`
  - `spentByCategory` — convert to single Expenses-posting query
  - `spendByNecessity` — convert to single Expenses-posting query; update JSDoc
  - `incomeExpense` — convert to real-posting query with D4 liability check
  - `LIABILITY_TYPES_SQL` comment — generalize (remove alias-specific note)

### New test file
- `apps/api/src/lib/postings-periods-parity.test.ts` (NEW)

### Must NOT change
- `periodRange`, `prevPeriodKey`, `currentPeriodKey`, `monthKeyOf` — pure helpers, untouched
- Any writer, schema, migration, shared-contract, or web file
- `apps/api/src/lib/periods.test.ts` — pure helper tests, unchanged
- `apps/api/src/modules/ledger/services/recurring.test.ts`
- `apps/api/src/modules/ingest/services/inbox.test.ts`

## Required Changes

### `spentByCategory` (replace the two db.execute calls)
```sql
SELECT p.category_id as cid, SUM(p.amount_paise)::bigint as spent
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = $userId
  AND t.deleted_at IS NULL
  AND t.date >= $from AND t.date <= $to
  AND a.system_kind = 'expenses'
  AND p.amount_paise > 0
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id AND a2.system_kind = 'clearing'
  )
GROUP BY p.category_id
```
Result: `rows` as `Array<{ cid: string | null; spent: string }>`, same Map output.
Remove the two-query combining loop; single loop over one result set.
Apply PB6 range check: `Number(row.spent)` → check isSafeInteger; check after
accumulation to map too.

### `spendByNecessity` (replace the two db.execute calls)
```sql
SELECT t.necessity as tx_necessity, c.necessity as cat_necessity, c.kind as cat_kind,
       SUM(p.amount_paise)::bigint as spent
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
LEFT JOIN categories c ON c.id = p.category_id AND c.user_id = t.user_id
WHERE t.user_id = $userId
  AND t.deleted_at IS NULL
  AND t.date >= $from AND t.date <= $to
  AND a.system_kind = 'expenses'
  AND p.amount_paise > 0
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id AND a2.system_kind = 'clearing'
  )
GROUP BY t.necessity, c.necessity, c.kind
```
Return type `NecessitySpendRow[]` and `mapRow` function unchanged.
Apply PB6 range check on `Number(row.spent)`.
Update JSDoc: remove the "runs two statements"/"concurrent split-add/remove race"
note. Replace with a brief note that it is now a single-query approach.

### `incomeExpense` (replace the single db.execute call)
```sql
SELECT
  COALESCE(SUM(CASE
    WHEN p.amount_paise > 0
         AND a.type NOT IN (${LIABILITY_TYPES_SQL})
    THEN p.amount_paise
    ELSE 0
  END), 0)::bigint as income,
  COALESCE(SUM(CASE
    WHEN p.amount_paise < 0
    THEN -p.amount_paise
    ELSE 0
  END), 0)::bigint as expense
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = $userId
  AND t.deleted_at IS NULL
  AND t.date >= $from AND t.date <= $to
  AND a.system_kind IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id
      AND a2.system_kind IN ('clearing', 'opening')
  )
```
Apply PB6 range check on `Number(row.income)` and `Number(row.expense)`.
Update JSDoc to remove account-type alias note; explain real-posting grain.

## `postings-periods-parity.test.ts` — required test cases

This is a DB-backed test requiring a live Postgres connection (same pattern as
`postings-balance-parity.test.ts`). Use the existing helpers from that file or
from the test suite: `createUser`, `createAccount`, `createTransaction`,
`setSplits`, etc. from service layer.

For each test case:
- Compute expected values DIRECTLY from legacy tables inside the test (never by
  calling `spentByCategory`/`spendByNecessity`/`incomeExpense` — no tautology)
- Call the converted functions
- Assert equality

Required cases:

1. **Ordinary expense** (bank, negative amount): all three functions.
2. **Ordinary income** (bank, positive amount, non-liability): `incomeExpense` income.
3. **Same-sign split expense** (3 splits, all negative, distinct categories):
   `spentByCategory` maps each category amount; `incomeExpense` expense = parent amount.
4. **Mixed-sign split, negative parent** (parent -70, splits [-100, +30]):
   `incomeExpense` expense=70 income=0; `spentByCategory` expense=100 for the
   negative split's category; `spendByNecessity` mirrors spentByCategory.
5. **Mixed-sign split, positive parent** (parent +70, splits [+100, -30]):
   `incomeExpense` income=70 expense=0; `spentByCategory` expense=30 for the
   negative split's category.
6. **Transfer pair**: both legs excluded from all three functions. Use service-layer
   createTransfer or manual link.
7. **Transfer lifecycle**:
   a. Auto-linked pair: excluded.
   b. Unlink the pair (via service unlinkTransfer or equivalent): both legs appear
      as ordinary spend/income.
   c. Re-link them: both excluded again.
   d. Hard-delete one leg (direct DB delete of a transaction, not soft-delete):
      surviving partner gets rebuilt as ordinary by the writer (or simulate by
      creating the expected posting shape) → surviving leg appears in spend/income.
8. **Opening row** (`is_opening = true`): excluded from all three.
9. **Soft-deleted transaction**: excluded from all three.
10. **Future-dated transaction** (date > today): excluded from all three.
11. **Liability-account inflow** (credit_card, positive amount, non-transfer):
    `incomeExpense` income=0 (D4); `spentByCategory` and `spendByNecessity` show 0
    (no Expenses posting for positive amount).
12. **EMI fixture** (recurring source + destination principal leg, both ordinary,
    no transfer_links, no Clearing postings):
    - Source expense on bank: appears in spentByCategory, spendByNecessity, incomeExpense expense.
    - Destination principal on loan (positive): incomeExpense income=0 (D4 loan=liability);
      spentByCategory and spendByNecessity = 0 for destination.
    NOTE: Rather than creating a real EMI recurring template, you can directly
    create two ordinary transactions (one expense on bank, one income on loan account)
    and verify the expected behavior without the full recurring materialization stack.
13. **Zero-amount transaction**: contributes 0 to all three functions.
14. **Two-user tenant isolation**: create user B with a transaction in the same date
    range; user A's results unaffected.
15. **`findInconsistentPostings(db, userId) == []`** for the fixture user.

For the transfer lifecycle cases (7b, 7c, 7d): use the service-layer functions if
available (unlinkTransactions, hard delete, etc.) so postings are rebuilt correctly.
If hard-delete service path is complex, you can: create a transfer pair, delete
one transaction's postings manually and insert new ordinary postings (simulating
the PR-A reconcile behavior), then verify the surviving leg appears.

## Overflow guard pattern (mirror of PR-B/reconciliation-reads.ts)
```typescript
import { HttpError } from "../../lib/errors.ts"; // or wherever HttpError is imported from

const x = Number(row.spent);
if (!Number.isSafeInteger(x)) {
  throw new HttpError(500, "Spend aggregate exceeded a safe integer — refusing to lose paise");
}
```

Check at every `Number(row....)` call and after any JS accumulation step.

## Acceptance Criteria
- AC1: all three functions query postings (no transaction_splits or transfer_links)
- AC2: Transfer = NOT EXISTS Clearing; Opening excluded naturally (PC1/PC2) or NOT EXISTS Opening (PC3)
- AC3: D4 liability check on the real account's type in incomeExpense
- AC4: incomeExpense gives parent amount for mixed-sign splits
- AC5: DB-backed parity test passes for all listed cases
- AC6: Overflow guarded with HttpError(500)
- AC7: typecheck + lint + apps/api tests all green; recurring.test.ts and inbox.test.ts pass
- AC8: stale JSDoc updated

## Commands
1. `cd /home/udai/PennyPilot && npm run typecheck 2>&1 | tail -30`
2. `cd /home/udai/PennyPilot && npm run lint 2>&1 | tail -20`
3. `cd /home/udai/PennyPilot && npm run test -w apps/api 2>&1 | tail -40`
4. `cd /home/udai/PennyPilot && node --test apps/api/src/lib/postings-periods-parity.test.ts 2>&1`

## Required Evidence
- Git diff of changed files (complete)
- List of modified and new files (must be only periods.ts + postings-periods-parity.test.ts)
- typecheck exit code
- lint exit code
- test output with pass/fail counts and exit code
- parity test output showing all cases pass
- Any deviations from the plan
