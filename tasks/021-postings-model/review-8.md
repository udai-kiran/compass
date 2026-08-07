## Findings

### Blockers

1. Schema coverage is not updated for the additive schema.

The schema adds both `postings` and `accountSystemKind`, but the decomposition test still expects 50 tables and omits the new enum from the shared-hubs enum list at [schema.decomposition.test.ts:213](/home/udai/PennyPilot/apps/api/src/db/schema.decomposition.test.ts:213). The test currently fails with:

> exports exactly 50 tables + 38 enums + users with no duplicates

This violates the A1 checkpoint requiring schema-coverage tests to remain green ([DELEGATION-dualwrite-pr-a.md:274](/home/udai/PennyPilot/tasks/021-postings-model/DELEGATION-dualwrite-pr-a.md:274)). The backup coverage test also reports `postings` missing from `ALL_TABLES`, but that registration is explicitly assigned to A6, so it is not an A1 blocker.

2. One DB→public `AccountType` boundary still uses an unchecked cast.

`accountBalancesAtDate` returns:

```ts
type: r.type as AccountType
```

at [accounts.ts:175](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:175), bypassing the new helper at [account-type.ts:6](/home/udai/PennyPilot/apps/api/src/lib/account-type.ts:6). The query correctly excludes system accounts at [accounts.ts:172](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:172), so this is not presently an exploitable leak under the database schema. Nevertheless, it does not satisfy the stated requirement to narrow at every DB→public boundary. It should use `assertPublicAccountType(r.type)`.

## 1. Migration and schema

The migration is purely additive. [0067_illegal_shocker.sql:1](/home/udai/PennyPilot/apps/api/drizzle/0067_illegal_shocker.sql:1)–[21](/home/udai/PennyPilot/apps/api/drizzle/0067_illegal_shocker.sql:21) contains:

- `CREATE TYPE account_system_kind`
- `ALTER TYPE account_type ADD VALUE 'system'`
- `CREATE TABLE postings`
- `ALTER TABLE accounts ADD COLUMN system_kind`
- Three foreign keys
- Three ordinary indexes
- One partial unique index

There are zero `DROP` statements and no altered or removed legacy columns.

The SQL faithfully matches the Drizzle definitions:

- `"system"` is appended to `accountType` at [hubs.ts:46](/home/udai/PennyPilot/apps/api/src/db/shared/hubs.ts:46).
- The four system kinds, including Clearing, are declared at [hubs.ts:58](/home/udai/PennyPilot/apps/api/src/db/shared/hubs.ts:58).
- `accounts.systemKind` is nullable at [hubs.ts:117](/home/udai/PennyPilot/apps/api/src/db/shared/hubs.ts:117).
- The partial unique index is defined at [hubs.ts:123](/home/udai/PennyPilot/apps/api/src/db/shared/hubs.ts:123).
- The postings columns and indexes match at [ledger.ts:132](/home/udai/PennyPilot/apps/api/src/db/shared/ledger.ts:132)–[152](/home/udai/PennyPilot/apps/api/src/db/shared/ledger.ts:152).

`accounts_system_kind_idx(user_id, system_kind) WHERE system_kind IS NOT NULL` is a valid PostgreSQL uniqueness arbiter for one account of each system kind per user. It can be targeted by conflict handling only when the conflict target includes a matching predicate; the current implementation deliberately does not attempt that.

FK behavior is appropriate:

- `postings.transaction_id ON DELETE CASCADE` ensures hard-deleting a transaction removes its postings.
- `account_id` and `category_id` use `NO ACTION`, preventing accounts or categories from being deleted while postings still reference them. This is safer than cascading financial history away. Later category merge and account deletion logic must rewrite or otherwise account for postings before deleting referenced rows.
- Soft-deleting a transaction does not invoke the FK, so postings remain as required.

There is no database check enforcing the semantic pairing `type = 'system'` iff `system_kind IS NOT NULL`. That is acceptable for this planned application-enforced model, but A2 guards and restore validation become essential.

## 2. Posting builders and classifiers

`buildTransferLegPostings` correctly implements the row-local Clearing model at [postings.ts:218](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:218):

- Real leg receives the signed legacy amount.
- Clearing receives its exact negation.
- Category and necessity are null on both.
- Each legacy transfer row gets its own independently zero-sum pair.
- `assertZeroSum` validates safe-integer amounts and balance.

The new tests cover outflow, inflow, and both safe-integer boundary signs at [postings.test.ts:213](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.test.ts:213). The focused posting suite passes all 20 tests.

There is a known latent classifier issue: a one-real plus one-Clearing pair is currently classified as `"ordinary"` because [postings.ts:268](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:268) treats every one-real/one-system shape as ordinary. The comment at [postings.ts:252](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:252) says it is “not one of the four shapes,” but that description is technically inaccurate—the current code does recognize it, incorrectly, as ordinary.

The projections behave as follows:

