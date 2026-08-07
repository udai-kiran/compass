# PR-B — balance readers → postings (dual-write plan, increment after PR-A)

## Status
COMPLETE (in the working tree; NOT yet committed — git/PR/release gated on
explicit user request). Codex review-19 APPROVED the plan; implementation landed
over 2 iterations; Codex review-20 raised 6 BLOCKING findings (all valid), fixed
in iteration 2; Codex review-21 verdict APPROVED — all 6 resolved, PB1–PB7 PASS,
AC1–AC5 PASS. Independent verification (separate worker) confirmed typecheck 0,
lint 0, apps/api 925 tests / 924 pass / 0 fail / 1 pre-existing skip, parity file
7/7 stable across 3 consecutive runs, only the 5 scoped files changed. Lead read
every changed file directly. Changed files: balances.ts, accounts.ts
(accountBalancesAtDate + listAccounts), average-balance.ts, account-balances.test.ts,
+ new postings-balance-parity.test.ts. Reviews: review-19 (plan), review-20
(impl, blocking), review-21 (impl, approved).

## Context / lineage
Task 2.1 postings-model, dual-write strategy (`PLAN-dualwrite.md`). SP0 + PR-A
merged (v2.1.0, v2.2.0). PR-A added the `postings` table (migration 0067), 4
system accounts (Expenses/Income/Opening Balances/Clearing), the full dual-write
writer graph, the per-transaction invariant, and restore compat — all ADDITIVE;
every legacy column still exists and dual-write continues. NO reader was
converted in PR-A; the DTO is still served from legacy.

PR-B converts the FIRST reader group — balance readers — to compute balance from
`postings` instead of `transactions.amount_paise`, keeping the
`accounts.opening_balance_paise` column as an explicit addend (dual-write Q3 —
column-based openings still have NO postings until PR-G). Green + releasable
(→ next continuous version bump, e.g. v2.3.0). Legacy columns remain; dual-write
continues; the per-transaction invariant + parity stay green.

## Objective
`balances.ts`, `accounts.ts` (`listAccounts`, `accountBalancesAtDate`), and
`average-balance.ts` compute account balances from `postings` (summed on the
real account, joined to the non-deleted parent transaction, same date cut) plus
the `opening_balance_paise` column addend — returning numbers IDENTICAL to the
current legacy computation on the same data (parity), proven by a DB-backed
parity test. No other reader, no writer, no schema, no migration changes.

## Root cause / parity proof (confirmed in source this session)
The real-account leg of EVERY posting builder equals the legacy row's signed
`amount_paise`:
- `buildOrdinaryPostings` real leg = `amountPaise` (postings.ts:98-105).
- `buildSplitPostings` real leg = `sumPaise(splits)` = parent `amountPaise`
  (asserted equal in `computePostingDraftsForTransaction`, transactions.ts:237-242).
- `buildTransferLegPostings` real leg = signed legacy leg `amountPaise`
  (postings.ts:240-247).
- `buildOpeningPostings` real leg = `amountPaise` (postings.ts:206-213).

Therefore, for any real (non-system) account A:
`Σ postings.amount_paise (account_id=A) ≡ Σ transactions.amount_paise (account_id=A)`
over the SAME set of non-deleted transactions and the SAME date cut. Adding the
`opening_balance_paise` column addend on both sides yields identical balances.
The identity holds row-locally, so it survives every account type, splits,
transfers, and opening rows. PR-A's per-transaction invariant + reconcile
guarantee the mirror is consistent, so parity is mathematically guaranteed, not
merely empirically likely.

Opening handling stays correct under postings:
- bank/cash: `opening_balance_paise` column is pinned to 0 and the opening
  balance lives as an `is_opening` transaction, which HAS a real posting → its
  amount is already inside the postings sum. Column addend contributes 0.
- card/loan/scheme: `opening_balance_paise` column is non-zero and there is NO
  opening transaction and NO posting → the column addend supplies it. (Q3)

## Scope (files)
- `apps/api/src/modules/ledger/services/balances.ts` — `bankCashBalances`
  (`bankCashTotal` just sums it; no direct SQL change).
- `apps/api/src/modules/ledger/services/accounts.ts` — `accountBalancesAtDate`,
  `listAccounts`. (NOTHING else in accounts.ts: writers, opening-plan, guards
  unchanged.)
- `apps/api/src/modules/ledger/services/average-balance.ts` —
  `accountAverageBalances` (the 3 SQL subqueries/queries: `first_activity`,
  `carried_in_delta`, and the per-date `deltas`). The PURE helpers
  (`ambWindow`/`sumDailyClosingPaise`/`buildAverageBalance`/etc.) are unchanged.
