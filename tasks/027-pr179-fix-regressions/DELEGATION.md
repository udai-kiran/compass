# Sonnet Worker Delegation — Iteration 4 (D11c production fix + staging all remaining local changes)

## Task
027-pr179-fix-regressions — fix the 4 remaining CI failures:
- Failure 4 (D11a): `inbox.test.ts:1221` stale `categoryId` assertion — ALREADY DONE in unstaged working tree
- Failures 1+2 (D11b): wall-clock date bombs in `card-due-tasks.test.ts` (staged) and `reconciliation-writes.test.ts` (unstaged) — ALREADY DONE locally
- Failure 3 (D11c): concurrent-lock bug — NOT YET IMPLEMENTED

## Approved Plan

### D11a — verify and stage
`apps/api/src/modules/ingest/services/inbox.test.ts` has an unstaged fix: the stale `assert.equal(after.categoryId, before.categoryId)` line is already removed, and the test at line ~1169 no longer claims "categoryId are unchanged". VERIFY this is correct (read the test declaration and the assertion block around lines 1169-1240), then stage the file.

### D11b — verify and stage
- `apps/api/src/modules/credit/services/card-due-tasks.test.ts` (already staged): re-dating SQL (`UPDATE transactions SET date = '2020-01-01' WHERE account_id = ${accountId} AND is_opening = true`) must be present inside the "AC15: reuses listCardHolders' handling of a non-zero opening balance" test, AFTER `createCardAccount(userId, "Opening balance card", -300000)` and BEFORE `createTxn`. Verify it's there.
- `apps/api/src/modules/credit/services/reconciliation-writes.test.ts` (unstaged): re-dating SQL (`UPDATE transactions SET date = '2020-01-01' WHERE account_id = ${accountId} AND is_opening = true`) must be present inside the "Diners-shaped constituent rows" test (line ~116), AFTER `createCardAccount(userId, -2000000)` and BEFORE `createTxn`. Verify it's there. This file also needs D11c changes below — stage AFTER D11c changes are applied.

### D11c — implement (5 file changes + 1 new file)

**1. `apps/api/src/db/index.ts`**

Add `$client: pg.Pool` to the `Db` type so TypeScript-level callers can access the pool:

```typescript
import type pg from "pg";
// ... existing imports ...

export type Db = NodePgDatabase<typeof schema> & { readonly $client: pg.Pool };

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema }) as unknown as Db;
}
```

The `as unknown as Db` cast is safe: Drizzle 0.45.2's runtime return value for `drizzle(pool, {schema})` has `$client` assigned to the pool. The existing `export { schema }` line stays.

**2. NEW `apps/api/src/lib/account-lock.ts`**

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import * as schema from "../db/schema.ts";
import type { Db } from "../db/index.ts";

/**
 * Acquires a PostgreSQL session-level advisory lock keyed by
 * `hashtextextended(accountId, 0)` (64-bit) on a DEDICATED pool connection,
 * then calls `fn` with a Drizzle instance bound to that same connection.
 *
 * Because the lock acquisition blocks until any concurrent holder releases
 * (and holders commit their changes before releasing), any SERIALIZABLE
 * transaction started inside `fn` takes its snapshot AFTER the previous
 * holder committed — eliminating the stale-snapshot race described in
 * tasks/027-pr179-fix-regressions/TASK.md §"Failure 3".
 *
 * `fn` should start a transaction via `lockedDb.transaction(...)`. The lock
 * is released after `fn` returns or throws. On unlock failure the connection
 * is destroyed rather than returned to the pool (session advisory locks
 * survive normal `COMMIT`/`ROLLBACK` and would contaminate pool reuse).
 *
 * Only accepts a pool-backed `Db` (not a Drizzle transaction handle), because
 * a transaction handle has no pool from which to reserve an independent session.
 */
