# Task 1.7 — Migrate ingest module: investigation

Investigation date: 2026-08-05. All file:line citations are to the repo as it stands on `main` post-1.6.

---

## 1. Routes to move

### `apps/api/src/routes/imports.ts` — 135 lines

Exported registration function: `importRoutes`.

| Method | URL |
|--------|-----|
| GET | /api/imports/presets |
| POST | /api/imports (multipart — uses raw `app.post`, not `r.post`) |
| GET | /api/imports |
| GET | /api/imports/:id |
| GET | /api/imports/:id/rows |
| PUT | /api/imports/:id/mapping |
| PATCH | /api/imports/:id/rows/:rowId |
| POST | /api/imports/:id/commit |
| POST | /api/imports/:id/rollback |
| DELETE | /api/imports/:id |

Services imported: `../services/imports.ts` (all 10 named imports including `BANK_PRESETS`, `MAX_IMPORT_BYTES`).

No `config: { public: true }` on any route. No demo-mode block needed beyond what `plugins/auth.ts`'s `MUTATING_METHODS` already covers.

EventBus emits: `app.eventBus.emit("ledger.mutated", ...)` on POST commit (line 112) and POST rollback (line 121). The remaining 8 routes do not emit.

Special note — multipart: `POST /api/imports` uses `app.post` (line 42) not `r.post`, because `@fastify/multipart` handles the body outside Zod; the query param (`accountId`) is validated manually via `z.object(...).parse(req.query)`. This pattern must be preserved in the module route file unchanged.

---

### `apps/api/src/routes/inbox.ts` — 132 lines

Exported registration function: `inboxRoutes`.

| Method | URL |
|--------|-----|
| GET | /api/inbox |
| GET | /api/inbox/count |
| GET | /api/inbox/orphaned |
| POST | /api/inbox/:id/accept |
| POST | /api/inbox/:id/repayment |
| POST | /api/inbox/transfer |
| POST | /api/inbox/:id/reject |
| POST | /api/inbox/:id/restore |
| POST | /api/inbox/:id/unmatch |

Services imported: `../services/inbox.ts` (8 named imports: `acceptExtracted`, `acceptRepayment`, `acceptTransfer`, `countPending`, `listInbox`, `listOrphanedAccepts`, `rejectExtracted`, `restoreOrphan`, `unmatchDuplicate`).

No `config: { public: true }`. EventBus emits on 3 of the POST routes: `/:id/accept` (line 64), `/:id/repayment` (line 80), `/transfer` (line 94). The reject/restore/unmatch handlers do not emit.

---

### `apps/api/src/routes/mailboxes.ts` — 67 lines

Exported registration function: `mailboxRoutes`.

| Method | URL |
|--------|-----|
| GET | /api/mailboxes |
| GET | /api/mailboxes/credentials |
| POST | /api/mailboxes |
| DELETE | /api/mailboxes/:id |
| POST | /api/mailboxes/sync |

Services imported: `../services/mailboxes.ts` (4 named imports: `addMailboxFromBundle`, `getCredentialsStatus`, `listMailboxes`, `mailboxSecret`, `removeMailbox`), `../jobs/index.ts` (`enqueueIngestorRun`).

No `config: { public: true }`. No eventBus emits. `POST /api/mailboxes/sync` calls `enqueueIngestorRun(app, userId, windowMinutes)` (line 63); this import from `../jobs/index.ts` becomes a relative import `../../jobs/index.ts` in the module.

---

## 2. Services to move

### `apps/api/src/services/imports.ts` — 878 lines

Exported functions/values: `MAX_IMPORT_BYTES`, `BANK_PRESETS`, `suggestMapping`, `parseRow`, `dedupeHash`, `createImport`, `applyMapping`, `listImports`, `getImport`, `listImportRows`, `updateImportRow`, `commitImport`, `linkedRollbackBlockers`, `rollbackImport`, `deleteImport`.

**Tables read/written:** `imports`, `importRows`, `importPresets`, `accounts`, `categories`, `transactions`, `transferLinks`.

**Cross-module service imports:**
- `../modules/ledger/services/merchants.ts` — `getMerchantRules`, `normalizeMerchant` (lines 25-26). These remain in the ledger module; imports.ts becomes a cross-module consumer.
- `./import-reconciliation.ts` — `reconcileStatementTransactions` (line 27). This service moves with imports.ts into the ingest module.
- `../modules/ledger/services/transfers.ts` — `autoLinkTransfers` (line 28). Cross-module; stays in ledger.

