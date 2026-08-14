# Investigation 1 — Legacy Ledger Drop (PR-G2)

## Files inspected

- `apps/api/src/db/shared/ledger.ts` — `transactions` + `postings` table defs
- `apps/api/src/db/shared/hubs.ts` — `accounts` table def (line 99: `opening_balance_paise`)
- `apps/api/src/modules/ledger/schema.ts` — resident table defs for `transaction_splits` / `transfer_links`
- `apps/api/src/db/schema.ts` — barrel re-export (lines 35–36)
- `apps/api/src/modules/ledger/services/legacy-projection.ts` — full read
- `apps/api/src/modules/ledger/services/post-entry.ts` — full read
- `apps/api/src/modules/ledger/services/accounts.ts` — selected sections
- `apps/api/src/modules/ledger/services/balances.ts` — header
- `apps/api/src/modules/ledger/services/cards.ts` (credit module) — lines 340–380
- `apps/api/src/modules/ledger/services/transactions.ts` — lines 155–242, 630–715
- `apps/api/src/modules/ledger/services/transfers.ts` — selected sections
- `apps/api/src/modules/ledger/services/categories.ts` — line 157 context
- `apps/api/src/modules/ledger/services/reconcile-postings.ts` — lines 110–156
- `apps/api/src/modules/ledger/services/search.ts` — full
- `apps/api/src/modules/credit/services/reconciliation-writes.ts` — lines 87–155, 360–390
- `apps/api/src/modules/ingest/services/imports.ts` — line 686 context
- `apps/api/src/modules/investments/services/sip-installments.ts` — lines 75–103, 280–340
- `apps/api/src/modules/system/services/backup.ts` — lines 25–194
- `apps/api/src/modules/system/services/demo.ts` — lines 127–245
- `apps/api/src/modules/system/services/restore-user.ts` — lines 1–80
- `apps/api/src/db/restore.ts` — lines 9–77
- `apps/api/src/app.ts` — line 191
- `packages/shared/src/schemas/ledger.ts` — lines 183–610
- `apps/web/src/routes/settings/AccountDetailPage.tsx` — lines 363–508
- `apps/web/src/routes/settings/SettingsPage.tsx` — line 135
- `apps/web/src/routes/settings/opening-balance.ts` — full
- `apps/web/src/routes/cards/CardDetailPage.tsx` — lines 178–210
- `apps/web/src/routes/transactions/TransactionsPage.tsx` — selected lines
- `apps/web/src/lib/queries.ts` — lines 195–250
- `apps/api/src/lib/postings-periods-parity.test.ts` — header + selected
- `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts` — header + selected
- `apps/api/src/modules/ledger/services/postings-balance-parity.test.ts` — header
- `.github/workflows/ci.yml` — full
- `eslint.config.js` — relevant sections
- `tasks/021-postings-model/PLAN-dualwrite.md` — PR-G2 description

---

## 1. Reference inventory

### (a) Schema definitions

| Symbol | File:line | What it is |
|--------|-----------|------------|
| `transactionSplits` pgTable | `apps/api/src/modules/ledger/schema.ts:40–55` | Resident table def |
| `transferLinks` pgTable | `apps/api/src/modules/ledger/schema.ts:57–76` | Resident table def |
| `transactions.isOpening` boolean column | `apps/api/src/db/shared/ledger.ts:66` | NOT NULL DEFAULT false |
| `transactions.accountId` uuid column | `apps/api/src/db/shared/ledger.ts:30–32` | NOT NULL FK → accounts |
| `transactions.amountPaise` bigint column | `apps/api/src/db/shared/ledger.ts:41` | NOT NULL |
| `transactions.categoryId` uuid column | `apps/api/src/db/shared/ledger.ts:43` | nullable FK → categories |
| `transactions.necessity` enum column | `apps/api/src/db/shared/ledger.ts:52` | nullable |
| `accounts.openingBalancePaise` bigint column | `apps/api/src/db/shared/hubs.ts:99–101` | NOT NULL DEFAULT 0 |
| Barrel re-exports | `apps/api/src/db/schema.ts:35–36` | `transactionSplits`, `transferLinks` |
| Decomposition test reference | `apps/api/src/db/schema.decomposition.test.ts:65` | includes both table names |

