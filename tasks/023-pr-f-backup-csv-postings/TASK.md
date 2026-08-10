# Task 023: PR-F(2) — backup CSV projection derives from postings

## Status
COMPLETE — implementation done, Codex-approved (review-4: APPROVED, no blockers),
typecheck/lint green, no scope creep, and the DB-backed tests have now **executed
and passed** against the dev Postgres (`compass_dev` on 192.168.2.196):
`node --test apps/api/src/modules/system/services/backup.test.ts` → **35/35 pass,
exit 0** (19 pre-existing + 16 new). AC2-AC9 and AC11-AC17 are therefore proven, not
merely reviewed; AC1 and AC18 remain inspection-only by nature. A controlled A/B
(stash → re-run → pop) showed **identical 59 failures across the same 6 files in
both states**, so zero apps/api failures are attributable to this change. Evidence:
`tasks/pr-f/verification-4.md`, `verification-5.md`.

## Pre-existing failures observed on the dev DB (NOT PR-F — separate issue)
Both with and without PR-F: 59 failures in `card-due-tasks.test.ts` (20),
`reconciliation-writes.test.ts` (18), `user-tasks.test.ts` (13),
`user-tasks.route.test.ts` (4), `postings-pr-e-parity.test.ts` (3), `emis.test.ts` (1)
— all PR-E code, none touched by PR-F. Includes a hard `TypeError:
row.created_at.toISOString is not a function` at `user-tasks.ts:55` (raw SQL returns
a string, not a Date). Either `main` is red, or the shared dev DB's residual data
(7 legacy `transactions`, **0 `postings`**, 48 `@example.invalid` users) breaks tests
that assume a clean database. Needs its own investigation.

## Objective
`transactionsCsv` in `apps/api/src/modules/system/services/backup.ts` derives the
Amount, Account and Category columns from `postings` instead of
`transactions.amount_paise` / `account_id` / `category_id`, with the CSV's header
and one-row-per-transaction shape unchanged.

## Root Cause
Not a defect. Planned migration step: `tasks/021-postings-model/PLAN-dualwrite.md`
line 58. Also `review-5.md:141` — "CSV conversion can remain here [PR-F], but JSON
archive/restore compatibility cannot; that portion belongs in PR-A" (already done).

## Background facts (verified, do not re-derive)
Evidence: `tasks/pr-f/investigation-1.md`, `investigation-2.md`, `investigation-3.md`.

- F1. Current query (`backup.ts:127-144`) selects
  `t.date, t.merchant, t.amount_paise, c.name as category, a.name as account, t.notes`
  with `left join categories c on c.id = t.category_id`,
  `left join accounts a on a.id = t.account_id`, `where t.user_id = $ and
  t.deleted_at is null`, `order by t.date desc`.
- F2. Header is exactly `Date, Merchant, Amount (paise), Category, Account, Notes`.
- F3. Served by `GET /api/export/transactions.csv`
  (`modules/system/routes/backup.ts:37-43`), `text/csv; charset=utf-8`, filename
  `compass-transactions.csv`, scoped to `req.session!.userId`. **User-facing
  download only.**
- F4. **Restore never reads this CSV.** `restoreDump` (`db/restore.ts`) and
  `restoreUserBackup` (`restore-user.ts`) consume the JSON dump / v2 archive and
  build column lists generically from each row's own keys. Changing the CSV cannot
  break restore. `dumpTable`/`dumpUserTable` use `select *` and are untouched.
- F5. **`transactionsCsv` has no tests at all.** No assertion anywhere covers its
  header or content, so no existing test will catch a regression here. Tests are
  therefore part of this task, not optional.
- F5a. **Correction (review-1 §6):** `backup.test.ts` has **no skip guard**.
  `requireDatabaseUrl()` *throws* when `DATABASE_URL` is absent
  (`backup.test.ts:333`) and is called at module load (`:345`). `DATABASE_URL` is a
  hard requirement, not a skip.
- F5b. Reusable fixtures already exist in `backup.test.ts`: ordinary + split
  (`:640`), transfer pair/link (`:670`), opening row (`:698`), posting
  reconciliation (`:725`), disposable-user + cleanup helpers (`:366`).
- F5c. `toCsv` (`lib/csv.ts:141`) stringifies the value and quotes only when it
  contains a comma, quote, CR or LF — so `""` emits a correct empty field.
- F6. Real accounts have `system_kind IS NULL`; the category/necessity dimension
  lives on the **counter** posting (Expenses/Income), not the real posting.
