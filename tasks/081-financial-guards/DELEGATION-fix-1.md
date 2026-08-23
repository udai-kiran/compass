# Codex Worker Delegation — Fix Iteration 1

## Task
081 — Financial Guards — Fix review-3 findings

## Findings to Fix

### F1 (High): Unsafe EMI outputs for large valid inputs
`principalPaise` can be `Number.MAX_SAFE_INTEGER` with 360 months and 10000 bps, producing unsafe integer results that fail `.safe()` response validation → 500.

**Fix:** Constrain `principalPaise` in `EmiOfferInputSchema` to max 100_000_000_00 (₹100 crore = 10 billion paise). This is a reasonable upper bound for any EMI offer. Also add a `maxPrincipalPaise` constant comment explaining why.

In `packages/shared/src/schemas/shopping.ts`, change:
```typescript
principalPaise: z.number().int().nonnegative().safe(),
```
to:
```typescript
/** Max ₹100 crore — keeps all derived EMI values within safe-integer range. */
principalPaise: z.number().int().nonnegative().max(10_000_000_000),
```

### F2 (Medium): Malformed emiOffers JSON → 500
`JSON.parse` inside Zod transform throws raw SyntaxError.

**Fix:** In `FinancialGuardsQuerySchema` in `packages/shared/src/schemas/shopping.ts`, wrap JSON.parse in try/catch:
```typescript
emiOffers: z
  .string()
  .optional()
  .transform((s, ctx) => {
    if (!s) return undefined;
    let parsed: unknown;
    try { parsed = JSON.parse(s); } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "emiOffers must be valid JSON" });
      return z.NEVER;
    }
    return z.array(EmiOfferInputSchema).max(10).parse(parsed);
  }),
```

### F3 (Medium): getGoalProgress duplicates DB reads
`getGoalProgress` at line 410 calls `getGoalProjectionInputs(db, userId, id)`, which re-loads ownedGoal, listAccounts, getPortfolio, effectiveTarget, getProjectionSettings, retirementDetails, and mappedContributionRate — all already loaded at lines 346-407. This doubles DB round-trips on every goal-progress call.

**Fix:** Remove the `getGoalProjectionInputs` call from `getGoalProgress`. Instead, construct a `ProjectionInput` locally from the already-loaded display data:

Replace lines 409-411 (the three lines):
```typescript
  // Keep the progress path aligned with the side-effect-free advisory loader.
  const projectionInputs = await getGoalProjectionInputs(db, userId, id);
  const proj = projectGoal(projectionInputs);
```
with:
```typescript
  const proj = projectGoal({
    assets: assets.map((a) => ({ valuePaise: a.valuePaise, annualReturnBps: a.annualReturnBps })),
    targetPaise: target,
    monthsToTarget,
    monthlyInflowPaise,
  });
```

This keeps `getGoalProjectionInputs` for the financial-guards use case (which needs projection without display data) while `getGoalProgress` uses its own already-loaded data for the same projection. No duplicate reads, no behavior change.

You will need to add `import type { ProjectionInput } from "./goal-projection.ts";` if it's not already imported (check first — it may not be needed since we're passing an object literal that TypeScript will structurally match).

## Files to Modify
- `packages/shared/src/schemas/shopping.ts` — F1, F2
- `apps/api/src/modules/planning/services/goals.ts` — F3

### F4: Update test for large EMI principal after cap
The test at line 16 uses `principalPaise = 900_000_000_000_000` which exceeds the new 10B cap. Change it to use a value within the cap that still exercises the BigInt path for processing fee.

In `apps/api/src/modules/shopping/services/financial-guards.test.ts`, change:
```typescript
  const largeFee = decomposeEmi(900_000_000_000_000, 1, 0, 10_000);
```
to:
```typescript
  const largeFee = decomposeEmi(9_000_000_000, 1, 0, 10_000);
```
And update the assertion:
```typescript
  assert.equal(largeFee.processingFeePaise, 900_000_000_000_000);
```
to:
```typescript
  assert.equal(largeFee.processingFeePaise, 9_000_000_000);
```

Also add a test that validates malformed JSON produces a Zod error (not a thrown SyntaxError):
```typescript
test("FinancialGuardsQuerySchema rejects malformed emiOffers JSON with a validation error", () => {
  const result = FinancialGuardsQuerySchema.safeParse({
    cartTotalPaise: "100000",
    emiOffers: "{bad",
  });
  assert.equal(result.success, false);
});
```

## Must Not Change
- financial-guards.ts (service)
- financial-guards route
- plugin.ts
- Any other files outside the 3 listed below

## Commands
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -w apps/api`

## Required Evidence
- files changed, diffs, command output, exit codes
