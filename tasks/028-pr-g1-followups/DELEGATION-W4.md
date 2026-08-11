# Sonnet Worker Delegation — W4

## Task
028-pr-g1-followups, Workstream W4: F10 fixes + F11 new test in
`apps/api/src/modules/credit/services/reconciliation-writes.test.ts` AND
F10 fix in `apps/api/src/modules/credit/services/card-due-tasks.test.ts`.
Branch: `fix/pr-g1-followups`.

## Approved Plan

---

### File 1: reconciliation-writes.test.ts

#### A. Import `updateAccount` (needed for F11)
Current import at line 10:
```typescript
import { createAccount, listAccounts } from "../../ledger/services/accounts.ts";
```
New:
```typescript
import { createAccount, listAccounts, updateAccount } from "../../ledger/services/accounts.ts";
```

#### B. Update `createCardAccount` helper to accept and forward `openingDate?`

Current (around line 54-77):
```typescript
async function createCardAccount(userId: string, openingBalancePaise = 0): Promise<string> {
  // Call the real createAccount so a nonzero openingBalancePaise seeds a real
  // ...
  const account = await createAccount(db, userId, {
    name: "Test Card",
    type: "credit_card",
    institution: null,
    accountLast4: null,
    holderName: null,
    currency: "INR",
    openingBalancePaise,
  });
  return account.id;
}
```

New (add `openingDate?` parameter and forward it):
```typescript
async function createCardAccount(userId: string, openingBalancePaise = 0, openingDate?: string): Promise<string> {
  // Call the real createAccount so a nonzero openingBalancePaise seeds a real
  // ...
  const account = await createAccount(db, userId, {
    name: "Test Card",
    type: "credit_card",
    institution: null,
    accountLast4: null,
    holderName: null,
    currency: "INR",
    openingBalancePaise,
  }, openingDate);
  return account.id;
}
```

#### C. F10 — fix 4 call sites + remove D11b raw SQL from the Diners test

**Site 1 — Diners test (line 120)** — current:
```typescript
  const accountId = await createCardAccount(userId, -2000000);
  // createAccount dates the opening transaction at real wall-clock "today", which has now
  // drifted past the fixture's statement close (2026-07-20). Pin it to a date safely before
  // all fixture dates so date-range queries include it correctly.
  await db.execute(sql`
    UPDATE transactions SET date = '2020-01-01'
    WHERE account_id = ${accountId} AND is_opening = true
  `);
```
Replace with:
```typescript
  const accountId = await createCardAccount(userId, -2000000, "2020-01-01");
```
(Remove the raw SQL UPDATE block entirely.)

**Site 2 — overflow test (line 247)**:

Current:
```typescript
  const accountId = await createCardAccount(userId, openingBalancePaise);
```
New:
```typescript
  const accountId = await createCardAccount(userId, openingBalancePaise, "2020-01-01");
```

**Site 3 — overflow test (line 262)**:

Current:
```typescript
  const accountId = await createCardAccount(userId, openingBalancePaise);
```
New:
```typescript
  const accountId = await createCardAccount(userId, openingBalancePaise, "2020-01-01");
```

**Site 4 — preexisting opening test (line 434)**:

Current:
```typescript
  const accountId = await createCardAccount(userId, -500000);
```
New:
```typescript
  const accountId = await createCardAccount(userId, -500000, "2020-01-01");
```

#### D. F11 — new integration test

Add the following test AFTER the existing concurrent-lock test (which ends around line 739+).
Place it right after that test's closing brace `});`.

The test name and exact code:

