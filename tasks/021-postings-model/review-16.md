## Review verdict

Overall: **BLOCKING due to required A6 acceptance-test gaps, not due to a production implementation defect.**

The inspected production implementation matches Design 1b and I found no correctness, tenant-isolation, money-paise, import-extension, or post-commit cleanup defect. However, several tests explicitly required by the approved plan are absent or insufficiently assertive, so AC3/AC4/AC5/AC6 are not fully proven.

Typecheck passes. The focused backup test could not run in this environment because `DATABASE_URL` is unset; it exited before registering its tests.

## Blocking findings

### B1 — AC3 old-style representative archive is not tested

The sole representative-shape test builds a current backup through `buildUserBackupStream`, after source reconciliation has populated postings:

- Source reconciliation: [backup.test.ts:716](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:716)
- Current archive construction: [backup.test.ts:732](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:732)
- Restore: [backup.test.ts:744](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:744)

Thus this is a new-style archive containing a `postings` table and archived posting rows. There is no representative ordinary/split/transfer/opening/soft-deleted archive with `postings` and system-account rows absent, as required by AC3 and PLAN §6.

AC2 incidentally exercises an archive with no source system accounts and no generated posting rows, but it covers only one ordinary transaction and still uses the current archive shape with an empty `postings` array. It does not satisfy the required old-style representative-branch test: [backup.test.ts:548](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:548).

**Severity: BLOCKING test-acceptance gap.**

### B2 — AC3/AC4 do not explicitly verify the representative branch shapes against expected source semantics

The test creates all requested shapes:

- Ordinary: [backup.test.ts:631](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:631)
- Split: [backup.test.ts:645](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:645)
- Transfer pair: [backup.test.ts:661](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:661)
- Opening balance: [backup.test.ts:689](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:689)
- Soft-deleted: [backup.test.ts:702](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:702)

But its substantive checks are:

- `repaired > 0`: [backup.test.ts:748](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:748)
- Archived posting IDs were not reused: [backup.test.ts:756](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:756)
- Every set sums to zero: [backup.test.ts:770](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:770)
- `findInconsistentPostings() === []`: [backup.test.ts:784](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:784)
- Soft-deleted transaction merely has some postings: [backup.test.ts:788](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:788)

It does not assert the expected account/amount/category shape for ordinary, split, transfer, or opening transactions. Both reconciliation and `findInconsistentPostings` use the same `computePostingDraftsForTransaction` implementation ([reconcile-postings.ts:91](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/reconcile-postings.ts:91), [reconcile-postings.ts:173](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/reconcile-postings.ts:173)), so a consistently wrong derivation branch could pass both reconciliation and the consistency check. Zero-sum alone would not detect that.

The approved plan explicitly requires matching the source-derived account/amount shape, not only self-consistency.

**Severity: BLOCKING test-vacuity/common-mode gap.**

### B3 — The mocked whole-DB test does not fully assert that every posting value is passed verbatim

The fixture includes all posting columns, and the SQL-column checks confirm none are omitted or deferred: [backup.test.ts:213](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:213), [backup.test.ts:239](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:239).

However, the value checks cover only:

- `id`
- `transaction_id`
- `account_id`
- `amount_paise`
- `note`

at [backup.test.ts:251](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:251).

They do not directly assert the verbatim values/positions of:

- `category_id`
- `necessity`
- `created_at`

Also, `params.includes(...)` does not prove correct column-to-value correspondence. A deep equality assertion against the expected ordered parameter list would prove the stated contract.

The implementation itself passes the row through correctly, but the exact AC6 mocked-test requirement is not fully met.

**Severity: BLOCKING test-acceptance gap.**

### B4 — The foreign-reference negative test covers a foreign account but not a foreign category

The malicious archived posting uses a foreign `account_id` but `category_id: null`: [backup.test.ts:849](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:849).

The production skip rejects the entire archived shape regardless of either field, so there is no implementation vulnerability. Nevertheless, the requested negative coverage specifically includes archived posting shapes with foreign account/category references. No non-null foreign category is tested.

**Severity: BLOCKING test-coverage gap under the stated review gate.**

### B5 — No test asserts skipped archived postings are excluded from summary row/table counts

The implementation places the skip correctly before reading/counting rows: [restore-user.ts:148](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:148).

But the approved plan explicitly requires a test that the returned `rows`/`tables` count only rows actually restored. The A6 tests check only `summary.rows > 0`; they never compare the summary against an archive containing posting rows or assert that the postings table is excluded: [backup.test.ts:592](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:592), [backup.test.ts:963](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:963).

