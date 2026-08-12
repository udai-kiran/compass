## Verdict

The implementation matches the approved source plan. No code defect or out-of-scope tracked edit was found. Typecheck and lint pass.

Operational acceptance criteria requiring tests, CI, merge, and release remain incomplete at this uncommitted stage.

## Plan review

- **P1 — PASS.** Branch is `fix/epf-opening-section-dedup`; `HEAD`, `origin/main`, and their merge base are all `38ae9a24a89221187c442278f09e8d2d012b784f`.

- **P2 — PASS.** The deleted origin block was exactly the obsolete single-field implementation at origin lines 302–364: one `Field`, no retirement query, no `epsText`, and no `parseEpsInput`. Its preceding documentation comment was deleted. The survivor is the EPS-aware implementation at [AccountDetailPage.tsx:376](/home/udai/common/compass/apps/web/src/routes/settings/AccountDetailPage.tsx:376), with `useRetirementDetails` at line 378, `epsText` at line 384, `parseEpsInput` at line 407, and two fields at lines 494 and 506.

- **P3 — PASS.** Exactly four tokens changed to `account.openingTransactionPaise`:

  - State initializer: [line 382](/home/udai/common/compass/apps/web/src/routes/settings/AccountDetailPage.tsx:382)
  - Effect body: [line 389](/home/udai/common/compass/apps/web/src/routes/settings/AccountDetailPage.tsx:389)
  - Effect dependency array: [line 390](/home/udai/common/compass/apps/web/src/routes/settings/AccountDetailPage.tsx:390)
  - Dirty comparison: [line 439](/home/udai/common/compass/apps/web/src/routes/settings/AccountDetailPage.tsx:439)

- **P4 — PASS.** The tracked diff contains only [AccountDetailPage.tsx](/home/udai/common/compass/apps/web/src/routes/settings/AccountDetailPage.tsx): four substitutions and deletion of the obsolete 63-line comment/component/separator region. No other tracked file changed.

## Acceptance criteria

- **AC1 — PASS.** Exactly one declaration at [line 376](/home/udai/common/compass/apps/web/src/routes/settings/AccountDetailPage.tsx:376), and exactly one call site at [line 110](/home/udai/common/compass/apps/web/src/routes/settings/AccountDetailPage.tsx:110).

- **AC2 — PASS.** Root `npm run typecheck` exited 0 across all workspaces, including `@compass/web`.

- **AC3 — PASS.** Root `npm run lint` exited 0.

- **AC4 — FAIL / not verified.** `DATABASE_URL` and `REDIS_URL` are both unset, so the required environment-backed `npm test` run was not performed and no pass/fail counts are available.

- **AC5 — PASS.** Zero `account.openingBalancePaise` occurrences remain inside the surviving component. The required write field remains unchanged at [line 449](/home/udai/common/compass/apps/web/src/routes/settings/AccountDetailPage.tsx:449): `openingBalancePaise: totalPaise`.

- **AC6 — PASS.** EPS behavior is intact:

  - `parseEpsInput`: lines 406–418
  - `epfCorpusPaise`: lines 420–428
  - Two fields: lines 494 and 506
  - Account update followed by `saveRetirement.mutate`: lines 448–475
  - `retIsPending` early return: lines 480–486
  - Derived EPF corpus row: lines 521–530

- **AC7 — FAIL / not yet applicable.** There is no committed PR or post-merge `main` CI run for this working-tree implementation.

- **AC8 — FAIL / not yet applicable.** No release tag or successful `Publish images` run exists for this uncommitted implementation.

## Scope and whitespace

There are no unapproved changes anywhere in the tracked diff. The reported blank-line collapse is the only incidental whitespace effect: origin’s separator following the deleted component was removed with that block, leaving one normal blank line between `IdentitySection` and `OpeningBalanceSection` at lines 300–302. It is acceptable. `git diff --check` reports no whitespace errors.

The workspace contains unrelated untracked paths, including `screen-shots/` and task artifacts. They are not part of the requested diff; this review cannot attribute them to this implementation.

## Unused or dangling code

No now-unused import, helper, or variable remains. Lint passes. `openingBalanceToInput`, `openingBalanceFromInput`, `DerivedRow`, `formatINR`, `useEffect`, and the retirement hooks all retain uses. The obsolete component’s documentation comment was removed, and no dangling comment refers to it.

## Protected areas

All are byte-for-byte unchanged relative to `origin/main`, after accounting for the 63-line deletion:

- `OpeningBalanceSection`: [lines 302–374](/home/udai/common/compass/apps/web/src/routes/settings/AccountDetailPage.tsx:302)
- Account detail render block: lines 90–124, including the EPF branch at lines 109–113
- `RetirementSection`: begins at line 894
- Everything following `EpfOpeningSection`
- All surviving hint, validation, toast, and UI copy

## Round-trip behavior

**Confirmed under the documented single-active-opening-row invariant.**

The component PATCHes `openingBalancePaise` at line 449. The API plans and inserts/updates the opening transaction at [accounts.ts:475](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:475) and lines 487–521, then forces the account column through `openingColumn` at lines 542–549. `listAccounts` aggregates active opening postings at lines 190–226 and returns `openingTransactionPaise`. The successful update invalidates the accounts query at [queries.ts:68](/home/udai/common/compass/apps/web/src/lib/queries.ts:68).

After refetch, the effect at lines 388–390 reseeds the field from that returned value, and the dirty comparison at lines 436–440 becomes false.

As previously noted, duplicate active opening rows could break this round trip because listing sums all rows while updating selects the earliest. That is pre-existing and deferred to task 040.

## New risks and prior findings

No new correctness, regression, security, or compatibility problem is introduced by this diff. `openingTransactionPaise` is required by the shared schema at [ledger.ts:200](/home/udai/common/compass/packages/shared/src/schemas/ledger.ts:200).

All code-action findings from `review-1.md` are addressed:

- All four read tokens, including the dependency array, were changed.
- The correct duplicate was deleted.
- EPS behavior and the write-side field remain intact.
- No unused-code fallout occurred.
- The known duplicate-opening-row invariant, non-atomic two-step save, refetch behavior, and missing regression tests remain acknowledged pre-existing/deferred matters—not implementation misses in this scoped patch.