- `projectRealLeg` works for a Clearing pair because it selects the sole non-system leg ([postings.ts:278](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:278)).
- `projectCounter` correctly refuses a Clearing pair because it only accepts Expenses/Income counters ([postings.ts:297](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:297)).
- `projectSplits` returns no splits for a Clearing pair ([postings.ts:321](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:321)).

Deferring this is acceptable for A1 because the brief explicitly prohibits changing reader-side classifier behavior and there is no A1 caller. It must be fixed before PR-B converts any caller that can feed per-leg Clearing shapes into `classifyShape`. Tests should explicitly pin the desired Clearing classification then.

## 3. Post-entry primitives

### `replacePostings`

Tenant checks are sufficient for this primitive’s planned responsibility:

- Transaction ownership is checked by both transaction ID and user ID at [post-entry.ts:48](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:48).
- Every posting account is checked through the tenant-scoped `assertOwnedAccount` at [post-entry.ts:54](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:54), whose query includes both account ID and user ID at [ownership.ts:23](/home/udai/PennyPilot/apps/api/src/lib/ownership.ts:23).
- Every non-null category is checked through `assertOwnedCategory`, which likewise scopes ID and user at [ownership.ts:36](/home/udai/PennyPilot/apps/api/src/lib/ownership.ts:36).
- All validation and `assertZeroSum` occur before the delete at [post-entry.ts:59](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:59).

Allowing owned system accounts here is correct: the posting mirror must reference Expenses, Income, Opening, and Clearing. Rejecting system accounts belongs at public/simple transaction API boundaries in A2, not in this lower-level primitive.

Not filtering `transactions.deleted_at IS NULL` is correct. Reconciliation and restore must rebuild postings for soft-deleted transactions, whose postings remain retained. Adding that filter would violate the plan’s characterization invariant.

Operating on the passed `DbOrTx` handle is the correct design for same-transaction dual-write. The primitive must not open an independent transaction around its delete/insert.

There is an acknowledged foot-gun if a caller passes the top-level `Db`: the delete and insert are then separate autocommit statements, and an insert failure could leave the transaction with no postings. The type intentionally permits `Db` for maintenance contexts, so atomicity cannot be enforced locally. A3–A7 callers must pass an outer transaction whenever legacy state and postings are mutated together; tests should inject failure after deletion and confirm outer rollback.

The per-draft ownership loop is correct but produces two queries per draft and repeats checks for duplicate account/category IDs. Deduplicating IDs and querying in bulk would reduce complexity and round trips, but it is not a correctness blocker.

### System accounts

`seedSystemAccounts` is sequentially idempotent:

- Existing non-null kinds are selected per user at [post-entry.ts:121](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:121).
- Only missing kinds are inserted at [post-entry.ts:127](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:127).
- All four kinds and required names are present at [post-entry.ts:103](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:103).

It is not concurrency-safe. Two concurrent seed calls can both observe a missing kind and one will lose to `accounts_system_kind_idx` with a uniqueness error. The index preserves data integrity, but the operation is not race-idempotent. This is not an A1b deviation—the brief explicitly requested select-then-insert-missing—but it must be handled before A2 wires seeding into potentially concurrent registration/demo/restore paths. Reasonable approaches include serializing on the user row/advisory lock, or catching a unique violation and re-resolving all four accounts.

`resolveSystemAccounts` correctly scopes to the user, collects all four kinds, and refuses an incomplete set at [post-entry.ts:146](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:146)–[164](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:164).

`updateTransactionHeader` remains header-only and does not touch postings ([post-entry.ts:78](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:78)). It does not tenant-scope the update itself at [post-entry.ts:96](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:96); that matches its existing trusted internal-helper shape, but callers must supply a previously owned transaction. If it becomes reachable using an untrusted ID, it should gain `userId` scoping.

## 4. Narrowing and generic exclusions

The new narrowing helper correctly rejects `"system"` at [account-type.ts:6](/home/udai/PennyPilot/apps/api/src/lib/account-type.ts:6). It is applied at the widened typed boundaries identified by TypeScript:

- Main account DTO: [accounts.ts:140](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:140)
- Account update type logic: [accounts.ts:342](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:342), [accounts.ts:360](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:360)
- EMI account map: [emis.ts:208](/home/udai/PennyPilot/apps/api/src/modules/credit/services/emis.ts:208)
- Bank details: [bank-details.ts:29](/home/udai/PennyPilot/apps/api/src/modules/credit/services/bank-details.ts:29)
- Overdraft details: [overdraft-details.ts:24](/home/udai/PennyPilot/apps/api/src/modules/credit/services/overdraft-details.ts:24)
- SIP commitments: [sip-commitments.ts:90](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-commitments.ts:90)
- SIP lifecycle: [sip-lifecycle.ts:141](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:141)
- EPF contributions: [epf-contributions.ts:22](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/epf-contributions.ts:22)
- Retirement details: [retirement.ts:26](/home/udai/PennyPilot/apps/api/src/modules/protection/services/retirement.ts:26)

