# Sonnet Worker / Engineer Delegation — SP1 (atomic postings cutover)

Branch: `feat/postings-model-sp1` off `main`. ALL work lands on this one branch;
it is intentionally NOT green until the final slice. Do NOT commit/push/tag/PR
(lead engineer retains that gate). Never `git add -A`.

Durable design: `tasks/021-postings-model/TASK.md` (D1–D22). Consumer map:
`investigation-1.md`. SP0 pure helpers already exist in
`apps/api/src/modules/ledger/services/postings.ts`
(assertSafePaise/sumPaise/assertZeroSum/buildOrdinaryPostings/buildSplitPostings/
buildTransferPostings/buildOpeningPostings/classifyShape/projectRealLeg/
projectCounter/projectSplits) and `SafePaiseSchema` in
`packages/shared/src/money.ts`. SP1 WIRES them in.

Slices (each a numbered backend-<n>.md / frontend-<n>.md engineer run):
- B1: schema + migration 0067 + postEntry/header helpers + system-account seed/resolve + backup registration.
- B2: write-path conversion (all writers route through postEntry; transfers merge/unlink; opening; splits; recurring EMI; imports/demo/insurance/epf/categories/merchants/review/transfer-classification/sip-lifecycle audit).
- B3: read/aggregation conversion (periods, balances, accounts reads, average-balance, search, user-tasks, cashflow, dashboard, reports, insights, goals, bills, cards, emis, reconciliation-reads, categorize, tools, sip-installments, networth, prefs).
- B4: shared contract + hydrate finalize + backup CSV + restore-user + db/restore + extractor + all fixtures.
- F1: web (TransactionsPage, AccountLedgerPage, TransactionDrawer, CardDetailPage, account forms, queries.ts).
Converge to green (typecheck/lint/test) only after B4/F1.

---

## Iteration 1 — B1 (backend-1.md): schema + migration + write primitives + system accounts

### Files to change
- `apps/api/src/db/shared/hubs.ts` — accounts table + account_type enum.
- `apps/api/src/db/shared/ledger.ts` — transactions header + new `postings` table.
- `apps/api/src/modules/ledger/schema.ts` — re-export `postings` (do NOT redefine).
- `apps/api/src/db/schema.ts` — barrel: export `postings` exactly once.
- NEW `apps/api/src/modules/ledger/services/post-entry.ts` — transactional writer + header-only helper + system-account seed/resolve.
- `apps/api/src/modules/system/services/backup.ts` — register `postings`.
- Generate `apps/api/drizzle/0067_*.sql`.

### Required schema changes (I own these exactly)
1. `hubs.ts` `accountType` pgEnum: append `"system"` as a new value (last). Keep all existing values.
2. `hubs.ts` new pgEnum `accountSystemKind = pgEnum("account_system_kind", ["expenses","income","opening"])`.
3. `hubs.ts` `accounts` table: DROP column `openingBalancePaise`. ADD column `systemKind: accountSystemKind("system_kind")` (nullable, no default). ADD a unique partial index: `uniqueIndex("accounts_system_kind_idx").on(t.userId, t.systemKind).where(sql\`system_kind is not null\`)`.
4. `ledger.ts` `transactions` table: DROP columns `accountId`, `amountPaise`, `categoryId`, `necessity`, `isOpening`. Also remove the now-dangling indexes `transactions_account_idx` and `transactions_category_idx`. Remove the now-unused imports (`accounts`, `categories`, `expenseNecessity`, `boolean`, `bigint`) ONLY if no longer referenced by the new postings table — note `postings` below RE-uses `accounts`, `categories`, `expenseNecessity`, `bigint`, so keep those imports.
5. `ledger.ts` new `postings` table (define beside transactions, in the shared layer):
   ```
   postings = pgTable("postings", {
     id: uuid("id").primaryKey().defaultRandom(),
     transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
     accountId: uuid("account_id").notNull().references(() => accounts.id),
     amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
     categoryId: uuid("category_id").references(() => categories.id),
     necessity: expenseNecessity("necessity"),
     note: text("note").notNull().default(""),
     createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
   }, (t) => [
     index("postings_tx_idx").on(t.transactionId),
     index("postings_account_idx").on(t.accountId),
     index("postings_category_idx").on(t.categoryId),
   ])
   ```
