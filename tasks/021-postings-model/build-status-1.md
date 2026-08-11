# Build Status — feat/postings-pr-g1 (2026-08-10)

## 1. npm run typecheck — EXIT 2 (FAIL)

All non-api workspaces (docs, extractor, ingestor, web, ai, shared) pass.
`@compass/api` fails with 14 errors across 5 files:

### src/lib/postings-periods-parity.test.ts (6 errors)
- (16,3) error TS2305: Module '"../modules/ledger/services/transactions.ts"' has no exported member 'rebuildPostingsForTransaction'.
- (489,45) error TS2339: Property 'transferLinkId' does not exist on type '{ transactionId: string; }'.
- (507,59) error TS2551: Property 'outTransactionId' does not exist on type '{ transactionId: string; }'. Did you mean 'transactionId'?
- (507,86) error TS2551: Property 'inTransactionId' does not exist on type '{ transactionId: string; }'. Did you mean 'transactionId'?
- (507,103) error TS2554: Expected 4 arguments, but got 5.
- (519,68) error TS2551: Property 'inTransactionId' does not exist on type '{ transactionId: string; }'. Did you mean 'transactionId'?
- (520,60) error TS2551: Property 'outTransactionId' does not exist on type '{ transactionId: string; }'. Did you mean 'transactionId'?

### src/modules/ingest/services/inbox.test.ts (2 errors)
- (1254,69) error TS2554: Expected 4 arguments, but got 5.
- (1667,68) error TS2554: Expected 4 arguments, but got 5.

### src/modules/ledger/services/epf-contributions.test.ts (1 error)
- (150,25) error TS2339: Property 'transferLinkId' does not exist on type '{ id: string; ... splits: { ...; }[]; }'.

### src/modules/ledger/services/postings-pr-e-parity.test.ts (1 error)
- (522,76) error TS2551: Property 'outTransactionId' does not exist on type '{ transactionId: string; }'. Did you mean 'transactionId'?

### src/modules/ledger/services/reconcile-postings.test.ts (2 errors)
- (8,10) error TS2305: Module '"./reconcile-postings.ts"' has no exported member 'reconcileUserPostings'.
- (296,27) error TS7006: Parameter 'f' implicitly has an 'any' type.

### src/modules/system/services/backup.test.ts (1 error)
- (34,36) error TS2305: Module '"../../ledger/services/reconcile-postings.ts"' has no exported member 'reconcileUserPostings'.

---

## 2. npm run lint — EXIT 0 (PASS)

No ESLint errors or warnings.

---

## 3. node --test legacy-projection.test.ts — EXIT 0 (PASS)

9 tests, 9 pass, 0 fail.

---

## 4. node --test rebuild-drafts.test.ts — EXIT 0 (PASS)

16 tests, 16 pass, 0 fail.

---

## Summary

| Check | Result |
|---|---|
| typecheck | FAIL (14 errors in api workspace) |
| lint | PASS |
| legacy-projection.test.ts | PASS (9/9) |
| rebuild-drafts.test.ts | PASS (16/16) |

The two recurring themes in typecheck failures:
1. `reconcileUserPostings` is not exported from `reconcile-postings.ts` (2 call sites).
2. `rebuildPostingsForTransaction` is not exported from `transactions.ts` (1 call site).
3. Transfer result shape no longer has `transferLinkId`, `outTransactionId`, `inTransactionId` — several test files still reference those old fields.
4. A function in the transfer/inbox path changed arity from 5 → 4 arguments.
