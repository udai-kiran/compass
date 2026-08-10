## Verdict

Approved. No BLOCKER findings. The final change set satisfies the task, both amendments, and the hard expectation guard.

## Review findings

1. Cause A is correctly fixed at [user-tasks.ts:13](/home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.ts:13) and [user-tasks.ts:86](/home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.ts:86).

   - All three timestamps use `to_char(... AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.
   - `TaskRawRow` now declares `created_at`/`updated_at` as `string` and `completed_at` as `string | null`.
   - No `.toISOString()` remains in this file.
   - `to_char(NULL, ...)` preserves `completedAt: null`.
   - The output, such as `2026-07-30T12:04:02.460779Z`, satisfies `z.iso.datetime()`.
   - The route regression test seeds non-zero microseconds and verifies list/get, incomplete/completed paths, HTTP 200, and Zod parsing at [user-tasks.route.test.ts:296](/home/udai/common/compass/apps/api/src/modules/ledger/routes/user-tasks.route.test.ts:296).

2. No remaining raw-SQL type lie was found in the touched production files.

   - `due_date` and raw SQL `date` fields remain correctly typed as strings.
   - `txn_amount_paise` and other raw bigints are strings before conversion, with the existing safe-integer check intact.
   - `sip-installments.ts` correctly changes `deleted_at` from `Date | null` to `string | null` at [sip-installments.ts:308](/home/udai/common/compass/apps/api/src/modules/investments/services/sip-installments.ts:308).
   - Its `rawRow.deleted_at !== null` condition at line 317 has identical semantics.

3. Every repaired Cause-B fixture creates the complete balanced posting family through the real `createTransaction` writer:

   - [card-due-tasks.test.ts:165](/home/udai/common/compass/apps/api/src/modules/credit/services/card-due-tasks.test.ts:165)
   - [reconciliation-writes.test.ts:60](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.test.ts:60)
   - [emis.test.ts:276](/home/udai/common/compass/apps/api/src/modules/credit/services/emis.test.ts:276)
   - [user-tasks.test.ts:63](/home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.test.ts:63)

   `createTransaction` calls `buildOrdinaryPostings` and `replacePostings`, producing the real leg and its system counter-leg atomically.

4. The hard D4/AC4 guard holds.

   The only modified pre-existing expected value is PE7’s merchant:

   - `"PE7Merchant"` → `"Pe7merchant"` at [postings-pr-e-parity.test.ts:532](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:532).

   This is legitimate defect correction:

   - Git attributes `titleCase`, `heuristicNormalize`, and `normalizeMerchant` to `90ee575`, dated 2026-07-14.
   - PR-E’s parent already called `normalizeMerchant` from `createTransaction`.
   - `postings-pr-e-parity.test.ts`, including PE7, was introduced by `2253623`, dated 2026-08-10.
   - Consequently PE7’s original expectation could never match the existing write normalization and is not masking a PR-E regression.

   The protected values remain unchanged, including `2540475`, every `created >= 1`, `-12345`, `-350000`, `0`, and PE7’s `-600`.

5. Amendment 2 is correctly implemented at [reconciliation-writes.test.ts:696](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.test.ts:696).

   - Both posting legs are updated through one `CASE`, preserving zero-sum.
   - Both hooks assert exactly two updated posting rows.
   - `txB` reads the account before writing, preserving the intended reverse-edge ordering.
   - No `rebuildPostingsForTransaction` is used.
   - Only `amountPaise` appears in `SET`; neither FK column is assigned.
   - The `::bigint` cast is correct. It resolves PostgreSQL’s parameter/CASE assignment typing without narrowing values or changing arithmetic.
   - The `40001` predicate, both `hookCalls === 2` assertions, `-350000`, and `openingBalancePaise === 0` remain intact.
   - The revised explanatory comment accurately identifies the postings update as the SSI edge.

6. AC5 holds.

   Test declaration counts do not decrease:

   - card-due-tasks: 30 → 30
   - emis: 28 → 28
   - reconciliation-writes: 27 → 27
   - user-tasks route: 7 → 8
   - postings PR-E parity: 10 → 10
   - user-tasks service: 20 → 20

   No tests were deleted, skipped, marked todo/only, commented out, or weakened.

7. The [app.ts:182](/home/udai/common/compass/apps/api/src/app.ts:182) change is comment-only. Runtime code is byte-unchanged. The new comment correctly states that post-PR-E readers depend on postings and that failed reconciliation can make transactions silently absent.

8. PE2 flake adjudication:

   `listEmiInstallments` inner-joins postings without `DISTINCT` at [emis.ts:478](/home/udai/common/compass/apps/api/src/modules/credit/services/emis.ts:478). Therefore, a malformed transaction containing two negative postings for the same EMI account would produce duplicate installment rows.

   However, PE2 uses a fresh user, account, template, and transaction UUIDs, and each of its three transactions is created through the canonical writer, which produces exactly one posting on that real account plus one counter-leg on a system account. Neither this branch nor normal production writers create a second qualifying negative posting on the same account. Old database rows cannot match the fresh template UUID.

   Best explanation: the single `4 !== 3` was a transient shared-database/test-environment anomaly or an unobserved concurrent/manual mutation, not fixture pollution through ordinary rows. The query’s multiplicity sensitivity is real but pre-existing and untouched by this branch. I do not expect recurrence in CI against a fresh isolated database.

9. No regression, security issue, schema change, migration, or unnecessary production complexity was found. Production changes remain limited to the two type/format fixes and the `app.ts` comment.

The known failed-restore degraded-state defect remains out of scope. This diff neither changes restore/reconciliation behavior nor makes that defect worse. The previously identified postings-less route fixture remains a report-only P5 item and is not exercised as an active posting-derived projection.