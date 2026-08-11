## Findings

- **Important — the concurrency test can leak a session advisory lock into the pool.** In [reconciliation-writes.test.ts](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.test.ts:673), unlocking occurs only on the success path. If the opening transaction setup, unlock query, or unlock assertion throws, `finally` calls `clientA.release()` without unlocking or destroying the client. The session lock then survives pool reuse and can hang later tests. The test should unlock in `finally`, and destroy the client when successful unlock cannot be confirmed.

- **Important — `lockedDb` is falsely typed as pool-backed `Db`.** [account-lock.ts](/home/udai/common/compass/apps/api/src/lib/account-lock.ts:34) constructs Drizzle over a `pg.PoolClient` but casts it to `Db`, whose `$client` is declared as `pg.Pool` in [db/index.ts](/home/udai/common/compass/apps/api/src/db/index.ts:5). At runtime, `$client` is a `PoolClient`, not a `Pool`. This permits unsafe code such as passing `lockedDb` back to `withAccountAdvisoryLock`, which would attempt nonexistent `PoolClient.connect()`. The callback should receive a transaction-capable type that does not claim a pool `$client`, rather than `Db`.

- **Minor — the acquisition try/catch does not cover `pool.connect()`, contrary to D11c’s stated structure.** [account-lock.ts](/home/udai/common/compass/apps/api/src/lib/account-lock.ts:31) awaits `pool.connect()` before entering the acquisition try at line 38. A rejected connection request does not itself leak a checked-out client, so this is not presently a double-release bug, but it does not meet the explicitly requested “pool.connect + advisory-lock acquisition” try/catch boundary.

- **Test gap — the concurrent-lock test does not exercise `updateAccount`.** It manually acquires the lock and manually inserts an opening transaction. This verifies that `absorbCarryover` waits and takes a fresh snapshot, but it would still pass if `updateAccount` stopped using the advisory-lock helper. TASK.md records the real `updateAccount` integration test as deferred F11, so this is an acknowledged rather than accidental gap.

No double-release path exists in the production helper: acquisition failure releases once, while the separate `fn`/unlock `finally` releases once. Unlock failure correctly sets `destroyClient=true` before release.

## Criteria assessment

- D11a is correct: the test name and legacy `categoryId` equality assertion were removed, while the real transfer-shape invariant remains asserted through `postings.categoryId === null`.
- D11b is correct and scoped: exactly two targeted `UPDATE transactions SET date='2020-01-01'` statements exist, immediately after the relevant account creation. No global helper behavior changed.
- D11c’s production wiring is otherwise correct:
  - `Db` has the readonly pool intersection.
  - `hashtextextended(..., 0)` is used on a dedicated connection.
  - `fn` and its transaction run on that connection.
  - `absorbCarryover` and `updateAccount` are wrapped.
  - `repairSnapshots` remains outside the lock and uses the original `db`.
  - `getTransaction` accepts `DbOrTx`.
- `npm run typecheck` passes, but the `unknown as Db` casts conceal the runtime `$client` mismatch described above.