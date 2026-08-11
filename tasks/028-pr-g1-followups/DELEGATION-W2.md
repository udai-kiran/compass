# Sonnet Worker Delegation — W2

## Task
028-pr-g1-followups, Workstream W2: fix F7 (lines 123, 177, 191) and F10 (test 8 + test 15)
in `apps/api/src/lib/postings-periods-parity.test.ts`.
Branch already exists: `fix/pr-g1-followups` (created by W1). Checkout that branch.

## Approved Plan

### F7 — replace three dormant `transfer_links` queries (lines 123, 177, 191)

The independent postings-shape predicate (already used in sibling queries in this file):
```sql
and not (
  (select count(*) from postings pr join accounts ar on ar.id = pr.account_id
   where pr.transaction_id = t.id and ar.system_kind is null) = 2
  and
  (select count(*) from postings ps join accounts asys on asys.id = ps.account_id
   where ps.transaction_id = t.id and asys.system_kind is not null) = 0
)
```

**Site 1 — `legacySpentByCategory` splitParts query (lines 123-124)**

Current (lines 123-124):
```sql
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
```
Replace with:
```sql
      and not (
        (select count(*) from postings pr join accounts ar on ar.id = pr.account_id
         where pr.transaction_id = t.id and ar.system_kind is null) = 2
        and
        (select count(*) from postings ps join accounts asys on asys.id = ps.account_id
         where ps.transaction_id = t.id and asys.system_kind is not null) = 0
      )
```

**Site 2 — `legacySpendByNecessity` nonSplit query (lines 177-178)**

Current (lines 177-178):
```sql
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
```
Replace with same predicate as above.

**Site 3 — `legacySpendByNecessity` splitParts query (lines 191-192)**

Current (lines 191-192):
```sql
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
```
Replace with same predicate as above.

### F10 — update `createAcct` wrapper and two test call sites

**Update the `createAcct` function** (around line 72-88) to accept and forward `openingDate?`:

Current:
```typescript
async function createAcct(
  userId: string,
  name: string,
  type: AccountType,
  openingBalancePaise = 0,
): Promise<{ id: string; type: AccountType }> {
  const account = await createAccount(db, userId, {
    name,
    type,
    institution: null,
    accountLast4: null,
    holderName: null,
    currency: "INR",
    openingBalancePaise,
  });
  return { id: account.id, type };
}
```

New:
```typescript
async function createAcct(
  userId: string,
  name: string,
  type: AccountType,
  openingBalancePaise = 0,
  openingDate?: string,
): Promise<{ id: string; type: AccountType }> {
  const account = await createAccount(db, userId, {
    name,
    type,
    institution: null,
    accountLast4: null,
    holderName: null,
    currency: "INR",
    openingBalancePaise,
  }, openingDate);
  return { id: account.id, type };
}
```

**Test 8 (around line 542)** — strengthen: pass `"2020-06-01"` so the opening transaction
is INSIDE FROM/TO="2020-01-01"/"2020-12-31" and the `is_opening` exclusion is actually
exercised (not just excluded by date):

Current:
```typescript
  await createAcct(userId, "Bank", "bank", 50000);
```
New:
```typescript
  // openingDate within FROM/TO so the is_opening filter is genuinely exercised
  await createAcct(userId, "Bank", "bank", 50000, "2020-06-01");
```

**Test 15 (around line 769)** — consistency: `findInconsistentPostings` only, date irrelevant;
pass `"2020-01-01"` for consistency:

Current:
```typescript
  const bank = await createAcct(userId, "Bank", "bank", 10000);
```
New:
```typescript
  const bank = await createAcct(userId, "Bank", "bank", 10000, "2020-01-01");
```

## Files and Symbols
- `apps/api/src/lib/postings-periods-parity.test.ts` (only this file)

## Must Not Change
- Any other file
- The actual test assertions (only fixture creation and SQL predicates change)
- The `accounts` import or other imports
- The other `createAcct` calls that use zero openingBalancePaise (leave them as-is)

## Acceptance Criteria
- AC1: Exactly 3 `transfer_links` occurrences replaced (lines 123, 177, 191) — no live
  `transfer_links` query remains in the file (cascade comments / doc strings are OK)
- AC2: `createAcct` wrapper accepts `openingDate?` and forwards it to `createAccount`
- AC3: Test 8 (line 542) passes `"2020-06-01"` as openingDate
- AC4: Test 15 (line 769) passes `"2020-01-01"` as openingDate
- AC5: `npm run typecheck` exits 0
- AC6: `npm run lint` exits 0

## Commands
1. `git checkout fix/pr-g1-followups`
2. Make the edits described above
3. `npm run typecheck` (from repo root)
4. `npm run lint` (from repo root)

## Required Evidence
- `git status` (only this one file modified)
- Complete diff of the file
- Exact typecheck command and literal output + exit code
- Exact lint command and literal output + exit code
- Confirm: grep for `transfer_links` in the file shows only doc/comment/cascade references, not live SQL
