## Review verdict

The timestamp fix is sound. The fixture-only ruling is not sufficiently justified because production can contain transactions without postings after a failed restore reconciliation.

### BLOCKER — E5 is false, so D4 is incomplete

A per-user restore commits transaction rows before rebuilding postings:

- Database commit: [restore-user.ts:184](/home/udai/common/compass/apps/api/src/modules/system/services/restore-user.ts:184)
- Posting reconciliation happens afterward: [restore-user.ts:200](/home/udai/common/compass/apps/api/src/modules/system/services/restore-user.ts:200)
- Reconciliation failure is swallowed and reported, leaving committed transactions intact: [restore-user.ts:203](/home/udai/common/compass/apps/api/src/modules/system/services/restore-user.ts:203)

The corresponding test explicitly verifies that behavior at `backup.test.ts:1181-1259`.

Boot reconciliation does not restore the invariant absolutely either: per-row failures are collected and startup continues ([reconcile-postings.ts:85](/home/udai/common/compass/apps/api/src/modules/ledger/services/reconcile-postings.ts:85), [app.ts:186](/home/udai/common/compass/apps/api/src/app.ts:186), [app.ts:193](/home/udai/common/compass/apps/api/src/app.ts:193)).

Therefore production can have a transaction without postings indefinitely after a failed restore/repair. All three converted readers then silently treat real legacy transactions as absent. The plan must either:

- make restore/reconciliation establish the posting invariant before exposing the restored data, or
- define and implement reader behavior for posting-inconsistent data, or
- explicitly accept degraded incorrect results with a convincing product decision.

Fixture repairs are still needed, but they cannot be the complete production fix under the stated E5 argument.

## 1. Cause A

Confirmed.

`createPool` constructs an ordinary `pg.Pool` ([infra/db.ts:3](/home/udai/common/compass/apps/api/src/infra/db.ts:3)); `createDb` passes it directly to `drizzle-orm/node-postgres` ([db/index.ts:14](/home/udai/common/compass/apps/api/src/db/index.ts:14)). No `setTypeParser`, `pg.types`, or equivalent override exists.

The raw lateral query selects three `timestamptz` columns directly ([user-tasks.ts:84](/home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.ts:84)), casts the result rows to `TaskRawRow` ([user-tasks.ts:115](/home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.ts:115)), and then calls `.toISOString()` ([user-tasks.ts:42](/home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.ts:42), [user-tasks.ts:55](/home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.ts:55)). That is fully consistent with the recorded raw-string versus typed-select probe.

`due_date` is correctly modeled as `string | null`. `bigint` is correctly modeled as a string and converted with a safe-integer check ([user-tasks.ts:31](/home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.ts:31)).

## 2. D1 and six-digit fractional seconds

D1 is correct.

The installed Zod version is 4.4.3. An empirical check against that exact runtime gives:

- `2026-07-30T12:04:02.460779Z` → accepted
- `2026-07-30T12:04:02.460Z` → accepted
- `2026-07-30T12:04:02Z` → accepted
- `2026-07-30 12:04:02.460779+00` → rejected

Thus PostgreSQL `.US` six-digit precision is accepted by `z.iso.datetime()`. It does not require exactly milliseconds.

The format

```sql
'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
```

combined with `AT TIME ZONE 'UTC'` emits the required UTC ISO form and preserves null through `to_char(NULL, ...)`.

The precedent at [transactions.ts:348](/home/udai/common/compass/apps/api/src/modules/ledger/services/transactions.ts:348) is valid formatting precedent, but that value is embedded inside an opaque base64url cursor rather than validated through `z.iso.datetime()` ([transactions.ts:357](/home/udai/common/compass/apps/api/src/modules/ledger/services/transactions.ts:357)). It therefore does not itself prove Zod compatibility; the installed-Zod check does.

## 3. D2

D2’s rejection is correct.

Both routes register outbound schemas:

- List: [user-tasks route:17](/home/udai/common/compass/apps/api/src/modules/ledger/routes/user-tasks.ts:17)
- Get: [user-tasks route:22](/home/udai/common/compass/apps/api/src/modules/ledger/routes/user-tasks.ts:22)

The application installs `serializerCompiler` ([app.ts:161](/home/udai/common/compass/apps/api/src/app.ts:161)), and the route test does likewise ([user-tasks.route.test.ts:61](/home/udai/common/compass/apps/api/src/modules/ledger/routes/user-tasks.route.test.ts:61)).

The schema requires strict datetime strings ([user-tasks schema:17](/home/udai/common/compass/packages/shared/src/schemas/user-tasks.ts:17), [user-tasks schema:24](/home/udai/common/compass/packages/shared/src/schemas/user-tasks.ts:24)). Returning the stock `pg` string would fail outbound serialization and yield a 500.

## 4. D4 per-group verdict

### Card-due tasks

Fixture defect confirmed for normal healthy production state.

The fixture inserts only `transactions` ([card-due-tasks.test.ts:168](/home/udai/common/compass/apps/api/src/modules/credit/services/card-due-tasks.test.ts:168)). `listCardHolders` now aggregates the card-account posting ([cards.ts:229](/home/udai/common/compass/apps/api/src/modules/credit/services/cards.ts:229)), and materialization directly relies on that reader ([card-due-tasks.ts:79](/home/udai/common/compass/apps/api/src/modules/credit/services/card-due-tasks.ts:79)). Hence the fixture no longer represents the normal transaction service shape.

However, because restore can leave a production transaction without postings, the production reader can incorrectly compute zero due and suppress a card-due task. This is part of the E5 blocker.

### Reconciliation writes

Fixture defect confirmed for normal healthy production state.

