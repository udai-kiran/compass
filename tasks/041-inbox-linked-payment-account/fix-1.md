# Fix 1: Make `linkedAccountId` required (not optional) in `AccountSchema`

## Files Changed

- `packages/shared/src/schemas/ledger.ts` — line 196: removed `.optional()` from `linkedAccountId`
- `apps/web/src/routes/accounts/account-groups.test.ts` — added `linkedAccountId: null` to the `AccountWithBalance` fixture factory
- `apps/web/src/routes/inbox/repayment-eligibility.test.ts` — added `linkedAccountId: null` to the `Account` fixture factory

## Schema Change

In `AccountSchema` (line 196 of `ledger.ts`):

Before:
```ts
linkedAccountId: z.uuid().nullable().optional(),
```

After:
```ts
linkedAccountId: z.uuid().nullable(),
```

Note: the second occurrence at line 261 (`UpdateAccountSchema`) was left unchanged — it is a PATCH payload schema where `.optional()` is correct.

## Typecheck Output Before Fix

```
src/routes/accounts/account-groups.test.ts(6,87): error TS2719: Type '{ ... }' is not assignable to type '{ ... }'. Two different types with this name exist, but they are unrelated.
  Types of property 'linkedAccountId' are incompatible.
    Type 'string | null | undefined' is not assignable to type 'string | null'.
      Type 'undefined' is not assignable to type 'string | null'.
src/routes/inbox/repayment-eligibility.test.ts(6,65): error TS2719: Type '{ ... }' is not assignable to type '{ ... }'. Two different types with this name exist, but they are unrelated.
  Types of property 'linkedAccountId' are incompatible.
    Type 'string | null | undefined' is not assignable to type 'string | null'.
      Type 'undefined' is not assignable to type 'string | null'.
npm error code 2
```

Exit code: 2

## Typecheck Output After Fix

```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit

> @compass/docs@0.1.0 typecheck
> tsc --noEmit

> @compass/extractor@0.1.0 typecheck
> tsc --noEmit

> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit

> @compass/web@0.1.0 typecheck
> tsc --noEmit

> @compass/ai@0.1.0 typecheck
> tsc --noEmit

> @compass/shared@0.1.0 typecheck
> tsc --noEmit
```

Exit code: 0

## Web Workspace Test Output

```
> @compass/web@0.1.0 test
> node --test "src/**/*.test.ts"

[264 tests, all passing — full output captured]

ℹ tests 264
ℹ suites 0
ℹ pass 264
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 630.765094
```

Exit code: 0
