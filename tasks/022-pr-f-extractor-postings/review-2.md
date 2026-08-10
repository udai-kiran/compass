## Verdict

No BLOCKER found. The implementation is correct, scoped, and resolves both prior blockers in actual code.

The principal gaps are test-quality issues:

- AC5’s test passes under the legacy query too, so it does not prove account scoping comes from postings.
- AC7’s tenant scope is tested, but date-range behavior has no dedicated test.
- AC1 is proven only by inspection.
- DB-backed tests could not be executed; AC9 is therefore only partially verified.

## Prior blockers

1. Safe-integer guard: resolved.

The aggregate is converted at [db.ts:267](/home/udai/common/compass/apps/extractor/src/db.ts:267), immediately checked with `Number.isSafeInteger` at [db.ts:268](/home/udai/common/compass/apps/extractor/src/db.ts:268), and only placed in a returned row afterward at [db.ts:273](/home/udai/common/compass/apps/extractor/src/db.ts:273). AC10 exercises the rejection path at [statement-duplicate.test.ts:424](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:424).

There is no bypass: `NaN`, infinities, unsafe positive values, and unsafe negative values all fail `Number.isSafeInteger`. A SQL `bigint` overflow would fail in PostgreSQL rather than return rounded paise.

2. Real Clearing-backed AC4 fixture: resolved.

The test creates a same-user system account with `type = 'system'` and `system_kind = 'clearing'` through [statement-duplicate.test.ts:64](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:64), then creates:

- Card posting `+500000` at [statement-duplicate.test.ts:313](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:313).
- Clearing posting `-500000` at [statement-duplicate.test.ts:315](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:315).

This is a genuine balanced card/Clearing posting shape.

## Plan P1–P5

- P1 — Implemented. The query reads from `postings`, joins its parent transaction, filters on `p.account_id`, aggregates with `sum`, and groups by transaction fields at [db.ts:252](/home/udai/common/compass/apps/extractor/src/db.ts:252).
- P2 — Implemented. `LedgerTxnRow` remains unchanged at [db.ts:218](/home/udai/common/compass/apps/extractor/src/db.ts:218), while the checked conversion is at [db.ts:266](/home/udai/common/compass/apps/extractor/src/db.ts:266).
- P3 — Implemented. `createLedgerTxn` now inserts the matching real-account posting at [statement-duplicate.test.ts:124](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:124) and [statement-duplicate.test.ts:136](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:136). The comment honestly identifies it as a legal but single-leg test fixture at [statement-duplicate.test.ts:119](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:119).
- P4 — Implemented, with the AC5 and AC7 coverage qualifications below. Tests for AC2–AC8 and AC10 occupy [statement-duplicate.test.ts:244](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:244) through [statement-duplicate.test.ts:453](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:453).
- P5 — Implemented. The comment documents postings-derived scope and amount, and deliberate inclusion of transfers/openings at [db.ts:227](/home/udai/common/compass/apps/extractor/src/db.ts:227).

## Acceptance criteria AC1–AC10

- AC1 — Implemented and proven by inspection, but has no explicit static test. The query contains neither `t.account_id` nor `t.amount_paise`; it uses `p.account_id` and `p.amount_paise` at [db.ts:253](/home/udai/common/compass/apps/extractor/src/db.ts:253) and [db.ts:260](/home/udai/common/compass/apps/extractor/src/db.ts:260).
- AC2 — Implemented and tested at [statement-duplicate.test.ts:244](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:244). It proves a negative card posting returns as `-50000`. Because the posting and legacy value agree, the test alone would not distinguish old and new readers; AC3 provides that decisive proof.
- AC3 — Implemented and genuinely decisive at [statement-duplicate.test.ts:259](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:259). The legacy transaction is `-99999` at line 273, the posting is `-50000` at line 279, and the assertion requires `-50000` at lines 281–287. A legacy-sourced reader would fail.
- AC4 — Implemented and effective at [statement-duplicate.test.ts:291](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:291). The account and two balanced postings meet D7 exactly.
- AC5 — The implementation satisfies it through `p.account_id = $2` at [db.ts:260](/home/udai/common/compass/apps/extractor/src/db.ts:260). The test at [statement-duplicate.test.ts:324](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:324) satisfies the literal criterion but is weak: both the legacy `transactions.account_id` and posting point to the other account at lines 332–342. Consequently, the pre-change query would also return zero. A decisive source-selection test would set the legacy `transactions.account_id` to the queried card while placing the posting on the other account.
- AC6 — Implemented and tested at [statement-duplicate.test.ts:349](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:349). It inserts the posting, soft-deletes only the parent, and expects no row.
- AC7 — Tenant scoping is implemented at [db.ts:259](/home/udai/common/compass/apps/extractor/src/db.ts:259) and convincingly tested with a hostile cross-tenant posting at [statement-duplicate.test.ts:366](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:366). Date scoping remains implemented as inclusive `BETWEEN` at [db.ts:262](/home/udai/common/compass/apps/extractor/src/db.ts:262), but there is no test for out-of-range rows or boundary inclusion. Thus AC7 is only partially covered by tests.
- AC8 — Implemented and tested at [statement-duplicate.test.ts:398](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:398). Two same-account postings are inserted at lines 415–416, followed by assertions for one row and their sum at lines 418–420.
- AC9 — Partially verified. `npm run typecheck` and `npm run lint` both completed successfully with exit code 0. The DB-backed extractor suite was not run because `DATABASE_URL`/Postgres is unavailable, as stipulated. Therefore the complete extractor test-suite requirement is unverified, not passing.
- AC10 — Implemented and properly tested at [statement-duplicate.test.ts:424](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:424). `MAX_SAFE_INTEGER + 1` is formed in PostgreSQL from two independently safe parameters at lines 440–442, and the test requires a clear safe-integer error at lines 444–451.

