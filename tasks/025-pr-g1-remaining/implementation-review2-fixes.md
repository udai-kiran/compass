# Implementation: Review-2 BLOCKING Fixes

## Files Inspected
- `apps/api/src/modules/ledger/services/accounts.ts` (lines 425-452)
- `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts` (lines 120-148)
- `apps/api/src/modules/credit/services/reconciliation-writes.ts` (lines 305-322)

## Files Changed

### 1. `apps/api/src/modules/ledger/services/accounts.ts` — B1 fix (AC3)

**Old (around line 435):**
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

**New:**
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

`amount_paise` now comes from the posting on the real account (`p.amount_paise`), not the transaction header. The `existingRow` type cast and downstream `Number(existingRow.amount_paise)` calls are unchanged.

---

### 2. `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts` — B3 fix (AC4)

**Old (line 138):**
```typescript
assert.equal(holders[0]!.cards[0]!.balancePaise, 5000 + Number(legRow.total));
```

**New:**
```typescript
assert.equal(holders[0]!.cards[0]!.balancePaise, Number(legRow.total));
```

After PR-G1, the Opening transaction writes a posting on `cardAcct` with `amount_paise = 5000`. `legRow.total` (sum of all postings on cardAcct) therefore already includes that +5000. The `5000 +` addend was double-counting it. Removing it makes the cross-check agree with the direct assertion on line 127 (which correctly shows the total as -10000: 5000 + (-10000) + (-25000) + 20000 = -10000).

---

### 3. `apps/api/src/modules/credit/services/reconciliation-writes.ts` — Advisory fix (AC5)

**Old (lines 315-319):**
```sql
select p.amount_paise from postings p
join accounts a on a.id = p.account_id and a.system_kind is null
where p.transaction_id = ${openingTxnRow.rows[0]!.id}
limit 1
```

**New:**
```sql
select p.amount_paise from postings p
where p.transaction_id = ${openingTxnRow.rows[0]!.id}
  and p.account_id = ${accountId}
limit 1
```

Removed the `accounts` join; instead constrain directly to `p.account_id = ${accountId}`. This prevents an arbitrary pick when a malformed Opening transaction has multiple non-system postings. The `as unknown as { rows: Array<{ amount_paise: number }> }` type cast is unchanged.

---

## Commands Run and Output

### `npm run typecheck`
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

EXIT:0
```

### `npm run lint`
```
> compass@0.1.0 lint
> eslint .

EXIT:0
```

## Assumptions
- None. The code exactly matched the before-state described in the brief.

## Unresolved Risks
- None identified. All three changes are surgical and type-safe.