6. `modules/ledger/schema.ts`: add `postings` to the re-export from `../../db/shared/ledger.ts` (line 38 area: `export { transactions, transactionSource, postings } from "../../db/shared/ledger.ts";`). Do NOT define postings here.
7. `db/schema.ts` barrel: ensure `postings` is exported exactly once (it flows through the ledger shared re-export or the module barrel — match the existing single-export pattern; verify `postings` appears once).

### post-entry.ts (I own the API surface — implement exactly)
Provide, using Drizzle and the existing `DbOrTx` convention (see `createTransaction` in `modules/ledger/services/transactions.ts:254` for how a plain Db vs Tx is handled — if passed a plain Db, open `.transaction(...)` internally; if passed a Tx, use it directly so nesting is avoided):
```
import type { PostingDraft } from "./postings.ts";
import { assertZeroSum } from "./postings.ts";

export interface PostEntryHeader {
  date: string; occurredAt?: Date | null; merchant?: string; notes?: string;
  tags?: string[]; source?: "manual" | "import" | "recurring";
  policyId?: string | null; resourceId?: string | null; sipId?: string | null;
  recurringTemplateId?: string | null; reconciledStatementId?: string | null;
}
// Insert a new transaction header + its postings in ONE db transaction,
// asserting zero-sum immediately before persistence. Returns the new tx id.
export async function postEntry(db: DbOrTx, input: { userId: string; header: PostEntryHeader; postings: PostingDraft[] }): Promise<{ transactionId: string }>;
// Replace ALL postings of an existing transaction (delete + insert) inside a
// single db transaction, asserting zero-sum before persist. For posting mutations.
export async function replacePostings(db: DbOrTx, transactionId: string, postings: PostingDraft[]): Promise<void>;
// Header-only metadata/FK update (D18). MUST NOT touch postings.
export async function updateTransactionHeader(db: DbOrTx, transactionId: string, patch: Partial<PostEntryHeader>): Promise<void>;
// Idempotent: ensure one system account per kind for the user. Uses ON CONFLICT
// DO NOTHING against accounts_system_kind_idx (or select-then-insert). type = "system".
// Names: expenses→"Expenses", income→"Income", opening→"Opening Balances".
export async function seedSystemAccounts(db: DbOrTx, userId: string): Promise<void>;
// Resolve the three system-account ids for a user. Throws if any missing.
export async function resolveSystemAccounts(db: DbOrTx, userId: string): Promise<{ expenses: string; income: string; opening: string }>;
```
`postEntry` MUST call `assertZeroSum(input.postings)` before writing. `replacePostings` MUST call `assertZeroSum(postings)` before writing.

### backup.ts registration (D8)
- Add `"postings"` to `ALL_TABLES`, positioned immediately AFTER `"transactions"` (and after `"accounts"`, which already precedes transactions) so restore FK order holds.
- Add `postings: { fk: "transaction_id", parent: "transactions" }` to `LINKED_TABLES`.
- Do NOT add postings to `USER_TABLES` (it has no user_id).
- Leave `transaction_splits` and `transfer_links` registered as-is (still present in schema this task).

