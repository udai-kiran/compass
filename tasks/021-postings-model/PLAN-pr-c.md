# PR-C — periods.ts income/expense/spend/necessity → postings

## Status
APPROVED (review-22: 1 BLOCKING resolved, 3 WARNINGs addressed; review-23: BLOCKING confirmed resolved, 2 WARNINGs folded into T4 — both test-coverage only, no design defects)

## Context / lineage
Task 2.1 postings-model, dual-write strategy (`PLAN-dualwrite.md`).
SP0 (v2.1.0), PR-A (v2.2.0), PR-B (v2.3.0) merged. PR-B converted balance
readers; PR-C converts the income/expense/spend/necessity readers in
`lib/periods.ts`. Green + releasable → next version bump (e.g. v2.4.0).

## Objective
`spentByCategory`, `spendByNecessity`, and `incomeExpense` in
`apps/api/src/lib/periods.ts` compute income, expense, and spend from the
`postings` mirror instead of `transactions`/`transaction_splits`, returning
numbers IDENTICAL to the legacy computation on the same data (parity). No
writer, schema, migration, shared-contract, or web change. Legacy columns
remain; dual-write continues; the per-transaction invariant and parity stay
green.

## Root cause / parity proof

**`spentByCategory` and `spendByNecessity` — per-split Expenses postings:**
- Every expense split (amount_paise < 0) produces an `Expenses` posting with
  `amount_paise = -(split.amount_paise) > 0` and the split's `category_id`,
  `necessity`.
- For non-split transactions the single Expenses posting has the parent amount.
- Therefore `SUM(expenses_postings.amount_paise grouped by category)` ≡
  `SUM(-split.amount_paise WHERE split.amount < 0)` ≡ `SUM(-t.amount_paise WHERE
  amount < 0, non-split)` over the same non-deleted, date-cut, non-transfer set.
- The per-split grain is CORRECT for these two functions — it is the same grain
  as the legacy two-query approach.

**`incomeExpense` — real posting (one per transaction):**
- Every transaction has EXACTLY ONE real posting (`a.system_kind IS NULL`) with
  `amount_paise = t.amount_paise` (parity from PR-A per-transaction invariant).
- For split transactions, the real posting carries the PARENT amount, not per-split
  amounts. This is the correct grain for income/expense totalling (matches legacy
  which queries `transactions.amount_paise`, not `transaction_splits.amount_paise`).
- Using Expenses/Income counter-postings for `incomeExpense` is WRONG for
  mixed-sign splits: a parent of -70 with splits [-100, +30] would give
  expense=100/income=30 via counter-postings, vs the correct expense=70/income=0
  via the real posting (= parent amount). The real-posting approach is required.
- Therefore `SUM(real_posting.amount_paise classified by sign and account type)` ≡
  `SUM(t.amount_paise classified by sign and account type)` over the same filter
  set (review-22 BLOCKING fix).

**Transfer detection:**
- PR-A transfers have a `Clearing` posting on each leg. `NOT EXISTS (p2 JOIN a2
  WHERE p2.transaction_id = t.id AND a2.system_kind = 'clearing')` is equivalent to
  the legacy `NOT EXISTS (transfer_links WHERE ...)` for all invariant-compliant
  data. This equivalence relies on the PR-A writer-graph invariant: link/unlink/
  hard-delete/re-link all execute atomically, maintaining Clearing ↔ transfer_links
  parity. (review-22 WARNING: state this dependency explicitly.)

**Opening-row detection:**
- Opening rows produce `[A: amount] + [Opening: -amount]`. For `spentByCategory`
  and `spendByNecessity`, filtering `a.system_kind = 'expenses'` already excludes
  them (buildOpeningPostings never produces Expenses/Income postings — confirmed in
  postings.ts).
- For `incomeExpense`, the real-posting approach requires an explicit exclusion:
  `NOT EXISTS (p2 JOIN a2 WHERE p2.transaction_id = t.id AND a2.system_kind IN
  ('clearing', 'opening'))` — both exclusions in one subquery.

Transfer detection:
- PR-A transfers have a `Clearing` posting on each leg. `NOT EXISTS (SELECT 1
  FROM postings p2 JOIN accounts a2 ON a2.id = p2.account_id WHERE
  p2.transaction_id = t.id AND a2.system_kind = 'clearing')` is equivalent to the
  legacy `NOT EXISTS (transfer_links WHERE ...)`.

Opening-row detection:
- Opening rows produce an `Opening` system-account posting (not `Expenses` or
  `Income`). Filtering on `a.system_kind = 'expenses'` or `'income'` already
  excludes them — no explicit `NOT t.is_opening` filter needed.

