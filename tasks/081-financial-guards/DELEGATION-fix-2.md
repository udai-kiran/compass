# Codex Worker Delegation — Fix Iteration 2

## Task
081 — Financial Guards — Fix review-4 HIGH finding

## Finding
`cartTotalPaise` accepts `Number.MAX_SAFE_INTEGER` via `.safe()`. With negative `remainingPaise` (overspent budget), `overBudgetPaise = Math.max(0, cartTotalPaise - remainingPaise)` can exceed safe integer → 500 response. Same class of bug as F1 (EMI principal).

## Fix
Cap `cartTotalPaise` at 10B paise (₹100 crore) in both schemas, matching the EMI principal cap.

In `packages/shared/src/schemas/shopping.ts`:

1. Change `FinancialGuardsRequestSchema` (line 211):
```typescript
  cartTotalPaise: z.number().int().nonnegative().safe(),
```
to:
```typescript
  /** Max ₹100 crore — keeps derived budget values within safe-integer range. */
  cartTotalPaise: z.number().int().nonnegative().max(10_000_000_000),
```

2. Change `FinancialGuardsQuerySchema` (line 219):
```typescript
  cartTotalPaise: z.coerce.number().int().nonnegative().safe(),
```
to:
```typescript
  /** Max ₹100 crore — keeps derived budget values within safe-integer range. */
  cartTotalPaise: z.coerce.number().int().nonnegative().max(10_000_000_000),
```

## Files to Modify
- `packages/shared/src/schemas/shopping.ts` only

## Must Not Change
- All other files

## Commands
1. `npm run typecheck`
2. `npm run test -w packages/shared`
3. `npm run test -w apps/api`

## Required Evidence
- Diff, command outputs, exit codes
