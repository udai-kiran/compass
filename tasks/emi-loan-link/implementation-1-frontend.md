Everything checks out. The backend `PATCH /api/emis/:templateId/loan-account` route (pre-existing in the working tree) matches the web mutation's path/method/body/response shape, `EmiSummarySchema` includes `loanAccountId`, and `EMI_DESTINATION_TYPES` matches the eligible-account filter. All verification gates pass.

---

# Implementation Report: Add link/unlink loan-account UI to the /emis page

## 1. Files modified (2 — both requested files only)

- **`apps/web/src/lib/emi-queries.ts`** — modified
- **`apps/web/src/routes/emis/EMIsPage.tsx`** — modified

No files were created or deleted. Nothing was staged or committed (`git add`/commit not used, per instructions).

## 2. Summary of each change and why

### `apps/web/src/lib/emi-queries.ts`
- **Step A (imports):** No change needed — `EmiSummarySchema` was already in the `@compass/shared` import list (line 3), exactly as the task anticipated.
- **Step B:** Added a `linkLoanAccount` mutation inside `useEmiMutations`, immediately after `setPaused` (lines 61–68). It PATCHes `/api/emis/${templateId}/loan-account` with `{ loanAccountId }` (string | null), parses the response with `EmiSummarySchema`, and on success invalidates the `emis`/`transactions`/`recurring` queries plus the `accounts` query (a linked/unlinked loan account changes the accounts list).
- **Step C:** Updated the return object from `{ create, remove, setPaused }` to `{ create, remove, setPaused, linkLoanAccount }` (line 69).

### `apps/web/src/routes/emis/EMIsPage.tsx`
- **Step A:** In `EmiRow`, removed the `const loanAccount = accounts?.find((a) => a.id === emi.loanAccountId);` line (the lookup now lives inside `LoanAccountSection`) and replaced the `{loanAccount && (<Link …>)}` block with `<LoanAccountSection emi={emi} accounts={accounts} />` (line 79).
- **Step B:** Added the `LoanAccountSection` component between `EmiRow` and `InstallmentHistory` (lines 133–243) with the exact implementation specified:
  - Linked state (`emi.loanAccountId` set): renders "Loan account: {name}" link to `/accounts/{id}` plus a "×" unlink button (with confirm dialog, `toast("Loan account unlinked", "success")` on success, disabled while pending).
  - Unlinked state: shows "+ Link loan account" button, disabled when `emi.paidInstallments !== 0` or no eligible accounts exist (with explanatory `title` tooltips). Clicking it opens an inline `<select>` of eligible accounts (non-archived, type in `EMI_DESTINATION_TYPES`, excluding the EMI's own source account) with Link/Cancel buttons; success closes the panel and toasts, errors toast the error message.
- **Imports:** Verified all identifiers used by the new component were already imported — `toast` (`../../lib/toast.tsx`), `Link`, `useState`, `useEmiMutations`, `EMI_DESTINATION_TYPES`, `EmiSummary`, `AccountWithBalance` — so **no imports were added or changed**.

I also confirmed the supporting backend already exists in the working tree (pre-existing change, not mine): `PATCH /api/emis/:templateId/loan-account` in `apps/api/src/modules/credit/routes/emis.ts` with body `{ loanAccountId: z.uuid().nullable() }` → `EmiSummarySchema`, backed by `getEmiDetail`/`upsertEmiDetails` in `apps/api/src/modules/credit/services/emis.ts`. The web mutation matches this contract exactly. `EmiSummarySchema` includes `loanAccountId: z.uuid().nullable()` (packages/shared/src/schemas/wealth.ts line 316) and `EMI_DESTINATION_TYPES = ["loan", "home_loan_od", "overdraft"]` (line 290), so the eligibility filter is consistent with the create form.

## 3. Commands run and output

- `npm run typecheck -w apps/web` → **exit 0** (`tsc --noEmit`, no errors)
- `npx eslint apps/web/src/lib/emi-queries.ts apps/web/src/routes/emis/EMIsPage.tsx` → **clean, no output**
- `npx prettier --check apps/web/src/lib/emi-queries.ts apps/web/src/routes/emis/EMIsPage.tsx` → **exit 1** (warnings; see deviation note below)
- `npm run test -w apps/web` → **380 tests pass, 0 fail**
- `npm run build -w apps/web` → **success** (vite build, incl. `dist/assets/EMIsPage-C6WaoxHt.js`)

## 4. Issues, risks, and deviations

- **Prettier formatting (deliberate deviation):** `prettier --check` reports style issues in both files, but the offending lines are **pre-existing** — e.g. the long `@compass/shared` import line and the `send<T>` signature in `emi-queries.ts`, and multiple `NewEmiForm`/`EmiRow` lines in `EMIsPage.tsx`, all present at HEAD. The repo's CI runs typecheck/lint/test/build but **no prettier check**, and HEAD itself is not prettier-clean. I deliberately did **not** run `prettier --write`, because it would reformat unrelated pre-existing lines (diff noise outside the task scope, conflicting with "do not disturb unrelated changes"). My inserted code uses the exact formatting specified in the task, which is consistent with the surrounding file style. If the maintainers want, a repo-wide `npm run format` pass is a separate change.
- **UI behavior not visually verified in a running browser:** The "/emis page shows × Unlink / + Link loan account" criterion is implemented and typechecked/build-tested, and the API contract it calls exists in the working tree; I did not spin up the dev servers (requires Postgres/Redis + auth) to click through the UI.
- **Pre-existing working-tree changes left untouched:** `apps/api/src/modules/credit/routes/emis.ts`, `apps/api/src/modules/credit/services/emis.ts`, and two `.claude/agents/*.md` files were already modified before I started; I only touched the two files in scope.
- **No tests added:** The task specified only the two file edits and the typecheck gate; the changed logic is declarative React/query-hook wiring consistent with existing patterns in the file, so no new test files were added.