**Library imports:** `../lib/csv.ts`, `../lib/errors.ts`, `../lib/hdfc-statement.ts` (pure libs, stay in place).

**Ingest-table imports from `../db/schema.ts`:** `importPresets`, `importRows`, `imports`. Also uses `accounts`, `categories`, `transactions`, `transferLinks` (cross-domain reads — still imported from `../../db/schema.ts` directly, same convention as other modules that reference cross-domain tables not in their own schema.ts).

**Colocated test:** `services/imports.test.ts` — 151 lines. Pure (no DATABASE_URL required). Tests `parseRow`, `dedupeHash`, `suggestMapping`, `linkedRollbackBlockers`, `heuristicNormalize`/`normalizeMerchant`. Also imports `heuristicNormalize` from `../modules/ledger/services/merchants.ts` (line 4). The test moves with the service.

---

### `apps/api/src/services/inbox.ts` — 804 lines

Exported functions/types: `listInbox`, `listOrphanedAccepts`, `pickTransferPairs`, `historyKey`, `pickHistoryCategories`, `countPending`, `acceptExtracted`, `claimPending` (private — not exported), `acceptTransfer`, `RepaymentCandidateSelection` (type), `selectRepaymentCandidate`, `acceptRepayment`, `restoreOrphan`, `rejectExtracted`, `unmatchDuplicate`.

Actually checking carefully: `claimPending` is not exported (no `export` keyword, line 417). Exported names: `listInbox`, `listOrphanedAccepts`, `pickTransferPairs`, `historyKey`, `pickHistoryCategories`, `countPending`, `acceptExtracted`, `acceptTransfer`, `RepaymentCandidateSelection`, `selectRepaymentCandidate`, `acceptRepayment`, `restoreOrphan`, `rejectExtracted`, `unmatchDuplicate`.

**Tables read/written:** `extractedTransactions`, `emailIngestions`, `accounts`, `categories`, `transactions`, `transferLinks`.

**Cross-module service imports (all outbound, none into ingest from other modules):**
- `../modules/ledger/services/merchants.ts` — `getMerchantRules`, `normalizeMerchant` (line 19).
- `../modules/investments/services/sip-lifecycle.ts` — `isUniqueViolation` (line 20). Cross-domain utility. After migration this becomes `../../../modules/investments/services/sip-lifecycle.ts` relative to the new path.
- `../modules/ledger/services/transactions.ts` — `createTransaction` (line 21).
- `../modules/ledger/services/transfers.ts` — `autoLinkTransfers`, `linkTransfer`, `TRANSFER_WINDOW_DAYS` (line 22).

**Ingest-table imports from `../db/schema.ts`:** `emailIngestions`, `extractedTransactions`. Also reads `accounts`, `categories`, `transactions`, `transferLinks` (cross-domain).

**Colocated test:** `services/inbox.test.ts` — 1767 lines. Mixed: top section (lines 54–148) is pure; remainder (lines 161–1767) is DB-backed (requires `DATABASE_URL`). The test imports from `services/periods.ts` (line 19: `incomeExpense`) and `modules/ledger/services/transactions.ts` and `transfers.ts`.

---

### `apps/api/src/services/mailboxes.ts` — 140 lines

Exported functions: `mailboxSecret`, `listMailboxes`, `addMailboxFromBundle`, `removeMailbox`, `getCredentialsStatus`.

**Tables read/written:** `mailboxAccounts`, `mailboxCredentials`.

**Cross-module imports:** none (only `../lib/secret-box.ts` and `@compass/shared`). No cross-service dependency.

**No colocated test file.**

---

### `apps/api/src/services/import-reconciliation.ts` — 71 lines

Exported types/functions: `StatementTransaction`, `ExistingTransaction`, `Reconciliation`, `reconcileStatementTransactions`. No DB access — pure function.

**No table imports.** No cross-module service imports.

**Colocated test:** `services/import-reconciliation.test.ts` — 87 lines. Pure (no DATABASE_URL). Moves with the service into `modules/ingest/services/`.

---

## 3. inbox.ts split (804 lines)

The file contains three natural units based on query shape and collaborators. Below are the proposed new files, exported functions per unit, and shared private helpers.

### (a) review-queue CRUD → `modules/ingest/services/review-queue.ts`

