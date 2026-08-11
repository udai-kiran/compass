# Sonnet Worker Delegation — W5

## Task
028-pr-g1-followups, Workstream W5: F10 fix in
`apps/api/src/modules/ledger/services/postings-balance-parity.test.ts`.
Branch already exists: `fix/pr-g1-followups`. Checkout that branch.

## Approved Plan

### Update `createAcct` wrapper to accept and forward `openingDate?`

Current (lines 70-86):
```typescript
async function createAcct(
  userId: string,
  name: string,
  type: AccountType,
  openingBalancePaise: number,
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
  openingBalancePaise: number,
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

### Update two non-zero call sites + fix stale comment

**Line 185 — `bankOpening`**:

Current:
```typescript
  // 1. Bank with an is_opening row (createAccount seeds it) + ordinary +/-.
  const bankOpening = await createAcct(userId, "Bank Opening", "bank", 500000);
```
New:
```typescript
  // 1. Bank with an is_opening row (createAccount seeds it) + ordinary +/-.
  const bankOpening = await createAcct(userId, "Bank Opening", "bank", 500000, "2020-01-01");
```

**Line 190 — `cardOpening`**:

Current (the comment says "column-based opening balance" which is stale — under PR-G1,
`carriesOpeningAsTransaction()` returns true for ALL types including credit_card, so
credit cards also get an is_opening transaction, not a column value):
```typescript
  // 2. Card with a column-based opening balance + charges (no opening txn for card type).
  const cardOpening = await createAcct(userId, "Card Opening", "credit_card", 250000);
```
New (update the comment, add openingDate):
```typescript
  // 2. Card with an is_opening row (under PR-G1, carriesOpeningAsTransaction returns true
  //    for all account types including credit_card) + charges.
  const cardOpening = await createAcct(userId, "Card Opening", "credit_card", 250000, "2020-01-01");
```

### Do NOT change the other non-zero calls

The following calls with non-zero opening balance must NOT receive an `openingDate` argument:
- `zeroActivityLoan` (line 239): `createAcct(userId, "Zero Activity Loan", "loan", 54321)` — leave as-is
- `card` in the overflow test (line 499): `createAcct(userId, "Overflow Card", "credit_card", BIG)` — leave as-is

These tests use `dbToday` as the "as-of" date for their queries, so the opening transaction
dated "today" is always included. They are not date bombs.

## Files and Symbols
- `apps/api/src/modules/ledger/services/postings-balance-parity.test.ts` (only)

## Must Not Change
- Any other file
- Test assertions
- Any other call to `createAcct` not listed above (especially zero-balance calls and the non-bomb non-zero calls)

## Acceptance Criteria
- AC1: `createAcct` wrapper updated with `openingDate?: string` parameter, forwarded to `createAccount`
- AC2: Lines 185 and 190 both pass `"2020-01-01"` as the 5th argument
- AC3: Line 190's comment updated to describe `is_opening row` (not "column-based")
- AC4: Lines 239 and 499 are NOT changed
- AC5: `npm run typecheck` exits 0
- AC6: `npm run lint` exits 0

## Commands
1. `git checkout fix/pr-g1-followups`
2. Make the edits described above
3. `npm run typecheck`
4. `npm run lint`

## Required Evidence
- `git status` (only this one file modified)
- Complete diff of the file
- Typecheck + lint literal output + exit codes
