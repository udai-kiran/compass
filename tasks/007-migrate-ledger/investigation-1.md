# Investigation 1 — task 1.1 "Migrate ledger module" (`tasks/01.01-migrate-ledger.md`)

Read-only investigation. No files changed. All paths absolute-relative to repo root `/home/udai/PennyPilot`.

## 1. Route files: line count + `app.ts` registration variable

`wc -l` on each named route file:

```
   57 apps/api/src/routes/accounts.ts
   63 apps/api/src/routes/categories.ts
  104 apps/api/src/routes/transactions.ts
   62 apps/api/src/routes/transfers.ts
   28 apps/api/src/routes/transaction-links.ts
   60 apps/api/src/routes/attachments.ts
   77 apps/api/src/routes/recurring.ts
   48 apps/api/src/routes/rules.ts
   54 apps/api/src/routes/resources.ts
   38 apps/api/src/routes/search.ts
   57 apps/api/src/routes/user-tasks.ts
  648 total
```

`grep` of `apps/api/src/app.ts` for the import + registration:

```
21:import { accountRoutes } from "./routes/accounts.ts";
22:import { categoryRoutes } from "./routes/categories.ts";
23:import { transactionRoutes } from "./routes/transactions.ts";
24:import { transferRoutes } from "./routes/transfers.ts";
25:import { attachmentRoutes } from "./routes/attachments.ts";
26:import { transactionLinkRoutes } from "./routes/transaction-links.ts";
28:import { ruleRoutes } from "./routes/rules.ts";
32:import { recurringRoutes } from "./routes/recurring.ts";
48:import { searchRoutes } from "./routes/search.ts";
56:import { resourceRoutes } from "./routes/resources.ts";
57:import { userTaskRoutes } from "./routes/user-tasks.ts";
```

`registerRoutes()` call sites (order preserved, `app.ts:99-138`):

```
102:  await app.register(accountRoutes);
103:  await app.register(categoryRoutes);
104:  await app.register(transactionRoutes);
105:  await app.register(transferRoutes);
106:  await app.register(attachmentRoutes);
107:  await app.register(transactionLinkRoutes);
109:  await app.register(ruleRoutes);
113:  await app.register(recurringRoutes);
129:  await app.register(searchRoutes);
137:  await app.register(resourceRoutes);
138:  await app.register(userTaskRoutes);
```

Note: the 11 route-group registrations are **not contiguous** in `registerRoutes()` — `importRoutes` (line 108), `budgetRoutes`, `dashboardRoutes`, `notificationRoutes` (lines 109-112, `ruleRoutes` at 109 comes right after `importRoutes` at 108), and later `goalRoutes`...`backupRoutes`...`mailboxRoutes` are interleaved between them. Any prefixed-plugin conversion will change registration *order* only if it collapses these into one block; the AC only requires the printed route table (paths/methods), which is order-insensitive for `printRoutes({ commonPrefix: false })`'s per-path content, not the registration call order itself. Flagging as a fact, not a verdict.

## 2. Service files: line counts + sibling files found via route-file import grep

Primary service files named in the brief:

```
   507 apps/api/src/services/accounts.ts
   216 apps/api/src/services/categories.ts
   441 apps/api/src/services/transactions.ts
   195 apps/api/src/services/transfers.ts
    76 apps/api/src/services/transaction-links.ts
   124 apps/api/src/services/attachments.ts
   350 apps/api/src/services/recurring.ts
    73 apps/api/src/services/merchants.ts   (this is the "rules" service — see below)
    76 apps/api/src/services/resources.ts
    34 apps/api/src/services/search.ts
   182 apps/api/src/services/user-tasks.ts
  2274 total (11 files)
```