Exported:
- `listInbox` (L102–121): reads `extractedTransactions + emailIngestions`, calls private `applyHistoryCategory` and `pickTransferPairs`.
- `listOrphanedAccepts` (L133–147): reads `extractedTransactions + emailIngestions`.
- `countPending` (L285–291): scalar count from `extractedTransactions`.
- `pickTransferPairs` (L156–192): **pure, exported** — belongs here as it serves `listInbox` directly.
- `historyKey` (L195–197): **pure, exported** — used in tests.
- `pickHistoryCategories` (L205–233): **pure, exported** — used in tests.

Private to this file:
- `toDto` (L33–77): shapes a DB row into `ExtractedTransaction`. Used by all three groups via reload/dtoFromRow.
- `INBOX_COLUMNS` (L80–100): column projection constant. Used by all reads.
- `applyHistoryCategory` (L243–283): async DB read + mutation of dtos. Used only by `listInbox`.

---

### (b) extraction review state machine → `modules/ingest/services/review-actions.ts`

Exported:
- `acceptExtracted` (L354–410): claims a pending draft and creates a ledger transaction; calls `createTransaction`, `autoLinkTransfers`.
- `rejectExtracted` (L758–785): atomic guarded UPDATE to `rejected`.
- `restoreOrphan` (L721–742): atomic guarded UPDATE to `pending`.
- `unmatchDuplicate` (L792–804): resets a `duplicate` draft to `pending`.

Private to this file (or shared via a small internal utility export):
- `loadOne` (L293–300): simple SELECT for ownership check (used only by `unmatchDuplicate`).
- `reload` (L302–310): post-mutate reload from the JOIN view (used by `acceptExtracted`, `unmatchDuplicate`; also by acceptTransfer and acceptRepayment in unit c).
- `dtoFromRow` (L322–340): builds DTO from a `RETURNING` row + ingestion fetch (used by `rejectExtracted`, `restoreOrphan`).
- `claimPending` (L417–441): atomic UPDATE to `accepted` with RETURNING (used by `acceptTransfer`, `acceptRepayment` in unit c).

`reload`, `dtoFromRow`, `claimPending` are each consumed by BOTH (b) and (c). Options:
1. Export them from `review-actions.ts` and import into `transfer-classification.ts`.
2. Move them to a shared internal `_shared.ts` within the module's services/. Given the thin-module discipline, option 1 is simpler and consistent with how modules reference each other's exports.

---

### (c) transfer/repayment classification → `modules/ingest/services/transfer-classification.ts`

Exported:
- `acceptTransfer` (L450–518): two-leg transfer accept, uses `claimPending`, `createTransaction`, `linkTransfer`.
- `RepaymentCandidateSelection` (L522–525): exported type.
- `selectRepaymentCandidate` (L536–539): **pure, exported** — used in tests.
- `acceptRepayment` (L587–697): card repayment accept, uses `claimPending`, `createTransaction`, `linkTransfer`, `isUniqueViolation`.

Private (imported from review-actions.ts if split there, or moved here):
- `claimPending` (needed by both acceptTransfer and acceptRepayment).
- `reload` (used by `acceptTransfer` (line 518) and `acceptRepayment` (line 696)).

---

### inbox.test.ts split

`inbox.test.ts` (1767 lines) covers all three units. The pure section (lines 54–148) tests `pickHistoryCategories`, `historyKey`, `pickTransferPairs`, `selectRepaymentCandidate`. The DB section covers `listOrphanedAccepts`, `restoreOrphan`, `rejectExtracted` (guard atomicity including two-connection contention), `listInbox` intent round-trips, `acceptRepayment` (with extensive SQL predicate coverage), and transfer reconstruction.

Splitting the test file is not strictly required to stay functional (node --test runs each *.test.ts independently), but discipline from prior migrations says tests are colocated with their service. Proposed split:
- `services/review-queue.test.ts`: pure `pickHistoryCategories`/`historyKey`/`pickTransferPairs` tests (lines 54–127) + DB tests for `listOrphanedAccepts`, `listInbox` (intent round-trips lines 965–1023).
- `services/review-actions.test.ts`: DB tests for `restoreOrphan`, `rejectExtracted`, guard-atomicity, orphan/soft-delete, transfer reconstruction (lines 348–930), re-accept (lines 934–955).
- `services/transfer-classification.test.ts`: `selectRepaymentCandidate` pure tests (lines 129–148) + all `acceptRepayment` DB tests (lines 1057–1767).

