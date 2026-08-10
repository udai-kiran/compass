# Sonnet Worker Delegation — iteration 1

## Task
023 — PR-F(2): `transactionsCsv` derives from postings.

## Approved Plan
P1-P5 as written in `tasks/023-pr-f-backup-csv-postings/TASK.md`. Read it in full
first. Design rulings D1-D9 are binding; D9 is the list of *intended* behaviour
changes and every entry needs a test.

## Files and Symbols
- `apps/api/src/modules/system/services/backup.ts` — `transactionsCsv` only.
- `apps/api/src/modules/system/services/backup.test.ts` — new DB-backed CSV tests.

## Required Changes
1. Replace the query with the **exact SQL given in P1**. It was written and
   tenant-scoped by the reviewer; do not simplify it. In particular keep: two
   independent laterals, `a.user_id = t.user_id` on both account joins and
   `c.user_id = t.user_id` on the category join, `a.system_kind is null` for the real
   posting, `ca.system_kind is not null` for counters, and
   `order by x.name collate "C"`.
2. Mapping: `r.amount_paise === null ? "" : Number(r.amount_paise)`, and the same
   blank treatment for Account. Never `Number(null)`.
3. Header array stays byte-identical.
4. Add DB-backed tests for AC2-AC9 and AC11-AC17. Reuse the existing fixtures at
   `backup.test.ts:640` (ordinary/split), `:670` (transfer pair), `:698` (opening),
   `:366` (disposable user + cleanup). Extracting one small local fixture helper is
   justified rather than duplicating a large block.
5. Doc comment: state that amount/account/category are postings-derived, that
   multi-category splits are joined with `"; "`, and that transfer/opening/
   postings-less rows export a blank category by design.
6. Resolve AC18 explicitly: either add a safe-integer check or document acceptance
   of the existing bigint→`Number` behaviour. Say which you chose and why.

## Must Not Change
- The CSV header, column order, or `order by t.date desc`.
- `dumpTable`, `dumpUserTable`, `dumpDatabase`, `buildUserBackupStream`,
  `restoreDump`, `restoreUserBackup`.
- `ALL_TABLES`, `USER_TABLES`, `LINKED_TABLES`, `FILE_COLUMNS`.
- The route in `modules/system/routes/backup.ts`.
- Anything under `apps/extractor/`. Do not touch task 022's files.
- No schema change, no migration.

## Critical constraints
- Do **not** filter `archived_at` on accounts or categories (D8).
- Do **not** fall back to `t.category_id` for transfer/opening/postings-less rows —
  blank is the specified behaviour (D4/D9).
- Do **not** exclude transfers or openings. This is a row export, not an aggregate
  report.
- Keep one row per transaction. A split must not become N rows.

## Acceptance Criteria
AC1-AC18 in TASK.md.

## Commands
1. `node --test apps/api/src/modules/system/services/backup.test.ts`
2. `npm run test -w apps/api`
3. `npm run typecheck`
4. `npm run lint`

Note: (1) requires `DATABASE_URL` and THROWS at module load without it. If unset,
report the command as blocked — never as passing.

## Required Evidence
- files changed
- complete diff
- commands and literal output
- exit codes
- plan deviations or blockers

---

# Sonnet Worker Delegation — iteration 2 (review-2 BLOCKERS)

review-2 verdict: CHANGES REQUIRED. The production SQL and mapping in `backup.ts`
are **correct and approved** — they match the specified SQL exactly. All three
blockers are test-completeness gaps. Production code must NOT change.

## Required changes (test file only: `apps/api/src/modules/system/services/backup.test.ts`)
1. **BLOCKER — AC2 is not tested byte-for-byte.** The current test at `:1346`
   parses the CSV and compares fields, so it would accept quoted headers or changed
   line endings. Add a raw-string assertion against an empty-user fixture:
   ```ts
   assert.equal(csv, "Date,Merchant,Amount (paise),Category,Account,Notes\r\n");
   ```
   (Confirm the actual terminator `toCsv` emits and assert the true bytes.)
2. **BLOCKER — AC17's renamed-account case is untested.** Archived accounts/
   categories are covered at `:1634`, but no test renames an account and asserts the
   export shows the NEW name. Add it.
3. **BLOCKER — D9.6 has no test.** DELEGATION requires a test for every D9
   divergence. Insert a transaction with TWO real postings and assert exactly one
   row is exported and that `order by p.id limit 1` picks deterministically.
4. Minor: the AC14 comment claims categories are inserted in reverse alphabetical
   order, but only `Zulu` is newly inserted there. Correct the comment to match.

## Must Not Change
- `apps/api/src/modules/system/services/backup.ts` — approved as-is, including the
  AC18 documented acceptance (review-2 confirmed the reasoning is sound: this reads
  one unaggregated posting, unlike task 022's `sum()`).
- Existing tests in `backup.test.ts` — do not weaken or delete any.

## Commands
1. `npm run typecheck`
2. `npm run lint`
3. `node --test apps/api/src/modules/system/services/backup.test.ts` (expected
   BLOCKED — no `DATABASE_URL` locally; report as blocked, never as passing)

## Required Evidence
Complete diff, commands with literal output and exit codes, and confirmation that
`backup.ts` is byte-unchanged.

---

# Sonnet Worker Delegation — iteration 3 (review-3 BLOCKER)

review-3 confirmed AC2 and AC17 resolved and `backup.ts` byte-unchanged. **One
blocker remains.**

## BLOCKER — the D9.6 test would flake in CI
The new D9.6 test (`backup.test.ts:1713-1727`) asserts that the **first inserted**
posting wins. That assumption is invalid: `postings.id` is `defaultRandom()`
(`db/shared/ledger.ts:135`), i.e. `gen_random_uuid()`. The query's
`order by p.id limit 1` is deterministic for *fixed* UUID values but has no
relationship to insertion order, so the expected `Bank`/`-7000` posting wins only by
chance. This test will fail nondeterministically in CI.

## Required fix (test file only)
Insert the two real postings with **explicit, hard-coded UUIDs of known lexical
ordering** (e.g. `'00000000-0000-4000-8000-000000000001'` and
`...0002`), then assert the posting carrying the **smaller** UUID is the one
exported. Make the intent explicit in a comment so nobody "tidies" the literals away.
Keep the existing one-row cardinality assertion.

## Must Not Change
- `apps/api/src/modules/system/services/backup.ts` (byte-unchanged; SHA-256
  `1e675ee2790f571c0796503d9746087e78b279014aea4d6deb90f041444d7151`).
- Any other test.

## Commands
1. `npm run typecheck`
2. `npm run lint`
3. `node --test apps/api/src/modules/system/services/backup.test.ts` (expected
   BLOCKED locally — report as blocked, never as passing)

## Required Evidence
Complete diff, commands with literal output and exit codes, confirmation
`backup.ts` is byte-unchanged, and the two literal UUIDs used with a statement of
which one the test expects to win and why.
