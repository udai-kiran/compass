## Verdict

The SQL direction is correct and D1/D2 are substantively right for valid dual-written data. Two plan gaps are blocking: unsafe bigint conversion and an underspecified/dishonest transfer fixture that can satisfy AC4 without exercising the transfer shape D1 is meant to protect.

## Blocking findings

### BLOCKER — P2 omits the mandatory safe-integer check

P1 introduces `sum(p.amount_paise)::bigint`, but P2 explicitly keeps only `Number(r.amount_paise)` unchanged ([TASK.md:91](/home/udai/common/compass/tasks/022-pr-f-extractor-postings/TASK.md:91), [TASK.md:103](/home/udai/common/compass/tasks/022-pr-f-extractor-postings/TASK.md:103)). That can silently round an out-of-range bigint, especially under AC8’s multiple-posting case.

The migration strategy requires every touched SQL aggregate to be range-checked before conversion. Converted readers already follow that convention, e.g. [reconciliation-reads.ts:138](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-reads.ts:138) and [periods.ts:225](/home/udai/common/compass/apps/api/src/lib/periods.ts:225).

P2/ACs must require:

```ts
const amountPaise = Number(r.amount_paise);
if (!Number.isSafeInteger(amountPaise)) {
  throw new Error(/* clear aggregate overflow message */);
}
```

Add a test using same-account postings whose sum exceeds `Number.MAX_SAFE_INTEGER`. Merely typechecking does not test this.

### BLOCKER — P3/AC4 can use a fake transfer shape and miss the D1 regression

Production transfer legs contain two postings:

- Real account: signed legacy amount.
- Clearing account: its negation.

That is explicit in [postings.ts:227](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.ts:227) and [postings.ts:240](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.ts:240). Shape selection comes from `transfer_links` in [transactions.ts:221](/home/udai/common/compass/apps/api/src/modules/ledger/services/transactions.ts:221).

P3 instead proposes inserting only the card posting while claiming this “reproduces the production dual-write shape” ([TASK.md:105](/home/udai/common/compass/tasks/022-pr-f-extractor-postings/TASK.md:105)). It does not. Worse, AC4 merely says “a transfer leg” must be returned, without requiring a Clearing posting. A transaction containing only a card posting would still pass if someone later introduced exactly the forbidden Clearing-based `NOT EXISTS`, because there would be no Clearing posting to exclude it.

AC4 must construct at least:

- The card transaction row.
- Card posting `+500000`.
- Same-user Clearing account.
- Clearing posting `-500000`.

Preferably also construct the linked opposite transaction and `transfer_links` row so the fixture genuinely represents `acceptRepayment`. Then assert the card leg is returned and matched. P3 may use a simpler lone posting for ordinary-reader tests, but it must stop describing that as a production transfer shape.

## 1. D1 — correct

D1 is correct. The legacy query filters only `transactions.account_id = $2` and therefore includes transfer legs and any opening rows on that account ([db.ts:246](/home/udai/common/compass/apps/extractor/src/db.ts:246)). This is a per-account ledger row reader, not an income/spend aggregate.

A card repayment’s card-side legacy row has a positive amount. Its mirror is:

```text
card account     +X
Clearing account -X
```

See [postings.ts:227](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.ts:227)-[256](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.ts:256). The proposed query filters `p.account_id = $2`, so it selects the card posting and returns `+X`. The statement matcher converts a credit line to positive and requires exact equality ([extract.ts:833](/home/udai/common/compass/apps/extractor/src/extract.ts:833)-[836](/home/udai/common/compass/apps/extractor/src/extract.ts:836)).

The Clearing/Opening exclusion in [periods.ts:218](/home/udai/common/compass/apps/api/src/lib/periods.ts:218) and [dashboard.ts:74](/home/udai/common/compass/apps/api/src/modules/planning/services/dashboard.ts:74) serves aggregate semantics and would wrongly remove repayments here. The closest precedent is indeed [reconciliation-reads.ts:124](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-reads.ts:124)-[136](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-reads.ts:136), which scopes by posting account without transfer exclusion.

Opening rows use the same real-account-plus-Opening-counter shape ([postings.ts:197](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.ts:197)). Current application writers limit opening rows to bank/cash, so a normal card should not have one, but omitting the exclusion still preserves legacy behavior.

