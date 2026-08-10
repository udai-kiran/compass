# Task 022: PR-F(1) — extractor `loadCardLedgerTxns` reads postings

## Status
COMPLETE — implementation done, Codex-approved (review-3: no blockers),
typecheck/lint green, no scope creep, and the DB-backed tests have now **executed
and passed** against the dev Postgres (`compass_dev` on 192.168.2.196):
`node --test apps/extractor/src/statement-duplicate.test.ts` → **10/10 pass, exit 0**;
`npm run test -w apps/extractor` → **72/72 pass, exit 0**. AC2-AC8 and AC10 are
therefore proven, not merely reviewed. AC1 remains inspection-only by nature.
Controlled A/B (stash/pop) confirmed zero apps/api failures attributable to this
change. Evidence: `tasks/pr-f/verification-4.md`, `verification-5.md`.

## Objective
`apps/extractor/src/db.ts:loadCardLedgerTxns` sources each ledger row's account
scope and signed amount from `postings` instead of `transactions.account_id` /
`transactions.amount_paise`, with byte-identical downstream behaviour for the
statement-duplicate matcher.

## Root Cause
Not a defect. Planned migration step: `tasks/021-postings-model/PLAN-dualwrite.md`
line 58 — "**PR-F:** extractor `apps/extractor/src/db.ts` → postings; backup CSV
derives from postings."

## Background facts (verified, do not re-derive)
Evidence: `tasks/pr-f/investigation-1.md`, `investigation-2.md`, `investigation-3.md`.

- F1. `postings(id, transaction_id, account_id, category_id, amount_paise,
  necessity, note, created_at)`. No `user_id`, no `deleted_at`. Scoped via parent
  `transactions`. Indexed on `transaction_id` and `account_id`.
- F2. Real accounts have `accounts.system_kind IS NULL`; system accounts are
  `'expenses' | 'income' | 'opening' | 'clearing'`.
- F3. Dual-write invariant: for every current shape (ordinary / split / transfer
  leg / opening row) there is **exactly one posting on the real account**, and its
  `amount_paise` equals the legacy `transactions.amount_paise`. So a postings-derived
  read is at parity with the legacy read today.
- F4. Sign convention is unchanged and load-bearing: a card spend is **negative**
  paise; `matchLinesToLedger` (`extract.ts:833-836`) compares
  `t.amountPaise !== signed` for exact equality. Proven by `extract.test.ts:395-398`
  (`line(50000,"debit")` matches `ledgerTxn("t1", -50000)`) and `:407-415`
  (never matches `+50000`).
- F5. The extractor has **no Drizzle access** — deps are `@compass/shared`,
  `@compass/ai`, `bullmq`, `mailparser`, `pdfjs-dist`, `pg`, `zod`. The conversion
  must be hand-written raw SQL on `pg.Pool`.
- F6. Sole production call site: `statement-duplicates.ts:30`, inside
  `annotateStatementDuplicates`. Date range is the lines' own span ±4 days.
- F7. The two `update transactions set reconciled_statement_id = ...` statements in
  `upsertReconciliation` (`db.ts:457-466`) touch neither legacy column and are
  **out of scope** — confirmed, not an oversight.
- F8. `postings` has no `deleted_at`; postings are retained on soft-deleted
  transactions. Readers must keep filtering `t.deleted_at is null` on the parent.

## Decisive design rulings

- **D1 — Filter on `postings.account_id`, and do NOT exclude transfers or
  openings.** Legacy `where account_id = $2` includes transfer legs and opening
  rows on the card. Adding the `NOT EXISTS (... system_kind = 'clearing')` guard
  used by `periods.ts`/`dashboard.ts` would be a **regression**: a card repayment
  booked as a transfer would stop matching its statement payment line, producing a
  duplicate draft. The correct precedent is Shape 5,
  `reconciliation-reads.ts:124-137` (`ledgerDuesAtDates`), which filters by
  `p.account_id = $accountId` with no `system_kind` filter and no transfer
  exclusion. Aggregate-report readers exclude transfers; per-account row-list
  readers must not.
- **D2 — Aggregate with `sum(p.amount_paise)` grouped by transaction, not
  `limit 1`.** Today exactly one posting per real account per transaction (F3), so
  `sum` is identical to picking the single row. `sum` additionally stays correct if
  a transaction ever carries two postings on one account, and it preserves
  one-row-per-transaction cardinality, matching legacy. `LIMIT 1` would silently
  drop the second leg. **Wording correction (review-1 §2):** if two same-account
  postings ever sum to something other than `transactions.amount_paise`, that is
  *drift*, not parity — the shape is invalid under the dual-write invariant. D2
  defines sensible postings-native behaviour for it; it does not claim legacy parity.