**Severity: BLOCKING test-acceptance gap.**

## Item-by-item review

### 1. Backup registration

**PASS — no blocker.**

- `postings` is immediately after `transactions` in `ALL_TABLES`: [backup.ts:32](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:32)
- Ordering rationale covers all three parents: [backup.ts:28](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:28)
- It is in `LINKED_TABLES`, scoped through `transaction_id → transactions`: [backup.ts:70](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:70)
- It is absent from `USER_TABLES`: [backup.ts:48](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:48)
- `exportGaps()` remains exhaustive: [backup.ts:87](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:87)
- The no-double-scope test is present: [backup.test.ts:62](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:62)

No double export/scope exists.

### 2. Freshness guard

**PASS — no blocker. A genuinely freshly registered user is not rejected.**

The blocking set is exactly:

```text
accounts, transactions, insurance_policies, goals, holdings
```

at [restore-user.ts:15](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:15).

It does not include categories, notification preferences, or every `USER_TABLES` entry.

Both checks use the same helper and same narrow set:

- Pre-check: [restore-user.ts:102](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:102)
- In-transaction re-check: [restore-user.ts:127](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:127)

`countBlockingRows` appends `and system_kind is null` only for `accounts`: [restore-user.ts:50](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:50).

Real registration seeds both default categories and system accounts:

- Categories: [auth.ts:45](/home/udai/PennyPilot/apps/api/src/modules/system/services/auth.ts:45)
- System accounts: [auth.ts:46](/home/udai/PennyPilot/apps/api/src/modules/system/services/auth.ts:46)

Categories do not participate in the guard; seeded system accounts are excluded by `system_kind is null`. The real-registration-shaped AC2 setup now seeds both and restores successfully: [backup.test.ts:559](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:559). A real account is checked for 409: [backup.test.ts:562](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:562), [backup.test.ts:594](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:594).

### 3. Per-user insertion trust boundary

**PASS implementation; test-count gap noted in B5.**

The posting skip occurs before archive-row access, table counting, and row counting:

- Loop begins: [restore-user.ts:148](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:148)
- Skip: [restore-user.ts:151](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:151)
- Counts occur afterward: [restore-user.ts:152](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:152)

Consequently no archived posting row reaches `firstPassRow` or `insertRow`. Account, category, amount, necessity, note, ID, or timestamp content in an archived posting cannot be injected through the per-user path.

### 4. Post-commit reconcile control flow

**PASS — no blocker.**

The transaction commits and only then assigns `summary`, with no early return: [restore-user.ts:184](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:184).

The reconcile call is:

- Outside the inner rollback catch/release finally, which end at [restore-user.ts:191](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:191)
- Outside the outer uploaded-blob cleanup catch, which ends at [restore-user.ts:195](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:195)
- After `archive.close()` in the outer finally: [restore-user.ts:196](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:196)
- Awaited in its own try/catch: [restore-user.ts:203](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:203)

A throw records `{ repaired: 0, failed: 1 }`: [restore-user.ts:206](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:206). It cannot reach rollback or uploaded-blob deletion because those scopes have completed.

The injectable-throw test meaningfully uploads a blob and proves:

- Failed summary: [backup.test.ts:963](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:963)
- Committed transaction survives: [backup.test.ts:967](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:967)
- Uploaded blob is not deleted: [backup.test.ts:974](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:974)

Route-level failure logging is present and correctly occurs after the awaited restore: [routes/backup.ts:97](/home/udai/PennyPilot/apps/api/src/modules/system/routes/backup.ts:97).

### 5. Injectable default

**PASS — no blocker.**

The default is exactly a wrapper over the existing pool:

```ts
(p, uid) => reconcileUserPostings(createDb(p), uid)
```

at [restore-user.ts:91](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:91).

The route does not override it, preserving production behavior: [routes/backup.ts:97](/home/udai/PennyPilot/apps/api/src/modules/system/routes/backup.ts:97).

### 6. Reconcile coverage and tenant safety

**PASS — no tenant/cross-user blocker found.**

- System accounts are seeded before reconciliation: [reconcile-postings.ts:73](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/reconcile-postings.ts:73)
- Transaction enumeration filters by `userId` and has no `deleted_at` filter: [reconcile-postings.ts:82](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/reconcile-postings.ts:82)
- Each derivation is tenant-scoped by transaction ID plus user ID: [transactions.ts:207](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:207)
- Soft-deleted rows are therefore included.
- Opening, transfer, split, and ordinary branch order is explicit: [transactions.ts:213](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:213), [transactions.ts:221](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:221), [transactions.ts:233](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:233), [transactions.ts:256](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:256)
- `replacePostings` re-checks transaction ownership and every account/category before deleting or inserting: [post-entry.ts:49](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:49), [post-entry.ts:57](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:57), [post-entry.ts:63](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:63)