`routes/rules.ts` does not import a `services/rules.ts` — it imports `renameMerchant` from `../services/merchants.ts` (confirmed: `apps/api/src/routes/rules.ts:8: import { renameMerchant } from "../services/merchants.ts";`) and also directly imports `merchantRules` from `../db/schema.ts` and does its own `and`/`eq` Drizzle queries inline (`apps/api/src/routes/rules.ts:5-6`). There is no separate `services/rules.ts` file on disk.

Sibling/helper files pulled in by each route file's own import block (full import blocks read directly):

- `routes/accounts.ts` also imports `accountAverageBalances` from `../services/average-balance.ts` (261 lines) — a service file not in the brief's list, used only for the `GET /api/accounts/average-balance` endpoint.
- `routes/transactions.ts` also imports `recordEpfContribution` from `../services/epf-contributions.ts` (65 lines) — used for `POST /api/epf-contributions` (a route registered by `transactionRoutes`, confirmed by its presence in the snapshot at line 57 `/api/epf-contributions (POST)`, immediately after the `/api/transactions` block). `epf-contributions.ts` in turn imports `listAccounts` (services/accounts.ts), `findOrCreateCategory` (services/categories.ts), `createTransaction` (services/transactions.ts) — i.e. it's a thin composition service over three ledger services, but has no dedicated table of its own (see item 3/4) and is not named in the brief's Tables list.
- `routes/attachments.ts`, `routes/recurring.ts`, `routes/resources.ts`, `routes/user-tasks.ts`, `routes/transaction-links.ts`, `routes/search.ts`, `routes/categories.ts`, `routes/transfers.ts` import only from their single same-named service file (no additional siblings beyond `@compass/shared` schemas).

`wc -l` on the two extra sibling files found:
```
  261 apps/api/src/services/average-balance.ts
   65 apps/api/src/services/epf-contributions.ts
```

## 3. Is `imports.ts` (878 lines) actually in scope for this task?

`apps/api/src/services/imports.ts` is **878 lines**; `apps/api/src/routes/imports.ts` is **135 lines**. Neither is registered by any of the 11 route imports above — `app.ts:27` imports `importRoutes` from `./routes/imports.ts` separately, and it is registered at `app.ts:108` (`await app.register(importRoutes);`), between `transactionLinkRoutes` (107) and `ruleRoutes` (109) — i.e. structurally adjacent in registration order but a distinct route module.

`tasks/01.01-migrate-ledger.md`'s own "Routes:"/"Tables:" lists (line 12) do **not** include `imports`/`import_rows`/`import_presets`. But the same line's prose calls out `imports.ts` (878) as one of the "Heaviest services" for *this* task — this is an internal inconsistency in 01.01's own text.

`tasks/01.07-migrate-ingest.md:10` explicitly claims this domain instead: `"Routes: imports, inbox, mailboxes. Tables: imports, import_rows, import_presets, mailbox_accounts, mailbox_credentials, email_ingestions, extracted_transactions."` No other `tasks/01.0X-migrate-*.md` file (`01.02` credit, `01.03` investments, `01.04` protection, `01.05` planning, `01.06` automation, `01.08` system) mentions "import" in its Routes/Tables text (grepped all seven, only `01.07` matched).

**Flag:** `01.01-migrate-ledger.md`'s reference to `imports.ts` as a "heaviest service" is inconsistent with its own Routes/Tables scope — `imports.ts`/`routes/imports.ts` belong to the ingest module (task `1.7`), not ledger (`1.1`), per `01.07`'s own explicit claim.

## 4. Foreign keys for the 11 tables (from `apps/api/src/db/schema.ts`)

All FKs quoted verbatim from the table definitions:

- **accounts** (`schema.ts:154`): `userId ... .references(() => users.id)` (line 160); `goalId: uuid("goal_id").references((): AnyPgColumn => goals.id, { onDelete: "set null" })` (line 198, comment: "AnyPgColumn keeps inference stable across the accounts → goals reference (goals is declared after accounts in this file)"). → FK to `goals` is **outside** the 11-table list (a forward reference within the same file, resolved via `AnyPgColumn`).
- **categories** (`schema.ts:212`): `userId ... .references(() => users.id)` (line 218). `parentId: uuid("parent_id")` (line 233) — **no `.references()` call at all**; it's a plain column, self-referential only by convention/service logic, not an FK constraint. No cross-module FK.
- **resources** (`schema.ts:265`): `userId: uuid("user_id").notNull().references(() => users.id)` (line 269). No other FK.
- **transactions** (`schema.ts:284`): `userId ... .references(() => users.id)` (290); `accountId ... .references(() => accounts.id)` (293, in-list); `categoryId: uuid("category_id").references(() => categories.id)` (304, in-list); `policyId: uuid("policy_id").references((): AnyPgColumn => insurancePolicies.id, { onDelete: "set null" })` (334-336) → **outside** list (protection/insurance module, `01.04`); `resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "set null" })` (337, in-list); `sipId: uuid("sip_id").references((): AnyPgColumn => sips.id, { onDelete: "set null" })` (344) → **outside** list (investments module); `recurringTemplateId: uuid("recurring_template_id").references((): AnyPgColumn => recurringTemplates.id, { onDelete: "set null" })` (345-348, in-list); `reconciledStatementId: uuid("reconciled_statement_id").references((): AnyPgColumn => statementReconciliations.id, { onDelete: "set null" })` (355-358) → **outside** list (credit module, statement reconciliation).
- **user_tasks** (`schema.ts:388`): `userId ... .references(() => users.id)` (392); `transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" })` (397-399, in-list). No other FK.
- **transaction_splits** (`schema.ts:430`): `transactionId ... .references(() => transactions.id, { onDelete: "cascade" })` (434-436, in-list); `categoryId ... .references(() => categories.id)` (437-439, in-list). No `userId` column on this table at all (scoped through parent — matches item 7 below).
- **transfer_links** (`schema.ts:447`): `userId ... .references(() => users.id)` (451-453); `outTransactionId ... .unique().references(() => transactions.id, { onDelete: "cascade" })` (454-457, in-list); `inTransactionId ... .unique().references(() => transactions.id, { onDelete: "cascade" })` (458-461, in-list). No other FK.
- **merchant_rules** (`schema.ts:545`): `userId ... .references(() => users.id)` (549-551). No other FK.
- **recurring_templates** (`schema.ts:650`): `userId ... .references(() => users.id)` (654-656); `accountId ... .references(() => accounts.id)` (657-659, in-list); `categoryId: uuid("category_id").references(() => categories.id)` (660, in-list); `resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "set null" })` (673, in-list). No other FK.
- **attachments** (`schema.ts:769`): `transactionId ... .references(() => transactions.id, { onDelete: "cascade" })` (773-775, in-list). No `userId` column (scoped through parent). No other FK.
- **transaction_links** (`schema.ts:785`): `transactionId ... .references(() => transactions.id, { onDelete: "cascade" })` (789-791, in-list). No `userId` column (scoped through parent). No other FK.

**Summary of FKs to `users`:** every one of the 11 tables except `transaction_splits`, `attachments`, and `transaction_links` has a direct `user_id` FK to `users` — already handled by `db/core-schema.ts` per task 0.3.

**Summary of cross-module (outside-the-11) FK targets found:**
- `accounts.goal_id → goals.id` (goals module, task `1.5` per its own Routes/Tables list — see below)
- `transactions.policy_id → insurance_policies.id` (protection module, task `1.4`)
- `transactions.sip_id → sips.id` (investments module, task `1.3`)
- `transactions.reconciled_statement_id → statement_reconciliations.id` (credit module, task `1.2`)

All four use `(): AnyPgColumn => target.id` (or, for `goal_id`, the comment explicitly names it a forward-reference workaround) — i.e. all four are already written defensively against declaration order, which is the same technique task 0.3 used for `accounts → goals`.