### (b) Runtime writes

All dual-writes to the legacy structures funnel through a single file:

**`post-entry.ts:postTransaction()`** (lines 100–127):
- line 109–120: updates `transactions.{accountId, amountPaise, categoryId, necessity, isOpening}` from `projectLegacyColumns()`
- line 123: `db.delete(transactionSplits)…`
- line 125: `db.insert(transactionSplits)…` (conditional on split shape)

No other file writes to `transaction_splits` or `transfer_links` at runtime. `legacy-projection.ts` only computes values; `post-entry.ts` is the sole writer.

`accounts.ts` writes `openingBalancePaise` (the accounts column, not transaction):
- line 246: `{ openingBalancePaise: 0 }` when seeding an opening transaction (PIN at 0)
- line 503: `openingColumn = { openingBalancePaise: plan.columnPaise }` in `updateAccount`

`reconciliation-writes.ts:372` writes `isOpening: true` into a new opening transaction insert — this passes through `postTransaction` thereafter.

`demo.ts:191–192` writes `isOpening: true` into `txns[]` (the insert batch) — those rows are then fed to `postTransaction` at line 225–243.

### (c) Runtime reads (column VALUE reads — not merely WHERE filters)

| File:line | Column read | Purpose |
|-----------|-------------|---------|
| `accounts.ts:201` | `transactions.isOpening` | FILTER in postings aggregate to compute `openingTxnPaise` for the DTO |
| `accounts.ts:149` | `accounts.openingBalancePaise` | returned as part of `AccountWithBalance` DTO |
| `cards.ts:356` | `t.is_opening` | WHERE filter in raw SQL that excludes opening rows from card activity |
| `transactions.ts:671` | `transactions.categoryId` | SELECT into snapshot for bulk-action undo |

Notes:
- `reconciliation-writes.ts:97,139,150` and `imports.ts:671` use `transactions.accountId` only in `eq(transactions.accountId, …)` WHERE predicates — they filter by account, they do not read the projected account value for output.
- `sip-installments.ts:296` derives `is_opening` via a fresh `EXISTS (SELECT 1 FROM postings p2 JOIN accounts a2 … WHERE a2.system_kind = 'opening')` sub-query — **postings-native, not a legacy column read**.

### (d) Tests

Files that reference legacy column names or table names:

| File | Context |
|------|---------|
| `lib/postings-periods-parity.test.ts:106,114,119,123,157,182,190,196,201` | SQL strings in parity formulas — computes the "legacy formula" to compare against postings readers. Legacy SQL uses `transaction_splits`, `is_opening` |
| `modules/ledger/services/postings-pr-e-parity.test.ts:431–432` | Reads `transactions.accountId` and `transactions.isOpening` for fixture lookup (not production logic) |
| `modules/ledger/services/recurring.test.ts:138,323,471` | `eq(transactions.accountId, …)` WHERE predicates in test setup |
| `modules/ledger/services/epf-contributions.test.ts:82` | `eq(transactions.accountId, …)` WHERE predicate in test setup |
| `modules/system/services/backup.test.ts:679` | `eq(transactions.accountId, …)` and `eq(transactions.isOpening, true)` WHERE predicates in test assertions |
| `db/schema.decomposition.test.ts:65` | Lists `"transactionSplits"`, `"transferLinks"` as expected resident tables of ledger module |

### (e) Comments / docs

Purely textual references (not runtime):
- `legacy-projection.ts:4–23` — top-of-file architectural comment
- `post-entry.ts:87–98` — architectural comment
- `postings.ts:230,267–268,281,361` — describes what no longer exists
- `transfers.ts:55,113,232` — notes that `transfer_links` is gone
- `reconcile-postings.ts:118–119` — boot-gate description
- `balances.ts:25` — notes column is always 0
- `accounts.ts:19–21,72–73` — architectural note
- `average-balance.ts:154–158` — note about `is_opening` transaction model
- `categories.ts:157` — contrast note about the old approach
- `ingest/imports.ts:686–688` — note that `transfer_links.auto` is gone
- `PLAN-dualwrite.md` — G4 description of the full drop

