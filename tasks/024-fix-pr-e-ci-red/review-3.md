## Verdict: amendment required

Your refutation is correct. The literal output in `implementation-B.md:247-249` fails at `reconciliation-writes.test.ts:728` with `hookCalls` equal to 1. Execution never reaches the `-350000` assertion at line 734, so `-400000` was not observed.

D7’s diagnosis and SSI construction are sound, but P8 has one material defect: updating only the real posting leaves the posting family unbalanced. Amend P8 to update both existing posting legs while preserving the real-leg SSI conflict.

### Diagnosis

1. The raw seeds create no postings.

The seeds at [reconciliation-writes.test.ts:690](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.test.ts:690) and line 742 bypass `createTransaction`.

There is no posting-creation trigger. The migrations define only the deferred split-sum triggers at [0002_fts-and-split-check.sql:32](/home/udai/common/compass/apps/api/drizzle/0002_fts-and-split-check.sql:32). The postings migration defines foreign keys and indexes, not triggers, at [0067_illegal_shocker.sql:15](/home/udai/common/compass/apps/api/drizzle/0067_illegal_shocker.sql:15). Investigation 3’s real-database probe found zero posting rows.

`createTransaction` performs the actual dual-write at [transactions.ts:407](/home/udai/common/compass/apps/api/src/modules/ledger/services/transactions.ts:407), including both posting drafts and `replacePostings`.

2. The aggregate reads postings, with no `system_kind` predicate.

At [reconciliation-reads.ts:124](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-reads.ts:124), the query reads `p.amount_paise` and applies:

- `p.account_id = accountId`
- `t.user_id = userId`
- `t.deleted_at is null`
- `t.date < statementDate`
- inner join on `t.id = p.transaction_id`

There is no `system_kind` predicate and postings have no `deleted_at`. The counter-leg is excluded because its `account_id` is a system account, not the requested card account.

3. The missing SSI edge is the true failure mechanism.

Connection A reads `postings`; connection B currently writes only `transactions.amount_paise` at [reconciliation-writes.test.ts:715](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.test.ts:715). Those accesses do not conflict, so there is no A→B read/write anti-dependency, no cycle, no `40001`, and no retry.

The observed results—`hookCalls === 1` in the first test and “Missing expected rejection” in the second—match this mechanism exactly.

4. Both tests are currently vacuous as serialization-retry tests.

They execute the hook, but no longer construct the dependency cycle their names and comments claim. Amendment 2 correctly identifies this as lost test coverage.

### Claim (c): PostgreSQL locking

The narrow locking claim is correct.

An update whose `SET` list contains only `amount_paise` does not invoke the foreign-key check triggers for `account_id` or `transaction_id`. Therefore it does not acquire a foreign-key `FOR KEY SHARE` lock on either referenced account or transaction row.

Additional considerations do not change that:

- `postings.account_id` is indexed at [ledger.ts:150](/home/udai/common/compass/apps/api/src/db/shared/ledger.ts:150), but it is not modified.
- `amount_paise` is not indexed, so the update may be HOT. HOT affects tuple/index maintenance, not FK checking or SSI conflict detection.
- No repository migration defines a trigger on `postings`.
- Updating the existing counter-leg’s `amount_paise` is equally safe because its `account_id` remains unchanged.
- The deferred transaction split trigger at [0002_fts-and-split-check.sql:37](/home/udai/common/compass/apps/api/drizzle/0002_fts-and-split-check.sql:37) may run because `transactions.amount_paise` is updated, but it reads transaction splits; it does not lock `accounts`.

Do not use `rebuildPostingsForTransaction` inside B. It deletes and reinserts postings at [post-entry.ts:68](/home/udai/common/compass/apps/api/src/modules/ledger/services/post-entry.ts:68), and the inserts would perform FK checks. Direct updates of the existing rows are the safe construction.

### Blocking defect in P8

