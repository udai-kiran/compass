# Sonnet Worker Delegation — iteration 1 (implementation)

## Task
039 — De-duplicate `EpfOpeningSection` on `main` and land the real
opening-balance fix. Read `tasks/039-epf-opening-section-dedup/TASK.md` first.

## Approved Plan
- **P1:** Create branch `fix/epf-opening-section-dedup` from `origin/main`
  (commit `38ae9a2`). Do NOT work on `fix/epf-save-in-accounts-page` — it is
  already merged and its tree does not contain PR #189.
- **P2:** Delete the `EpfOpeningSection` block at `origin/main:308-364` plus its
  preceding `/** … */` doc comment.
- **P3:** In the surviving `EpfOpeningSection`, replace
  `account.openingBalancePaise` with `account.openingTransactionPaise` at four
  token occurrences (main lines 445, 452, 453, 502).
- **P4:** Change nothing else.

## Files and Symbols
- `apps/web/src/routes/settings/AccountDetailPage.tsx` — the ONLY source file to
  touch.
  - DELETE: the `EpfOpeningSection` declared at main line 308, ending at 364.
    Identify it by: exactly one `Field label="Total PF balance"`, and NO
    `useRetirementDetails`, NO `epsText`, NO `parseEpsInput`. Its doc comment
    begins `/**` with "EPF-specific opening balance section."
  - KEEP AND EDIT: the `EpfOpeningSection` declared at main line 439. Identify it
    by `useRetirementDetails(account.id, true)`, `saveRetirement`, `epsText`,
    `parseEpsInput`, two `Field`s, and the `epfCorpusPaise` `DerivedRow`.

## Required Changes
1. Delete the block described above, doc comment included.
2. In the survivor, four token replacements
   `account.openingBalancePaise` → `account.openingTransactionPaise`:
   - the `useState(() => openingBalanceToInput(...))` initialiser for `totalText`
   - the `useEffect` body that calls `setTotalText(openingBalanceToInput(...))`
   - **that same `useEffect`'s dependency array** — a separate token, easiest to
     miss; Codex flagged it explicitly
   - the `dirty` comparison `totalPaise !== account.openingBalancePaise`
3. Afterwards the surviving component must contain **zero** occurrences of
   `account.openingBalancePaise`.

## Must Not Change
- The two-step `update.mutate(...)` → `saveRetirement.mutate(...)` save sequence,
  including its `onSuccess`/`onError` handlers and `sequencePending`.
- `submit`'s PATCH body: `openingBalancePaise: totalPaise` is the correct WRITE
  field and stays exactly as is. Only the READ path changes.
- The EPS half: `parseEpsInput`, `epsPaise`, `epsError`, `corpusError`,
  `epfCorpusPaise`, and the `epsPaise !== (retData?.epsBalancePaise ?? 0)`
  comparison.
- The `retIsPending` "Loading…" early return.
- `OpeningBalanceSection`, `RetirementSection`, `AccountDetail`'s render block
  (its `account.type === "epf"` branch is already correct), any hint/copy text.
- `packages/shared/src/schemas/ledger.ts`, `apps/api/**`,
  `apps/web/src/routes/accounts/account-groups.test.ts` — all already correct.
- Do NOT add tests in this task (see TASK.md's Codex ruling). Do NOT reformat, do
  NOT rename, do NOT reorder other functions.

## Acceptance Criteria
- AC1: exactly ONE `function EpfOpeningSection` in the file.
- AC5: zero `account.openingBalancePaise` in the surviving component; the
  initialiser, effect body, effect dep, and dirty check all read
  `account.openingTransactionPaise`.
- AC6: EPS UI fully intact — two `Field`s, `parseEpsInput`, `epfCorpusPaise`
  derived row, two-step save.
- AC2/AC3: root `npm run typecheck` and `npm run lint` exit 0.

## Commands
Run from `/home/udai/common/compass`. Report each command and its literal output.

1. `git fetch origin`
2. `git switch -c fix/epf-opening-section-dedup origin/main`
3. `git log --oneline -1` (confirm you are on `38ae9a2`)
4. `grep -n "function EpfOpeningSection\|<EpfOpeningSection" apps/web/src/routes/settings/AccountDetailPage.tsx` (BEFORE — expect 110, 308, 439)
5. Make the edits.
6. `grep -n "function EpfOpeningSection\|<EpfOpeningSection" apps/web/src/routes/settings/AccountDetailPage.tsx` (AFTER — expect exactly one decl + one call site)
7. `grep -n "openingBalancePaise\|openingTransactionPaise" apps/web/src/routes/settings/AccountDetailPage.tsx`
8. `npm run typecheck` (repo root, all workspaces)
9. `npm run lint`
10. `git diff` (complete, unabridged)

Do NOT commit. Do NOT push. Do NOT open a PR. Do NOT tag. Git write operations
are a separate, explicitly-authorised step that I will delegate after
verification and review. Creating the branch in step 2 is the only git write
you are authorised to perform.

## Investigation question (answer alongside the work)
Does this repo have ANY React component test harness? Check for
`@testing-library/*`, `jsdom`, `happy-dom`, or `.tsx` test files under
`apps/web`. Report the literal search and result. If one EXISTS, say so
prominently and do not treat its absence as settled — it changes a review ruling.

## Required Evidence
- files changed (exact paths)
- complete unabridged diff
- every command run, with literal output and exit codes
- the BEFORE and AFTER grep outputs for step 4/6, verbatim
- pass/fail status of typecheck and lint
- the React-test-harness answer
- any plan deviation or blocker — if the block you are about to delete does not
  match the identifying markers exactly, STOP and report rather than guessing
