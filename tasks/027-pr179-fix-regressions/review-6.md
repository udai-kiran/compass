## Review verdict

The approach is sound and preserves the SSI behavior, but the plan needs two corrections before implementation:

1. `Db` currently does not expose `$client` at the TypeScript level.
2. A failed unlock must destroy the pooled connection, not return it normally.

## Findings

### 1. Drizzle `$client` and `PoolClient` support

`apps/api/package.json` uses:

- `drizzle-orm` `^0.45.2` (installed version: `0.45.2`)
- `pg` `^8.22.0`

Drizzle 0.45.2 does assign `$client` at runtime. Its `drizzle()` return type is an intersection containing `$client`.

It also explicitly accepts:

```ts
type NodePgClient = pg.Pool | PoolClient | Client;
```

Therefore:

```ts
drizzle(client, { schema })
```

with a `pg.PoolClient` works correctly. Drizzle recognizes that it is not a pool and runs `BEGIN`, transaction statements, and `COMMIT` directly on that dedicated client without acquiring another connection.

However, the application currently erases the `$client` property:

```ts
export type Db = NodePgDatabase<typeof schema>;
```

`NodePgDatabase` itself does not declare `$client`; only the return type of `drizzle()` does. Consequently, a helper accepting `db: Db` and accessing `db.$client` should fail type-checking even though the property exists at runtime.

The plan must update the type, for example by defining `Db` as the appropriately typed `drizzle()` result or explicitly intersecting it with `{ $client: pg.Pool }`. The helper should require a pool-backed database specifically—not merely any `NodePgDatabase`.

It would also be prudent to validate that `$client` is a `pg.Pool` before calling `connect()`, producing a clear error rather than an obscure method failure.

### 2. Schema and locked database type

[db/index.ts](/home/udai/common/compass/apps/api/src/db/index.ts) imports:

```ts
import * as schema from "./schema.ts";
```

and defines:

```ts
export type Db = NodePgDatabase<typeof schema>;
```

Using the same schema import in `account-lock.ts`:

```ts
import * as schema from "../db/schema.ts";
const lockedDb = drizzle(client, { schema });
```

produces `NodePgDatabase<typeof schema>` plus a `$client: PoolClient` intersection. It is structurally compatible with the current `Db` database surface.

A cleaner option is to export the existing `schema` namespace from `db/index.ts`—which it already does—and import it from there, avoiding two independent-looking schema import paths.

### 3. First SSI retry test

The hook at lines 776–837 runs:

```ts
await db.transaction(..., { isolationLevel: "serializable" });
```

It does not call `updateAccount`, `absorbCarryover`, or the proposed advisory-lock helper. Connection B therefore bypasses the advisory lock and remains concurrent with absorbCarryover’s transaction.

The expected sequence remains valid:

- absorbCarryover holds the session advisory lock.
- Attempt 1 starts a SERIALIZABLE transaction and reads postings.
- The hook runs B through the pool on another connection.
- B reads the account and updates the transaction/postings.
- The SSI dependency cycle aborts absorbCarryover with `40001`.
- Drizzle rolls the failed transaction back.
- `withSerializableRetry` starts another SERIALIZABLE transaction on the same dedicated, still-advisory-locked client.
- The second hook invocation is inert.
- Attempt 2 sees B’s committed postings.

Thus `hookCalls === 2` and the `-350000` opening posting expectation remain correct.

### 4. “Both attempts fail” SSI test

This hook likewise uses plain pool-backed `db.transaction()` and never acquires the advisory lock.

It recreates the SSI cycle on both attempts. `withSerializableRetry` retries exactly once, so:

- `assert.rejects(... code === "40001")` remains correct.
- `hookCalls === 2` remains correct.
- Neither failed absorb transaction commits its opening-balance change.
- B’s independent posting changes do commit, as they already do today.

### 5. `updateAccount` callback scope

The entire production operation currently lives in one transaction callback:

- account `FOR UPDATE`
- ownership/system-account validation
- SIP source and target guards
- goal eligibility and earmark handling
- owned-goal validation
- bank-account last-four validation
- existing opening-transaction lookup
- earliest transaction lookup
- opening-balance reconciliation and planning
- opening transaction insert/update/delete
- postings generation
- account field, archive, and opening-column update
- retirement-detail cleanup after type conversion
- DTO conversion

Wrapping the existing callback as:

```ts
withAccountAdvisoryLock(db, id, (lockedDb) =>
  lockedDb.transaction(async (tx) => {
    // unchanged body
  }),
)
```

keeps all of it inside the same READ COMMITTED transaction on the locked connection.

The existing row lock should remain. It still coordinates with SIP operations and other code that does not use the advisory-lock protocol.

### 6. `absorbCarryover` callback scope

The entire relevant operation currently resides inside the SERIALIZABLE callback:

- account and reconciliation row locks
- `ledgerDuesAtDates`
- `hooks?.afterAggregate?.()`
- drift calculation
- existing opening-transaction and posting reads
- `planOpeningBalanceChange`
- opening transaction insert/update/delete
- posting creation/replacement
- post-change `ledgerDuesAtDates`
- returned reconciliation DTO construction

Wrapping the existing `withSerializableRetry` and transaction without moving this body preserves the required behavior. In particular, `hooks?.afterAggregate?.()` remains inside each SERIALIZABLE attempt and therefore fires twice when a retry occurs.