P8 says to update only the matching real-leg posting. That produces:

- transaction: `-150000`
- real posting: `-150000`
- counter posting: still `+100000`

The committed posting family then sums to `-50000`, violating the zero-sum model explicitly enforced by `buildOrdinaryPostings` at [postings.ts:98](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.ts:98) and D5b’s full-family requirement.

The safer construction is:

- Keep the legacy `transactions.amount_paise` update.
- Update both existing postings for the transaction.
- Set the card-account leg to the new amount and the other leg to its negation.
- Assert that exactly two posting rows were updated, or otherwise assert the resulting family is zero-sum.

For example, use an `UPDATE postings ... SET amount_paise = CASE WHEN account_id = accountId THEN newAmount ELSE -newAmount END WHERE transaction_id = seed.id`, with `.returning()` and an assertion that it updated two rows. This neither changes nor places any FK column in the `SET` list.

### SSI reliability

Updating the existing real-leg posting restores a genuine, deterministic cycle:

- A reads the card posting.
- B reads the account row.
- B updates and commits the card posting: A→B anti-dependency.
- A later updates the account row: B→A anti-dependency.
- A must abort with `40001`; B has already committed before the second edge is formed.

The query plan does not make this flaky. Under `SERIALIZABLE`, PostgreSQL registers `SIREAD` predicate locks for both index and sequential scans. An index scan may register tuple/page/range locks; a sequential scan can promote to a broader relation lock. Broader locking creates at least the same relevant conflict, not fewer conflicts. Because B updates the exact existing posting qualifying under `p.account_id = accountId`, the required conflict remains present under either plan.

### Arithmetic

`createTransaction` creates:

- card leg: `-100000`
- Expenses counter-leg: `+100000`

Only the card leg qualifies for the aggregate.

First test:

- First A reads sum `-100000`.
- B commits card leg `-150000` and counter-leg `+150000`.
- First A aborts.
- Retry reads sum `-150000`.
- Ledger due = `-(0 + -150000) = 150000`.
- Drift = `500000 - 150000 = 350000`.
- New opening balance = `0 - 350000 = -350000`.

Second test:

- B reconstructs the cycle on both attempts.
- Both A attempts abort with `40001`.
- Neither account update commits.
- `hookCalls === 2`.
- Opening balance remains exactly `0`.

Thus all four AC12 expectations remain unchanged.

### Production-writer audit

I found no normal production writer that changes `transactions.amount_paise` without rebuilding the postings in the same transaction:

- Manual update rebuilds at [transactions.ts:491](/home/udai/common/compass/apps/api/src/modules/ledger/services/transactions.ts:491) and line 502.
- Statement-import corrections rebuild at [imports.ts:655](/home/udai/common/compass/apps/api/src/modules/ingest/services/imports.ts:655) and line 725.
- Import rollback rebuilds at [imports.ts:915](/home/udai/common/compass/apps/api/src/modules/ingest/services/imports.ts:915) and line 932.
- Opening-balance transaction updates rebuild at [accounts.ts:477](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:477) and line 487.

Other direct transaction updates found change header-only fields such as merchant, SIP linkage, reconciliation linkage, or soft-deletion and therefore correctly do not alter posting amounts.

Consequently, there is no production analogue of this particular “amount changed but existing posting left stale” defect. The separately documented restore/reconciliation path that can leave postings absent remains a real production issue, but it is not this failure mechanism and does not invalidate D7’s test-side ruling.

### Scope and tests

No additional production file needs to enter Amendment 2’s implementation scope. P8 will need the `postings` schema import in `reconciliation-writes.test.ts`.

AC12 should additionally require that each B transaction leaves the two postings balanced, ideally by checking that exactly two existing postings were updated. That prevents the repaired concurrency test from manufacturing a different invalid ledger shape.

Subject to changing P8 from “update the real leg only” to “update both existing legs, with the real leg carrying the conflict,” Amendment 2 is sound.