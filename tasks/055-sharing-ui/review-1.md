**Findings**

No API path mismatches, type errors, or React dependency-array issues found in the reviewed Task 055 + 056 files.

**Review Notes**

`sharing-queries.ts` matches the API routes:
`GET /api/sharing-grants?resourceType=X&resourceId=Y`, `POST /api/sharing-grants`, `DELETE /api/sharing-grants/:id`. Shared schemas/types line up with the route response schemas.

`SharingControl.tsx` imports from `@compass/shared`, `household-queries`, and `sharing-queries` correctly. Hooks are unconditional, there are no dependency arrays involved, and checkbox toggles call grant/revoke as expected.

`split-math.ts` matches the API-side split math behavior. Equal splits distribute remainder to earlier members; proportional splits use largest remainder; exact validation returns positive shortfall or negative overshoot.

`split-math.test.ts` covers all three functions and passes with `node --test`.

`split-queries.ts` uses the expected household balance and settlement paths.

`BalancesPanel.tsx` passes raw paise values into `formatINR`, which is correct.

`HouseholdPage.tsx` imports and renders both `BalancesPanel` and `SharingControl` via `SharingDemoPanel`; no duplicate/conflicting imports found.

**Verification**

Passed:
`node --test apps/web/src/routes/household/split-math.test.ts`

Passed:
`npm run typecheck`

Not run:
`npm run build -w apps/web`, because Vite build writes build artifacts and this review was constrained to read-only file access.