---

## 2. `legacy-projection.ts` — what it maintains, the PR-G2 plan, and the CI gate

**Columns maintained** (computed from postings and dual-written onto `transactions`):
- `account_id` — from `primaryRealLeg(postings)` (for transfers: the outflow leg)
- `amount_paise` — from `primaryRealLeg(postings)`
- `category_id` — from the single Expenses/Income counter posting (null for split/transfer/opening)
- `necessity` — from the same counter posting
- `is_opening` — true when shape is `"opening"`

**Table maintained**: `transaction_splits` — one row per Expenses/Income counter posting for split-shaped transactions only; cleared for non-split shapes.

**What is NOT maintained**: `transfer_links` — no writer creates link rows under PR-G1; the table is always empty (verified by `assertNoLegacyShapes` at boot).

**PR-G2 plan** (from file comment lines 21–23):
> "When PR-G2 drops the columns, this file is deleted whole. That is the point of concentrating the writes here rather than leaving them spread across the writer graph."

**The CI gate** — the comment (`legacy-projection.ts:12`) says "a CI gate asserts zero reads of these columns outside this file, the schema files and the boot check." Investigation found **no automated grep-based check in CI** (`.github/workflows/ci.yml` has no such step) and **no dedicated lint rule** in `eslint.config.js`. The effective gate is the `postings-pr-e-parity.test.ts` suite, which proves all API-facing readers compute from postings; and `postings-periods-parity.test.ts` for the aggregation helpers. However, reads at `accounts.ts:201`, `cards.ts:356`, and `transactions.ts:671` exist outside the listed exemptions — these are the violations that PR-G2 must fix before dropping the columns. The comment is forward-looking.

The boot check lives in `reconcile-postings.ts:assertNoLegacyShapes()`, called from `app.ts:191`. It reads `transfer_links` count and `accounts.opening_balance_paise <> 0` count — correctly on the allowlist.

---

## 3. Writers of legacy structures — post-entry.ts and all others

**`post-entry.ts`** — THE sole runtime writer:
- `postTransaction()` (lines 100–127): after replacing postings, calls `projectLegacyColumns()` then updates `transactions.{accountId, amountPaise, categoryId, necessity, isOpening}`, then deletes + inserts `transaction_splits` rows from `projectLegacySplits()`.
- All other services call `postTransaction()` (or `replacePostings()` + a subsequent `postTransaction()`) — there are no scattered direct writes.

**`transfers.ts`** — does NOT write `transfer_links`. Both `linkTransfer` (line 99) and `createTransfer` call `postTransaction` internally. Comment at line 113 confirms: "there is no link row left to record."

**`imports.ts`** — does NOT write `transaction_splits` or `transfer_links`. Line 686 is a comment noting the old `transfer_links.auto` flag is absent. All ledger mutations go through `postTransaction`.

**`categories.ts`** — does NOT write legacy structures (line 157 is only a comment noting it used to need two writes; the current implementation updates `postings.categoryId` directly).

**`reconciliation-writes.ts:372`** — writes `isOpening: true` into a `transactions.insert()` call. This is a necessary seed value because `transactions.is_opening` is NOT NULL and the column still exists. After PR-G2 removes the column this write disappears; the row is still identified as opening by its posting shape (postings leg against the `opening` system account).

**`demo.ts`** — writes `isOpening: true` into `txns[]` for the same reason (NOT NULL column). The flag is then used only to select the posting builder (`buildOpeningPostings` vs `buildOrdinaryPostings`). After PR-G2, the column drop requires removing the `isOpening` field from the `txns` push lines and the conditional at line 229.

---

## 4. Backup / restore / export coverage

### `backup.ts` — ALL_TABLES / USER_TABLES / LINKED_TABLES