- **D3 — No `accounts` join.** `$2` is always a real credit-card account id
  (`loadCreditCards` filters `a.type = 'credit_card'`; system accounts are type
  `'system'`), so an `a.system_kind is null` filter is dead weight. Matches D1's
  precedent, which also omits it.
- **D4 — Accept the zero-posting exposure; do not add a legacy fallback.** A
  transaction with no postings vanishes from the result, so its statement line
  would not match and would land as a pending draft. Control is the existing
  deployment gate (`PLAN-dualwrite.md` steps 3-4: full-shape reconciliation must be
  a no-op before any reader is converted) — the identical exposure PR-B..PR-E
  already accepted. A `COALESCE` to the legacy column would defeat the migration
  and complicate PR-G's contract step. Recorded as accepted risk, not an oversight.
- **D5 — `LedgerTxnRow`, its field names, and the exported signature are
  unchanged.** Only the SQL source changes. This keeps `matchLinesToLedger` and
  `statement-duplicates.ts` untouched.
- **D6 (review-1 BLOCKER 1) — the summed bigint MUST be range-checked before
  `Number(...)`.** `sum(...)::bigint` is a new aggregate, and every converted reader
  range-checks its aggregates — e.g. `periods.ts:228-230` throws
  "Income/expense aggregate exceeded a safe integer — refusing to lose paise", and
  `reconciliation-reads.ts:138`. Verified by the lead against both files. Silently
  rounding paise is exactly the failure this convention exists to prevent.
- **D7 (review-1 BLOCKER 2) — the transfer-leg fixture MUST include a Clearing
  posting.** A fixture with only the card posting would pass AC4 even if someone
  later added the forbidden `NOT EXISTS (... system_kind = 'clearing')` guard,
  because there would be no Clearing posting to exclude on. That makes the D1
  regression test worthless. The fixture must create a same-user Clearing system
  account and the balancing counter-posting.

## Scope
- `apps/extractor/src/db.ts` — `loadCardLedgerTxns` SQL only (lines ~232-260).
- `apps/extractor/src/statement-duplicate.test.ts` — fixture must insert postings;
  add the characterization tests below.

## Dependencies
None. Independent of task 023.

## Plan
- P1: Rewrite `loadCardLedgerTxns`'s SQL to derive the account filter and signed
  amount from `postings`, per D1-D3. Target shape:
  ```sql
  select t.id,
         sum(p.amount_paise)::bigint as amount_paise,
         to_char(t.date, 'YYYY-MM-DD') as date,
         to_char(t.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as occurred_at_ts,
         t.merchant
    from postings p
    join transactions t on t.id = p.transaction_id
   where t.user_id = $1
     and p.account_id = $2
     and t.deleted_at is null
     and t.date between $3 and $4
   group by t.id, t.date, t.occurred_at, t.merchant
  ```
- P2: Keep `LedgerTxnRow` and the row-mapping shape as-is (D5), but add the D6
  range check: `Number(...)` only after `Number.isSafeInteger` passes, throwing a
  clear aggregate-overflow error otherwise. `amount_paise` still arrives as a string
  from `pg` (bigint `int8` is string-parsed by default).
- P3: Update the `createLedgerTxn` fixture in `statement-duplicate.test.ts` to also
  insert the real posting on the card account with the same signed amount. A lone
  posting is legal in the DB (no zero-sum trigger — enforcement lives in
  `replacePostings`, not SQL) and is fine for narrowly testing source selection, but
  it must **not** be described as a production shape. The transfer test specifically
  requires the full Clearing shape per D7.
- P4: Add the characterization tests in Verification below.
- P5: Update the doc comment on `loadCardLedgerTxns` to state that the amount and
  the account scope come from postings, and that transfer legs and opening rows are
  deliberately included (D1).

## Acceptance Criteria
- AC1: `loadCardLedgerTxns` contains no reference to `transactions.amount_paise` or
  `transactions.account_id`.
- AC2: For an ordinary card spend, the returned `amountPaise` is negative and equals
  the card posting's amount — the sign convention in F4 is preserved end to end.