- Tests: `account-balances.test.ts` (update the stub query param assertions to
  the new SQL; keep row-mapping assertions + apply D22 overflow flip, see PB6),
  `average-balance.test.ts` (update as needed to keep passing), and a NEW
  DB-backed parity test `postings-balance-parity.test.ts` (see Verification).

## Design decisions
- **PB1 — Real-account posting sum replaces the legacy txn sum.** Each converted
  query replaces `sum(transactions.amount_paise)` on account A with
  `sum(postings.amount_paise)` where `postings.account_id = A`, JOINed to the
  parent transaction for the `deleted_at is null` and date predicates. Because
  the real leg == row amount, this is a drop-in parity replacement.
- **PB2 — Keep the `opening_balance_paise` column as an explicit addend.**
  Dual-write Q3: column-based openings (cards/loans/schemes) have no postings
  yet; the column must still be added. Do NOT drop or ignore it. (Removing it is
  a PR-G concern.)
- **PB3 — Real accounts only.** Every converted query must restrict the summed
  postings to real accounts (`accounts.system_kind is null`), so Clearing /
  Expenses / Income / Opening-Balances postings can NEVER enter a balance.
  `balances.ts`/`average-balance.ts` already filter `type in ('bank','cash')` /
  `type='bank'` (all non-system); `accountBalancesAtDate`/`listAccounts` already
  filter `system_kind is null`. Preserve these filters; the postings join is
  keyed on the already-filtered real account rows.
- **PB4 — Date/deleted cut reads from the PARENT transaction.** Postings carry
  no date/deleted flag; join `postings` → `transactions` on
  `transaction_id = transactions.id` and apply the existing predicates
  (`transactions.deleted_at is null`, `transactions.date <= <asOf|current_date>`)
  on the parent. Keep `current_date` in `listAccounts` (not a bound param) and
  the bound `asOf` in the others — same values as today.
- **PB5 — Parity is the acceptance gate.** A DB-backed test seeds a user with
  every relevant shape (ordinary +/−, split, linked transfer pair, bank opening
  row, card with opening-column balance, a soft-deleted txn, a future-dated txn)
  and asserts the converted readers equal the legacy formula computed
  independently in the test, per account and in total, and that AMB matches.
- **PB6 — Range-check aggregates AND derived arithmetic, 500-class (D12 /
  dual-write line 65).** The readers this PR touches must refuse out-of-range
  results rather than silently IEEE-754-round. Use the EXISTING 500-class pattern
  in `reconciliation-reads.ts:137-143` — `if (!Number.isSafeInteger(x)) throw new
  HttpError(500, "... aggregate exceeded a safe integer — refusing to lose
  paise")` — NOT `assertSafePaise` from postings.ts (it throws `HttpError(400)`,
  which mislabels a server/data-integrity overflow as a client error, per Codex).
  Check is required at EVERY step where two safe values can combine to an unsafe
  one, not just the raw SQL aggregate:
  - `accountBalancesAtDate` / `bankCashBalances`: the raw posting sum AND the
    final `opening_balance_paise + sum`.
  - `bankCashTotal`: also the cross-account reduction (individually safe balances
    can sum out of range).
  - `average-balance.ts`: the raw carried-in/delta sums, the
    `opening_balance_paise + carried_in` addition, each daily-delta conversion,
    and the accumulated daily-closing arithmetic (`sumDailyClosingPaise` runs in
    JS number space — guard the inputs; do not silently overflow across days).
  This flips the deliberately-unsafe `account-balances.test.ts` fixture (the
  `9007199254740993` row) to assert refusal. Deliberate, plan-sanctioned behavior
  change (silent round → throw) on out-of-range balances (~₹90 trillion+); no
  real balance reaches it. Codex review-19 confirmed PB6 belongs in PR-B.
- **PB7 — Other direct legacy balance readers stay legacy until PR-D/PR-E
  (explicit deferral).** `planning/services/insights.ts` (`cashAndLiabilities`),
  `credit/services/cards.ts` (card summary + activity), and
  `credit/services/reconciliation-reads.ts` (`ledgerDuesAtDates`) also compute
  `opening_balance_paise + Σ transactions.amount_paise`. They are NOT in PR-B
  scope — the durable strategy assigns planning/credit readers to PR-D/PR-E.
  They will NOT disagree with the converted readers during dual-write because the
  parity identity holds. `insights.ts` is especially easy to mistake for the
  "first balance-reader group"; it is intentionally left on legacy here.
  (Confirmed present in source by the lead via grep for `opening_balance_paise`.)