export async function withAccountAdvisoryLock<T>(
  db: Db,
  accountId: string,
  fn: (lockedDb: Db) => Promise<T>,
): Promise<T> {
  const pool = db.$client;
  const client: pg.PoolClient = await pool.connect();
  // Create a Drizzle instance on this dedicated connection.
  // drizzle() with a pg.PoolClient runs all statements on that exact client.
  const lockedDb = drizzle(client, { schema }) as unknown as Db;
  try {
    // Block until the previous holder releases and commits.
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended($1, 0))",
      [accountId],
    );
    let destroyClient = false;
    try {
      return await fn(lockedDb);
    } finally {
      // Release the session-level advisory lock. If this fails or reports
      // unlocked=false, destroy the connection so the lock cannot leak.
      try {
        const result = await client.query(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
          [accountId],
        );
        if ((result.rows as Array<{ unlocked: boolean }>)[0]?.unlocked !== true) {
          destroyClient = true;
        }
      } catch {
        destroyClient = true;
      }
      client.release(destroyClient);
    }
  } catch (err) {
    // pg_advisory_lock itself failed (rare — network, server restart, etc.).
    // The connection has not been released yet; destroy it.
    client.release(true);
    throw err;
  }
}
```

**3. `apps/api/src/modules/credit/services/reconciliation-writes.ts`**

Add import at the top (with the existing imports):
```typescript
import { withAccountAdvisoryLock } from "../../../lib/account-lock.ts";
```

Wrap the existing `withSerializableRetry(...)` call with `withAccountAdvisoryLock`:

BEFORE (lines ~239-424):
```typescript
const { dto, createdAt } = await withSerializableRetry(() =>
  db.transaction(
    async (tx) => {
      // ... entire callback unchanged ...
    },
    { isolationLevel: "serializable" },
  ),
);
```

AFTER:
```typescript
const { dto, createdAt } = await withAccountAdvisoryLock(db, accountId, (lockedDb) =>
  withSerializableRetry(() =>
    lockedDb.transaction(
      async (tx) => {
        // ... entire callback UNCHANGED — every tx.select(), tx.execute(), tx.insert() stays as-is ...
      },
      { isolationLevel: "serializable" },
    ),
  ),
);
```

The `db` references INSIDE the callback (there are none — everything uses `tx`) are unaffected. The post-commit `repairSnapshots(db, redis, userId, from)` call stays outside the `withAccountAdvisoryLock` call and uses the original pool-backed `db`. Do NOT change any line inside the `async (tx) => { ... }` callback.

**4. `apps/api/src/modules/ledger/services/accounts.ts`**

Add import (near the top with existing imports):
```typescript
import { withAccountAdvisoryLock } from "../../../lib/account-lock.ts";
```

Wrap `updateAccount`'s `db.transaction(...)` call with `withAccountAdvisoryLock`:

BEFORE (line ~363):
```typescript
return db.transaction(async (tx) => {
  // ... entire callback unchanged ...
});
```

AFTER:
```typescript
return withAccountAdvisoryLock(db, id, (lockedDb) =>
  lockedDb.transaction(async (tx) => {
    // ... entire callback UNCHANGED — every tx.select(), tx.update(), tx.insert() stays as-is ...
  }),
);
```

The `id` here is the account UUID parameter (`updateAccount`'s second parameter after `userId`). No `withSerializableRetry` needed — `updateAccount` stays READ COMMITTED. Do NOT add `{ isolationLevel: "serializable" }`. Do NOT change any line inside the `async (tx) => { ... }` callback.

**5. `apps/api/src/modules/credit/services/reconciliation-writes.test.ts`**

This file ALREADY has D11b changes (re-dating SQL in the "Diners-shaped" test). Add D11c changes to the concurrent-lock test (lines 653-738):

Replace the ENTIRE "Connection A" block (from the comment at ~line 667 to the `aTxPromise` declaration/close, inclusive) with the advisory-lock-based version. The test's overall structure (gate pattern, 250ms check, `release.release() → await aTxPromise → await absorbPromise`) stays the same.

Before (connection A block):
```typescript
  // Connection A: locks the account row the same way updateAccount does
  // before its own opening-balance edit, holds it open, then commits a
  // change — while a concurrent absorb is blocked waiting for that same lock.
  const aTxPromise = db.transaction(async (tx) => {
    await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .for("update");
    started.release();
    await release.opened;
    // Mutate opening balance through the production path — same mechanism createAccount
    // and absorbCarryover use — so postings-based readers (ledgerDuesAtDates) see it.
    // A direct accounts.opening_balance_paise column write would be invisible after
    // PR-G1: the boot check (assertNoLegacyShapes) freezes that column at 0, and every
    // balance surface reads from postings only.
    const [openingTxn] = await tx
      .insert(transactions)
      .values({
        userId,
        accountId,
        date: new Date().toISOString().slice(0, 10),
        amountPaise: -50000,
        merchant: "Opening balance",
        isOpening: true,
      })
      .returning({ id: transactions.id });
    const sys = await resolveSystemAccounts(tx, userId);
    await postTransaction(
      tx,
      openingTxn!.id,
      userId,
      buildOpeningPostings({ accountId, amountPaise: -50000, systemOpeningAccountId: sys.opening }),
    );
  });
```

After (connection A block — use advisory lock, matching the updated updateAccount behavior):
```typescript
  // Connection A: acquires the same account advisory lock that the updated updateAccount
  // uses, holds it open, then commits an opening transaction before releasing — while a
  // concurrent absorbCarryover is blocked at pg_advisory_lock waiting for that same lock.
  // The opening transaction is inserted via the pool (a separate connection) so it commits
  // before the advisory lock is released; absorbCarryover's fresh SERIALIZABLE snapshot
  // therefore includes it.
  const aTxPromise = (async () => {
    const clientA = await pool.connect();
    try {
      await clientA.query(
        "SELECT pg_advisory_lock(hashtextextended($1, 0))",
        [accountId],
      );
      started.release();
      await release.opened;
      // Mutate opening balance through the production path — same mechanism createAccount
      // and absorbCarryover use — so postings-based readers (ledgerDuesAtDates) see it.
      await db.transaction(async (tx) => {
        const [openingTxn] = await tx
          .insert(transactions)
          .values({
            userId,
            accountId,
            date: new Date().toISOString().slice(0, 10),
            amountPaise: -50000,
            merchant: "Opening balance",
            isOpening: true,
          })
          .returning({ id: transactions.id });
        const sys = await resolveSystemAccounts(tx, userId);
        await postTransaction(
          tx,
          openingTxn!.id,
          userId,
          buildOpeningPostings({ accountId, amountPaise: -50000, systemOpeningAccountId: sys.opening }),
        );
      });
      // Release advisory lock. The opening transaction above committed on the pool, so
      // absorbCarryover's SERIALIZABLE snapshot (taken after lock acquisition) includes it.
      const unlockResult = await clientA.query(
        "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
        [accountId],
      );
      assert.equal(
        (unlockResult.rows as Array<{ unlocked: boolean }>)[0]?.unlocked,
        true,
        "advisory unlock must report success",
      );
    } finally {
      clientA.release();
    }
  })();