## 2. D2 and GROUP BY

D2 is correct for this reader.

The `user-tasks.ts` lateral pattern deliberately chooses one real posting for a transaction-shaped DTO ([user-tasks.ts:97](/home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.ts:97)-[104](/home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.ts:104)). Here the output contract is one amount per transaction for a specific account. Summing all postings on that account preserves one row and is deterministic if that representation later permits multiple same-account legs.

For today’s valid mirror, every shape has exactly one real posting equal to the legacy amount:

- Ordinary: [postings.ts:98](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.ts:98)-[115](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.ts:115)
- Split: [postings.ts:137](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.ts:137)-[159](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.ts:159)
- Transfer leg: [postings.ts:240](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.ts:240)-[255](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.ts:255)
- Opening: [postings.ts:206](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.ts:206)-[221](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.ts:221)

The exact P1 `GROUP BY t.id, t.date, t.occurred_at, t.merchant` is valid PostgreSQL. All selected non-aggregates are listed. PostgreSQL could also infer the other `t` columns from the primary key `t.id` ([ledger.ts:26](/home/udai/common/compass/apps/api/src/db/shared/ledger.ts:26)), but the explicit list is clearer and compiles.

The claim that summing two same-account postings remains “legacy parity” should be narrowed: it defines sensible postings-native behavior, but if their sum differs from `transactions.amount_paise`, it necessarily differs from legacy. Such a shape is invalid under today’s dual-write invariant and should be treated as drift, not parity.

## 3. Proposed SQL

The SQL is valid PostgreSQL.

- `sum(bigint)` normally produces `numeric`; the explicit `::bigint` makes the result `int8`.
- With node-postgres’s default parsers, `int8` is returned as a string, so the declared `amount_paise: string` and `Number(...)` remain appropriate, subject to the BLOCKER safe-integer validation.
- `to_char(t.date, 'YYYY-MM-DD')` is unchanged.
- `to_char(t.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSOF')` is unchanged, including its session-time-zone behavior and null propagation.
- `$1..$4` correctly match `[userId, accountId, fromDate, toDate]` at [db.ts:251](/home/udai/common/compass/apps/extractor/src/db.ts:251).
- `BETWEEN` remains inclusive, matching the legacy query.

## 4. Parity cases

For data satisfying the full-shape dual-write invariant, there is no row-set or amount divergence:

- Ordinary card transaction: one matching posting; same amount.
- Split transaction: one real card posting equal to the sum of splits and legacy parent amount.
- Opening row: one real posting equal to legacy amount; returned because there is no Opening exclusion.
- Transfer leg: one real posting equal to the legacy signed amount; returned despite its Clearing counter-posting.
- Soft-deleted transaction: postings remain, but `t.deleted_at is null` excludes it, matching legacy.
- Date boundary: unchanged inclusive comparison.
- Tenant: `t.user_id = $1` retains legacy tenant scoping.

Potential divergences outside the valid invariant are:

- Zero postings: legacy returns the transaction; new query does not.
- Wrong-account posting: row inclusion can differ.
- Duplicate same-account postings: new amount is their sum, potentially unlike legacy.
- Stale posting amount: new amount differs from legacy.

These are precisely the shapes the reconciliation gate is supposed to repair/reject.

“Multi-user ID collision” is not a realistic owned-account fixture: `accounts.id` is a global UUID primary key ([hubs.ts:68](/home/udai/common/compass/apps/api/src/db/shared/hubs.ts:68)). AC7 can nevertheless test hostile cross-tenant linkage by attaching user B’s transaction to a posting referencing user A’s account. The proposed query correctly rejects it through `t.user_id = $1`. It should not attempt to create two accounts with the same ID.

## 5. D4 and the deployment gate

D4 is sound only if the posting reconciliation gate is genuinely enforced.

There is already a cheap safety net from PR-A: startup awaits `reconcileAllPostings` before jobs and traffic ([app.ts:182](/home/udai/common/compass/apps/api/src/app.ts:182)-[195](/home/udai/common/compass/apps/api/src/app.ts:195)). It repairs missing and wrong-shaped postings by exact multiset comparison ([reconcile-postings.ts:80](/home/udai/common/compass/apps/api/src/modules/ledger/services/reconcile-postings.ts:80)-[109](/home/udai/common/compass/apps/api/src/modules/ledger/services/reconcile-postings.ts:109)).