- F7. Dual-write invariant: exactly one posting on the real account per transaction,
  its amount equal to legacy `amount_paise` (parity holds today).
- F8. **Splits break category parity.** `setSplits` never writes the parent's
  `transactions.category_id`, and it is unconstrained; `buildSplitPostings` emits one
  counter per split, each with its own NOT NULL `categoryId`. So for a split
  transaction the counter categories and `t.category_id` are independently managed
  and can differ. (investigation-3 Q1.)
- F9. `user-tasks.ts:97-104` establishes the `left join lateral` precedent, under
  which a transaction with no postings still yields a row with null account/amount.
  Other converted readers use inner joins and drop such rows. No PR added an
  explicit test for the zero-posting case.

## Decisive design rulings

- **D1 — Preserve the header and one-row-per-transaction cardinality exactly.**
  PR-F is a source swap, not a format change. Emitting one row per posting would
  turn a split into N rows and silently change a user-facing export. Format
  evolution belongs to PR-G/G1 where DTOs are finalised.
- **D2 — Amount and Account come from the single real posting** (`system_kind IS
  NULL`) via `left join lateral`, following F9's precedent so a postings-less
  transaction still appears rather than silently vanishing from an export.
- **D3 — A transaction with no real posting emits empty Amount and empty Account,
  never `0`.** `Number(null)` is `0`, and a silent `0` in a money column of a
  user-facing export is worse than a visible blank. The anomaly must be visible and
  is covered by a test.
- **D4 — Category comes from the counter postings, with an explicit split rule.**
  `t.category_id` is itself a legacy column slated for the PR-G/G4 drop, so leaving
  it would not finish the job. **Rule (final wording, review-1 §1):** *Category is
  the sorted, distinct set of category names on the transaction's system-account
  postings, joined with `"; "`. A transfer leg, an opening row, or a postings-less
  transaction therefore exports blank, regardless of any stale legacy
  `transactions.category_id`.* Falling back to the legacy category for those shapes
  was rejected: it would leave PR-F depending on a field scheduled for removal.
  Ordering must be `order by x.name collate "C"` so it is locale-independent —
  category names are not globally unique (the unique index includes nullable
  `parent_id`, `foundation.ts:83`), so `distinct name` is the right collapse.
- **D5 — Ordering stays exactly `order by t.date desc`.** No tiebreaker is added;
  changing row order is an unnecessary user-visible change. Tests must therefore
  use distinct dates to stay deterministic.
- **D6 — `dumpTable` / `dumpUserTable` / restore are untouched** (F4).
- **D7 (review-1 BLOCKER 2) — tenant-scope the account and category joins
  explicitly.** `postings` has no `user_id` (`ledger.ts:132`). Filtering only
  `t.user_id` stops another user's *transaction* entering the export, but does not
  stop a malformed posting joining another user's *account or category name* into
  a row. Every joined `accounts`/`categories` row must carry `... and x.user_id =
  t.user_id`, per the convention in `periods.ts:125,150`.
- **D8 — do NOT filter `archived_at`** on accounts or categories. Neither query
  does today; adding it would blank historical names in the export.
- **D9 — the full, deliberate divergence list (review-1 BLOCKER 1).** Split category
  is *not* the only intended change. These all diverge from today and each must be
  documented and tested:
  1. Split → category becomes the sorted distinct split categories (was the
     unmanaged parent category).
  2. A previously categorised transaction later linked as a **transfer** → blank
     category (was its stale legacy category). Linking rebuilds postings to the
     Clearing shape but never clears `t.category_id` (`transactions.ts:221,224`).
  3. An **opening row** carrying a legacy category → blank category. The opening
     builder ignores the parent category (`postings.ts:201`).
  4. A **postings-less** transaction → blank amount, account *and* category (was all
     three legacy values).
  5. A transaction whose posting has **drifted** from its legacy values → exports the
     posting's values. This is the intended source-swap behaviour (AC4).
  6. **Multiple real postings** → `order by p.id limit 1` picks one deterministically;
     today the legacy value is exported. Relies on the migration invariant.

## Carve-out — the "last reader" premise is FALSE (review-1 BLOCKER, lead-verified)

The working assumption that "after PR-F every reader is on postings and the legacy
columns are read-only relics" is **wrong**, and PR-G planning depends on it. After
PR-F these production readers still read `transactions.amount_paise` /
`transactions.account_id`:

