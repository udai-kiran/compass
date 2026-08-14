# Task: EPS balance is editable in two places on the EPF account page

## Status
COMPLETE

## Objective
An EPF account's EPS (Pension) balance has exactly one editing surface, so two
controls cannot disagree about the same stored value.

## Root Cause
`AccountDetail` (`apps/web/src/routes/settings/AccountDetailPage.tsx:107-120`)
renders both `EpfOpeningSection` (EPF only) and `RetirementSection` (all
retirement types including EPF). Both call `useRetirementDetailsMutation` and
both write `epsBalancePaise` — RetirementSection echoes back a cached value
it does not display. Lost-update race on every save.

`EpfOpeningSection` also echoes back stale `annualRateBps`/`referenceNumber`
from cache, creating the same lost-update risk in the reverse direction.

## Design Decision
**P1 resolved:** `EpfOpeningSection` owns `epsBalancePaise`. `RetirementSection`
owns `annualRateBps`, `maturityDate`, `referenceNumber`. Each component sends
only its own fields; the API merges with existing DB state for omitted fields.

The task's original non-goal of "no API change" is overridden — investigation
confirmed that the schema's `.default(null)` makes it impossible to distinguish
"not provided" from "clear" without making fields `.optional()`. The change is
backward-compatible: callers that send all fields get identical behavior.

## Scope
- `packages/shared/src/schemas/wealth.ts` — `UpsertRetirementDetailsSchema`
- `apps/api/src/modules/protection/services/retirement.ts` — `upsertRetirementDetails`
- `apps/web/src/routes/settings/AccountDetailPage.tsx` — `EpfOpeningSection`, `RetirementSection`

## Dependencies
Task 039 (COMPLETE).

## Plan
- **P1:** Schema: change all 4 fields from `.default(X)` to `.optional()`
- **P2:** Service: read existing row before upsert; merge — only override fields
  that are explicitly present (not `undefined`); preserve existing for omitted
- **P3:** Frontend RetirementSection: omit `epsBalancePaise` for EPF accounts
- **P4:** Frontend EpfOpeningSection: send only `{ epsBalancePaise }`; omit
  `annualRateBps`, `maturityDate`, `referenceNumber`
- **P5:** Update any schema deepEqual tests if they reference the old defaults

## Acceptance Criteria
- AC1: exactly one control writes `epsBalancePaise` for an EPF account
- AC2: an EPS-only save does not write `annualRateBps`/`referenceNumber` from a
  stale cache
- AC3: a rate-only save does not write `epsBalancePaise` from a stale cache
- AC4: PPF/SSY RetirementSection still sends all fields (unchanged behavior)
- AC5: `npm run typecheck` and `npm run lint` exit 0

## Verification
- T1: npm run typecheck (exit 0)
- T2: npm run lint (exit 0)
- T3: npm run test (no new failures)
- T4: Read EpfOpeningSection mutation call — only epsBalancePaise present
- T5: Read RetirementSection mutation call for EPF — no epsBalancePaise

## Non-Goals
- Any change to the opening-balance read path (task 039 owns it)
- Any migration