However, startup logs reconciliation failures and proceeds ([app.ts:188](/home/udai/common/compass/apps/api/src/app.ts:188)-[193](/home/udai/common/compass/apps/api/src/app.ts:193)). Therefore the code is a repair pass, not a hard gate. The release procedure must explicitly verify zero failures/inconsistencies before PR-F deployment. If that operational gate cannot be demonstrated, continuing after reconciliation failures is itself blocking because a missing card posting creates a user-visible duplicate draft.

A legacy fallback is not desirable; enforcing the existing reconciliation gate is cheaper and consistent with PR-B–PR-E.

## 6. AC1–AC9

Most criteria are useful and testable, with these amendments:

- AC1 is testable by inspection/static assertion.
- AC2 is sound.
- AC3 is sound. There is no database constraint coupling `transactions.amount_paise` to postings. The schema has only independent non-null bigint columns ([ledger.ts:41](/home/udai/common/compass/apps/api/src/db/shared/ledger.ts:41), [ledger.ts:143](/home/udai/common/compass/apps/api/src/db/shared/ledger.ts:143)). Poisoning the legacy value deliberately violates the application mirror invariant, but that is exactly what proves which source the reader uses. Keep the fixture isolated and document that purpose.
- AC4 must require a Clearing posting, as described in the blocker.
- AC5 is sound.
- AC6 is sound.
- AC7 should be reworded to a cross-tenant posting reference, not “same account id” as though two users can own the same primary key.
- AC8 is testable because the database has no unique constraint on `(transaction_id, account_id)`. It tests aggregation behavior, not legacy parity.
- Add AC10 for safe-integer refusal.
- AC9 is verification rather than behavioral acceptance, but is otherwise fine.
- T1’s “must actually run” requirement is good. The test currently throws immediately when `DATABASE_URL` is absent, rather than skipping ([statement-duplicate.test.ts:24](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:24)-[36](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:36)); the verification report should say whether the URL was present and that the DB-backed test executed.

## 7. Fixture implications

A lone posting is accepted by the database. The migration creates foreign keys and indexes only; there is no zero-sum trigger or check constraint ([0067_illegal_shocker.sql:3](/home/udai/common/compass/apps/api/drizzle/0067_illegal_shocker.sql:3)-[21](/home/udai/common/compass/apps/api/drizzle/0067_illegal_shocker.sql:21)). Zero-sum enforcement lives in application helpers such as `replacePostings`, not raw SQL ([post-entry.ts:49](/home/udai/common/compass/apps/api/src/modules/ledger/services/post-entry.ts:49)-[55](/home/udai/common/compass/apps/api/src/modules/ledger/services/post-entry.ts:55)).

Therefore:

- A lone posting is acceptable for narrowly testing the reader’s source selection.
- It is dishonest as the fixture for a production ordinary, opening, or transfer transaction.
- The transfer regression test needs a Clearing system account and balanced counter-posting.
- Throwaway users do not need all four system accounts merely to insert ordinary raw postings.
- If AC4 uses a realistic transfer shape, it needs at least a same-user Clearing account. Seeding all four through API helpers is unavailable to the extractor test; raw SQL can create the needed system account.
- Cleanup remains safe because deleting transactions cascades postings ([ledger.ts:136](/home/udai/common/compass/apps/api/src/db/shared/ledger.ts:136)).

## 8. Scope, security, and conventions

Tenant scoping is adequate. Although postings has no `user_id`, joining to the globally identified parent and filtering `t.user_id = $1` is the established pattern ([reconciliation-reads.ts:130](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-reads.ts:130)-[134](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-reads.ts:134)). No accounts join is required for confidentiality or parity.

The main convention violation is the missing safe-integer check. PR-B–PR-E converted aggregate readers with explicit range validation; PR-F should do the same.

No changes are needed in `statement-duplicates.ts` or `matchLinesToLedger`; the call contract and exact signed matching remain unchanged. The `reconciled_statement_id` updates are correctly out of scope.

After resolving the two blockers—safe aggregate conversion and a genuinely Clearing-backed AC4 fixture—the proposed conversion is appropriately scoped and preserves current valid-data behavior.