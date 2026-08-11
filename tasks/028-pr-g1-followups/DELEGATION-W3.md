# Sonnet Worker Delegation — W3

## Task
028-pr-g1-followups, Workstream W3: fix F7 (lines 289, 442, 529) and F10 (update createAcct
wrapper + 6 call sites, SKIP line 783) in
`apps/api/src/modules/planning/services/postings-planning-parity.test.ts`.
Branch already exists: `fix/pr-g1-followups`. Checkout that branch.

## Approved Plan

### F7 — replace three dormant `transfer_links` queries

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

**Site 1 — getTrends byCategory test, splitCat query (~lines 289-290)**

In the `legSplitCat` query block, current:
```sql
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
```
Replace with the postings-shape predicate above.

**Site 2 — getInsights/topMerchants test (~lines 442-443)**

In the `legMerchantRes` query, current:
```sql
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
```
Replace with the postings-shape predicate.

**Site 3 — buildReport merchants test (~lines 529-530)**

In the `legRes` query, current:
```sql
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
```
Replace with the postings-shape predicate.

### F10 — update `createAcct` wrapper and 6 call sites

**Update the `createAcct` function** (around line 91-107):

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

**6 call sites to update** (add `"2020-01-01"` as 5th argument):
- Line 261: `await createAcct(userId, "BankWithOpening", "bank", 5000);`
  → `await createAcct(userId, "BankWithOpening", "bank", 5000, "2020-01-01");`

- Line 337: `const bank = await createAcct(userId, "Bank", "bank", 50000); // opening balance`
  → `const bank = await createAcct(userId, "Bank", "bank", 50000, "2020-01-01"); // opening balance`

- Line 432: `await createAcct(userId, "OpeningBank", "bank", 30000);`
  → `await createAcct(userId, "OpeningBank", "bank", 30000, "2020-01-01");`

- Line 678: `await createAcct(userId, "OpeningBank", "bank", 50000);`
  → `await createAcct(userId, "OpeningBank", "bank", 50000, "2020-01-01");`

- Line 732: `await createAcct(userId, "OpeningLarge", "bank", 80000);`
  → `await createAcct(userId, "OpeningLarge", "bank", 80000, "2020-01-01");`

- Line 874: `const bank = await createAcct(userId, "Bank", "bank", 10000);`
  → `const bank = await createAcct(userId, "Bank", "bank", 10000, "2020-01-01");`

**CRITICAL — DO NOT CHANGE line 783**:
```typescript
  const savingsWithOpening = await createAcct(userId, "SavingsOpening", "bank", 20000);
```
This must remain WITHOUT an openingDate argument. The test asserts the opening
posting is counted within a date window of `cutoffIso (today-365) to today` — a
fixed "2020-01-01" date would fall outside that window and break the test.

## Files and Symbols
- `apps/api/src/modules/planning/services/postings-planning-parity.test.ts` (only)

## Must Not Change
- Any other file
- Line 783 (`savingsWithOpening`) — ABSOLUTELY DO NOT add an openingDate here
- The actual test assertions
- Any zero-opening-balance `createAcct` calls

## Acceptance Criteria
- AC1: Exactly 3 `transfer_links` occurrences replaced (lines 289, 442, 529)
- AC2: `createAcct` wrapper accepts `openingDate?` and forwards to `createAccount`
- AC3: Exactly 6 call sites updated with `"2020-01-01"` (lines 261, 337, 432, 678, 732, 874)
- AC4: Line 783 (`savingsWithOpening`) is UNCHANGED — no openingDate argument
- AC5: `npm run typecheck` exits 0
- AC6: `npm run lint` exits 0

## Commands
1. `git checkout fix/pr-g1-followups`
2. Make the edits described above
3. `npm run typecheck`
4. `npm run lint`

## Required Evidence
- `git status` (only this file modified)
- Complete diff of the file
- Grep confirming no live `transfer_links` SQL remains (doc comments OK)
- Grep confirming line 783 still has `createAcct(userId, "SavingsOpening", "bank", 20000)` WITHOUT a 5th arg
- Typecheck + lint literal output + exit codes