| Reader | Location | Disposition |
|---|---|---|
| `listTransactions` filters (`accountId`, min/max amount) | `ledger/services/transactions.ts:66,70-73` | PR-G/G1 (DTO) |
| `listTransactions` totals (sum/inflow/outflow) | `transactions.ts:327-329` | PR-G/G1 |
| Transaction DTO hydration (`select()` returns legacy cols) | `transactions.ts:~156-160`, `:318` | PR-G/G1 |
| Transfer-counterpart account hydration | `transactions.ts:~146-150` | PR-G/G1 |
| Repayment-candidate matching | `ingest/services/transfer-classification.ts:239-240` | PR-G |
| Opening-balance reconciliation | `ledger/services/accounts.ts:430-459` | PR-G/G4 |
| Account-delete guard | `accounts.ts:560-564` | PR-G/G4 |
| `suggestTransfers` | `ledger/services/transfers.ts:39-59` | PR-G/G2-G4 |

Lead-verified by direct read: `transactions.ts:66,70-73`, `transactions.ts:327-329`,
`transfer-classification.ts:239-240`, `transfers.ts:39-59`.

None is converted here, and that is defensible: `PLAN-dualwrite.md` G1 explicitly
owns "postings-native readers + finalized shared `Transaction`/`Account` DTOs", and
G2/G4 collapse transfers and drop `transfer_links`, `is_opening` and the legacy
columns — so converting these now is throwaway work. They are correct today because
the columns are still dual-written.

**The actionable consequence: G4's column drop breaks all eight.** PR-G's scope must
name them explicitly rather than assuming a clean field.

## Scope
- `apps/api/src/modules/system/services/backup.ts` — `transactionsCsv` only.
- `apps/api/src/modules/system/services/backup.test.ts` — new DB-backed CSV tests.

## Dependencies
None. Independent of task 022.

## Plan
- P1: Replace `transactionsCsv`'s SQL with exactly this shape (two independent
  laterals so real and counter postings never multiply the row):
  ```sql
  select
    t.date, t.merchant, rp.amount_paise,
    coalesce(cat.category, '') as category,
    rp.account, t.notes
  from transactions t
  left join lateral (
    select p.amount_paise, a.name as account
    from postings p
    join accounts a on a.id = p.account_id
                   and a.user_id = t.user_id
                   and a.system_kind is null
    where p.transaction_id = t.id
    order by p.id
    limit 1
  ) rp on true
  left join lateral (
    select string_agg(x.name, '; ' order by x.name collate "C") as category
    from (
      select distinct c.name
      from postings cp
      join accounts ca on ca.id = cp.account_id
                      and ca.user_id = t.user_id
                      and ca.system_kind is not null
      join categories c on c.id = cp.category_id
                       and c.user_id = t.user_id
      where cp.transaction_id = t.id
    ) x
  ) cat on true
  where t.user_id = ${userId} and t.deleted_at is null
  order by t.date desc
  ```
- P2: Map a missing real posting to empty-string Amount and Account rather than `0`
  (D3). **Do not call `Number()` before the null test** — `Number(null)` is `0`:
  `r.amount_paise === null ? "" : Number(r.amount_paise)`. Keep `Date`, `Merchant`
  and `Notes` sourced from `transactions` as today.
- P3: Keep the header array byte-identical (D1/F2).
- P4: Add the DB-backed tests in Verification, using the file's existing
  `DATABASE_URL` skip guard.
- P5: Document in the function's doc comment that amount/account/category are
  postings-derived and that the multi-category split rule is intentional.

## Acceptance Criteria
- AC1: `transactionsCsv` references none of `t.amount_paise`, `t.account_id`,
  `t.category_id`.
- AC2: Header row is exactly `Date,Merchant,Amount (paise),Category,Account,Notes`.
- AC3: An ordinary expense yields one row whose Amount equals the real posting's
  signed paise and whose Account and Category equal the legacy values — parity.
- AC4: A transaction whose legacy `amount_paise`/`account_id` hold decoy values
  different from its postings exports the **postings**' values. Decisive proof of
  postings-sourcing.
- AC5: A split transaction yields exactly **one** row (D1) whose Category lists its
  distinct counter categories joined by `"; "` (D4).
- AC6: A transfer pair yields one row per leg, each showing that leg's own real
  account and signed amount.
- AC7: A transaction with no postings yields a row with empty Amount and empty
  Account (D3) — not `0`, and not a dropped row.
- AC8: Soft-deleted transactions are excluded; another user's transactions are never
  present.
- AC9: Row order is by `date desc`, unchanged.
- AC10: `npm run typecheck`, `npm run lint`, and `backup.test.ts` are green,
  including its existing schema-coverage assertions.