The missed raw cast at [accounts.ts:175](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:175) is the exception noted above.

The two required generic exclusions are correct:

- `accountBalancesAtDate`: [accounts.ts:172](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:172)
- `listAccounts`: [accounts.ts:193](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:193)

They do not change existing behavior before system accounts are seeded. Once seeding begins, they prevent internal zero-balance accounts from surfacing publicly. The balance formulas themselves remain legacy-based and unchanged.

Other queries needing attention before or alongside A2 seeding include:

- Global account search at [search.ts:19](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/search.ts:19), which would expose “Expenses,” “Income,” “Opening Balances,” and “Clearing” in public search results.
- The demo “has data” guard at [demo.ts:68](/home/udai/PennyPilot/apps/api/src/modules/system/services/demo.ts:68). If system accounts are seeded before demo population completes, they can make an otherwise empty demo user appear populated and suppress recovery seeding. The plan already calls for the fresh-account guard to ignore system accounts.
- Backup/restore generic account enumeration must distinguish and remap system accounts rather than treating them as ordinary accounts. This is explicitly assigned to A6.
- Account edit/delete/archive selection at [accounts.ts:334](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:334) and [accounts.ts:507](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:507) needs A2 system-account guards.

Queries constrained to concrete public types—for example `type = 'bank'` in [balances.ts:35](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/balances.ts:35) and [average-balance.ts:222](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/average-balance.ts:222)—cannot select `"system"` and do not need an additional predicate for A1.

The aggregate in [insights.ts:103](/home/udai/PennyPilot/apps/api/src/modules/planning/services/insights.ts:103) can produce a `"system"` group after seeding, but the consumer only reads named bank/cash/liability types. It will therefore ignore that group. Explicit exclusion would still make the intent clearer when that reader is converted in PR-D.

## 5. MUST-NOT-CHANGE compliance

Compliant:

- No legacy column, table, enum member, or legacy index was dropped.
- `accounts.opening_balance_paise` remains at [hubs.ts:99](/home/udai/PennyPilot/apps/api/src/db/shared/hubs.ts:99).
- All legacy transaction fields remain.
- `transaction_splits` and `transfer_links` remain.
- No posting-based reader or aggregation formula was introduced.
- No `packages/shared` DTO file changed.
- No web file changed.
- The only account-query behavioral changes are the explicitly required system-row exclusions.
- Existing classifier/projection behavior was not rewired.
- Header-creating `postEntry` is absent; `replacePostings` only mirrors an existing transaction.

## 6. Tests and other concerns

Verification results:

- API TypeScript typecheck passed.
- Focused `postings.test.ts` passed: 20 tests, zero failures.
- `git diff --check` reported no whitespace errors.
- Full API tests were not green. Most failures were because the connected test database had not applied migration 0067 and therefore lacked `accounts.system_kind`. Those failures do not establish a code regression, but they mean full convergence has not been demonstrated.
- Independently of the stale database, schema decomposition fails because its expected schema inventory was not updated.
- Backup coverage fails because `postings` is not yet in `ALL_TABLES`; that is expected to be completed in A6, not A1.
- There are no direct tests for `replacePostings`, system-account seeding/resolution, soft-deleted parent replacement, cross-tenant account/category rejection, or delete/insert rollback. The A1b brief only explicitly requires builder tests, so their absence is not itself an A1b blocker. These cases must be covered by A7 before PR-A completion.

The schema allows duplicate posting rows and does not enforce zero-sum at the database level. This is intentional under the plan: `replacePostings`, reconciliation, and the per-transaction invariant are the enforcement layer.

## Later-slice requirements

- Before A2: make system-account seeding safe under concurrent calls; exclude system accounts from search and the demo fresh-data guard; add edit/delete/archive and public simple-API system-account guards.
- Before PR-B: teach `classifyShape` to distinguish a one-real/one-Clearing transfer leg, and add classifier/projection tests for it.
- By A6: register `postings` in backup table collections, implement restore remapping/synthesis/validation, and preserve/regenerate system accounts.
- By A7: add tenant-scope, soft-delete, rollback, reconciliation, restore, full-shape invariant, duplicate/extra-posting, and second-run-zero-write tests.
- Before any A3–A7 dual-write caller ships: ensure every legacy mutation and `replacePostings` call shares the same outer database transaction.

## Verdict

**A1-HAS-BLOCKERS**

Blockers:

1. Update schema decomposition/coverage expectations for the new `postings` table and `accountSystemKind` enum.
2. Replace the remaining unchecked `r.type as AccountType` boundary in `accountBalancesAtDate` with `assertPublicAccountType(r.type)`.

The schema, migration, row-local Clearing builder, and core post-entry primitive design are otherwise sound foundations for A2–A7 once those two A1 issues are corrected.