### Wire seeding (minimal in B1 — just the calls; deeper write conversion is B2)
- In `modules/system/services/auth.ts` registration path (where categories are seeded), also call `seedSystemAccounts(tx, userId)` idempotently, in the same transaction.
Do NOT yet convert demo.ts / seed.ts / restore in B1 (B2/B4 handle those) UNLESS leaving them causes db:generate to fail (it won't — generate is offline).

### Generate migration
Run `cd /home/udai/PennyPilot && npm run db:generate`. It is an OFFLINE schema diff (no DB, no typecheck needed). Expect exactly ONE new file `apps/api/drizzle/0067_*.sql`. If drizzle-kit prompts interactively about renames vs drops, choose DROP/CREATE (these are true drops/adds, not renames) — but capture and report any prompt verbatim. Report the full generated SQL.

### Must NOT change
- Do NOT touch service read/write logic beyond post-entry.ts, the auth seeding call, and backup registration in B1.
- Do NOT redefine postings in module schema.
- Do NOT delete `transaction_splits`/`transfer_links` tables.
- Do NOT run typecheck/lint/test in B1 (the tree is intentionally broken until B4). Only run `db:generate`.

### Required evidence to return
- Files changed + full diff of the schema files, post-entry.ts, backup.ts registration, auth.ts seeding call.
- The literal `db:generate` command output + exit code + the full text of the generated `0067_*.sql` + its filename.
- Any interactive prompt encountered, verbatim.

---

## Iteration 2 — BFix (post-entry defects) + B4s (shared contract keystone)

Two DISJOINT file sets, launched in parallel.

### BFix (sonnet-worker) — apply the two lead-diagnosed defects in `apps/api/src/modules/ledger/services/post-entry.ts`
1. Line 2 `import type { Db, DbOrTx } from "../../../db/index.ts";` — remove the unused `Db` → `import type { DbOrTx } from "../../../db/index.ts";`.
2. `seedSystemAccounts`: the `onConflictDoNothing` targets the PARTIAL unique index `accounts_system_kind_idx` but omits its predicate, so Postgres can't infer the arbiter. Import `sql` from `drizzle-orm` (add to the existing `import { and, eq, isNotNull } from "drizzle-orm";`) and change the conflict clause to:
   `.onConflictDoNothing({ target: [accounts.userId, accounts.systemKind], targetWhere: sql\`system_kind is not null\` })`
Do NOT change anything else in the file. Do NOT run typecheck/test (tree is intentionally broken). Report the diff of post-entry.ts only.

### B4s (backend-engineer) — `packages/shared/src/schemas/ledger.ts` per D23. Isolated + independently verifiable.
Scope files: ONLY `packages/shared/src/schemas/ledger.ts` (do NOT touch ledger.test.ts — its assertions stay valid).

Structural changes:
- Add import at top: `import { SafePaiseSchema } from "../money.ts";`
- `AccountSchema`: DELETE the `openingBalancePaise: z.number().int(),` line (response drops it). Keep everything else.
- `TransferResultSchema`: transfers are now ONE transaction (D1). Replace its body with `z.object({ transactionId: z.uuid() })`. Keep the export + `TransferResult` type.

SafePaiseSchema adoption — replace EXACTLY these fields, nothing else:
- `SplitSchema.amountPaise`: `z.number().int()` → `SafePaiseSchema`
- `TransactionSchema.amountPaise`: `z.number().int()` → `SafePaiseSchema`
- `AccountWithBalanceSchema.balancePaise`: `z.number().int()` → `SafePaiseSchema`
- `TransactionPageSchema.{totalAmountPaise,totalInflowPaise,totalOutflowPaise}`: each `z.number().int()` → `SafePaiseSchema`
- `SetSplitsSchema` inner `amountPaise`: `z.number().int()` → `SafePaiseSchema`
- `TransferSuggestionSchema.amountPaise`: `z.number().int()` → `SafePaiseSchema`
- `CreateTransactionSchema.amountPaise`: `z.number().int().refine((n) => n !== 0, "Amount cannot be zero")` → `SafePaiseSchema.refine((n) => n !== 0, "Amount cannot be zero")` (keep exact message)
- `UpdateTransactionSchema.amountPaise`: same → `SafePaiseSchema.refine((n) => n !== 0, "Amount cannot be zero").optional()`
- `CreateAccountSchema.openingBalancePaise`: `z.number().int().default(0)` → `SafePaiseSchema.default(0)`
- `UpdateAccountSchema.openingBalancePaise`: `z.number().int().optional()` → `SafePaiseSchema.optional()`
- `CreateTransferSchema.amountPaise`: `z.number().int().positive()` → `SafePaiseSchema.refine((n) => n > 0, "must be positive")`
- `CreateEpfContributionSchema.amountPaise`: `z.number().int().positive()` → `SafePaiseSchema.refine((n) => n > 0, "must be positive")`
- `EpfContributionResultSchema.amountPaise`: `z.number().int()` → `SafePaiseSchema`

MUST NOT change (leave exactly as-is): `TransactionFilterSchema.minAmountPaise/maxAmountPaise` (they use `z.coerce.number().int()` and must keep coercion); `BankDetailsSchema.requiredAmbPaise`, `UpsertBankDetailsSchema.requiredAmbPaise`, `OverdraftDetailsSchema.*`, `UpsertOverdraftDetailsSchema.*`, `AccountAverageBalanceSchema.*` (peripheral, out of SP1 scope). Do NOT alter `TransactionSchema.transferLinkId` / `transferCounterpartAccountId` (repurposed in hydrate, not the schema). Do NOT touch any other file.

Acceptance: `npm run typecheck -w packages/shared` exits 0; `npm run test -w packages/shared` passes (ledger.test.ts unchanged). Report the full diff of ledger.ts + both command outputs + exit codes.