The fixture helpers (`createUser`, `createAccount`, `createIngestion`, `createDraft`, `createCategory`, etc.) are shared across all three groups; they would need to be duplicated or extracted into a `_test-helpers.ts` within the module's services/ directory.

---

## 4. Tables owned by ingest

All seven tables are defined in `apps/api/src/db/schema.ts` (the Drizzle Kit single entry point). Physical relocation is deferred to task 1.9 — the new `modules/ingest/schema.ts` will be a thin re-export only.

| Table | pgTable() line | Owns user_id | Inbound FKs |
|-------|---------------|--------------|-------------|
| `imports` | L471 | yes (`user_id` → users) | `import_rows.import_id` (cascade) |
| `import_rows` | L493 | **no** — scoped via `import_id` → imports (cascade) | none |
| `import_presets` | L526 | yes (`user_id` → users) | none |
| `mailbox_accounts` | L1541 | yes (`user_id` → users) | `email_ingestions.mailbox_id` (set null) |
| `mailbox_credentials` | L1571 | yes (`user_id` → users) | none |
| `email_ingestions` | L1610 | yes (`user_id` → users) | `extracted_transactions.ingestion_id` (cascade), `ai_events.ingestion_id` (set null) |
| `extracted_transactions` | L1659 | yes (`user_id` → users) | none |

`import_rows` scopes to a user through its parent `imports` row — consistent with `LINKED_TABLES` in `services/backup.ts` (line 70). This is safe for the thin re-export; no change to backup.ts needed.

**Outbound FKs from ingest tables into other domains:**
- `imports.account_id` → `accounts` (ledger-owned)
- `import_presets.account_id` → `accounts`
- `import_rows.category_id` is UUID but no FK constraint (the column is nullable with no `.references()`)
- `extractedTransactions.suggestedAccountId` → `accounts` (set null)
- `extractedTransactions.suggestedCategoryId` → `categories` (set null)
- `extractedTransactions.transactionId` → `transactions` (set null)
- `extractedTransactions.matchedTransactionId` → `transactions` (set null)
- `emailIngestions.mailboxId` → `mailboxAccounts` (set null — intra-ingest)
- `aiEvents.ingestionId` → `emailIngestions` (set null — `aiEvents` is automation-owned, references ingest)

The FK from `ai_events.ingestion_id` → `email_ingestions.id` is an outbound FK from the automation module's table into ingest's. The automation module's `schema.ts` does not export `emailIngestions`; that table is read from `../../db/schema.ts` directly in `aiEvents` definition — so there is no ES-module cycle today and none will be created by the thin re-export.

**Enums owned by ingest** (all defined adjacent to their tables in `db/schema.ts`):
- `importStatus` (L469): `["staged", "committed", "rolled_back"]`
- `mailboxProvider` (L1533): `["google", "microsoft"]`
- `mailboxStatus` (L1534): `["active", "disconnected", "error"]`
- `emailClass` (L1588): `["transaction_alert", "card_statement", "bill", "otp", "promo", "other"]`
- `emailIngestStatus` (L1597): `["pending", "processing", "extracted", "deferred", "ignored", "failed"]`
- `extractedTxnStatus` (L1637): `["pending", "accepted", "rejected", "duplicate"]`
- `txnDirection` (L1645): `["debit", "credit"]`
- `extractedTxnIntent` (L1651): `["repayment", "refund", "cashback"]`

The `modules/ingest/schema.ts` thin re-export must include all 7 tables + 8 enums.

---

## 5. External consumers

### `apps/ingestor/src/db.ts` — raw SQL, no Drizzle

**Reads:** `mailbox_accounts` JOIN `mailbox_credentials` in `loadSyncableMailboxes` (columns: `id`, `user_id`, `provider`, `email_address`, `refresh_token_enc`, `folder`, `uid_validity`, `last_uid`, `client_id`, `client_secret_enc`).

**Writes/updates `email_ingestions`:** `recordIngestion` (INSERT columns: `user_id`, `mailbox_id`, `message_id`, `from_addr`, `subject`, `received_at`, `raw`, `status`; conflict key: `(user_id, message_id)`).

**Updates `mailbox_accounts`:** `saveWatermark` (sets `uid_validity`, `last_uid`, `last_synced_at`, `status`, `last_error`), `markMailboxError` (sets `status`, `last_error`).

### `apps/extractor/src/db.ts` — raw SQL, no Drizzle

**Reads `email_ingestions`:** `loadIngestion` (columns: `id`, `user_id`, `subject`, `from_addr`, `received_at`, `raw`).