**`goals` module claim check:** `tasks/01.05-migrate-planning.md:10`: `"Routes: budgets, goals, cashflow, bills, projection-settings, dashboard, insights, reports. Tables: budgets, budget_lines, budget_alerts, goals, subscription_dismissals, projection_settings."` — confirms `goals` is explicitly claimed by the planning module (`1.5`), not ledger.

## 5. Cross-module service imports (files importing FROM the 11 ledger service files)

Grepped every `apps/api/src/services/*.ts` (and, where relevant, `routes/*.ts`, `jobs/*.ts`) for imports of each of `accounts.ts`, `categories.ts`, `transactions.ts`, `transfers.ts`, `transaction-links.ts`, `attachments.ts`, `recurring.ts`, `merchants.ts`, `resources.ts`, `search.ts`, `user-tasks.ts`. Test files excluded from the table below but listed separately where found (they still need import-path updates on a move).

| Importing file (non-ledger) | Imported symbol(s) | From ledger service |
|---|---|---|
| `services/bank-details.ts:7` | `syncAccountLast4` | `./accounts.ts` |
| `services/goals.ts:14` | `listAccounts` | `./accounts.ts` |
| `services/goal-networth.ts:6` | `listAccounts` | `./accounts.ts` |
| `services/auth.ts:8` | `seedDefaultCategories` | `./categories.ts` |
| `services/demo.ts:27` | `seedDefaultCategories` | `./categories.ts` |
| `db/seed.ts:4` | `seedDefaultCategories` | `../services/categories.ts` |
| `db/bootstrap.ts:16` | `seedDefaultCategories` | `../services/categories.ts` |
| `services/inbox.ts:21` | `createTransaction` | `./transactions.ts` |
| `services/dashboard.ts:15` | `listTransactions` | `./transactions.ts` |
| `services/insurance.ts:20` | `createTransaction` | `./transactions.ts` |
| `services/imports.ts:27` | `autoLinkTransfers` | `./transfers.ts` |
| `services/inbox.ts:22` | `autoLinkTransfers, linkTransfer, TRANSFER_WINDOW_DAYS` | `./transfers.ts` |
| `services/insurance.ts:19` | `assertUploadable` | `./attachments.ts` |
| `services/card-statements.ts:7` | `assertUploadable` | `./attachments.ts` |
| `routes/cards.ts:36` | `MAX_ATTACHMENT_BYTES` | `../services/attachments.ts` |
| `routes/insurance.ts:12` | `MAX_ATTACHMENT_BYTES` | `../services/attachments.ts` |
| `services/cashflow.ts:11` | `advanceDate` | `./recurring.ts` |
| `services/bills.ts:8` | `advanceDate` | `./recurring.ts` |
| `jobs/index.ts:18` | `materializeDue` | `../services/recurring.ts` |
| `routes/emis.ts:6` | `materializeDue` | `../services/recurring.ts` |
| `services/imports.ts:25` | `getMerchantRules, normalizeMerchant` | `./merchants.ts` |
| `services/inbox.ts:19` | `getMerchantRules, normalizeMerchant` | `./merchants.ts` |
| `services/insurance.ts:21` | `assertOwnedResource` | `./resources.ts` |

Intra-ledger cross-imports (both sides are among the 11 — not cross-module, listed for completeness): `services/transfers.ts:6` imports `createTransaction` from `./transactions.ts`; `services/transactions.ts:15` imports `getMerchantRules, normalizeMerchant` from `./merchants.ts`; `services/transactions.ts:17` imports `assertOwnedResource` from `./resources.ts`; `services/recurring.ts:13` imports `assertOwnedResource` from `./resources.ts`.