```typescript
test("absorbCarryover advisory lock blocks concurrent updateAccount — integration proof with real callers", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  // One charge so there is a positive drift when totalDuePaise > ledger due.
  // statementDate must be in the future so the charge is within the window.
  const close = "2029-06-20";
  await createTxn(userId, accountId, "2029-06-05", -100000);
  const reconciliationId = await createReconciliation(userId, accountId, {
    statementDate: close,
    totalDuePaise: 350000, // ledgerDue=100000, drift=250000, nextOpeningPaise=-250000
  });

  // Gate pattern identical to the existing advisory-lock concurrent test.
  const absorbAcquired = makeGate();
  const releaseAbsorb = makeGate();

  const { redis } = stubRedis();
  // Start absorbCarryover. The afterAggregate hook fires once the advisory lock
  // is held and the SERIALIZABLE transaction is open (after the ledger aggregate
  // read, before the account-row UPDATE). We pause there to ensure updateAccount
  // is started while absorbCarryover still owns the lock.
  const absorbPromise = absorbCarryover(
    db,
    redis as never,
    userId,
    accountId,
    reconciliationId,
    {
      afterAggregate: async () => {
        absorbAcquired.release(); // advisory lock is now held by absorbCarryover
        await releaseAbsorb.opened; // hold until the test signals release
      },
    },
  );

  // Wait until absorbCarryover has acquired the lock.
  await absorbAcquired.opened;

  // Now attempt updateAccount on the same account — must try to acquire the
  // same advisory lock (hashtextextended(accountId, 0)) and BLOCK.
  const updatePromise = updateAccount(db, userId, accountId, { openingBalancePaise: -80000 });
  let updateSettled = false;
  void updatePromise.then(
    () => { updateSettled = true; },
    () => { updateSettled = true; },
  );

  // 250 ms: absorbCarryover still holds the lock; updateAccount must still be pending.
  await new Promise<void>((r) => setTimeout(r, 250));
  assert.equal(
    updateSettled,
    false,
    "updateAccount must be blocked while absorbCarryover holds the account advisory lock",
  );

  // Release absorbCarryover. It will commit its opening posting (-250000),
  // then release the advisory lock, allowing updateAccount to proceed.
  releaseAbsorb.release();

  // Await both operations — both must complete without error.
  await Promise.all([absorbPromise, updatePromise]);

  // Serial order is deterministic: absorbCarryover ran first (held the lock),
  // created the opening posting (-250000); updateAccount ran second and
  // updated it to -80000. Exactly ONE live opening posting must remain.
  const openingPostings = await db.execute(sql`
    select p.amount_paise from postings p
    join transactions t on t.id = p.transaction_id
    where p.account_id = ${accountId} and t.is_opening = true and t.deleted_at is null
  `);
  const rows = openingPostings.rows as Array<{ amount_paise: string }>;
  assert.equal(rows.length, 1, "exactly one opening posting must exist after both operations");
  assert.equal(
    Number(rows[0]!.amount_paise),
    -80000,
    "updateAccount ran after absorbCarryover (serial order enforced by advisory lock), final opening = -80000",
  );
  assert.equal(
    (await db.select().from(accounts).where(eq(accounts.id, accountId)))[0]!.openingBalancePaise,
    0,
    "accounts.opening_balance_paise remains frozen at 0 (PR-G1 invariant)",
  );
});
```

Note: `makeGate`, `stubRedis`, `createTxn`, `createReconciliation`, `accounts`, `sql`,
`eq` are all already available in scope from existing imports and helpers.

---

### File 2: card-due-tasks.test.ts

#### A. Update `createCardAccount` helper to accept and forward `openingDate?`

The helper is at around line 157-177. Current signature:
```typescript
async function createCardAccount(
  userId: string,
  name: string,
  openingBalancePaise = 0,
  institution?: string,
): Promise<string> {
```

New:
```typescript
async function createCardAccount(
  userId: string,
  name: string,
  openingBalancePaise = 0,
  institution?: string,
  openingDate?: string,
): Promise<string> {
```

And inside, change the `createAccount` call to forward `openingDate`:
```typescript
  const account = await createAccount(db, userId, {
    name,
    type: "credit_card",
    institution: institution ?? null,
    accountLast4: null,
    holderName: null,
    currency: "INR",
    openingBalancePaise,
  }, openingDate);
```

#### B. Fix AC15 call site + remove D11b raw SQL

Current (around line 790-797):
```typescript
  const accountId = await createCardAccount(userId, "Opening balance card", -300000);
  // createAccount dates the opening transaction at real wall-clock "today", which has now
  // drifted past the fixture's cycle close. Pin it to a date safely before all fixture
  // dates so date-range queries include it correctly.
  await db.execute(sql`
    UPDATE transactions SET date = '2020-01-01'
    WHERE account_id = ${accountId} AND is_opening = true
  `);
```

Replace with:
```typescript
  const accountId = await createCardAccount(userId, "Opening balance card", -300000, undefined, "2020-01-01");
```
(Remove the raw SQL UPDATE block entirely; the 4th arg `institution` is `undefined`, 5th arg is `openingDate`.)

## Files and Symbols
- `apps/api/src/modules/credit/services/reconciliation-writes.test.ts`
- `apps/api/src/modules/credit/services/card-due-tasks.test.ts`

## Must Not Change
- Any other file
- Test assertions (only fixture and import changes)
- Other `createCardAccount` calls (zero opening balance — leave as-is)
- The existing concurrent advisory lock test (lines 651-739) — new test goes AFTER it

## Acceptance Criteria
- AC1: `updateAccount` imported in reconciliation-writes.test.ts
- AC2: Both `createCardAccount` helpers updated with `openingDate?` forwarded
- AC3: 4 call sites in reconciliation-writes.test.ts pass `"2020-01-01"` as opening date
- AC4: 1 call site in card-due-tasks.test.ts passes `"2020-01-01"` as opening date
- AC5: D11b raw SQL blocks removed from both files (2 total)
- AC6: F11 test added after existing concurrent test in reconciliation-writes.test.ts;
  uses `afterAggregate` hook + gate pattern; asserts `updateSettled === false` at 250ms;
  asserts final opening posting = -80000
- AC7: `npm run typecheck` exits 0
- AC8: `npm run lint` exits 0

## Commands
1. `git checkout fix/pr-g1-followups`
2. Make all edits described above
3. `npm run typecheck`
4. `npm run lint`

## Required Evidence
- `git status` (exactly 2 files modified)
- Complete diff of each file
- Grep confirming no raw SQL `UPDATE transactions SET date` remains in either file
- Typecheck + lint literal output + exit codes