**Updates `email_ingestions`:** `setStatus` (sets `status`, `error`), `saveResults` (sets `classification`, `status`, `error`).

**Inserts `extracted_transactions`:** `saveResults` (columns: `user_id`, `ingestion_id`, `amount_paise`, `direction`, `occurred_at`, `occurred_at_ts`, `counterparty`, `suggested_account_id`, `suggested_category_id`, `bank_ref`, `source_quote`, `confidence`, `dedupe_hash`, `status`, `matched_transaction_id`, `intent`; conflict key: `(user_id, dedupe_hash)`).

**Also touches non-ingest tables:** `ai_settings` (read), `accounts` (read), `categories` (read), `transactions` (read + update `reconciled_statement_id`), `reward_entries` (insert/delete), `statement_reconciliations` (upsert).

**Critical constraint:** Both ingestor and extractor use raw SQL strings with bare table/column names. The migration MUST NOT rename any table or column. The thin re-export convention preserves this — `db/schema.ts` continues to hold all `pgTable()` calls unchanged.

### BullMQ queue contracts

- `EXTRACT_QUEUE = "email.extract"` — defined in `packages/shared/src/schemas/email.ts` line 191.
- `INGESTOR_QUEUE = "ingestor.run"` — defined in `packages/shared/src/schemas/email.ts` line 194.
- **Producer** of `INGESTOR_QUEUE`: `apps/api/src/jobs/index.ts` line 37 (`app.queues.ingestor.add("run", ...)`). The ingestor Queue is created at line 234 as a producer-only Queue (no Worker on API side).
- **Consumer** of `INGESTOR_QUEUE`: `apps/ingestor/src/index.ts` line 193 (`new Worker(INGESTOR_QUEUE, ...)`).
- **Producer** of `EXTRACT_QUEUE`: `apps/ingestor/src/index.ts` line 20 + 59 (Queue + enqueue calls).
- **Consumer** of `EXTRACT_QUEUE`: `apps/extractor/src/index.ts` line 203 (`new Worker(EXTRACT_QUEUE, ...)`).
- The queue names are shared constants from `@compass/shared`. Moving `enqueueIngestorRun` (and `mailboxRoutes`) into the ingest module has no effect on queue contracts — neither queue name nor job shape changes.

---

## 6. Registration in app.ts

Current `registerRoutes` function (`apps/api/src/app.ts`, lines 126–141):

```
L127  await app.register(healthRoutes);
L128  await app.register(authRoutes);
L129  await app.register(ledgerRoutes);
L130  await app.register(importRoutes);       ← INGEST (position 4)
L131  await app.register(planningRoutes);
L132  await app.register(notificationRoutes);
L133  await app.register(investmentsRoutes);
L134  await app.register(creditRoutes);
L135  await app.register(protectionRoutes);
L136  await app.register(backupRoutes);
L137  await app.register(automationRoutes);
L138  await app.register(profileRoutes);
L139  await app.register(inboxRoutes);        ← INGEST (position 13)
L140  await app.register(mailboxRoutes);      ← INGEST (position 14)
```

`importRoutes` is at position 4 (between `ledgerRoutes` and `planningRoutes`). `inboxRoutes` and `mailboxRoutes` are at the end (positions 13–14). They are **not adjacent**.

After migration, `app.ts` will replace all three with a single `await app.register(ingestRoutes)`. Where to slot it: the most natural choice (matching prior migrations which kept the position of the first removed registration) is position 4, after `ledgerRoutes`. This collapses mailboxes/inbox from the end into an earlier position, which changes the raw `printRoutes()` tree. `route-table.snapshot.txt` must be regenerated (justify in evidence trail). `route-surface.snapshot.txt` must NOT change.

**How modules register** (reference pattern from planning): `plugin.ts` exports a single `async function <name>Routes(app: FastifyInstance): Promise<void>` that calls `await app.register(subRoute)` for each route file. `app.ts` imports this function and calls `await app.register(<name>Routes)`.

---

## 7. backup.ts

`apps/api/src/services/backup.ts`:

All 7 ingest tables are covered and in the correct lists:

**`ALL_TABLES`** (lines 28–41): contains `"imports"`, `"import_rows"`, `"import_presets"` (line 30); `"mailbox_accounts"`, `"mailbox_credentials"`, `"email_ingestions"`, `"extracted_transactions"` (line 39).