## Scope (files)
- `apps/api/src/lib/periods.ts` — `spentByCategory`, `spendByNecessity`,
  `incomeExpense`. NOTHING else in periods.ts (pure helpers `periodRange`,
  `prevPeriodKey`, `currentPeriodKey`, `monthKeyOf`, `LIABILITY_TYPES_SQL`
  unchanged).
- Tests: `periods.test.ts` (pure helpers only — no SQL; no change needed unless
  a pure-helper breaks); NEW `postings-periods-parity.test.ts` (DB-backed parity
  test, see Verification below).

## Design decisions

### PC1 — Single query replaces two-query pattern for `spentByCategory`
Current code runs two queries (nonSplit on `transactions`, splitParts on
`transaction_splits`). Via postings: one query on `Expenses` postings, grouped by
`p.category_id`. The Expenses posting already carries the per-split `category_id`
(from `buildSplitPostings`), so split and non-split cases are handled uniformly.
No `transaction_splits` join needed.

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

The result type (`Map<string | null, number>`) and combining logic are unchanged.
The `spentPaise` value now comes directly from the Expenses posting's positive
amount (no `-` flip needed).

### PC2 — Single query for `spendByNecessity`
Same two-query → one-query collapse as PC1. The Expenses posting carries
`p.category_id` (per-split when split). Categories join on `p.category_id`. The
`t.necessity` transaction-level override is still accessed by joining `transactions
t` — postings carry the per-split necessity but `effectiveNecessity` uses the
transaction-level override first, so `t.necessity as tx_necessity` must still be
provided.

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

Return type (`NecessitySpendRow[]`) and `mapRow` function unchanged.

### PC3 — `incomeExpense` anchors to the REAL posting (review-22 BLOCKING fix)
The legacy query classifies `t.amount_paise` per transaction. Mixed-sign splits
(e.g., parent -70, splits -100/+30) have a real posting of -70 but two
counter-postings of +100 and -30 — using counter-postings would give the wrong
income/expense totals. `incomeExpense` MUST anchor to the real posting.

New query selects real postings (`a.system_kind IS NULL`) — exactly one per
transaction — applies the D4 liability check on the real account, and excludes
transfers (Clearing) and opening rows (Opening) in one NOT EXISTS subquery:

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

This is parity-equivalent to the legacy query for all shapes:
- Ordinary: real posting = t.amount_paise ✓
- Split: real posting = parent t.amount_paise (not per-split) ✓
- Mixed-sign split: real posting = parent amount; income/expense reflect the parent ✓
- Transfer: excluded by NOT EXISTS (Clearing) ✓
- Opening row: excluded by NOT EXISTS (Opening) ✓
- Liability D4: `a.type NOT IN (LIABILITY_TYPES)` on the real account ✓
- EMI destination principal leg: positive amount on loan (liability) → income=0 by D4 ✓

### PC4 — D4 liability-inflow exclusion is on the real posting's own account
PC3 anchors to real postings (`a.system_kind IS NULL`); `JOIN accounts a ON a.id =
p.account_id` is already the real account join. The liability check `a.type NOT IN
(LIABILITY_TYPES)` is applied inline in the income CASE branch — no additional join
to `t.account_id` or to a second posting is needed.