- AC11 (D9.2): a categorised transaction later linked as a transfer exports a
  **blank** Category, even though `t.category_id` is still set.
- AC12 (D9.3): an opening row carrying a legacy category exports its real
  amount/account and a **blank** Category.
- AC13 (D9.4): a postings-less transaction exports blank Amount, Account **and**
  Category — three blanks, not just two.
- AC14 (D4): category ordering is deterministic and locale-independent — proven by a
  fixture whose categories are inserted in reverse alphabetical order; duplicate
  category names collapse to one entry.
- AC15: CSV escaping is correct for a category, merchant and note containing a
  comma, a double quote and a newline (F5c).
- AC16 (D7): a posting referencing a **second user's** account or category can never
  surface that user's account/category name in the first user's export.
- AC17 (D8): an archived account and an archived category still appear, showing
  their current names; a renamed account shows the new name.
- AC18: the amount is either safe-integer checked, or the existing
  bigint→`Number` behaviour is explicitly accepted in the doc comment. State which.

## Verification
- T1: `node --test apps/api/src/modules/system/services/backup.test.ts` — DB-backed.
  `DATABASE_URL` is a **hard requirement**: `requireDatabaseUrl()` throws at module
  load (`backup.test.ts:333,345`); nothing skips (F5a). Report literal pass/fail
  counts and confirm the new CSV tests actually executed.
- T2: `npm run test -w apps/api`
- T3: `npm run typecheck`
- T4: `npm run lint`

## Non-Goals
- Changing the CSV header, column order, or row ordering.
- Touching `dumpTable`, `dumpUserTable`, `restoreDump`, `restoreUserBackup`,
  `ALL_TABLES`/`USER_TABLES`/`LINKED_TABLES` (F4/D6).
- Converting `suggestTransfers` (see Carve-out).
- Any schema change or legacy-column drop.

## Review log
- **review-1 (Codex, plan):** verdict CHANGES REQUIRED. Core approach (one row per
  transaction, real posting via `LEFT JOIN LATERAL`, blank anomaly fields) confirmed
  sound; D1/D2/D3 agreed, `toCsv` blank-field handling verified at `csv.ts:141`.
  Two BLOCKERS, both validated by the lead and folded in:
  (1) the parity claim was incomplete — transfer/opening stale-category, postings-less
  category, drift and multi-real-posting all diverge too → new **D9** divergence list
  + AC11-AC13; (2) the "only `suggestTransfers` remains" premise is false — eight
  production readers remain, including the main `listTransactions` path → Carve-out
  table rewritten, lead-verified by direct read of four of them.
  Non-blocking amendments taken: Codex's exact tenant-scoped SQL adopted verbatim
  into P1 (**D7**); `collate "C"` for deterministic ordering; `Number()` must not
  precede the null test; `archived_at` must not be filtered (**D8**); the
  "DATABASE_URL skip guard" claim corrected to a hard requirement (F5a); existing
  fixtures catalogued (F5b); AC14-AC18 added for escaping, cross-tenant leakage,
  archived/renamed names, determinism and bigint safety.
- **review-2 (Codex, implementation):** production SQL confirmed to match the
  approved query exactly, with no deviation; scope clean. Three test-completeness
  BLOCKERS: AC2 compared parsed fields rather than bytes; AC17's renamed-account case
  untested; D9.6 untested. Fixed in iteration 2.
- **review-3 (Codex, delta):** AC2 and AC17 resolved, `backup.ts` byte-unchanged.
  One new BLOCKER — the D9.6 test assumed the first-inserted posting had the lowest
  id, but `postings.id` is `gen_random_uuid()` (`ledger.ts:135`), so `order by p.id`
  is unrelated to insertion order and the test would flake in CI. A genuine catch:
  the test passed only by chance. Fixed in iteration 3 with explicit UUID literals.
- **review-4 (Codex, final):** **APPROVED, no blockers.** `backup.ts` byte-unchanged
  (SHA-256 `1e675ee2…`); D9.6 now deterministic (`…0001 < …0002` by UUID byte
  ordering, carrying the asserted `Test Bank` / `-7000`); no id collisions, cleanup
  cascades. AC1 and AC18 remain inspection-only by nature.
- **Deferred, recorded not dropped:** Codex notes the route contract (content-type
  `text/csv; charset=utf-8`, filename `compass-transactions.csv`) is not covered by
  service-level tests. Out of scope for PR-F; worth a route test later.
