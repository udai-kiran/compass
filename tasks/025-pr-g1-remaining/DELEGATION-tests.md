# Delegation: Tests — Fix the 14 typecheck errors in test files

## Task
025 — PR-G1 remaining (test fixes)

## Context
Branch: `feat/postings-pr-g1`. The API changed in PR-G1:
- `createTransfer` now returns `{ transactionId: string }` (the single outflow header)
  instead of `{ transferLinkId, outTransactionId, inTransactionId }`
- `unlinkTransfer(db, userId, txnId)` now takes a TRANSACTION ID (not a link ID)
  and returns `{ transactionIds: [string, string] }` (survivor, new leg)
- `linkTransfer(db, userId, outId, inId)` now has 4 parameters — the 5th `auto` boolean
  was removed
- `Transaction` DTO field `transferLinkId` → `isTransfer: boolean`
- `reconcileUserPostings` is gone from `reconcile-postings.ts`
  (replaced by `findInconsistentPostings` and `reprojectAllLegacyColumns`)
- `rebuildPostingsForTransaction` is gone from `transactions.ts`

There are currently 14 typecheck errors across 6 test files. Fix them all.

## Required Changes per File

### T1 — `apps/api/src/modules/ingest/services/inbox.test.ts`

Read the file. Find the TWO `linkTransfer(tx, userId, ..., false)` calls:
- Line ~1254: `await linkTransfer(tx, userId, candidate.id, spuriousCredit.id, false)`
  → `await linkTransfer(tx, userId, candidate.id, spuriousCredit.id)`
- Line ~1667: `await linkTransfer(db, userId, alreadyLinked.id, otherCredit.id, false)`
  → `await linkTransfer(db, userId, alreadyLinked.id, otherCredit.id)`

Remove the 5th argument (the `false` boolean) from both calls. No other changes.

### T2 — `apps/api/src/modules/ledger/services/epf-contributions.test.ts`

Read the file. Find line ~150:
```typescript
assert.equal(hydrated.transferLinkId, null);
```
Change it to:
```typescript
assert.equal(hydrated.isTransfer, false);
```
`transferLinkId` no longer exists on the Transaction DTO; `isTransfer: boolean` replaced it.

### T3 — `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts`

Read the file. Find lines ~519-523:
```typescript
// Update out-leg merchant to force a match with the search term
// createTransfer returns TransferResult = { transferLinkId, outTransactionId, inTransactionId }
await db.execute(
  sql`UPDATE transactions SET merchant = 'PE7Merchant' WHERE id = ${xfer.outTransactionId}`,
);
```
Change to:
```typescript
// Update the transfer header's merchant (createTransfer returns { transactionId } —
// the outflow leg; PR-G1 replaced the old three-field result)
await db.execute(
  sql`UPDATE transactions SET merchant = 'PE7Merchant' WHERE id = ${xfer.transactionId}`,
);
```
Only change: `xfer.outTransactionId` → `xfer.transactionId` and update the comment.

### T4 — `apps/api/src/lib/postings-periods-parity.test.ts`

Read the file. Locate test "postings-periods-parity: 7 — transfer lifecycle: link / unlink / re-link / hard-delete" (around line 463).

**Step 4a — remove the import of `rebuildPostingsForTransaction`** (line ~16):
```typescript
  rebuildPostingsForTransaction,
```
Remove that line from the import statement.

**Step 4b — fix 7b: unlink (line ~489):**
```typescript
await unlinkTransfer(db, userId, transfer.transferLinkId);
```
Change to:
```typescript
const unlinked = await unlinkTransfer(db, userId, transfer.transactionId);
const [outId, inId] = unlinked.transactionIds;
```
`transfer.transactionId` is what `createTransfer` now returns (the outflow header ID).
`unlinkTransfer` returns `{ transactionIds: [survivorId, newLegId] }`.

**Step 4c — fix 7c: re-link (line ~507):**
```typescript
const newLink = await linkTransfer(db, userId, transfer.outTransactionId, transfer.inTransactionId, false);
```
Change to:
```typescript
const newLink = await linkTransfer(db, userId, outId, inId);
```
Use the IDs captured from the `unlinked` result above. The 5th boolean arg is removed.