## SQL review

The SQL at [db.ts:252](/home/udai/common/compass/apps/extractor/src/db.ts:252) is valid PostgreSQL.

- `postings` has no `user_id`; tenant ownership is correctly obtained from the joined parent with `t.user_id = $1` at line 259.
- Account scope is correctly applied with `p.account_id = $2` at line 260.
- Soft deletion remains parent-scoped at line 261.
- Dates remain inclusively scoped by `$3` and `$4` at line 262.
- Every selected non-aggregate transaction expression is represented in the `GROUP BY` at line 263. The grouping is valid.
- `sum(bigint)` normally yields `numeric`; `::bigint` at line 253 explicitly returns PostgreSQL `int8`.
- With node-postgres’s default parser, `int8` is returned as a string, matching the declared `amount_paise: string` at [db.ts:247](/home/udai/common/compass/apps/extractor/src/db.ts:247). `Number()` handles that string, with the subsequent safe-integer check preventing silent precision loss.
- Parameter ordering remains correct at [db.ts:264](/home/udai/common/compass/apps/extractor/src/db.ts:264).
- No unnecessary `accounts` join was added.

## D1 regression guard

No Clearing or Opening `NOT EXISTS` exclusion exists anywhere in the query at [db.ts:252](/home/udai/common/compass/apps/extractor/src/db.ts:252).

The AC4 test is valuable. If someone added the forbidden conventional exclusion—an anti-join/`NOT EXISTS` that detects any posting on an account whose `system_kind` is `clearing`—the Clearing posting at [statement-duplicate.test.ts:316](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:316) would make that predicate false, the row count would become zero, and the assertion at line 319 would fail.

The fixture does not construct a linked opposite transaction or `transfer_links` row, but TASK/D7 requires the card transaction plus its balanced card/Clearing postings, not the full two-transaction business workflow. For this SQL regression, the supplied shape is sufficient and non-vacuous.

## Fixture integrity and cleanup

`createLedgerTxn` inserts a transaction followed by the real-account posting carrying the same signed amount at [statement-duplicate.test.ts:129](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:129) and [statement-duplicate.test.ts:137](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:137). This correctly makes the existing duplicate-matcher integration test readable through postings.

The fixture comment is honest that its ordinary helper creates a single posting rather than a complete production-balanced shape at [statement-duplicate.test.ts:119](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:119). AC4 separately creates the required full balanced shape.

AC3’s poisoned legacy value is well constructed and cannot pass under the old reader.

Each test schedules cleanup through `t.after`. Cleanup deletes transactions before accounts/users at [statement-duplicate.test.ts:149](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:149). Deleting a transaction cascades its postings, so account deletion is not blocked. AC7 deliberately cleans user B first, which removes user B’s transaction and its posting referencing user A’s account before user A’s account is deleted at [statement-duplicate.test.ts:372](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:372).

One minor convention issue: fixture users/accounts are still named “AC9 test” at [statement-duplicate.test.ts:50](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:50) and [statement-duplicate.test.ts:59](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:59), despite now serving AC2–AC10. This is harmless but mildly misleading.

## Parity and tenant safety

For valid dual-written data, the new query has no row-set or amount divergence from the old query:

- Ordinary and split transactions have one real-account posting equal to the legacy amount.
- Transfers and openings remain included because there is no system-account exclusion.
- Soft-deleted parents remain excluded.
- Date bounds remain inclusive.
- Multiple postings on other accounts do not affect the selected account’s aggregate.
- Tenant scope remains anchored to the parent transaction.

Expected divergences are limited to invalid/drifted shapes: missing postings, wrong-account postings, stale posting values, or multiple same-account postings whose sum differs from the legacy column. These are inherent to moving authority to postings and are explicitly accepted by D2/D4.

There is no tenant-leak path in this query. Even a malicious cross-tenant account reference in `postings.account_id` cannot bypass `t.user_id = $1`.

## Caller and API regression review

`LedgerTxnRow` is byte-identical to the prior version at [db.ts:218](/home/udai/common/compass/apps/extractor/src/db.ts:218). The exported function name, arguments, ordering, and return type remain unchanged at [db.ts:238](/home/udai/common/compass/apps/extractor/src/db.ts:238).

`annotateStatementDuplicates` still invokes it with the same five arguments at [statement-duplicates.ts:30](/home/udai/common/compass/apps/extractor/src/statement-duplicates.ts:30). It passes the returned rows unchanged to `matchLinesToLedger` at [statement-duplicates.ts:32](/home/udai/common/compass/apps/extractor/src/statement-duplicates.ts:32).

`matchLinesToLedger` remains untouched and continues exact signed-paise matching at [extract.ts:833](/home/udai/common/compass/apps/extractor/src/extract.ts:833). No caller regression is evident.

## Scope and conventions

Only the intended extractor SQL/mapping/comment and its DB test fixture/tests were changed for this task. No schema, caller, matcher, dependency, or reconciliation update was introduced.

`git diff --check` reported no whitespace errors. The extra TASK-specific references such as “D1-D3” in the production doc comment at [db.ts:233](/home/udai/common/compass/apps/extractor/src/db.ts:233) are somewhat repository-process-oriented, but the surrounding explanation is accurate and useful rather than dead or misleading.

Final assessment: implementation approved, with non-blocking test-strength gaps for AC5 and the date-range portion of AC7, and DB execution still required in CI.