The post-commit `repairSnapshots(db, ...)` correctly remains outside the advisory lock and uses the original pool-backed database.

### 7. Callers and `DbOrTx`

Both public functions accept `Db`, not `DbOrTx`.

Observed production callers are:

- `updateAccount(app.db, ...)` from the accounts route
- `absorbCarryover(app.db, ...)` from the cards route

The test callers likewise pass the pool-backed `db`. No caller passes an in-progress transaction handle.

Therefore the proposed change does not currently break a valid nested-transaction call path. The helper should nevertheless accept only the newly defined pool-backed database type. Allowing `DbOrTx` would be incorrect because a Drizzle transaction does not expose a pool from which to reserve an independent session.

### 8. Advisory-lock cleanup

Normal operation is safe:

- The same `PoolClient` acquires and releases the session lock.
- Drizzle uses that client directly.
- SERIALIZABLE retries occur on that same session.
- A lost database connection automatically releases its PostgreSQL session locks.

The proposed unconditional normal `client.release()` after an unlock failure is not safe.

A session advisory lock survives transaction rollback and normal return to the pool. The 30-second idle timeout does not make this acceptable:

- The same client may immediately be checked out for unrelated work.
- Reacquiring the same advisory lock on that session is reentrant and increments its hold count.
- A later single unlock would decrement only one acquisition, leaving the leaked lock held.
- Idle eviction is not guaranteed promptly while the client remains active.

Cleanup should track unlock failure and destroy the client:

```ts
let destroyClient = false;
try {
  return await fn(lockedDb);
} finally {
  try {
    const result = await client.query(
      "select pg_advisory_unlock(hashtext($1)::bigint) as unlocked",
      [accountId],
    );
    if (result.rows[0]?.unlocked !== true) destroyClient = true;
  } catch {
    destroyClient = true;
  }
  client.release(destroyClient);
}
```

The original `fn` error should generally remain the primary error. If `fn` succeeds but unlock fails, the helper should surface the unlock failure after destroying the client.

The concurrency test’s raw client should also use `try/finally`; otherwise an assertion or insert failure can leak the lock and hang subsequent tests.

### 9. Pool configuration

[infra/db.ts](/home/udai/common/compass/apps/api/src/infra/db.ts) configures:

```ts
connectionTimeoutMillis: 3000,
max: 10,
idleTimeoutMillis: 30_000,
```

A dedicated lock holder consumes one pool connection for the duration of the wait and transaction. Advisory-lock waiters also consume connections while blocked. With ten same-account callers, the pool can be fully occupied, although the current lock holder’s transaction is self-contained and can ordinarily finish, releasing the next waiter.

One test-specific caveat is that `afterAggregate` opens connection B from the pool. With ordinary test concurrency there is ample capacity, but if nine advisory-lock waiters were also present, the hook could be starved. That does not invalidate the planned tests or production flow, but it is an inherent disadvantage of blocking session locks on pooled connections.

### 10. PostgreSQL and `hashtext`

CI uses PostgreSQL 18:

```yaml
image: postgres:18
```

`hashtext(text)` and advisory locks are available there and have existed for many older PostgreSQL releases, so compatibility with the repository’s declared target is not a concern.

The more relevant issue is key width: `hashtext` returns a 32-bit integer, and casting it to `bigint` does not increase its entropy. Different account UUIDs can collide and serialize unnecessarily. A collision does not compromise correctness, but it can create surprising cross-account contention.

Prefer a 64-bit key where available, such as:

```sql
pg_advisory_lock(hashtextextended($1, 0))
```

with the matching unlock expression. PostgreSQL 18 supports it. If broad compatibility with very old, otherwise unspecified PostgreSQL versions matters, `hashtext` remains functionally safe.

## Test-plan assessment

Changing the concurrent-lock test to acquire the same advisory lock before committing the opening transaction correctly reproduces the stale-snapshot boundary:

- absorbCarryover cannot start its SERIALIZABLE transaction until the session lock is released.
- Connection A commits its separate transaction before unlocking.
- absorbCarryover’s first data snapshot therefore includes the `-50000` opening posting.
- It updates that single opening transaction to `-150000`.
- The expected zero drift and exactly one opening posting remain correct.

The test should acquire, unlock, and release the raw client in `try/finally`, and should verify the unlock returned `true`.

One coverage weakness remains: the revised test manually imitates the advisory-lock protocol rather than invoking `updateAccount`. It validates absorbCarryover’s lock acquisition and snapshot timing, but not that `updateAccount` actually participates in the same protocol. An additional integration test using concurrent `updateAccount(..., { openingBalancePaise: ... })` would protect the production pairing from a future accidental removal of either wrapper.

## Recommendation

Approve the design after these changes:

- Preserve `$client` in the exported pool-backed `Db` type.
- Restrict `withAccountAdvisoryLock` to that pool-backed type.
- Destroy the client on unlock failure or an unexpected `unlocked = false`.
- Use `try/finally` in the revised concurrency test.
- Prefer a 64-bit advisory key to reduce collisions.
- Keep the existing row locks and both SERIALIZABLE SSI tests unchanged.
- Ideally add a production-path concurrency test using `updateAccount` directly.