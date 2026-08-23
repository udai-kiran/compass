# Release Fix 1 — Task 089

**Date:** 2026-08-23  
**Branch:** feat/082-083-receipt-cart-review  
**Related:** tag v3.8.0 (commit 07e0898)

## Objective

Follow-up commit: restore omitted `packages/shared/src/schemas/wealth.test.ts` (MAX_RD_INSTALLMENTS=600 rejection tests).

## Changes

**New commit:** `db636f5`

Files:
- `packages/shared/src/schemas/wealth.test.ts` (+39 lines)

Commit message:
```
test(shared): RD installment-cap rejection coverage (task 089)

Follow-up to 07e0898 — the MAX_RD_INSTALLMENTS=600 schema cap landed
without its rejection tests. No code changes.

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Log

```
db636f5 (HEAD -> feat/082-083-receipt-cart-review, origin/feat/082-083-receipt-cart-review) test(shared): RD installment-cap rejection coverage (task 089)
07e0898 (tag: v3.8.0) feat(tax): FY tax-rule data, regime preference & fixed-income deposits (tasks 087, 089)
a4b0cf6 feat(shopping): receipt loop and cart review UI (tasks 082-083)
```

## Status

**Exit codes:** 0 (all)  
**Push:** ✓ yes  
**Errors:** none

```
git add:        exit 0
git commit:     exit 0 [1 file changed, 39 insertions(+)]
git push:       exit 0 [07e0898..db636f5]
```