```

Also update the test name and the assertion message at line 716 to replace "account-row lock" with "advisory lock":

Test name change (line 653):
```
"absorbCarryover: a concurrent account-row lock (an opening-balance edit in progress) blocks absorb until it commits — the final state matches a serial order"
```
→
```
"absorbCarryover: a concurrent advisory lock (an opening-balance edit in progress via updateAccount's new protocol) blocks absorb until it commits — the final state matches a serial order"
```

Assertion message change (line 716):
```
"absorb should still be blocked on A's held account-row lock"
```
→
```
"absorb should still be blocked on A's held advisory lock"
```

No other changes to this test (expected values dueDriftPaise=0, openingPostings.length=1, amount=-150000 are unchanged). No changes to the two SSI tests (lines 776-892).

## Files and Symbols

New:
- `apps/api/src/lib/account-lock.ts` — `withAccountAdvisoryLock`

Modified:
- `apps/api/src/db/index.ts` — `Db` type, `createDb` return cast
- `apps/api/src/modules/credit/services/reconciliation-writes.ts` — `absorbCarryover` outer wrapper
- `apps/api/src/modules/ledger/services/accounts.ts` — `updateAccount` outer wrapper
- `apps/api/src/modules/credit/services/reconciliation-writes.test.ts` — concurrent-lock test + stage existing D11b changes
- `apps/api/src/modules/ingest/services/inbox.test.ts` — stage existing D11a change (no code change needed)
- `apps/api/src/modules/credit/services/card-due-tasks.test.ts` — already staged, no additional changes

## Required Changes

1. `db/index.ts`: Add `& { readonly $client: pg.Pool }` to `Db` type; add `as unknown as Db` cast in `createDb`
2. `account-lock.ts` (new): full implementation as specified above
3. `reconciliation-writes.ts`: import + wrap `withSerializableRetry` with `withAccountAdvisoryLock`
4. `accounts.ts`: import + wrap `updateAccount`'s `db.transaction` with `withAccountAdvisoryLock`
5. `reconciliation-writes.test.ts`: update concurrent-lock test connection A block; keep SSI tests unchanged
6. Stage `inbox.test.ts` (already correct) and all other modified files

## Must Not Change

- The `async (tx) => { ... }` callback body inside `absorbCarryover` — zero changes there
- The `async (tx) => { ... }` callback body inside `updateAccount` — zero changes there
- The two SSI tests (reconciliation-writes.test.ts lines 776-892) — zero changes
- `withSerializableRetry` itself (`lib/serializable.ts`) — zero changes
- Any file outside the listed scope
- `pnpm-lock.yaml` or `tasks/` files

## Acceptance Criteria

- AC1: `npm run typecheck` exits 0 (the `Db` type update must satisfy all call sites)
- AC2: `npm run lint` exits 0
- AC3: `git status` shows exactly: modified `db/index.ts`, `reconciliation-writes.ts`, `accounts.ts`, `reconciliation-writes.test.ts`, `inbox.test.ts`, `card-due-tasks.test.ts`; and one new untracked `lib/account-lock.ts` (now tracked after staging); no other files
- AC4: The `withAccountAdvisoryLock` function correctly acquires the lock BEFORE calling `fn`, and releases in finally with `destroyClient` on failure
- AC5: The concurrent-lock test uses `pool.connect()` + `pg_advisory_lock(hashtextextended...)` for connection A, with `try/finally` around `clientA.release()`
- AC6: No change inside `absorbCarryover`'s or `updateAccount`'s `async (tx) => { ... }` callbacks

## Commands

1. Read the current state of each file before editing (to confirm local changes are present)
2. Implement the 5 changes + 1 new file
3. Stage all 6 modified/new files (including the already-correct `inbox.test.ts`)
4. Run `npm run typecheck -w apps/api` and capture literal output + exit code
5. Run `npm run lint` and capture literal output + exit code

## Required Evidence

- Confirmation that D11a (inbox.test.ts) is already correctly modified (no categoryId assertion, test name correct) — show the test declaration line and the lines around 1214-1221
- Confirmation that D11b (reconciliation-writes.test.ts "Diners-shaped", card-due-tasks.test.ts AC15) re-dating SQL is present
- Complete diff for all 6 files (git diff HEAD -- <file> after staging)
- `npm run typecheck` literal output and exit code
- `npm run lint` literal output and exit code
- `git status` after staging
- Any deviations from this plan with justification
