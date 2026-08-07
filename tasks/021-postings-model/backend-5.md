All changes are complete and verified. Here's a summary of what I did:

## Changes made to `packages/shared/src/schemas/ledger.ts`

**Structural changes:**
1. Added `import { SafePaiseSchema } from "../money.ts";` immediately after the existing `import { z } from "zod";`.
2. Deleted the `openingBalancePaise: z.number().int(),` line from `AccountSchema` (all other fields kept).
3. Replaced the body of `TransferResultSchema` with `z.object({ transactionId: z.uuid() })`, keeping the `TransferResult` type line.

**SafePaiseSchema adoption** (exactly the specified fields, nothing else):
- `SplitSchema.amountPaise`, `TransactionSchema.amountPaise`, `AccountWithBalanceSchema.balancePaise`, `TransactionPageSchema.totalAmountPaise`/`totalInflowPaise`/`totalOutflowPaise`, `SetSplitsSchema` inner `amountPaise`, `TransferSuggestionSchema.amountPaise`, `EpfContributionResultSchema.amountPaise` → `SafePaiseSchema`
- `CreateTransactionSchema`/`UpdateTransactionSchema.amountPaise` → `SafePaiseSchema.refine(...)` (with the zero checks preserved)
- `CreateAccountSchema.openingBalancePaise` → `SafePaiseSchema.default(0)`
- `UpdateAccountSchema.openingBalancePaise` → `SafePaiseSchema.optional()`
- `CreateTransferSchema`/`CreateEpfContributionSchema.amountPaise` → `SafePaiseSchema.refine((n) => n > 0, "must be positive")`

**Left untouched** (byte-for-byte): `TransactionFilterSchema.minAmountPaise`/`maxAmountPaise` (still `z.coerce`), `BankDetailsSchema`/`UpsertBankDetailsSchema.requiredAmbPaise`, `OverdraftDetailsSchema`/`UpsertOverdraftDetailsSchema` fields, `AccountAverageBalanceSchema` fields, and `TransactionSchema.transferLinkId`/`transferCounterpartAccountId`.

## Verification
- `npm run typecheck -w packages/shared` — passed with no errors.
- `npm run test -w packages/shared` — 212/212 tests passed.
- `node --test packages/shared/src/schemas/ledger.test.ts` — 10/10 tests passed.