- `ALL_TABLES` (line 33): includes `"transaction_splits"` and `"transfer_links"` — both must be removed.
- `USER_TABLES` (line 49): includes `transfer_links: "user_id"` — must be removed.
- `LINKED_TABLES` (lines 71): includes `transaction_splits: { fk: "transaction_id", parent: "transactions" }` — must be removed.
- `backup.test.ts:48–51` enforces that `ALL_TABLES` matches the Drizzle schema exactly — dropping the tables from schema without removing them from `ALL_TABLES` fails this test ("stale" entry). The reverse is also checked.

### `transactionsCsv()` (backup.ts lines 150–193)

**Already postings-derived.** The comment at line 129–148 explicitly states this was converted in task 023: Amount/Account come from `postings`, Category from counter postings via `string_agg`. The legacy `transactions.amount_paise` / `account_id` / `category_id` columns are NOT read here.

### `restore-user.ts`

No direct column references to legacy structures. It uses `restorableTables()` (line 18) which filters `ALL_TABLES` against `USER_TABLES` and `LINKED_TABLES` — so removing `transaction_splits` / `transfer_links` from those maps automatically excludes them from restore. No surgical change needed beyond the maps.

### `db/restore.ts` — `DEFERRED_RESTORE_COLUMNS`

No legacy column entries: `{ accounts: ["goal_id", "linked_account_id"] }`. No change needed here for PR-G2.

---

## 5. `packages/shared` Zod schemas and web consumption

### Schemas exposing legacy-adjacent fields

| Schema | File:line | Field | Status after PR-G2 |
|--------|-----------|-------|-------------------|
| `AccountSchema` | `ledger.ts:192` | `openingBalancePaise: z.number().int()` | Column being dropped from `accounts` — **must be removed from schema and all consumers** |
| `AccountWithBalanceSchema` | `ledger.ts:202–208` | inherits `openingBalancePaise` | Same |
| `CreateAccountSchema` | `ledger.ts:249` | `openingBalancePaise: z.number().int().default(0)` | **Must be removed** — user intent expressed as an opening transaction, not a column value |
| `UpdateAccountSchema` | `ledger.ts:262` | `openingBalancePaise: z.number().int().optional()` | **Must be removed** |
| `TransactionSchema` | `ledger.ts:383–418` | `accountId`, `amountPaise`, `categoryId`, `splits`, `isTransfer` | These are ALREADY postings-derived in `hydrate()` — the names persist but are populated from `postings`, not from legacy columns. **No schema change needed.** |
| `TransferLinkSchema` | `ledger.ts:563–568` | `id, outTransactionId, inTransactionId, auto` | `auto` field is meaningless (transfer_links table dropped); schema only used in `CreateTransferLinkSchema` body (route input, not response). The `auto` field should be removed. `CreateTransferLinkSchema` itself (outTransactionId + inTransactionId) remains valid as the "link two transactions" route body. |
| `SplitSchema` | `ledger.ts:375–380` | `id, categoryId, amountPaise, note` | Populated from postings (posting `.id` is the split id). **No change needed.** |

### Web components consuming legacy fields

| File:line | Legacy field | Purpose |
|-----------|-------------|---------|
| `CardDetailPage.tsx:185` | `account.openingBalancePaise` | Shows before/after opening balance in absorb-carryover confirm dialog |
| `AccountDetailPage.tsx:377` | `openingBalancePaise` in `updateAccount` call | Sends opening balance change to API |
| `AccountDetailPage.tsx:384` | `account.openingBalancePaise` | Calls `editsOpeningBalanceAsAmount(type, openingBalancePaise)` |
| `AccountDetailPage.tsx:508` | `openingBalancePaise` in `updateAccount` call | Same |
| `SettingsPage.tsx:135` | `openingBalancePaise` | Account creation form |
| `opening-balance.ts:51–53` | `openingBalancePaise` parameter | `editsOpeningBalanceAsAmount()` helper |