Confirmed: `updateTransaction` rebuilds the real posting from the resulting
`t.account_id` atomically (same DB transaction), so `p.account_id` (the real
posting's account) and `t.account_id` always agree in invariant-compliant state.

Expense CASE branch has no D4 guard: expenses (`amount_paise < 0` on real account)
are always counted regardless of account type. The existing sign check `p.amount_paise < 0`
in the expense CASE is sufficient.

### PC5 — Opening rows excluded
For `spentByCategory` and `spendByNecessity`: opening rows produce `[A: amount] +
[Opening: -amount]`. `buildOpeningPostings` never produces Income or Expenses
postings (confirmed in postings.ts). `a.system_kind = 'expenses'` naturally
excludes opening rows — no explicit `is_opening` filter needed.

For `incomeExpense`: the real-posting query (`a.system_kind IS NULL`) would include
opening rows (they have a real posting). Excluded explicitly by `NOT EXISTS
(a2.system_kind IN ('clearing', 'opening'))` in the same subquery as transfers.

### PC10 — Update stale documentation within periods.ts (review-22 WARNING)
`spendByNecessity`'s JSDoc currently says "runs two statements" and discusses a
concurrent split-add/remove race. PC2 replaces it with a single statement — this
comment becomes false and must be updated. The wording about non-atomicity across
two queries is no longer applicable; the concurrency note can be dropped or
replaced with a note about the single-query approach.

`LIABILITY_TYPES_SQL`'s comment says "queries alias accounts as `a`"; PC3's new
query uses `a` for the real account. The comment should be updated to be
query-neutral (e.g., remove the alias-specific note or generalize it).

"NOTHING else in periods.ts" (scope) permits updating comments within the file.

### PC6 — Range-check every derived monetary value before returning (PB6 pattern)
Same rule as PR-B (PLAN-dualwrite.md line 65): use HttpError(500) at any step
where two safe values can combine to an unsafe one.
- `spentByCategory`: check each `Number(row.spent)` before adding to the map, and
  check the intermediate map value after adding.
- `spendByNecessity`: check each `Number(row.spent)`.
- `incomeExpense`: check `Number(row.income)` and `Number(row.expense)`.

Pattern (mirrors `reconciliation-reads.ts:137-143`):
```ts
if (!Number.isSafeInteger(x)) {
  throw new HttpError(500, "Spend aggregate exceeded a safe integer — refusing to lose paise");
}
```

### PC7 — `LIABILITY_TYPES_SQL` and pure helpers unchanged
`LIABILITY_TYPES_SQL` is still used by `incomeExpense` (PC3). No signature, return
type, or export surface changes.

### PC8 — Existing DB-backed tests remain valid
`recurring.test.ts` (AC9 test, lines 543-574) and `inbox.test.ts` (line 1335)
call `incomeExpense`/`spentByCategory` with real DB. They create transactions via
the service layer, which PR-A dual-writes to postings. After PR-C the converted
readers read those postings — parity holds, so the tests pass unchanged.

### PC9 — Deferred readers (intentional)
`modules/planning/services/insights.ts` (`incomeExpense` and `cashAndLiabilities`),
and any other planning/credit reader that calls these functions, are NOT in PR-C
scope. They call the converted `lib/periods.ts` functions and inherit
postings-based numbers automatically. Direct legacy SQL in planning/credit readers
(`reconciliation-reads.ts`, `cards.ts` balance columns) stays legacy until
PR-D/PR-E as planned.

## Acceptance Criteria
- AC1 `spentByCategory` and `spendByNecessity` compute from Expenses-system
  postings (`a.system_kind = 'expenses'`) joined to the non-deleted parent
  transaction; `incomeExpense` computes from real postings (`a.system_kind IS NULL`).
  No `transaction_splits` or `transfer_links` join in any converted function.
- AC2 Transfer exclusion uses NOT EXISTS (Clearing posting). Opening rows excluded
  naturally for spend functions; excluded via NOT EXISTS (Opening posting) for
  `incomeExpense`.
- AC3 D4 liability-inflow: `incomeExpense` income CASE excludes rows where the
  real account (`a.type`) is in LIABILITY_ACCOUNT_TYPES.
- AC4 `incomeExpense` gives the PARENT transaction amount for mixed-sign splits —
  parity test must include a mixed-sign split fixture and assert expense/income
  equal the legacy formula (which reads `t.amount_paise`, not per-split amounts).
- AC5 DB-backed parity test proves per-function equality with legacy formula across
  ordinary income/expense, split (including mixed-sign), transfer (excluded),
  opening row (excluded), soft-deleted (excluded), future-dated, liability-account
  inflow (excluded), EMI destination principal leg (excluded from spend, excluded
  from income by D4), and 2-user tenant isolation.
- AC6 Monetary aggregates range-checked before `Number()`; overflow refused with
  HttpError(500).
- AC7 `npm run typecheck` (all workspaces), `npm run lint`, and `npm run test
  -w apps/api` all green; specifically `recurring.test.ts` and `inbox.test.ts`
  (existing DB-backed callers) pass unchanged.
- AC8 Stale `spendByNecessity` JSDoc (two-statement race note) updated; stale
  `LIABILITY_TYPES_SQL` comment updated.

## Verification
- T1 `npm run typecheck` — exit 0 across all workspaces.
- T2 `npm run lint` — exit 0.
- T3 `npm run test -w apps/api` — green; `recurring.test.ts`, `inbox.test.ts`,
  and the new `postings-periods-parity.test.ts` all pass.
- T4 Parity test (DB-backed, live Postgres with 0067 applied). Expected values
  MUST be computed directly from legacy tables (`transactions`/`transaction_splits`
  + `transfer_links` + `is_opening`) inside the test — never by calling the
  converted functions (no tautology). Coverage:
  - Ordinary expense (bank account, negative amount): all three functions.
  - Ordinary income (bank account, positive amount): `incomeExpense` income side.
  - Same-sign split expense (3 splits, all negative, distinct categories):
    `spentByCategory` maps each category; `incomeExpense` expense = parent amount.
  - **Mixed-sign split, negative parent** (parent -70, splits [-100, +30]):
    `incomeExpense` expense=70 income=0 (parent amount, NOT 100/30);
    `spentByCategory` expense=100 in one category (only the negative split);
    `spendByNecessity` mirrors `spentByCategory`.
  - **Mixed-sign split, positive parent** (parent +70, splits [+100, -30]):
    `incomeExpense` income=70 expense=0 (parent amount, NOT income=100/expense=30);
    `spentByCategory` expense=30 for the negative split's category.
    Expected values for both computed from legacy `t.amount_paise` and per-split
    `transaction_splits.amount_paise`.
  - Transfer pair (out + in): both legs excluded from all three functions.
  - **Transfer lifecycle cases**:
    - Auto-linked pair: both legs excluded (Clearing postings present).
    - Unlinked pair (manual unlink via service): both legs revert to ordinary
      postings (Clearing removed); both appear in spend/income as expected.
    - Re-linked pair (re-link the same two legs): both excluded again.
    - Hard-delete surviving partner (simulate import-rollback: one leg deleted →
      postings cascade; surviving partner rebuilt as ordinary by PR-A writer):
      surviving leg appears in spend/income; no Clearing posting remains.
  - Opening row (`is_opening = true`, bank account): excluded from all three.
  - Soft-deleted transaction: excluded from all three.
  - Future-dated transaction (date > today): excluded from all three.
  - Liability-account inflow (credit_card, positive amount, non-transfer):
    excluded from `incomeExpense` income by D4; also excluded from `spentByCategory`
    and `spendByNecessity` (positive amount = no Expenses posting).
  - **EMI fixture** (recurring source expense + destination principal leg): source
    expense appears in all three spend functions; destination principal leg (positive
    amount on loan account) appears in neither `spentByCategory` nor
    `spendByNecessity`; excluded from `incomeExpense` income by D4 (loan is
    liability). Assert no Clearing or transfer_links row for either EMI transaction.
  - Zero-amount transaction (Income posting with amount 0, no Expenses posting):
    contributes 0 to all three functions.
  - Two-user tenant isolation: user B's data absent from user A's output.
  - `findInconsistentPostings(db, userId) == []` for the fixture user.
- T5 `git status` / `git diff --name-only` shows only the scoped files changed
  (`periods.ts`, new `postings-periods-parity.test.ts`); no unintended
  modifications.

## Non-goals
- No conversion of planning/credit/investment readers that call these functions —
  they inherit postings-based numbers via the converted functions automatically.
- No writer, schema, migration, shared-contract, or web changes.
- No changes to `periodRange`, `prevPeriodKey`, `currentPeriodKey`, `monthKeyOf`,
  or `LIABILITY_TYPES_SQL`.
- No dropping of `transaction_splits` or `transfer_links` (PR-G).

## Review history
- review-22 (Codex): 1 BLOCKING + 3 WARNINGs + 5 NOTEs.
  - BLOCKING: `incomeExpense` via counter-postings gives wrong result for
    mixed-sign splits. Fixed: PC3 now anchors to real postings (`system_kind IS
    NULL`), one per transaction. Opening rows excluded via NOT EXISTS (opening)
    combined with NOT EXISTS (clearing) in one subquery.
  - WARNING: Clearing ↔ transfer_links equivalence relies on PR-A invariant.
    Acknowledged in parity proof; T4 includes transfer-lifecycle cases.
  - WARNING: T4 must include EMI scenario. Added.
  - WARNING: T4 must include mixed-sign split. Added (AC4 + T4).
  - WARNING: Stale documentation in periods.ts. Added PC10 and AC8.
  - NOTEs (all valid; no plan changes): `t.account_id` D4 correctness confirmed;
    opening rows confirmed safe from Income/Expenses; sign correctness confirmed;
    fan-out analysis for PC3 confirmed (N rows per split is wrong for incomeExpense
    — now irrelevant, PC3 fixed to real postings); zero-amount NOTE confirmed;
    EMI NOTE confirmed.

## Deviations / open questions for Codex plan review (iteration 2)
All three questions confirmed by review-23:
1. PC3 parity-equivalent for all shapes — confirmed (review-23 NOTE).
2. Combined NOT EXISTS correct for every builder-produced shape — confirmed (review-23 NOTE).
3. No other callers or unconverted functions identified as blocking.