Non-service, non-route cross-references worth flagging separately:
- **`services/card-due-tasks.ts`** (belongs to the credit module per `tasks/01.02-migrate-credit.md:10`, which explicitly lists only `cards`/`emis`/`overdraft-details`/`bank-details` routes and `card_details`/`card_issuer_settings`/`card_statements`/`reward_entries`/`statement_reconciliations`/`emi_details`/`bank_details`/`overdraft_details` tables — no `user_tasks`) directly imports the **table**, not the service: `apps/api/src/services/card-due-tasks.ts:4: import { alertLedger, cardDetails, userTasks, users } from "../db/schema.ts";` and inserts directly at line 104 (`await tx.insert(userTasks).values({...})`), bypassing `services/user-tasks.ts` entirely. This is a cross-module **table-level** write, not a service-level import, and needs its own explicit treatment (task 1.9's port-formalization, or an earlier decision) since it writes to a ledger-owned table from what will become the credit module.
- **`services/periods.test.ts`** (colocated with `services/periods.ts`, a budgets/planning-domain helper — not itself one of the 11) imports and directly tests `advanceDate` from the ledger's `recurring.ts`: `apps/api/src/services/periods.test.ts:4: import { advanceDate } from "./recurring.ts";`, exercised at `periods.test.ts:24-31` ("advanceDate steps and clamps day-of-month"). Moving `recurring.ts` under `modules/ledger/` breaks this import path even though `periods.ts`/`periods.test.ts` themselves are not part of this task's scope.
- **Test-only cross-imports** (excluded from the table above, listed for completeness since they still need path fixes on a move): `services/cards.test.ts:16` (`listAccounts` from `./accounts.ts`), `services/epf-contributions.test.ts:12,14` (`listAccounts` from `./accounts.ts`, `getTransaction` from `./transactions.ts`), `services/inbox.test.ts:20,21` (`createTransaction` from `./transactions.ts`; `linkTransfer, TRANSFER_WINDOW_DAYS` from `./transfers.ts`), `routes/ledger-events.route.test.ts:13` (`transactionRoutes` from `./transactions.ts`), `routes/user-tasks.route.test.ts:17` (`softDeleteTransaction` from `../services/transactions.ts`), `services/user-tasks.test.ts:10` (`softDeleteTransaction` from `./transactions.ts`), `services/imports.test.ts:4` (`heuristicNormalize, normalizeMerchant` from `./merchants.ts`).

## 6. `ledger.mutated` event emission — which of the 11 route groups already emit it

Definition site: `apps/api/src/lib/event-bus.ts:11` (`"ledger.mutated": { userId: string }`). Subscriber: `apps/api/src/app.ts:84-89` (`registerLedgerCacheSubscriber`, calls `invalidateUserCache` + `enqueueBudgetEvaluation`).

Grep of all 11 route files for `ledger.mutated`:

```
apps/api/src/routes/transfers.ts:31:      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
apps/api/src/routes/transfers.ts:43:      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
apps/api/src/routes/transfers.ts:58:      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
apps/api/src/routes/transactions.ts:49:      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
apps/api/src/routes/transactions.ts:70:      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
apps/api/src/routes/transactions.ts:80:      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
apps/api/src/routes/transactions.ts:90:      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
apps/api/src/routes/transactions.ts:100:      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
apps/api/src/routes/recurring.ts:27:        app.eventBus.emit("ledger.mutated", { userId: uid });
apps/api/src/routes/recurring.ts:30:      app.eventBus.emit("ledger.mutated", { userId });
apps/api/src/routes/recurring.ts:73:      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
```

**Emit:** `transactions.ts` (5 call sites), `transfers.ts` (3 call sites), `recurring.ts` (3 call sites).
**Do NOT emit** (no match in that file): `accounts.ts`, `categories.ts`, `transaction-links.ts`, `attachments.ts`, `rules.ts`, `resources.ts`, `search.ts`, `user-tasks.ts`.

Non-ledger route files that also emit `ledger.mutated` (for completeness, since these are the same event name/subscriber and any refactor of the subscriber-registration point must keep working for them too): `apps/api/src/routes/inbox.ts` (lines 64, 80, 95), `apps/api/src/routes/imports.ts` (lines 112, 122), `apps/api/src/jobs/index.ts` (lines 249, 375).

## 7. `services/backup.ts` — `ALL_TABLES`/`USER_TABLES`/`LINKED_TABLES` entries for the 11 tables

Exact quoted lines (`apps/api/src/services/backup.ts`):

`ALL_TABLES` (line 28-41) includes, in this relative order: `"users", "accounts", "categories", "resources", "transactions", "user_tasks", "transaction_splits", "transfer_links", "attachments", "transaction_links", "imports", ... "merchant_rules", ... "recurring_templates", "goals", ...` — all 11 tables present.

`USER_TABLES` (lines 44-59) — exact substring: `accounts: "user_id", categories: "user_id", resources: "user_id", transactions: "user_id", user_tasks: "user_id", transfer_links: "user_id",` (line 45) and `... merchant_rules: "user_id",` (line 46) and `... recurring_templates: "user_id",` (line 47). So `accounts`, `categories`, `resources`, `transactions`, `user_tasks`, `transfer_links`, `merchant_rules`, `recurring_templates` are all `USER_TABLES` (7 of the 11, direct `user_id` scoping).

`LINKED_TABLES` (lines 66-74) — exact substring: `transaction_splits: { fk: "transaction_id", parent: "transactions" },` and `attachments: { fk: "transaction_id", parent: "transactions" },` and `transaction_links: { fk: "transaction_id", parent: "transactions" },` (lines 67-69). So `transaction_splits`, `attachments`, `transaction_links` are the 3 `LINKED_TABLES` among the 11 — matches item 4's finding that these three tables carry no `user_id` column of their own.

All 11 tables: 7 in `USER_TABLES` + 3 in `LINKED_TABLES` + (implicitly none uncovered) = 10 accounted for directly, plus `accounts`/`categories`/etc. already counted — total 11 confirmed covered (8 `USER_TABLES` names listed above is actually 8: accounts, categories, resources, transactions, user_tasks, transfer_links, merchant_rules, recurring_templates = 8, not 7 — corrected count: 8 `USER_TABLES` + 3 `LINKED_TABLES` = 11). No change needed here for a pure file move (table names/columns don't change).

## 8. Route-table snapshot — endpoint counts for the 11 route groups

`apps/api/src/route-table.snapshot.txt` is 156 lines total (plus trailing blank = `wc -l` reports 156). Grep hits for the relevant path prefixes:

```
--- accounts ---
12:├── /api/accounts (GET, HEAD, POST)
--- categories ---
26:├── /api/categories (GET, HEAD, POST)
--- transactions ---
45:├── /api/transactions (GET, HEAD, POST)
--- transfers ---
52:├── /api/transfers (POST)
--- transaction-links ---
50:│       └── /links (GET, HEAD, POST)
51:├── /api/transaction-links/:id (DELETE)
--- attachments ---
18:├── /api/attachments/:id (GET, HEAD, DELETE)
49:│       ├── /attachments (GET, HEAD, POST)
--- recurring ---
115:├── /api/recurring (GET, HEAD, POST)
--- rules ---
88:├── /api/merchant-rules (GET, HEAD)
90:├── /api/merchants/rename (POST)
--- resources ---
120:├── /api/resources (GET, HEAD, POST)
--- search ---
135:├── /api/search (GET, HEAD)
--- user-tasks ---
155:└── /api/user-tasks (GET, HEAD, POST)
```

**Caveat:** `printRoutes()`'s tree nests by URL path segment, not by route-module ownership, so a raw path-prefix grep over-attributes some lines — e.g. `/api/accounts/:id/nps-details`, `/bank-details`, `/overdraft-details` (snapshot lines 15-17) are nested visually under `/api/accounts` but are registered by `accountNpsRoutes`/`bankDetailsRoutes`/`overdraftDetailsRoutes` (separate route files, separate Phase-1 modules), not `accountRoutes`. To get an accurate per-module count I instead counted actual endpoint-definition call sites (`r.get(`/`r.post(`/`r.patch(`/`r.put(`/`r.delete(`, plus the two `app.get`/`app.post` multipart calls in `attachments.ts`) directly in each of the 11 route files:

```
accounts.ts: 5   (GET /api/accounts, GET /average-balance, POST /api/accounts, PATCH /:id, DELETE /:id)
categories.ts: 5 (GET /api/categories, GET /tree, POST /api/categories, PATCH /:id, POST /:id/merge)
transactions.ts: 8 (GET list, GET :id, POST create, POST bulk, PATCH :id, DELETE :id, PUT :id/splits, POST epf-contributions)
transfers.ts: 4  (GET suggestions, POST create, POST record, DELETE :id)
transaction-links.ts: 3 (GET links, POST links, DELETE :id)
attachments.ts: 4 (GET tx/:id/attachments, POST tx/:id/attachments, GET /api/attachments/:id, DELETE /api/attachments/:id)
recurring.ts: 4  (GET list, POST create, PATCH :id, DELETE :id)
rules.ts: 3      (GET merchant-rules, DELETE :id, POST merchants/rename)
resources.ts: 4  (GET list, POST create, PATCH :id, DELETE :id)
search.ts: 2     (GET search, GET recent)
user-tasks.ts: 5 (GET list, GET :id, POST create, PATCH :id, DELETE :id)
Total: 47 distinct endpoint definitions across the 11 route files.
```

## 9. Colocated `*.test.ts` files for the 11 service/route files

Found (`ls`/`find` over `apps/api/src/services/*.test.ts` and `apps/api/src/routes/*.test.ts`):

```
apps/api/src/services/accounts.test.ts
apps/api/src/services/attachments.test.ts
apps/api/src/services/recurring.test.ts
apps/api/src/services/transaction-links.test.ts
apps/api/src/services/transactions.test.ts
apps/api/src/services/transfers.test.ts
apps/api/src/services/user-tasks.test.ts
apps/api/src/routes/user-tasks.route.test.ts
apps/api/src/routes/ledger-events.route.test.ts   (route-injection test for transactionRoutes' ledger.mutated emission, not named after the route file itself)
```

**No colocated test file exists** for: `services/categories.ts` (no `categories.test.ts`), `services/resources.ts` (no `resources.test.ts`), `services/search.ts` (no `search.test.ts`), `services/merchants.ts` (no `merchants.test.ts` — confirmed by `find . -iname "*merchant*test*"` returning nothing), and none of `routes/accounts.ts`, `categories.ts`, `transfers.ts`, `transaction-links.ts`, `attachments.ts`, `recurring.ts`, `rules.ts`, `resources.ts`, `search.ts` have their own dedicated route-injection test file (only `user-tasks.route.test.ts` and the cross-cutting `ledger-events.route.test.ts` exist at the route layer).

`apps/api/src/routes/user-tasks.route.test.ts` contains the existing demo-mode 403 characterization relevant to AC5 ("Demo-mode 403 on a mutating ledger route still enforced"): `apps/api/src/routes/user-tasks.route.test.ts:288-289`: `test("AC12: a demo session's mutating request is rejected 403, and no database row is created or changed", ...)`, issuing `POST /api/user-tasks` with a demo session and asserting rejection + no DB row created.

Sibling-service test file also relevant but **not colocated with any of the 11** (belongs to a different service domain, tests a ledger function anyway — see item 5): `apps/api/src/services/periods.test.ts` (tests `advanceDate` imported from `services/recurring.ts`).

`services/card-due-tasks.test.ts` (45KB, largest test file found in the directory listing) is colocated with `services/card-due-tasks.ts`, which is credit-module-scoped (item 5) but writes directly to the ledger's `user_tasks` table — this test's fixtures/assertions likely depend on `user_tasks` row shape and would be worth checking for breakage risk during the ledger move, even though the file itself is out of this task's scope.
