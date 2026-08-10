# Sonnet Worker Delegation — iteration 1

## Task
022 — PR-F(1): `apps/extractor/src/db.ts:loadCardLedgerTxns` reads postings.

## Approved Plan
P1-P5 as written in `tasks/022-pr-f-extractor-postings/TASK.md`. Read that file in
full first — the design rulings D1-D7 are binding and each exists because a specific
alternative was considered and rejected.

## Files and Symbols
- `apps/extractor/src/db.ts` — `loadCardLedgerTxns` (SQL + result mapping + doc
  comment). `LedgerTxnRow` stays byte-identical.
- `apps/extractor/src/statement-duplicate.test.ts` — `createLedgerTxn` fixture and
  new tests.

## Required Changes
1. Replace the SQL with the P1 query (postings-sourced; `p.account_id = $2`;
   `sum(p.amount_paise)::bigint`; `group by t.id, t.date, t.occurred_at, t.merchant`).
2. Add the D6 safe-integer check before `Number(...)`; throw a clear overflow error.
3. Fixture: also insert the real posting. For the transfer test, additionally create
   a same-user Clearing system account (`accounts.system_kind = 'clearing'`, type
   `'system'`) and the balancing counter-posting (D7).
4. Add tests for AC2-AC8 and AC10.
5. Update the doc comment: amount + account scope come from postings; transfer legs
   and opening rows are deliberately INCLUDED (D1).

## Must Not Change
- `LedgerTxnRow`, the exported signature, or any caller
  (`statement-duplicates.ts`, `matchLinesToLedger`).
- The two `update transactions set reconciled_statement_id` statements.
- `apps/extractor/package.json` — no new dependency. No Drizzle. Raw `pg` SQL only.
- Anything under `apps/api/`. Do not touch task 023's files.
- No schema change, no migration.

## Critical constraints
- **Do NOT add** `NOT EXISTS (... system_kind = 'clearing'/'opening')`. That guard
  belongs to aggregate readers only; adding it here is the exact regression AC4
  exists to catch (D1).
- Sign convention is load-bearing: card spend = negative paise; the matcher does
  exact equality.
- Tenant scoping comes from `t.user_id = $1` on the joined parent — postings have no
  `user_id`.

## Acceptance Criteria
AC1-AC10 in TASK.md.

## Commands
1. `node --test apps/extractor/src/statement-duplicate.test.ts`
2. `node --test apps/extractor/src/extract.test.ts`
3. `npm run test -w apps/extractor`
4. `npm run typecheck`
5. `npm run lint`

Note: (1) THROWS without `DATABASE_URL` rather than skipping. If it is unset, say so
explicitly and report the command as blocked — do not report it as passing.

## Required Evidence
- files changed
- complete diff
- commands and literal output
- exit codes
- plan deviations or blockers

---

# Sonnet Worker Delegation — iteration 2 (review-2 follow-up)

review-2 found **no blockers**; the implementation is approved. These are
test-strength gaps only. Production code in `db.ts` must NOT change.

## Required changes (test file only: `apps/extractor/src/statement-duplicate.test.ts`)
1. **Strengthen the AC5 test (currently weak).** Today both the legacy
   `transactions.account_id` AND the posting point at the *other* account, so the
   pre-change query would also return zero rows — the test passes for the wrong
   reason. Fix: set the legacy `transactions.account_id` to the **queried card
   account** while placing the posting on the **other** account, then assert zero
   rows. That makes it decisive about source selection, matching AC3's decoy
   technique.
2. **Add the missing AC7 date-range test.** Cover an out-of-range row excluded and
   both `BETWEEN` boundaries included (the bounds are inclusive).
3. **Rename the misleading fixture labels.** Users/accounts are still named
   "AC9 test" (`:50`, `:59`) though they now serve AC2-AC10.

## Must Not Change
- `apps/extractor/src/db.ts` — approved as-is.
- Anything outside `apps/extractor/src/statement-duplicate.test.ts`.

## Commands
1. `npm run typecheck`
2. `npm run lint`
3. `node --test apps/extractor/src/statement-duplicate.test.ts` (expected BLOCKED —
   no `DATABASE_URL` locally; report as blocked, never as passing)

## Required Evidence
Complete diff, commands with literal output and exit codes, and confirmation that
`db.ts` is byte-unchanged.