**`USER_TABLES`** (lines 44–59): contains `"imports"`, `"import_presets"` (line 46); `"mailbox_accounts"`, `"mailbox_credentials"`, `"email_ingestions"`, `"extracted_transactions"` (lines 56–57).

**`LINKED_TABLES`** (lines 66–74): contains `"import_rows": { fk: "import_id", parent: "imports" }` (line 70).

`import_rows` does not have `user_id`, so it is correctly in `LINKED_TABLES` only. Migration changes no table names, so `backup.ts` and `backup.test.ts` need no modifications.

---

## 8. Snapshot and gate tests

### Route snapshot tests — `apps/api/src/app.route-snapshot.test.ts`

Two separate gate files:

1. **`route-surface.snapshot.txt`** — canonical (method, path) pair list. Built via `onRoute` hook. Never changes across a pure registration-restructure migration. Must be identical after task 1.7.

2. **`route-table.snapshot.txt`** — raw `printRoutes()` tree. Sensitive to nesting/registration order. **Will change** because `importRoutes` moves from position 4 and `inboxRoutes`/`mailboxRoutes` move from positions 13–14, all collapsing into a single plugin at position 4. Must be regenerated after the migration and the diff justified in the evidence trail.

Current snapshot lines for ingest:
- `route-table.snapshot.txt` line 66: `├── /api/mailboxes (GET, HEAD, POST)` (registered separately, near top of flat list)
- `route-table.snapshot.txt` line 89: `├── /api/imports (POST, GET, HEAD)` (with child tree for `/presets`, `/:id`, etc.)
- `route-table.snapshot.txt` line 105: `├── /api/inbox (GET, HEAD)` (with child tree for `/count`, `/orphaned`, `/:id/*`, `/transfer`)

After migration all three trees will be under the ingest plugin's subtree, contiguous.

### Module schema smoke test — pattern from `modules/planning/schema.smoke.test.ts`

`modules/ingest/schema.smoke.test.ts` must:
- Import `* as barrel from "../../db/schema.ts"` and `* as ingestSchema from "./schema.ts"`.
- For each of the 7 tables, `assert.strictEqual(ingestSchema.X, barrel.X)` (object identity, not structural equality).
- `getTableConfig(tableObj).name` must equal the SQL table name string.
- For each of the 8 enums, same identity check.
- A `createDb(stubPool)` check that `db.query.<tableName>` exists for all tables that have `db.query` support (Drizzle relational queries). Note: `import_rows` has no relation accessor defined in `db/index.ts` unless added.

### Module plugin test — pattern from `modules/planning/plugin.test.ts`

`modules/ingest/plugin.test.ts` must:
- Register `ingestRoutes` on a minimally-decorated Fastify instance.
- Assert `app.hasRoute({ method, url })` for one representative (method, url) from each of the 3 route files (e.g., `GET /api/imports/presets`, `GET /api/inbox/count`, `GET /api/mailboxes`).

---

## Cross-cutting observations

1. **`isUniqueViolation` from `modules/investments/services/sip-lifecycle.ts`** (inbox.ts line 20) is a cross-module utility. After migration this becomes a two-level-up import (`../../../modules/investments/services/sip-lifecycle.ts`). It should either stay as a cross-module import or be factored into `lib/errors.ts`. This is the only ingest→investments dependency.

2. **`services/periods.ts`** is imported in `inbox.test.ts` (line 19: `incomeExpense`). This is a service that stays in the flat `services/` layer; the test's import path changes to `../../../services/periods.ts` after moving the test.

3. **Drizzle relational query** (`db.query.*`) is used in `imports.ts` for `accounts`, `importRows`, `imports`, `importPresets`, `categories`; in `inbox.ts` for `extractedTransactions`, `accounts`; in `mailboxes.ts` for `mailboxCredentials`. The `db/index.ts` (Drizzle instance configuration) needs these tables in its `schema` arg — which they already are, since all definitions remain in `db/schema.ts`. No change needed to `db/index.ts`.

4. **No `config: { public: true }` on any ingest route** — all routes require a session. The demo-mode choke at `plugins/auth.ts` already blocks all mutating methods for demo sessions, so no extra demo handling is needed.

5. **`mailboxRoutes` imports `enqueueIngestorRun` from `jobs/index.ts`** (not from a service). After migration this becomes `../../jobs/index.ts` relative to `modules/ingest/routes/mailboxes.ts`. This is a permissible cross-layer import (routes → jobs layer) consistent with how the existing flat route file uses it.
