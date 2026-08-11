# Sonnet Worker Delegation — D11d

## Task
027-pr179-fix-regressions — Fix concurrent-lock test advisory-lock leak

## Approved Plan
Change exactly the `aTxPromise` IIFE inside the test named:
"absorbCarryover: a concurrent advisory lock (an opening-balance edit in
progress via updateAccount's new protocol) blocks absorb until it commits..."

Current structure (lines ~673-718 of reconciliation-writes.test.ts):
```
const aTxPromise = (async () => {
  const clientA = await pool.connect();
  try {
    await clientA.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [accountId]);
    started.release();
    await release.opened;
    await db.transaction(async (tx) => { ... });
    const unlockResult = await clientA.query("SELECT pg_advisory_unlock(...)");
    assert.equal((unlockResult.rows...)[0]?.unlocked, true, "advisory unlock must report success");
  } finally {
    clientA.release();
  }
})();
```

Bug: if `db.transaction` throws, `pg_advisory_unlock` is never called (it's in the try
block, not finally). `clientA.release()` returns the connection to the pool with the
advisory lock still held on the session.

Fix: restructure to mirror `account-lock.ts`'s production pattern — unlock in finally,
destroy the client if unlock fails:

```
const aTxPromise = (async () => {
  const clientA = await pool.connect();
  let unlocked = false;
  let destroyA = true; // default: destroy unless we successfully unlock
  try {
    await clientA.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [accountId]);
    started.release();
    await release.opened;
    await db.transaction(async (tx) => { ... }); // UNCHANGED body
  } finally {
    try {
      const unlockResult = await clientA.query(
        "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
        [accountId],
      );
      unlocked = (unlockResult.rows as Array<{ unlocked: boolean }>)[0]?.unlocked === true;
      destroyA = !unlocked;
    } catch {
      destroyA = true;
    }
    clientA.release(destroyA);
  }
  // assert after finally so cleanup always runs even if assertion fails
  assert.equal(unlocked, true, "advisory unlock must report success");
})();
```

## Files and Symbols
- `apps/api/src/modules/credit/services/reconciliation-writes.test.ts`
  - The `aTxPromise` IIFE in the concurrent advisory-lock test (line ~673-718)
  - No other changes to this file, no other files

## Required Changes
- Move `pg_advisory_unlock` query + result check to a `finally` block
- Add `let unlocked = false; let destroyA = true;` before the try
- Set `unlocked` and `destroyA` from the unlock result in finally
- Call `clientA.release(destroyA)` in finally (not `clientA.release()`)
- Move `assert.equal(unlocked, true, "advisory unlock must report success")` to AFTER the
  finally block (inside the IIFE but after the try/finally, so it only runs on success path)
- The `db.transaction` body (lines 684-703) must remain completely unchanged
- The advisory lock acquisition query (`pg_advisory_lock`) remains at the top of the try block

## Must Not Change
- Any other test in the file
- Any production file (`reconciliation-writes.ts`, `accounts.ts`, `account-lock.ts`, etc.)
- The `db.transaction` body inside `aTxPromise` (lines 684-703)
- pnpm-lock.yaml or tasks/ files

## Acceptance Criteria
- AC1: `pg_advisory_unlock` runs in the `finally` block
- AC2: `clientA.release(destroyA)` is called in `finally` where `destroyA = true`
  when unlock throws or returns `unlocked !== true`
- AC3: `assert.equal(unlocked, true, ...)` is present AFTER the `finally`
- AC4: `db.transaction` body unchanged
- AC5: `npm run typecheck` exits 0 (run from repo root)
- AC6: `npm run lint` exits 0 (run from repo root)

## Commands
1. Read `apps/api/src/modules/credit/services/reconciliation-writes.test.ts` lines 650-760
2. Apply the targeted edit to the `aTxPromise` IIFE only
3. Run `npm run typecheck` from `/home/udai/common/compass`
4. Run `npm run lint` from `/home/udai/common/compass`

## Required Evidence
- complete diff of the changed IIFE
- exact `npm run typecheck` output + exit code
- exact `npm run lint` output + exit code
- confirm no other tests in the file were touched (`git diff --stat`)