**Step 4d — DELETE sub-test 7d entirely:**
Sub-test 7d starts at `// 7d: hard-delete the in-leg transaction...` (around line 517)
and ends before `// findInconsistentPostings: only out-leg remains` (around line 530).
The exact lines are:
```typescript
  // 7d: hard-delete the in-leg transaction (cascades transfer_links + its postings)
  //     then rebuild out-leg postings: no longer in transfer_links → ordinary expense shape
  await db.delete(transactions).where(eq(transactions.id, transfer.inTransactionId));
  await rebuildPostingsForTransaction(db, userId, transfer.outTransactionId);
  {
    const ie = await incomeExpense(db, userId, FROM, TO);
    const sbc = await spentByCategory(db, userId, FROM, TO);
    assert.equal(ie.expensePaise, 30000, "7d: surviving out-leg appears as ordinary expense");
    assert.equal(ie.incomePaise, 0, "7d: no income after in-leg hard-deleted");
    assert.equal(sbc.get(null) ?? 0, 30000, "7d: out-leg appears in spentByCategory with null category");
    const sbn7d = await spendByNecessity(db, userId, FROM, TO); assert.equal(totalNecessitySpend(sbn7d), 30000, "7d: surviving out-leg in spendByNecessity");
  }
```
Delete all these lines. In PR-G1 a transfer is ONE header — there is no separate
"in-leg transaction" to delete. This scenario is architecturally impossible.

**Step 4e — fix the final assertion (line ~531):**
After deleting 7d, the remaining code should be:
```typescript
  // findInconsistentPostings: only out-leg remains; must be consistent
  assert.deepEqual(await findInconsistentPostings(db, userId), []);
  assert.ok(true, "7: transfer lifecycle assertions complete with " + newLink.id);
```
The comment "only out-leg remains" is no longer accurate after the 7d deletion — the
re-linked transfer still exists. Update the comment to:
```typescript
  // findInconsistentPostings: re-linked transfer must be consistent
  assert.deepEqual(await findInconsistentPostings(db, userId), []);
  assert.ok(true, "7: transfer lifecycle complete with " + newLink.id);
```

Also check whether `transfer.inTransactionId` or `transfer.outTransactionId` are
referenced ANYWHERE else in the test file (not just in 7d) and remove those references.
The same for `transfer.transferLinkId` — replace with `transfer.transactionId`.

### T5 — `apps/api/src/modules/ledger/services/reconcile-postings.test.ts`

Read the full file. The function `reconcileUserPostings` is gone (it was the old
legacy→postings reconciler). Replace the tests entirely with tests for the new
validator functions `findInconsistentPostings` and `reprojectAllLegacyColumns`.

**New test structure (replace ALL existing test content):**

```typescript
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { accounts, categories, postings, transactions, users } from "../../../db/schema.ts";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { findInconsistentPostings, reprojectAllLegacyColumns } from "./reconcile-postings.ts";
import { seedSystemAccounts } from "./post-entry.ts";
import { createTransaction } from "./transactions.ts";
import { createAccount } from "./accounts.ts";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "reconcile-postings.test.ts's DB-backed tests need DATABASE_URL set — " +
        "export it before running `npm run test -w apps/api`.",
    );
  }
  return url;
}

const pool = createPool(requireDatabaseUrl());
const db = createDb(pool);
after(async () => {
  await pool.end();
});

async function createUser(): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email: `reconcile-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "reconcile-postings.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(categories).where(eq(categories.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

test("findInconsistentPostings: returns [] for a normally-created transaction", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);
  const acct = await createAccount(db, userId, { name: "Bank", type: "bank", openingBalancePaise: 0 });
  await createTransaction(db, userId, {
    accountId: acct.id,
    amountPaise: -5000,
    date: "2026-01-01",
    merchant: "Test",
  });
  const problems = await findInconsistentPostings(db, userId);
  assert.deepEqual(problems, [], "normally-created transaction must have no posting problems");
});

test("findInconsistentPostings: reports 'no postings' for a raw-inserted transaction", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);
  const acct = await createAccount(db, userId, { name: "Bank", type: "bank", openingBalancePaise: 0 });
  const [txn] = await db
    .insert(transactions)
    .values({ userId, accountId: acct.id, date: "2026-01-02", amountPaise: -1000, merchant: "Raw" })
    .returning({ id: transactions.id });
  const problems = await findInconsistentPostings(db, userId);
  assert.equal(problems.length, 1, "raw-inserted transaction must appear as a posting problem");
  assert.equal(problems[0]!.transactionId, txn!.id);
  assert.ok(problems[0]!.reason.includes("no postings"), `expected 'no postings' in reason, got: ${problems[0]!.reason}`);
});

