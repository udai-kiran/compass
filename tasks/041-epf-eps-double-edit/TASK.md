# Task: EPS balance is editable in two places on the EPF account page

## Status
PLANNING — filed so it is not lost. Not scheduled.

## Objective
An EPF account's EPS (Pension) balance has exactly one editing surface, so two
controls cannot disagree about the same stored value.

## Root Cause
`AccountDetail` (`apps/web/src/routes/settings/AccountDetailPage.tsx:107-120`)
renders both:

- `EpfOpeningSection` when `account.type === "epf"` — its "Of which, EPS" field
  writes `epsBalancePaise` via `useRetirementDetailsMutation`;
- `RetirementSection` when `isRetirementAccount(account.type)` — true for EPF —
  which also edits `epsBalancePaise`/`annualRateBps`.

So the same stored field has two editors on one page. Each seeds from the same
query, so whichever saves last wins, and the other control keeps showing stale
text until its query refetches.

`EpfOpeningSection` also passes `annualRateBps: retData?.annualRateBps ?? 0` and
`referenceNumber: retData?.referenceNumber ?? ""` when saving EPS — i.e. it
rewrites fields that `RetirementSection` owns, echoing back its **cached** copy.
Note the `?? 0` is *not* a silent-zeroing bug: `submit` returns early unless
`retResolved`, and `retData === null` means no row exists yet, so there is no rate
to lose. The real exposure is a **lost update** — if the rate changed after this
component's query was cached (another tab, or `RetirementSection` saving without a
refetch reaching here), the EPS save writes the stale rate back over it.

## Scope
- `apps/web/src/routes/settings/AccountDetailPage.tsx` — `AccountDetail`,
  `EpfOpeningSection`, `RetirementSection`

## Dependencies
Task 039 (must land first — it establishes the single surviving
`EpfOpeningSection`).

## Plan
- **P1:** Decide the single owner of EPS. Likely `EpfOpeningSection`, since EPS is
  part of the opening passbook figure the user reads off one statement.
- **P2:** Either drop EPS from `RetirementSection` for EPF, or drop it from
  `EpfOpeningSection` — not both.
- **P3:** Stop echoing `annualRateBps`/`referenceNumber` back from a cached read
  on an EPS-only save, so an EPS save cannot lose a concurrent rate update. Either
  send a partial update, or refetch immediately before writing.

## Acceptance Criteria
- AC1: exactly one control writes `epsBalancePaise` for an EPF account.
- AC2: an EPS-only save does not write `annualRateBps`/`referenceNumber` from a
  stale cache.
- AC3: `npm run typecheck` and `npm run lint` exit 0.

## Non-Goals
- Any change to the opening-balance read path (task 039 owns it)
- Any migration or API change