- AC3: A transaction whose card posting exists but whose legacy `amount_paise` holds
  a different (decoy) value returns the **posting's** value. This is the decisive
  proof the reader is postings-sourced. (No prior PR used this technique —
  investigation-3 Q4 — so it is introduced here.)
- AC4: A transfer leg on the card account is **still returned** (D1 regression
  guard). The fixture must comprise: the card transaction row, a card posting of
  `+500000`, a same-user Clearing system account, and a Clearing posting of
  `-500000` (D7). Asserting only "a row comes back" from a lone-posting fixture does
  not satisfy AC4.
- AC5: A transaction with a posting on a *different* account is not returned.
- AC6: A soft-deleted transaction with a card posting is not returned (F8).
- AC7: Date-range and `user_id` scoping are unchanged. Tenant test is a **cross-tenant
  posting reference** — user B's transaction carrying a posting that references user
  A's account — which must not be returned when querying as A. (Not "two users with
  the same account id": `accounts.id` is a global UUID PK, so that fixture is
  impossible. Reworded per review-1 §6.)
- AC8: Exactly one row is returned per transaction, even given two postings on the
  same account for that transaction, and its amount is their sum (D2).
- AC9: `npm run typecheck`, `npm run lint`, and the extractor test suite are green.
- AC10 (D6): two same-account postings whose sum exceeds `Number.MAX_SAFE_INTEGER`
  cause `loadCardLedgerTxns` to **throw** a clear overflow error rather than return
  a silently rounded amount. Typechecking does not test this — it needs a test.

## Verification
- T1: `node --test apps/extractor/src/statement-duplicate.test.ts` — DB-backed.
  Note: this file **throws** when `DATABASE_URL` is absent
  (`statement-duplicate.test.ts:24-36`); it does not skip. The verification report
  must state whether `DATABASE_URL` was present and that the DB-backed test
  actually executed, with the literal pass/fail counts.
- T2: `node --test apps/extractor/src/extract.test.ts` — matcher unit tests still
  green, unchanged.
- T3: `npm run test -w apps/extractor`
- T4: `npm run typecheck`
- T5: `npm run lint`

## Non-Goals
- Converting `upsertReconciliation`'s `reconciled_statement_id` updates (F7).
- Converting `suggestTransfers` — see task 023's Carve-out note; tracked for PR-G.
- Any schema change, migration, or dropping of legacy columns (that is PR-G/G4).
- Changing `matchLinesToLedger`, `LedgerTxnRow`, or the extractor's dependency set.

## Review log
- **review-1 (Codex, plan):** SQL direction and D1/D2 confirmed correct against the
  real dual-write shapes. Two BLOCKERS, both validated by the lead against source
  and both now folded in: (1) missing safe-integer check on the new aggregate →
  D6 + P2 + AC10 (lead verified the convention at `periods.ts:228-230`);
  (2) AC4's transfer fixture could pass without a Clearing posting, making the D1
  regression guard worthless → D7 + rewritten AC4. Non-blocking amendments taken:
  AC7 reworded to a cross-tenant posting reference; D2 narrowed to "drift, not
  parity"; T1 corrected — the test throws rather than skips without `DATABASE_URL`.
- **review-2 (Codex, implementation):** no blockers. Both review-1 blockers
  confirmed resolved in actual code (safe-integer guard at `db.ts:267-272`, with no
  bypass; balanced card `+500000` / Clearing `-500000` fixture). Three test-strength
  gaps flagged: AC5 passed under the legacy reader too, AC7 had no date-range test,
  fixtures misnamed. Fixed in iteration 2.
- **review-3 (Codex, delta):** no blockers. `db.ts` byte-unchanged from the approved
  version; AC5 now decisive (legacy `account_id` = queried card, posting elsewhere →
  would fail under a legacy reader); AC7 date fixtures verified arithmetically
  (`05-01/05-15/05-31` in range, `04-30/06-01` out → exactly 3 rows). AC1 remains
  inspection-only by nature.
- **Operational risk accepted (review-1 §5), escalated to the user:**
  `reconcileAllPostings` runs at boot but **logs failures and proceeds**
  (`app.ts:186-193`; its own comment says "PR-B reader gate NOT satisfied").
  Lead-verified. So the reconciliation gate is a repair pass, not an enforced gate.
  This exposure is identical to the one PR-B..PR-E already shipped under, so it is
  not a PR-F blocker, but zero reconciliation failures should be confirmed on the
  target deployment before release.