The transfer-link and split lookups are keyed by a destination-owned, globally unique transaction ID. They do not introduce a cross-user traversal path. Even if malformed data produced a foreign draft reference, `replacePostings` rejects it before writing.

### 7. Whole-database restore

**PASS implementation; mocked assertion gap noted in B3.**

`apps/api/src/db/restore.ts` has no working-tree diff.

`restoreDump` iterates shared `ALL_TABLES`: [restore.ts:67](/home/udai/PennyPilot/apps/api/src/db/restore.ts:67). Because `postings` follows accounts, categories, and transactions in that shared order, it is inserted after its parents.

`postings` has no deferred or omitted entry:

- Deferred map: [restore.ts:9](/home/udai/PennyPilot/apps/api/src/db/restore.ts:9)
- Omitted map: [restore.ts:20](/home/udai/PennyPilot/apps/api/src/db/restore.ts:20)

Thus whole-DB restore inserts each archived posting row verbatim through `firstPassRow` and `insertRow`: [restore.ts:69](/home/udai/PennyPilot/apps/api/src/db/restore.ts:69).

### 8. A6 test coverage

| Requirement | Status |
|---|---|
| AC2 seeded categories + system accounts restore | PASS |
| AC2 real account causes 409 | PASS |
| Ordinary representative shape constructed | PARTIAL — no explicit expected-shape assertion |
| Split representative shape constructed | PARTIAL — no explicit expected-shape assertion |
| Transfer pair constructed | PARTIAL — no explicit expected-shape assertion |
| Opening balance constructed | PARTIAL — no explicit expected-shape assertion |
| Soft-deleted posting synthesized | PASS for existence; expected shape not asserted |
| Zero-sum | PASS |
| `findInconsistentPostings == []` | PASS, but shares derivation implementation with reconcile |
| New archive rows skipped | PASS |
| Old-style representative archive | **MISSING** |
| Foreign archived account reference | PASS |
| Foreign archived category reference | **MISSING** |
| Post-commit injected throw | PASS and non-vacuous |
| Committed database rows survive throw | PASS |
| Uploaded blob survives throw | PASS and non-vacuous |
| Summary posting failure surfaced | PASS |
| Whole-DB posting inserted after parents | PASS |
| Whole-DB all columns present | PASS |
| Whole-DB every value mapped verbatim | **INCOMPLETE** |
| Accounts/categories/transactions before postings | PASS |
| Skipped postings excluded from summary counts | **MISSING** |

### 9. PR-A guardrails

**PASS for A6 — no A6 guardrail violation found.**

- No `packages/shared` or web diff is associated with A6.
- `db/restore.ts` is unchanged.
- No reader was made posting-derived.
- The existing transaction hydration remains based on legacy transactions, splits, and transfer links; it does not read postings: [transactions.ts:160](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:160).
- The posting-related changes in `transactions.ts`, `post-entry.ts`, and `reconcile-postings.ts` are writer/derivation infrastructure, not reader conversion.
- No A6 schema change or deferred-column change was introduced.

The dirty worktree contains broader PR-A schema and writer changes from other slices, but nothing inspected indicates that A6 itself expanded into shared DTOs, web, or posting-derived readers.

### 10. Remaining defects and verification

No additional production correctness or security defect was found.

- Money remains integer paise throughout reconciliation and restore.
- Split summation uses the shared paise-safe helper: [transactions.ts:237](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:237).
- All inspected relative TypeScript imports include `.ts`.
- Archived posting shapes are outside the per-user trust boundary.
- Synthesized rows are tenant-owned or rejected.
- Reconcile failures are best-effort, awaited, surfaced, and cannot unwind committed state.

Verification performed:

- `npm run typecheck -w apps/api`: **PASS**
- `node --test apps/api/src/modules/system/services/backup.test.ts`: **NOT EXECUTED successfully**; the file failed at startup because `DATABASE_URL` is unset. Result: 0 passing tests, 1 harness-file failure. Therefore runtime passage of the DB-backed A6 tests could not be independently confirmed here.

## Final disposition

**BLOCKING.**

The production implementation is acceptable and matches the approved A6 design. Approval is blocked by the missing/incomplete acceptance tests B1–B5, especially the absent old-style representative archive and the common-mode/vacuous shape checks for ordinary, split, transfer, and opening derivations.