## Non-goals
- No conversion of downstream consumers of these readers (`networth.ts`,
  `cashflow.ts`, `dashboard.ts`, `prefs.ts`) — they call the converted functions
  and inherit postings-based numbers automatically; under parity the numbers are
  identical, so no behavior change (PR-C/D/E convert their own direct SQL).
- No income/expense/spend conversion (PR-C). No writer changes. No schema,
  migration, shared-schema, or web changes. No dropping of legacy columns (PR-G).
- No change to the pure AMB math helpers.

## Acceptance Criteria
- AC1 `bankCashBalances`/`accountBalancesAtDate`/`listAccounts`/
  `accountAverageBalances` compute the real-account component from `postings`
  (joined to the non-deleted parent transaction, same date cut), plus the
  `opening_balance_paise` column addend.
- AC2 Postings summed only over real accounts (`system_kind is null`); no
  system-account posting can enter any balance.
- AC3 DB-backed parity test proves per-account + total equality with the legacy
  formula across ordinary/split/transfer/opening/soft-deleted/future-dated data,
  and AMB parity for bank accounts.
- AC4 Aggregates range-checked before `Number(...)`; overflow refused (PB6);
  `account-balances.test.ts` unsafe fixture flipped to expect refusal.
- AC5 `npm run typecheck` (all workspaces), `npm run lint`, and `npm run test`
  (apps/api) all green. Extractor unchanged (its pre-existing DATABASE_URL guard
  failure is the known baseline, not caused here).

## Verification
- T1 `npm run typecheck` — exit 0 across all workspaces.
- T2 `npm run lint` — exit 0.
- T3 `npm run test -w apps/api` — green; specifically
  `account-balances.test.ts`, `average-balance.test.ts`, the new
  `postings-balance-parity.test.ts`, and `networth.test.ts` all pass.
- T4 Parity test (DB-backed, live Postgres with 0067 applied). The expected
  legacy values MUST be computed directly from the legacy tables
  (`opening_balance_paise + Σ transactions.amount_paise` under the same
  predicates) INSIDE the test — never by calling another balance helper (no
  tautology). It must ALSO assert exact posting shape (via
  `findInconsistentPostings` returning empty for the fixture user) so a
  coincidentally-equal aggregate cannot conceal drift. Coverage (Codex review-19):
  - bank account with `is_opening` opening row + ordinary +/− txns;
  - card with opening-column balance + charges;
  - split with mixed positive/negative components that still sum to the parent;
  - zero-amount ordinary activity;
  - linked transfer pair (both legs on real accounts; assert no Clearing leakage);
  - soft-deleted txn (excluded) — including one that WOULD be the earliest
    activity, proving it does not establish the AMB window;
  - future-dated txn (excluded by the date cut) — including an account whose ONLY
    txn is future-dated;
  - zero-activity bank account with zero column; zero-activity column-opening
    account (balance == column);
  - column-opening bank account with NO transaction → `firstActivity = null`, no
    AMB (must NOT substitute account-creation date — that is PR-G);
  - column-opening bank account whose first real activity falls inside the
    current month; an opening txn predating the month (carried-in AMB);
  - multiple same-day postings/txns (daily grouping);
  - archived-account behavior for each reader — `listAccounts` currently INCLUDES
    archived accounts; the rewrite must NOT silently add an archived filter;
  - tenant isolation: a second user whose data must not leak into user 1's
    balances (retain a parent `transactions.user_id` predicate in all converted
    SQL as defense in depth);
  - overflow: the FINAL `opening + sum` (not just the raw aggregate) and the
    `bankCashTotal` cross-account reduction.
  For AMB, compare the COMPLETE `AccountAverageBalance` result (window `from`/`to`,
  `days`, `daysInMonth`, `averagePaise`, `partialHistory`), not only `averagePaise`.
- T5 Confirm no other file changed: `git status` shows only the scoped files
  (`balances.ts`, `accounts.ts`, `average-balance.ts`, the two updated tests, and
  the new parity test).

## Deviations / open questions for Codex plan review (review-19)
- Confirm PB6 (range-check + overflow refusal + fixture flip) belongs in PR-B or
  should be deferred; confirm no legitimate balance path can trip the new throw.
- Confirm the `listAccounts` drizzle rewrite (leftJoin postings, then leftJoin
  transactions on `postings.transaction_id`, alongside the existing bankDetails
  leftJoin) cannot double-count via join fan-out (bankDetails is 1:1 per
  account; postings→transactions is N:1).
- Confirm no OTHER balance reader outside these 3 files reads
  `opening_balance_paise + Σ transactions.amount_paise` directly and would now
  disagree (it can't while parity holds, but Codex should scan for a reader that
  PR-B should have included).