All web consumption goes through `AccountSchema.openingBalancePaise` / `UpdateAccountSchema.openingBalancePaise`. After PR-G2 drops the column these must be removed from schemas and all UI flows replaced — opening-balance editing will need to go through transaction-level edits only.

---

## 6. NOT NULL constraints on legacy columns; API contract post-drop

**`transactions` legacy columns:**
- `accountId` (account_id): **NOT NULL** — any INSERT must provide it today.
- `amountPaise` (amount_paise): **NOT NULL** — any INSERT must provide it today.
- `categoryId` (category_id): **nullable** — may be null already.
- `isOpening` (is_opening): **NOT NULL DEFAULT false** — can be omitted on INSERT.
- `necessity`: nullable.

Because `accountId` and `amountPaise` are NOT NULL, every INSERT into `transactions` today passes them. PR-G2 must add a migration that drops these columns (and the NOT NULL constraint disappears with the column).

**`accounts.opening_balance_paise`**: NOT NULL DEFAULT 0. Boot check enforces it is already always 0 for PR-G1 databases.

**API contract after dropping columns:**

The `TransactionSchema` already represents the postings-derived view: `accountId` / `amountPaise` / `categoryId` / `splits` / `isTransfer` are computed in `hydrate()` entirely from `postings` rows. The drop of the legacy columns has **no effect on the transaction list or detail response schema** — consumers already receive postings-derived values. The response shape is stable.

The `AccountWithBalanceSchema` field `openingBalancePaise` represents the column's value (always 0 after PR-G1). After dropping the column it becomes meaningless. **The `openingTransactionPaise` field** (the sum of postings on `is_opening` transactions, currently computed at `accounts.ts:201`) continues to carry the semantically correct number — but the filter at line 201 will need to change from `transactions.isOpening = true` to an `EXISTS (SELECT 1 FROM postings p2 JOIN accounts a2 … WHERE a2.system_kind = 'opening')` sub-query pattern (same as `sip-installments.ts:296`).

---

## 7. Jobs, seed, demo data, Drizzle relations

**Jobs** (`apps/api/src/jobs/`): No references to any legacy structure found.

**`db/seed.ts`**: Does not reference legacy structures. Delegates to `seedDefaultCategories()` only.

**`modules/system/services/demo.ts`**: Writes `isOpening: true` in `txns[]` (lines 191–192) and reads it back at line 229 to choose posting builder. Also passes `openingBalancePaise` in account creation calls (lines 128–135) — these flow through `createAccount()` which uses the field to decide whether to seed an opening transaction. After PR-G2: the `isOpening` field in `txns[]` must be replaced by selecting a posting-builder directly, and `openingBalancePaise` in `createAccount` input must be replaced by a separate `openingAmountPaise` parameter or restructured call.

**`db/seed.ts`** (db:seed command): No legacy references.

**Drizzle relations**: The project does not use Drizzle's `relations()` API at all (confirmed by schema smoke tests noting "this schema doesn't use drizzle relations"). No `db.query.<table>` with nested relational queries. No relations cleanup needed.

**`db/schema.decomposition.test.ts:65`**: Lists `"transactionSplits"` and `"transferLinks"` as expected ledger module resident tables. Must be removed when the tables are dropped.

---

## Drop list

Tables / columns / files that are safe to delete once the "Must rework" conversions below are done:

| Target | Location | Type |
|--------|----------|------|
| `transaction_splits` table | Migration (new DROP TABLE SQL) | Table |
| `transfer_links` table | Migration (new DROP TABLE SQL) | Table |
| `transactions.is_opening` column | Migration (ALTER TABLE DROP COLUMN) | Column |
| `transactions.account_id` column | Migration (ALTER TABLE DROP COLUMN) | Column |
| `transactions.amount_paise` column | Migration (ALTER TABLE DROP COLUMN) | Column |
| `transactions.category_id` column | Migration (ALTER TABLE DROP COLUMN) | Column |
| `transactions.necessity` column | Migration (ALTER TABLE DROP COLUMN) | Column |
| `accounts.opening_balance_paise` column | Migration (ALTER TABLE DROP COLUMN) | Column |
| `apps/api/src/modules/ledger/services/legacy-projection.ts` | File | Entire file |
| `transactionSplits` pgTable def | `modules/ledger/schema.ts:40–55` | Table def |
| `transferLinks` pgTable def | `modules/ledger/schema.ts:57–76` | Table def |
| `transactions.isOpening` field def | `db/shared/ledger.ts:60–66` | Column def |
| `transactions.accountId` field def | `db/shared/ledger.ts:30–32` | Column def |
| `transactions.amountPaise` field def | `db/shared/ledger.ts:41` | Column def |
| `transactions.categoryId` field def | `db/shared/ledger.ts:43` | Column def |
| `transactions.necessity` field def | `db/shared/ledger.ts:52` | Column def |
| `accounts.openingBalancePaise` field def | `db/shared/hubs.ts:99–101` | Column def |
| `transactions_account_idx` index | `db/shared/ledger.ts:109` | Index on dropped column |
| `transactions_category_idx` index | `db/shared/ledger.ts:110` | Index on dropped column |
| `"transactionSplits"` and `"transferLinks"` entries | `db/schema.decomposition.test.ts:65` | Test list entries |
| `transactionSplits`, `transferLinks` barrel exports | `db/schema.ts:35–36` | Re-exports |
| `"transaction_splits"` / `"transfer_links"` entries in `ALL_TABLES` | `backup.ts:33` | String literal |
| `transfer_links: "user_id"` entry | `backup.ts:49` | `USER_TABLES` entry |
| `transaction_splits: { fk: … }` entry | `backup.ts:71` | `LINKED_TABLES` entry |
| `assertNoLegacyShapes()` (or gut the body) | `reconcile-postings.ts:128–156` | Entire function or empty check |
| `TransferLinkSchema.auto` field | `packages/shared/src/schemas/ledger.ts:567` | Schema field (whole `TransferLinkSchema` is obsolete if no code reads it) |
| `AccountSchema.openingBalancePaise` | `packages/shared/src/schemas/ledger.ts:192` | Schema field |
| `AccountWithBalanceSchema.openingBalancePaise` (inherited) | inherited | Schema field |
| `CreateAccountSchema.openingBalancePaise` | `packages/shared/src/schemas/ledger.ts:249` | Schema field |
| `UpdateAccountSchema.openingBalancePaise` | `packages/shared/src/schemas/ledger.ts:262` | Schema field |

---

## Must rework

Live code paths that read legacy column values or write them outside post-entry and need conversion before the drop:

