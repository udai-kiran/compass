# Verification Report — backend-5 (ledger.ts SafePaiseSchema adoption)

**Brief source:** tasks/021-postings-model/backend-5.md

---

## Typecheck output

```
> @compass/shared@0.1.0 typecheck
> tsc --noEmit

EXIT=0
```

---

## Test output

```
> @compass/shared@0.1.0 test
> node --test "src/**/*.test.ts"

✔ ddmmyyyyToISO returns null for ISO format (user typing 1990-05-15 in a DD-MM-YYYY field) (1.481037ms)
... (212 tests total)
ℹ tests 212
ℹ suites 0
ℹ pass 212
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 455.692929
EXIT=0
```

---

## git diff -- packages/shared/src/schemas/ledger.ts

```diff
diff --git a/packages/shared/src/schemas/ledger.ts b/packages/shared/src/schemas/ledger.ts
index 30cc217..08faab3 100644
--- a/packages/shared/src/schemas/ledger.ts
+++ b/packages/shared/src/schemas/ledger.ts
@@ -1,4 +1,5 @@
 import { z } from "zod";
+import { SafePaiseSchema } from "../money.ts";
 
 // ---------- Accounts ----------
 
@@ -188,7 +189,6 @@ export const AccountSchema = z.object({
   holderName: z.string().nullable(),
   upiIds: z.array(z.string()),
   currency: z.string(),
-  openingBalancePaise: z.number().int(),
   /** Goal this account is earmarked for; null = Unassigned. */
   goalId: z.uuid().nullable(),
   sortOrder: z.number().int(),
@@ -197,7 +197,7 @@ export const AccountSchema = z.object({
 export type Account = z.infer<typeof AccountSchema>;
 
 export const AccountWithBalanceSchema = AccountSchema.extend({
-  balancePaise: z.number().int(),
+  balancePaise: SafePaiseSchema,
   /** Bank subtype (savings/current/…) when the account carries bank details; else null. */
   subtype: BankAccountSubtypeSchema.nullable().default(null),
 });
@@ -242,7 +242,7 @@ export const CreateAccountSchema = z.object({
   accountLast4: Last4Schema.default(null),
   holderName: z.string().min(1).max(120).nullable().default(null),
   currency: z.string().min(3).max(3).default("INR"),
-  openingBalancePaise: z.number().int().default(0),
+  openingBalancePaise: SafePaiseSchema.default(0),
 });
 export type CreateAccount = z.infer<typeof CreateAccountSchema>;
 
@@ -254,7 +254,7 @@ export const UpdateAccountSchema = z.object({
   holderName: z.string().min(1).max(120).nullable().optional(),
   upiIds: UpiIdsSchema.optional(),
   goalId: z.uuid().nullable().optional(),
-  openingBalancePaise: z.number().int().optional(),
+  openingBalancePaise: SafePaiseSchema.optional(),
   sortOrder: z.number().int().optional(),
   archived: z.boolean().optional(),
 });
@@ -370,7 +370,7 @@ export const TransactionSourceSchema = z.enum(["manual", "import", "recurring"])
 export const SplitSchema = z.object({
   id: z.uuid(),
   categoryId: z.uuid(),
-  amountPaise: z.number().int(),
+  amountPaise: SafePaiseSchema,
   note: z.string(),
 });
 export type Split = z.infer<typeof SplitSchema>;
@@ -379,7 +379,7 @@ export const TransactionSchema = z.object({
   id: z.uuid(),
   accountId: z.uuid(),
   date: z.iso.date(),
-  amountPaise: z.number().int(),
+  amountPaise: SafePaiseSchema,
   merchant: z.string(),
   categoryId: z.uuid().nullable(),
   /**
@@ -410,10 +410,7 @@ export type Transaction = z.infer<typeof TransactionSchema>;
 export const CreateTransactionSchema = z.object({
   accountId: z.uuid(),
   date: z.iso.date(),
-  amountPaise: z
-    .number()
-    .int()
-    .refine((n) => n !== 0, "Amount cannot be zero"),
+  amountPaise: SafePaiseSchema.refine((n) => n !== 0, "Amount cannot be zero"),
   merchant: z.string().default(""),
   categoryId: z.uuid().nullable().default(null),
   necessity: ExpenseNecessitySchema.nullable().default(null),
@@ -427,11 +424,7 @@ export type CreateTransaction = z.input<typeof CreateTransactionSchema>;
 export const UpdateTransactionSchema = z.object({
   accountId: z.uuid().optional(),
   date: z.iso.date().optional(),
-  amountPaise: z
-    .number()
-    .int()
-    .refine((n) => n !== 0, "Amount cannot be zero")
-    .optional(),
+  amountPaise: SafePaiseSchema.refine((n) => n !== 0, "Amount cannot be zero").optional(),
   merchant: z.string().optional(),
   categoryId: z.uuid().nullable().optional(),
   necessity: ExpenseNecessitySchema.nullable().optional(),
@@ -463,11 +456,11 @@ export const TransactionPageSchema = z.object({
   items: z.array(TransactionSchema),
   nextCursor: z.string().nullable(),
   totalCount: z.number().int(),
-  totalAmountPaise: z.number().int(),
+  totalAmountPaise: SafePaiseSchema,
   /** Sum of inflows (credits), as a positive magnitude. -1 on cursor pages (unchanged). */
-  totalInflowPaise: z.number().int(),
+  totalInflowPaise: SafePaiseSchema,
   /** Sum of outflows (debits), as a positive magnitude. -1 on cursor pages (unchanged). */
-  totalOutflowPaise: z.number().int(),
+  totalOutflowPaise: SafePaiseSchema,
 });
 export type TransactionPage = z.infer<typeof TransactionPageSchema>;
 
@@ -476,7 +469,7 @@ export const SetSplitsSchema = z.object({
     .array(
       z.object({
         categoryId: z.uuid(),
-        amountPaise: z.number().int(),
+        amountPaise: SafePaiseSchema,
         note: z.string().default(""),
       }),
     )
@@ -539,7 +532,7 @@ export type BulkResult = z.infer<typeof BulkResultSchema>;
 export const TransferSuggestionSchema = z.object({
   outTransactionId: z.uuid(),
   inTransactionId: z.uuid(),
-  amountPaise: z.number().int(),
+  amountPaise: SafePaiseSchema,
   daysApart: z.number().int(),
 });
 export type TransferSuggestion = z.infer<typeof TransferSuggestionSchema>;
@@ -567,7 +560,7 @@ export const CreateTransferSchema = z
     fromAccountId: z.uuid(),
     toAccountId: z.uuid(),
     date: z.iso.date(),
-    amountPaise: z.number().int().positive(),
+    amountPaise: SafePaiseSchema.refine((n) => n > 0, "must be positive"),
     merchant: z.string().default(""),
     notes: z.string().default(""),
     tags: z.array(z.string()).default([]),
@@ -578,11 +571,7 @@ export const CreateTransferSchema = z
   });
 export type CreateTransfer = z.input<typeof CreateTransferSchema>;
 
-export const TransferResultSchema = z.object({
-  transferLinkId: z.uuid(),
-  outTransactionId: z.uuid(),
-  inTransactionId: z.uuid(),
-});
+export const TransferResultSchema = z.object({ transactionId: z.uuid() });
 export type TransferResult = z.infer<typeof TransferResultSchema>;
 
 // ---------- EPF contributions ----------
@@ -597,7 +586,7 @@ export const CreateEpfContributionSchema = z.object({
   toAccountId: z.uuid(),
   date: z.iso.date(),
   employer: z.string().default(""),
-  amountPaise: z.number().int().positive(),
+  amountPaise: SafePaiseSchema.refine((n) => n > 0, "must be positive"),
   notes: z.string().default(""),
 });
 export type CreateEpfContribution = z.infer<typeof CreateEpfContributionSchema>;
@@ -605,7 +594,7 @@ export type CreateEpfContributionInput = z.input<typeof CreateEpfContributionSch
 
 export const EpfContributionResultSchema = z.object({
   transactionId: z.uuid(),
-  amountPaise: z.number().int(),
+  amountPaise: SafePaiseSchema,
 });
 export type EpfContributionResult = z.infer<typeof EpfContributionResultSchema>;
```