test("findInconsistentPostings: tenant-scope — reports only the target user's problems", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => { await cleanupUser(userA); await cleanupUser(userB); });
  await seedSystemAccounts(db, userA);
  await seedSystemAccounts(db, userB);
  const acctA = await createAccount(db, userA, { name: "Bank A", type: "bank", openingBalancePaise: 0 });
  const acctB = await createAccount(db, userB, { name: "Bank B", type: "bank", openingBalancePaise: 0 });
  // Raw-insert for BOTH users
  await db.insert(transactions).values({ userId: userA, accountId: acctA.id, date: "2026-01-01", amountPaise: -100, merchant: "A" });
  await db.insert(transactions).values({ userId: userB, accountId: acctB.id, date: "2026-01-01", amountPaise: -200, merchant: "B" });
  // Check only user A — must not report user B's problem
  const problemsA = await findInconsistentPostings(db, userA);
  assert.equal(problemsA.length, 1, "findInconsistentPostings scoped to userA must return exactly 1 problem");
  assert.equal(problemsA[0]!.userId, userA);
});

test("reprojectAllLegacyColumns: idempotent — second call succeeds without error", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);
  const acct = await createAccount(db, userId, { name: "Bank", type: "bank", openingBalancePaise: 0 });
  await createTransaction(db, userId, {
    accountId: acct.id,
    amountPaise: -3000,
    date: "2026-01-03",
    merchant: "Reproject test",
  });
  const first = await reprojectAllLegacyColumns(db);
  assert.equal(first.failures.length, 0, "first reprojectAllLegacyColumns must have no failures");
  const second = await reprojectAllLegacyColumns(db);
  assert.equal(second.failures.length, 0, "second reprojectAllLegacyColumns must have no failures (idempotent)");
});
```

Important: the old test helpers like `cleanupUser` are kept. Preserve the `requireDatabaseUrl()` + pool/db setup at the top.

### T6 — `apps/api/src/modules/system/services/backup.test.ts`

Read the file. Find:
1. Line ~34: The import `{ findInconsistentPostings, reconcileUserPostings }` from `reconcile-postings.ts`
   → Remove `reconcileUserPostings` from this import (keep `findInconsistentPostings`)

2. Lines ~680-724: Raw `db.insert(transactions)` for ordinary transactions, raw
   `db.insert(transferLinks)` for a transfer pair, and raw `db.insert(transactions)` with
   `isOpening: true`. These need to be replaced with service-layer calls.

3. Line ~726-728: `const sourceReconcile = await reconcileUserPostings(db, sourceUserId)` and
   the two assertions after it — DELETE these three lines.

For the fixture replacement (items 680-724), read the surrounding test to understand
what accounts are available (bank, wallet, food category, etc.) and replace:

**The ordinary transactions** (lines ~661-681 and ~712-724) — check what they look like and
replace each `db.insert(transactions).values({...})` with `createTransaction(db, sourceUserId, {
  accountId: ..., amountPaise: ..., date: ..., merchant: ..., categoryId: ...
})`.

**The transfer pair** (lines ~682-696, inserting out-leg, in-leg, and `transfer_links` row) —
replace the THREE inserts with a single `createTransfer(db, sourceUserId, {
  fromAccountId: ...,
  toAccountId: ...,
  amountPaise: ...,
  date: ...,
})`. The `createTransfer` return value is `{ transactionId }` (the outflow header).

**The opening balance transaction** (lines ~700-710, raw insert with `isOpening: true`) —
This should instead be handled by `createAccount` with a non-zero `openingBalancePaise`.
BUT: the account was already created earlier in the test. If the account creation call
can be changed to include `openingBalancePaise` there, do that. Otherwise, use
`updateAccount(db, sourceUserId, bankId, { openingBalancePaise: 100000 })` to set the
opening balance after the fact (which will create the Opening transaction).
Import `updateAccount` from the accounts service if needed.

After making these changes, verify that the test's assertions about the backup content
still make sense (the backup should now contain correctly-shaped posting data).

## Must Not Change
- Any production files (only test files in this batch)
- Any test files not listed above

## Commands
1. Read each file before editing
2. Make the changes described
3. Run `npm run typecheck` and capture full output + exit code
4. Run `npm run lint` and capture output + exit code
5. Run `node --test apps/api/src/modules/ingest/services/inbox.test.ts 2>&1 | tail -20`
   (no DATABASE_URL needed for inbox.test.ts — check if it has a skip guard)
6. Run `node --test apps/api/src/modules/ledger/services/epf-contributions.test.ts 2>&1 | tail -20`
7. Run `node --test apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts 2>&1 | tail -20`
8. Run `node --test apps/api/src/lib/postings-periods-parity.test.ts 2>&1 | tail -20`
9. Run `node --test apps/api/src/modules/ledger/services/reconcile-postings.test.ts 2>&1 | tail -20`

## Required Evidence
- Files changed with brief description
- Complete diff for each changed file
- Exact typecheck output + exit code
- Exact lint output + exit code
- Test output per file (commands 5-9), noting which tests skip due to missing DATABASE_URL
  and which actually ran