| File:line | What it does | Conversion needed |
|-----------|-------------|-------------------|
| `post-entry.ts:109–120` | Writes `transactions.{accountId,amountPaise,categoryId,necessity,isOpening}` | Remove those SET fields from the `db.update(transactions).set(…)` call; delete the `projectLegacyColumns()` call and import |
| `post-entry.ts:122–126` | Writes / deletes `transaction_splits` | Remove entirely; delete `transactionSplits` import |
| `post-entry.ts:3` | `import { …, transactionSplits } from "../schema.ts"` | Remove `transactionSplits` from import |
| `post-entry.ts:7` | `import { projectLegacyColumns, projectLegacySplits } from "./legacy-projection.ts"` | Remove entire import |
| `accounts.ts:201` | Reads `transactions.isOpening` as FILTER in postings aggregate | Replace `transactions.isOpening = true` filter with `EXISTS (SELECT 1 FROM postings p2 JOIN accounts a2 ON a2.id = p2.account_id WHERE p2.transaction_id = postings.transaction_id AND a2.system_kind = 'opening')` — same pattern as `sip-installments.ts:296` |
| `accounts.ts:149` | Returns `openingBalancePaise` from account row DTO | Remove field; consumers that need the opening amount already have `openingTransactionPaise` from `AccountWithBalance` |
| `accounts.ts:242–266` | `createAccount` passes `openingBalancePaise` to column; logic conditional on seedsOpeningTransaction | Remove the `openingBalancePaise: 0` column pin — the column won't exist; opening transactions are still created but the column update is dropped |
| `accounts.ts:370,453–503` | `updateAccount` reads/writes `openingBalancePaise` column | Remove column read/write; the `planOpeningBalanceChange` logic that produces `columnPaise: 0` pin can stay for the transaction side |
| `cards.ts:356` | `AND NOT t.is_opening` in raw SQL | Replace with `AND NOT EXISTS (SELECT 1 FROM postings p2 JOIN accounts a2 ON a2.id = p2.account_id WHERE p2.transaction_id = t.id AND a2.system_kind = 'opening')` |
| `transactions.ts:671` | Reads `transactions.categoryId` for bulk-action snapshot | Replace with a postings join: `SELECT DISTINCT ON (postings.transaction_id) postings.category_id FROM postings JOIN accounts ON …WHERE accounts.system_kind IS NOT NULL` to get the counter posting's category |
| `reconciliation-writes.ts:372` | Passes `isOpening: true` in transaction insert | Remove the `isOpening` field; shape is determined by postings alone after drop |
| `demo.ts:191–192,229` | Uses `isOpening: true` in transaction batch insert and posting-builder selector | Remove `isOpening` field from `txns[]`; replace `seed.isOpening` conditional with inline check of whether `merchant === "Opening balance"` or introduce a dedicated seed flag that isn't a DB column |
| `db/schema.decomposition.test.ts:65` | Expects `transactionSplits` and `transferLinks` in ledger module | Remove those two strings |
| `web/AccountDetailPage.tsx:377,384,508` | Sends/reads `openingBalancePaise` through `updateAccount` | Remove; opening balance editing must use transaction edits (same flow as `openingTransactionPaise`-based editing that already works for bank/cash accounts) |
| `web/SettingsPage.tsx:135` | Passes `openingBalancePaise` in `createAccount` call | Remove field from the call |
| `web/opening-balance.ts:51–53` | `editsOpeningBalanceAsAmount(type, openingBalancePaise)` reads column value | After removing the column, the function degrades to always `return type !== "bank" && type !== "cash"` — or is deleted |
| `web/CardDetailPage.tsx:185` | Reads `account.openingBalancePaise` for absorb-carryover dialog | Replace with `account.openingTransactionPaise` (already on the DTO) |
| `packages/shared/src/schemas/ledger.ts:192,249,262` | Exposes `openingBalancePaise` on account schemas | Remove from `AccountSchema`, `CreateAccountSchema`, `UpdateAccountSchema` |
| `packages/shared/src/schemas/ledger.ts:563–568` | `TransferLinkSchema` with `auto: z.boolean()` | Remove `auto` field; whole schema can be deleted if no route returns it (only `CreateTransferLinkSchema` is used as route input) |
| `apps/api/src/modules/ledger/routes/transfers.ts:5,24` | Imports `CreateTransferLinkSchema` as route body | The schema is still valid (outTransactionId + inTransactionId); this route itself is safe. Only the `auto` field on `TransferLinkSchema` (response side) needs removal. |

### Secondary / test-only rework

| File:line | What it does | Action |
|-----------|-------------|--------|
| `postings-periods-parity.test.ts:106,114,119,123,157,182,190,196,201` | SQL parity-formula strings reference `transaction_splits` and `is_opening` | Delete the entire "legacy formula" side of the parity tests once legacy tables are gone; or replace with a postings-only reference formula |
| `postings-pr-e-parity.test.ts:431–432` | `eq(transactions.accountId/isOpening)` in test fixture lookup | Replace with postings-based fixture lookup |
| `modules/system/services/backup.test.ts:679` | `eq(transactions.accountId, …)` and `eq(transactions.isOpening, …)` | Replace predicates with postings-join equivalent |
| `modules/ledger/services/recurring.test.ts:138,323,471` | `eq(transactions.accountId, …)` | Replace with postings-join |
| `modules/ledger/services/epf-contributions.test.ts:82` | `eq(transactions.accountId, …)` | Replace with postings-join |
