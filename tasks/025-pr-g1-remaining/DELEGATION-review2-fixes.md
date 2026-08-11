# Delegation: Fix review-2 BLOCKING findings (B1 + B3) + advisory

## Task
025 — PR-G1 remaining (review-2 BLOCKING fixes)

## Context
Branch: `feat/postings-pr-g1`. Two BLOCKING findings from review-2 were never addressed in
subsequent implementations. Both must be fixed now.

## Blocking Fix 1 — accounts.ts:436 reads `t.amount_paise` (AC5 violation)

**File:** `apps/api/src/modules/ledger/services/accounts.ts`

**Current code** (around line 435):
```sql
select t.id, t.amount_paise
from transactions t
where t.user_id = ${userId}
  and t.deleted_at is null
  and exists (
    select 1 from postings p
    join accounts a_sys on a_sys.id = p.account_id and a_sys.system_kind = 'opening'
    where p.transaction_id = t.id
  )
  and exists (
    select 1 from postings p2
    where p2.transaction_id = t.id and p2.account_id = ${id}
  )
order by t.date asc, t.id asc
limit 1
```

**Problem:** Reads `t.amount_paise` from the transactions header — the legacy projection.
TASK.md AC5 explicitly forbids reading `transactions.amount_paise` in production code
outside the allowlist. The authoritative amount is the posting on the real account.

**Required change:** Replace the query so it JOINs to the posting on `account_id = id`
and reads `p.amount_paise` instead of `t.amount_paise`:

```sql
select t.id, p.amount_paise
from transactions t
join postings p on p.transaction_id = t.id and p.account_id = ${id}
where t.user_id = ${userId}
  and t.deleted_at is null
  and exists (
    select 1 from postings p_sys
    join accounts a_sys on a_sys.id = p_sys.account_id and a_sys.system_kind = 'opening'
    where p_sys.transaction_id = t.id
  )
order by t.date asc, t.id asc
limit 1
```

**The row type cast** on the line immediately after must also change from:
```typescript
const existingRow = (existingResult.rows as Array<{ id: string; amount_paise: number }>)[0];
```
to remain the same shape (same fields `id` and `amount_paise`), so the downstream
`Number(existingRow.amount_paise)` calls are unchanged. The only change is that
`amount_paise` now comes from the posting, not the transaction header.

---

## Blocking Fix 2 — postings-pr-e-parity.test.ts:138 stale addend

**File:** `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts`

**Current code** (line 138):
```typescript
assert.equal(holders[0]!.cards[0]!.balancePaise, 5000 + Number(legRow.total));
```

**Problem:** The `legRow` query (lines 131-137) sums ALL postings on `cardAcct.id`:
```sql
select coalesce(sum(p.amount_paise), 0)::bigint as total
from postings p join transactions t on t.id = p.transaction_id
where p.account_id = ${cardAcct.id} and t.user_id = ${userId} and t.deleted_at is null
```

After PR-G1, the Opening transaction produces a posting on cardAcct with `amount_paise = 5000`.
So `legRow.total` already includes the +5000 Opening posting. The `5000 +` addend
double-counts it. The assertion should be:

```typescript
assert.equal(holders[0]!.cards[0]!.balancePaise, Number(legRow.total));
```

**Verify** that the comment on line 127 reflects the correct math:
```typescript
assert.equal(holders[0]!.cards[0]!.balancePaise, 5000 + (-10000 - 25000 + 20000)); // -10000
```
This line 127 comment shows `5000 + ...` = -10000. After PR-G1 with opening as a posting:
- Opening posting: +5000
- Purchases/payments: -10000, -25000, +20000
- Sum: 5000 + (-10000) + (-25000) + 20000 = -10000
The math is correct (the comment just shows the expected balance breakdown).
The legRow cross-check on line 138 is what needs to change to remove the double-add.

---

## Advisory Fix — reconciliation-writes.ts:316 LIMIT 1 without account_id constraint

**File:** `apps/api/src/modules/credit/services/reconciliation-writes.ts`

**Current code** (around line 315):
```sql
select p.amount_paise from postings p
join accounts a on a.id = p.account_id and a.system_kind is null
where p.transaction_id = ${openingTxnRow.rows[0]!.id}
limit 1
```

**Problem:** For a malformed Opening transaction with multiple non-system postings, the
LIMIT 1 picks an arbitrary one. Should constrain to `p.account_id = ${accountId}`.

**Required change:**
```sql
select p.amount_paise from postings p
where p.transaction_id = ${openingTxnRow.rows[0]!.id}
  and p.account_id = ${accountId}
limit 1
```

No accounts join needed since we're constraining directly to the known real account.
The type cast `as unknown as { rows: Array<{ amount_paise: number }> }` stays unchanged.

---

## Files to change
- `apps/api/src/modules/ledger/services/accounts.ts` (B1 fix)
- `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts` (B3 fix)
- `apps/api/src/modules/credit/services/reconciliation-writes.ts` (advisory fix)

## Must NOT change
- Any other file

## Acceptance Criteria
- AC1: `npm run typecheck` exits 0
- AC2: `npm run lint` exits 0
- AC3: `accounts.ts` — Opening tx discovery query reads `p.amount_paise` (from postings), not `t.amount_paise`
- AC4: `postings-pr-e-parity.test.ts:138` — no `5000 +` addend
- AC5: `reconciliation-writes.ts` real-leg query constrained to `p.account_id = ${accountId}`

## Commands
1. Read each file before editing (required)
2. Make the three changes described
3. `npm run typecheck` — capture full output + exit code
4. `npm run lint` — capture full output + exit code

## Required evidence
Write findings to: `tasks/025-pr-g1-remaining/implementation-review2-fixes.md`
Include: files changed, complete diff, exact command output, exit codes.
Return digest ≤20 lines + file path.
