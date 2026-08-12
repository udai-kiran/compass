# Task: Fix EPF opening balance save

## Status
SUPERSEDED by task 039 — this task was wrongly marked COMPLETE.

It shipped as PR #190 (`a89ef79`, CI green) and PR #191 (`0da6688`), but the #191
**squash** merge left `main` failing to compile: `TS2393 Duplicate function
implementation`. P1 and P2 (the shared schema field and the `listAccounts`
`openingTxnPaise` aggregate) were correct and remain in place. **P3 was applied to
the wrong component.**

Two mistakes to learn from:

1. **Out-of-scope work.** P3 authorised editing `OpeningBalanceSection` only.
   `0da6688` additionally *created* a new `EpfOpeningSection` — never in the
   approved plan, and directly against this file's own Non-Goal
   "EpfOpeningSection UX redesign". PR #189, which this branch never contained
   (it forked at `caa5f2d`), had already added a richer EPS-aware component of
   that exact name. The squash merge replayed our diff onto it, producing two
   declarations.
2. **A misread CI signal.** A `pull_request` run checks out the **merge ref**, not
   the PR head. `gh run list` reports `headSha` as the PR head, which is
   misleading: run 31581474131 was already compiling the duplicated tree while
   local `tsc` was clean. That divergence was wrongly dismissed as a stale run
   instead of being investigated.

Because the later of two same-named top-level `function` declarations wins at
runtime, this task's fix would have been a **silent no-op** even had it compiled —
users would have rendered #189's buggy component. The red CI is the only reason it
did not ship that way.

See `tasks/039-epf-opening-section-dedup/TASK.md`. Test debt raised in review-1 and
review-2 and never closed is now tracked in
`tasks/040-opening-transaction-test-debt/TASK.md`.

## Objective
Saving the opening balance on an EPF account shows the correct value in the field
(persists across navigation) and the "Save" button correctly tracks dirty state —
i.e. shows "Saved" only when the field matches what is actually stored.

## Root Cause
`carriesOpeningAsTransaction` returns `true` for all account types, so every
account (including EPF/PPF/SSY/investment/loan/card) stores its opening balance
as an `is_opening = true` transaction. The `accounts.opening_balance_paise` column
stays 0. `AccountWithBalance` exposes `openingBalancePaise` (the column = 0) but
NOT the opening-transaction amount.

`OpeningBalanceSection` seeds its text field from `account.openingBalancePaise`
(= 0) and compares the dirty flag against the same value. Result:

1. Field always initialises to blank even if an opening transaction exists.
2. After save the column stays 0 → `useEffect` resets text to blank → user sees
   a blank field that looks like the save failed.
3. `dirty` becomes false immediately (0 === 0) so the button says "Saved" over a
   blank field — deeply confusing.

## Scope
- `packages/shared/src/schemas/ledger.ts` — add `openingTransactionPaise` to
  `AccountWithBalanceSchema`
- `apps/api/src/modules/ledger/services/accounts.ts` — add a second aggregate in
  `listAccounts` to sum postings of `is_opening = true` transactions per account,
  and include it in the returned shape
- `apps/web/src/routes/settings/AccountDetailPage.tsx` — change
  `OpeningBalanceSection` to seed from `openingTransactionPaise` and compare
  against it in the dirty check; also adjust the hint copy to reflect reality

## Dependencies
None (main branch HEAD)

## Plan
- P1: Add `openingTransactionPaise: z.number().int().default(0)` to
  `AccountWithBalanceSchema` in `packages/shared/src/schemas/ledger.ts`
- P2: In `listAccounts` in `accounts.ts`, add a second aggregate expression
  alongside the existing `postingSum`:
  ```ts
  openingTxnPaise: sql<number>`
    coalesce(sum(${postings.amountPaise}) filter (
      where ${transactions.isOpening} = true
        and ${transactions.deletedAt} is null
        and ${transactions.userId} = ${userId}
    ), 0)::bigint`
  ```
  Map it through as `openingTransactionPaise` in the returned object.
- P3: Update `OpeningBalanceSection` in `AccountDetailPage.tsx`:
  - Change both the `useState` initialiser and the `useEffect` dep to use
    `account.openingTransactionPaise` instead of `account.openingBalancePaise`
  - Change the `dirty` check: `parsed !== account.openingTransactionPaise`
  - Update the section hint to:
    "What this account held before your first recorded transaction. Set it
    once — it becomes a dated ledger entry so your running balance is right."
  - (No changes to the mutation call itself — it sends `openingBalancePaise`
    in the PATCH body which is what the API expects)

## Acceptance Criteria
- AC1: After saving the opening balance on an EPF account, the ₹ field retains
  the typed value (does not reset to blank).
- AC2: Navigating away and back to the EPF account detail page shows the
  previously saved opening balance in the field.
- AC3: "Save" button is disabled when the field matches the stored opening
  transaction amount; enabled when it differs.
- AC4: `npm run typecheck` exits 0.
- AC5: `npm run test` exits 0 (no regressions).

## Verification
- T1: `npm run typecheck` — exit 0
- T2: `npm run lint` — exit 0
- T3: `npm run test -w apps/api` — exit 0
- T4: `npm run test -w packages/shared` — exit 0
- T5: Complete diff of the three modified files

## Codex review-1 findings
- High (theoretical): multiple active opening transactions would make sum wrong. Addressed: write path enforces at most one active opening row (planOpeningBalanceChange never double-inserts). Use `sum` matching existing postingSum pattern; document invariant.
- Medium: add `Number.isSafeInteger` guard on `openingTxnPaise` (same as postingSum guard). ADDED to P2.
- Medium: tests — add targeted coverage. ADDED to P2 / T-range.
- Other: `apps/web/src/routes/accounts/account-groups.test.ts` factory needs `openingTransactionPaise: 0`. ADDED to P3.

## Non-Goals
- EpfOpeningSection UX redesign (EPS sub-balance alongside opening balance)
- Any changes to the EPF contribution modal
- Any changes to RetirementSection