`createTxn` inserts only the legacy transaction row ([reconciliation-writes.test.ts:59](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.test.ts:59)). `ledgerDuesAtDates` now sums account postings ([reconciliation-reads.ts:124](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-reads.ts:124)). Adding corresponding posting data should preserve the existing expected values.

But in a failed-restore state it reports the wrong ledger due and drift, so this group is also affected by the E5 blocker.

### EMI history guard

Fixture defect confirmed for normal healthy production state.

`insertInstallmentHistory` inserts only a transaction ([emis.test.ts:274](/home/udai/common/compass/apps/api/src/modules/credit/services/emis.test.ts:274)). The guard now requires a negative posting on the EMI source account ([emis.ts:374](/home/udai/common/compass/apps/api/src/modules/credit/services/emis.ts:374)). Normal recurring materialization creates the transaction and rebuilds postings in the same transaction ([recurring.ts:288](/home/udai/common/compass/apps/api/src/modules/ledger/services/recurring.ts:288), [recurring.ts:304](/home/udai/common/compass/apps/api/src/modules/ledger/services/recurring.ts:304)).

This is nevertheless the most serious degraded-state consequence: a restored installment transaction with missing postings lets a user attach a destination account despite existing payment history. Thus fixture repair alone can conceal a real production guard failure.

## 5. Other production writers

The ordinary production writers inspected do maintain atomic dual-write behavior:

- Manual creation: [transactions.ts:403](/home/udai/common/compass/apps/api/src/modules/ledger/services/transactions.ts:403)
- Imports: [imports.ts:747](/home/udai/common/compass/apps/api/src/modules/ingest/services/imports.ts:747), [imports.ts:769](/home/udai/common/compass/apps/api/src/modules/ingest/services/imports.ts:769)
- Recurring/EMI materialization: [recurring.ts:288](/home/udai/common/compass/apps/api/src/modules/ledger/services/recurring.ts:288), [recurring.ts:341](/home/udai/common/compass/apps/api/src/modules/ledger/services/recurring.ts:341)
- Demo seed: [demo.ts:216](/home/udai/common/compass/apps/api/src/modules/system/services/demo.ts:216)
- Opening-balance creation/update: [accounts.ts:253](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:253), [accounts.ts:463](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:463)

The exception is restore followed by fallible post-commit reconciliation.

The standalone full-database restore copies archived postings directly in table order ([db/restore.ts:67](/home/udai/common/compass/apps/api/src/db/restore.ts:67)); its correctness depends on the dump containing consistent postings. It does not itself synthesize or verify them.

## 6. Acceptance criteria

AC1’s route-level requirement is correct and valuable because service-only tests cannot detect response-schema rejection.

AC2 should explicitly require both list and get route coverage for:

- incomplete task: `completedAt === null`
- completed task: six-digit ISO UTC string
- `createdAt` and `updatedAt` validation

A dedicated regression test should insert timestamps with non-zero microseconds, call both HTTP routes, assert 200, and parse every timestamp with `z.iso.datetime()`. Without non-zero microseconds, a future change could accidentally test only millisecond/default formatting.

AC4 is a good fixture guard, but “expected values unchanged” cannot prove production correctness. It should be supplemented with an invariant/degraded-state decision addressing restore failures.

AC6 should include the shared-package schema tests or workspace-level `check` if API typecheck does not exercise the relevant Zod schema runtime test.

P4 should also be clearer about fixture shape. A production ordinary transaction has a balanced posting set, not merely one “real posting.” Inserting only the account posting is enough for these readers but remains inconsistent with `findInconsistentPostings`. If the stated goal is to mirror production, fixtures should use `createTransaction` where practical or create the full posting family, including the balancing system leg.

## 7. P3/P5 and latent raw timestamp declarations

P3 is correctly scoped for `TaskRawRow`.

One additional raw-query timestamp is misdeclared:

- [sip-installments.ts:308](/home/udai/common/compass/apps/api/src/modules/investments/services/sip-installments.ts:308): raw `t.deleted_at` from `tx.execute` is declared `Date | null`, but stock `pg` returns a string when non-null.

It currently performs only a null/non-null check ([sip-installments.ts:317](/home/udai/common/compass/apps/api/src/modules/investments/services/sip-installments.ts:317)), so this does not currently crash. It should nevertheless be retyped to `string | null`; it is a latent copy of the same type-safety defect.

No other production raw `db.execute` call site was found declaring a returned timestamp as `Date`.

P5 is worthwhile. The raw-insert sweep finds many tests deliberately constructing inconsistent transaction/posting states, especially reconciliation, backup/restore, reconciler, inbox, and user-task tests. Most are testing low-level behavior and should not be mechanically changed. P5 should specifically cross-reference fixtures against posting-derived readers rather than treating every raw transaction insert as a gap.

## 8. Other observations

- The timestamp SQL fix introduces no apparent security issue; values remain parameterized and the timestamp format is constant.
- `AT TIME ZONE 'UTC'` avoids session-timezone dependence.
- Null preservation for `completed_at` is correct.
- Retaining microseconds is preferable to converting through JavaScript `Date`, which would truncate precision.
- The lateral transaction projection can still become `transaction: null` when a transaction exists but its real-account posting is absent. That is another visible consequence of the failed E5 invariant.
- Comments in [app.ts:182](/home/udai/common/compass/apps/api/src/app.ts:182) still say posting-derived reader failures cannot surface because readers are legacy-derived. That comment is stale after PR-E and obscures the production risk.

## Required plan changes

1. Keep D1/D2 and the proposed timestamp implementation.
2. Add the non-zero-microsecond route regression test.
3. Retype `sip-installments.ts`’s raw `deleted_at` field.
4. Repair the three fixtures, preferably with full production posting shapes.
5. Replace E5 with an accurate invariant statement.
6. Resolve the restore/reconciliation degraded-state behavior before treating D4 as the complete fix.