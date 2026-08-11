## Review result: changes required

### High-severity finding

[account-lock.ts](/home/udai/common/compass/apps/api/src/lib/account-lock.ts:35) can release the pool client twice.

When `fn(lockedDb)` throws:

1. The inner `finally` unlocks and releases the client at line 58.
2. The error then reaches the outer `catch`.
3. Line 63 calls `client.release(true)` again.
4. `pg-pool` throws “Release called on client which has already been released to the pool,” masking the original application error.

The outer `catch` must cover only advisory-lock acquisition, or track whether the client has already been released.

## Specific questions

1. `pool.connect()` failures

The outer `catch` does **not** catch `pool.connect()` failures because `await pool.connect()` is at line 31, before the `try` begins. This is safe: no client was obtained, so none needs releasing. The comment claiming that the catch covers only `pg_advisory_lock` is effectively correct, but the catch currently also catches `fn`, unlock, and release failures.

Advisory-lock acquisition failure does correctly destroy the obtained client.

`destroyClient` is correctly set when unlock throws or returns anything other than `unlocked === true`.

2. Comment in `reconciliation-writes.ts`

The comment at lines 244–246 is stale. Serialization between `absorbCarryover` and `updateAccount` now comes primarily from the shared advisory lock, not because both lock the same row “the same way.”

The row lock still serializes against non-advisory-lock participants, but the comment should distinguish those responsibilities.

3. Existing `FOR UPDATE` in `accounts.ts`

It still serves an important purpose. SIP creation/update uses `lockedAccountForSip`, which takes the same account-row `FOR UPDATE` lock but does not acquire the advisory lock. Keeping this lock preserves the SIP/account-edit TOCTOU protection.

It is redundant only for operations already participating in the advisory-lock protocol, such as another `updateAccount` or `absorbCarryover`.

4. Test pool capacity

No pool exhaustion is expected:

- `clientA`: one checked-out connection holding the advisory lock.
- `clientB`: one checked-out connection blocked acquiring it.
- After `release.release()`, the test’s opening-transaction write needs a third connection.
- The configured pool maximum is 10.

Peak demand is approximately three connections, comfortably below the limit.

5. `DbOrTx`

`DbOrTx` remains a valid union. The intersection adds `$client` without changing the inherited `transaction` method, so extracting its callback argument type through `Db["transaction"]` still works.

The API typecheck passes.

## Per-file compliance

- `db/index.ts`: Correct and plan-compliant. `$client` is exposed as `pg.Pool`; `createDb` uses the specified cast.
- `account-lock.ts`: Structurally follows the plan, but has the double-release error described above.
- `reconciliation-writes.ts`: Wrapping and serializable retry ordering are correct. The transaction callback has no substantive changes; only wrapping/indentation changed. `repairSnapshots(db, ...)` remains outside the advisory lock. The row-lock comment needs updating.
- `accounts.ts`: Correct wrapping. The callback body is substantively unchanged. No serializable isolation or retry was added.
- `reconciliation-writes.test.ts`: Advisory-lock test follows the prescribed structure, uses a separate pooled transaction for the insert, checks unlock success, and updates the name/message. The two SSI tests are unchanged.
- `transactions.ts`: Changing `getTransaction` from `Db` to `DbOrTx` is the minimal correct type fix. It only performs queries/hydration and does not require pool access, so the broader parameter type is safe.

One type-model caveat: the dedicated-client Drizzle instance is cast to `Db`, although its runtime `$client` is a `PoolClient`, not a `Pool`. Current callbacks only call `transaction`, so this is safe in present usage, but the type would permit incorrectly nesting `withAccountAdvisoryLock(lockedDb, ...)`.