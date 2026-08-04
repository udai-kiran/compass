# Plan review: Task 1.1 — Migrate ledger module

## Verdict

Not implementation-ready.

The central schema decision is sound: keep the 11 table definitions in `db/schema.ts` for this migration and expose them through a thin `modules/ledger/schema.ts`. Physically moving the tables now would create a real bidirectional ESM dependency and is not a simpler or safer alternative.

However, the plan has several concrete completeness errors, and its proposed single-plugin registration demonstrably violates the byte-identical route-snapshot acceptance criterion. The following items block implementation:

1. Collapsing the 11 interleaved registrations into one plugin changes `Fastify#printRoutes()` output. I reproduced this in memory using the actual route functions: the proposed table is not byte-identical, with the first difference at line 63 (`/api/imports` in the current table versus `/api/merchant-rules` in the proposed table).
2. The cross-service import inventory misses `apps/api/src/services/ai/tools.ts`, which imports the moved `search` service.
3. The moved-test inventory omits `average-balance.test.ts` and `epf-contributions.test.ts`.
4. The instruction to repoint moved services’ schema imports wholesale to `modules/ledger/schema.ts` cannot work with the proposed ledger-only export surface. Several moved services also use non-ledger tables.
5. The plan does not comprehensively account for all relative imports that change depth when files move.
6. The inbound-FK inventory misses one cross-module FK: `emi_details.template_id → recurring_templates.id`.
7. The new thin-schema convention conflicts with the current documented convention in `CLAUDE.md` unless that documentation is deliberately updated.

These are plan defects rather than speculative implementation risks. They should be corrected before work starts.

## 1. Schema ownership decision

### Thin re-export is the right decision for this task

The proposed transitional arrangement is the safest option:

- Keep the 11 `pgTable()` definitions physically in `apps/api/src/db/schema.ts`.
- Make `modules/ledger/schema.ts` a narrow named re-export surface.
- Have ledger-local code import ledger-owned tables through that surface where practical.
- Leave `db/schema.ts` as the canonical whole-application schema entry consumed by Drizzle Kit and cross-module code.

This avoids schema churn in an already large relocation, introduces no new runtime cycle, and preserves all existing table identities, Drizzle relational query names, migration generation behavior, and external consumers.

It is also materially safer than moving the entire FK-connected component. The ledger tables are entangled with credit, investments, planning, protection, ingest, automation, and AI tables. Moving enough definitions to make the graph acyclic would expand task 1.1 into much of the remaining roadmap.

### Would the circular ESM version work?

Probably at Node runtime, but it should not be the chosen design.

The proposed physical move would produce this graph:

```text
db/schema.ts
  imports ledger tables for still-flat inbound FKs
       ↓
modules/ledger/schema.ts
  imports still-flat tables for ledger outbound FKs
       ↓
db/schema.ts
```

The usual temporal-dead-zone failure is avoided if an imported binding is only read later from a closure. That is how the existing Drizzle version behaves:

- `.references(ref)` stores the callback.
- Building the table constructs a `ForeignKeyBuilder` around that callback.
- The callback is invoked later when foreign-key metadata is inspected, such as when `ForeignKey#getName()` or schema generation resolves the reference.

Therefore a cycle of the following shape can complete ESM evaluation safely:

```ts
// A
export const a = pgTable("a", {
  bId: uuid("b_id").references(() => b.id),
});

// B
export const b = pgTable("b", {
  aId: uuid("a_id").references(() => a.id),
});
```

This is meaningfully different from reading `b.id` directly during module initialization. Node ESM live bindings plus Drizzle’s delayed callback make the runtime cycle technically plausible.

That does not make it a good module boundary:

- TypeScript inference across mutually recursive exported table declarations may require additional `AnyPgColumn` annotations and can be more fragile than same-file forward references.
- Drizzle Kit loads and introspects the full schema through a different execution path from an ordinary API import.
- Future code can accidentally introduce a non-lazy top-level read and turn the previously tolerated cycle into a TDZ failure.
- Every remaining migration would deepen or reshape the same cycle.
- It makes the dependency direction of the module schema misleading and difficult to enforce.

The same-file `accounts → goals` forward reference is not proof that the cross-file cycle is equally safe. It proves only that delayed foreign-key resolution handles declaration order within an already evaluated module.

So: the circular design likely works with the current Drizzle implementation, but relying on it is unnecessary risk. The plan is right to reject it.

### Clarifications the thin-schema plan needs

The plan should state whether `modules/ledger/schema.ts` exports only tables or also ledger-owned enums. The current definitions include at least:

- `accountType`
- `categoryKind`
- `expenseNecessity`
- `transactionSource`
- `resourceKind`
- `recurringFrequency`
- `recurringKind`

“Plus any enums they use” is too vague for a template-setting task. Define the intended public surface explicitly.

Add an identity smoke test analogous to the planning-module test. It should assert that representative or all exported ledger tables are the exact same objects through both import paths:

```ts
import { accounts as barrelAccounts } from "../db/schema.ts";
import { accounts as moduleAccounts } from "../modules/ledger/schema.ts";

assert.strictEqual(moduleAccounts, barrelAccounts);
```

That verifies what the thin layer promises and prevents a future accidental duplicate definition.

## 2. Inbound foreign-key inventory

The four outbound FKs identified by the investigation are accurate:

- `accounts.goal_id → goals.id`
- `transactions.policy_id → insurance_policies.id`
- `transactions.sip_id → sips.id`
- `transactions.reconciled_statement_id → statement_reconciliations.id`

All four currently use a delayed reference with an `AnyPgColumn` return annotation.

The inbound inventory is directionally correct but not complete. The actual cross-module inventory is 23 FK columns across 19 still-flat tables:

- `imports.account_id → accounts.id`
- `import_presets.account_id → accounts.id`
- `budget_lines.category_id → categories.id`
- `budget_alerts.category_id → categories.id`
- `notification_prefs.account_id → accounts.id`
- `card_details.account_id → accounts.id`
- `card_statements.account_id → accounts.id`
- `bank_details.account_id → accounts.id`
- `retirement_details.account_id → accounts.id`
- `overdraft_details.account_id → accounts.id`
- `insurance_policies.resource_id → resources.id`
- `reward_entries.account_id → accounts.id`
- `statement_reconciliations.account_id → accounts.id`
- `emi_details.template_id → recurring_templates.id`
- `emi_details.loan_account_id → accounts.id`
- `account_nps_details.account_id → accounts.id`
- `sips.source_account_id → accounts.id`
- `sips.target_account_id → accounts.id`
- `extracted_transactions.suggested_account_id → accounts.id`
- `extracted_transactions.suggested_category_id → categories.id`
- `extracted_transactions.transaction_id → transactions.id`
- `extracted_transactions.matched_transaction_id → transactions.id`
- `ai_events.account_id → accounts.id`

The investigation omits `emi_details.template_id → recurring_templates.id` from its narrative inventory. It mentions only the EMI-to-account relationship. This omission does not invalidate the thin-schema conclusion, but it should be corrected because the inventory is intended to justify that conclusion and serve as a template for later migrations.

The plan should use precise counts rather than “~20”: 19 referencing tables, 23 FK columns.

## 3. Cross-service import inventory

The production inventory is almost complete, but it misses:

```text
apps/api/src/services/ai/tools.ts
  imports search from ../search.ts
```

After moving `services/search.ts`, that becomes another cross-module import requiring an update.

The plan’s AC7 grep is not sufficient as written if it only searches paths containing a slash before the service basename. Existing sibling imports such as `../search.ts` or `./accounts.ts` can have different shapes depending on directory depth. Verification should search by every moved basename and inspect import declarations, or use TypeScript/module-resolution tooling rather than a narrow old-path literal.

The investigation correctly found the other important cross-module service edges, including:

- account consumers in bank details and goal services;
- category seeding from auth, demo, seed, and bootstrap;
- transaction creation/listing from inbox, dashboard, and insurance;
- transfer and merchant helpers from inbox and imports;
- attachment helpers/constants from cards, insurance, and card statements;
- recurrence helpers from bills, cashflow, EMIs, and jobs;
- resource ownership from insurance.

### Moved services also import still-flat services

The plan focuses on files importing from ledger, but moving the ledger files changes their imports in the other direction too. Examples include:

- `accounts.ts → ./ownership.ts`
- `transactions.ts → ./ownership.ts`
- `transactions.ts → ./sips.ts`
- `recurring.ts → ./emis.ts`
- `recurring.ts → ./ownership.ts`

Those files remain in the flat `services/` directory. Their paths must change after the ledger files move two levels deeper.

Likewise, every moved service’s imports from `db/index.ts`, `lib/errors.ts`, `lib/storage.ts`, and other flat locations require depth adjustment. Route imports such as `routes/attachments.ts → ../lib/errors.ts` do as well.

P3/P4 should explicitly say:

> Update every relative import in each moved file according to its new location, classifying imports as ledger-local, still-flat API code, shared package code, or ledger schema imports.

A broad statement is needed because limiting the work to schema imports and named intra-ledger imports will leave immediate resolution failures.

## 4. The proposed schema repoint cannot be applied wholesale

P3 says to repoint moved services’ schema imports to local `../schema.ts`. That is not valid for several files:

- `accounts.ts` imports ledger tables `accounts` and `transactions`, but also still-flat `bankDetails`, `retirementDetails`, and `sips`.
- `recurring.ts` imports ledger tables `recurringTemplates` and `transactions`, but also still-flat `emiDetails`.

The plan must choose one of these explicit policies:

1. Split imports:

   ```ts
   import { accounts, transactions } from "../schema.ts";
   import { bankDetails, retirementDetails, sips } from "../../../db/schema.ts";
   ```

2. Continue importing all tables in such mixed files from `db/schema.ts`.

Do not re-export `bankDetails`, `retirementDetails`, `sips`, or `emiDetails` through the ledger schema merely to avoid split imports. That would make `modules/ledger/schema.ts` a convenience barrel for tables the ledger does not own, undermining the boundary the migration is intended to establish.

I recommend split imports. They make both ownership and remaining cross-module coupling explicit.

## 5. Tests omitted from the move

The plan says each moved file’s colocated tests move with it, but its explicit Scope, AC4, and T7 lists omit two tests belonging to the 13 moved services:

- `apps/api/src/services/average-balance.test.ts`
- `apps/api/src/services/epf-contributions.test.ts`

`epf-contributions.test.ts` is especially significant because it imports multiple moved ledger services and several ledger tables. It should move with `epf-contributions.ts`, not remain flat as a cross-module test.

The correct moved-test list is at least:

- `accounts.test.ts`
- `attachments.test.ts`
- `average-balance.test.ts`
- `epf-contributions.test.ts`
- `recurring.test.ts`
- `transaction-links.test.ts`
- `transactions.test.ts`
- `transfers.test.ts`
- `user-tasks.test.ts`
- `user-tasks.route.test.ts`
- `ledger-events.route.test.ts`

The package test glob is recursive (`src/**/*.test.ts`), so tests under `modules/ledger/` will continue to be discovered. Still, AC4 and T7 should name all 11 moved test files.

Cross-module tests that stay flat and require import updates include the investigation’s list, notably `periods.test.ts`, `cards.test.ts`, `inbox.test.ts`, and `imports.test.ts`.

## 6. Single-plugin registration breaks the route snapshot

This is the largest immediate blocker.

The current ledger registrations are not contiguous. They are interleaved with routes from other future modules:

```text
accounts
categories
transactions
transfers
attachments
transaction-links
imports
rules
budgets
dashboard
notifications
recurring
...
search
...
resources
user-tasks
```

The plan proposes registering a ledger plugin once at the position of `accountRoutes`, with that plugin registering all 11 ledger route plugins internally. Fastify’s printed route tree is not globally sorted independent of plugin registration structure. Plugin encapsulation and registration order affect the tree traversal.

I constructed both route registries in memory from the actual functions:

- Current: the 39 registrations in their existing order.
- Proposed: one child plugin at the first ledger position, internally registering all 11 ledger route groups, with the remaining routes registered as today.

The resulting strings were unequal. The first difference was:

```text
Current line 63:  ├── /api/imports (POST, GET, HEAD)
Proposed line 63: ├── /api/merchant-rules (GET, HEAD)
```

Therefore P5 and AC1 contradict each other. P8 will fail even if every route and HTTP method is preserved.

The plan must decide which invariant is authoritative:

- If the snapshot must remain byte-identical, a single encapsulated ledger plugin cannot simply replace all 11 interleaved registrations.
- If one plugin registration is mandatory, the snapshot comparison must become order-insensitive or the committed snapshot must change. Both contradict the current roadmap acceptance criterion and task 0.3’s stated byte-identical gate.

Potential resolutions include:

- Change the route identity gate to compare a canonicalized path/method representation rather than raw `printRoutes()` traversal order. This is architecturally more appropriate for migration identity, but it changes task 0.3’s established contract and should be a separately reviewed prerequisite.
- Explicitly approve and recapture an ordering-only snapshot change. This weakens the current “unchanged” acceptance criterion and needs roadmap agreement.
- Temporarily keep the individual registrations, which preserves the snapshot but fails the “single plugin” objective.
- Redesign registration so the module owns route exports but `app.ts` retains interleaving. That is not a single plugin registration either.

The current plan cannot satisfy both requirements simultaneously. This must be resolved before implementation.

Also correct the assertion that `printRoutes({ commonPrefix: false })` is “content-addressed by path/method” and insensitive to registration order. The actual Fastify behavior refutes it.

## 7. Direct Drizzle usage outside the moved services

There is substantial direct access to ledger tables outside the 13 moved service files. This does not require changes under the thin-schema design, but the plan should document it more honestly than the single `card-due-tasks.ts` example.

Representative production consumers include:

- `services/sips.ts`: reads and writes `accounts` and `transactions`.
- `services/cards.ts`: reads and writes `accounts` and `transactions`.
- `services/emis.ts`: reads and writes `accounts`, `recurringTemplates`, and `transactions`.
- `services/demo.ts`: inserts/updates `accounts`, `categories`, `transactions`, and `recurringTemplates`.
- `services/imports.ts` and `services/inbox.ts`: use ledger tables directly in addition to calling ledger services.
- `services/goals.ts`, `cashflow.ts`, `bills.ts`, `anomaly.ts`, `reports.ts`, `ownership.ts`, and `account-nps.ts`: query ledger-owned tables directly.
- `services/card-due-tasks.ts`: inserts `userTasks` directly.
- `routes/rules.ts`: performs direct Drizzle queries against `merchantRules`.
- `services/search.ts`, `average-balance.ts`, `periods.ts`, and `networth.ts`: issue raw SQL against ledger table names.

These are not missed relocation edits because `db/schema.ts` and physical table names remain stable. They are, however, evidence that this task creates a directory boundary rather than actual domain encapsulation. The plan should say that explicitly.

No unexpected Drizzle consumption was found in `apps/web` or `packages/shared`. Shared contains ledger-facing schemas and types, not database-table imports. Those contracts should remain unchanged.

The raw SQL consumers are another reason not to treat `db:generate` as the sole compatibility proof. It will not detect an accidental change to a raw query’s expected export/import path, although typecheck and tests may.

## 8. `imports.ts` ownership

The exclusion of `services/imports.ts` and `routes/imports.ts` is correct.

Task 1.1’s route and table lists do not include the import domain, while task 1.7 explicitly owns:

- `imports`
- `import_rows`
- `import_presets`
- `mailbox_accounts`
- `mailbox_credentials`
- `email_ingestions`
- `extracted_transactions`

It also explicitly owns the `imports`, `inbox`, and `mailboxes` routes.

Removing the misleading “imports.ts (878)” wording from `tasks/01.01-migrate-ledger.md` is appropriate. `services/imports.ts` still needs import-path edits because it consumes moved ledger helpers, but it should not itself move.

## 9. Convention and architecture concerns

### `CLAUDE.md` needs an intentional update

The repository documentation currently says:

- `modules/<domain>/schema.ts` contains “Drizzle tables”.
- `db/schema.ts` re-exports each module’s schema.
- The planning module physically owns `projectionSettings`.

The proposed ledger schema is instead an inward-facing re-export from `db/schema.ts`. That is a deliberate and defensible transitional exception, but it directly changes the documented convention.

The task should update `CLAUDE.md` to distinguish:

- physically decomposed schema slices such as planning’s existing table;
- transitional ownership surfaces whose definitions remain in the central schema until a later graph-decomposition task.

Without this, future contributors will receive contradictory guidance from the code, task plan, and repository instructions.

The plan should also clarify that `db/schema.ts` must not `export *` from the thin ledger schema. The ledger schema already re-exports from `db/schema.ts`; adding the reverse barrel export would create a pointless cycle.

### Route-layer database access

`routes/rules.ts` directly queries `merchantRules`, contrary to the documented `routes → services → db` layering rule. This is pre-existing behavior, and a pure relocation should not silently refactor it. Still, calling the migration a template while reproducing that violation deserves an explicit exception or follow-up.

A clean option is to record it as technical debt and leave behavior unchanged in 1.1. Do not mix the service extraction into this already large move unless the task’s “move, not rewrite” rule is relaxed.

### “Schema ownership” wording

A thin re-export does not make the module the physical owner of the table definitions. It creates a module-facing access surface. The plan should consistently call it that and reserve “physical ownership” for a file containing the `pgTable()` declaration.

This distinction matters for later tasks, tooling, and dependency enforcement.

## 10. Security and compatibility risks

The relocation itself should not alter user scoping, demo-mode enforcement, CSRF protection, or event emission. Fastify parent decorations and hooks are inherited by registered child plugins, so placing routes under a module plugin should retain access to `db`, `storage`, `redis`, `eventBus`, and session data.

Nevertheless, the current verification is too narrow in a few areas:

- The existing demo-mode test covers one mutating user-task route. Retain it, but also ensure the route remains under the same parent auth/security hooks after plugin encapsulation.
- Route snapshot tests only paths and methods; it does not prove hooks, schemas, body limits, storage access, or event behavior.
- Multipart attachment routes are worth a focused route/plugin smoke test because they use `app.post`, `req.file`, `app.storage`, and `HttpError` directly rather than only the typed route wrapper.
- `ledger-events.route.test.ts` should continue to verify actual emissions after the plugin move.
- Search routes depend on inherited Redis decoration; their relocation deserves at least an existing test confirmation or a small plugin-readiness smoke test if none exists.
- The plugin should be tested through its public entry point, not only through individually imported route functions. Otherwise a missing registration inside `plugin.ts` can be masked by direct route tests.

Add a `modules/ledger/plugin.test.ts` or equivalent that registers the ledger plugin on a minimally decorated Fastify instance and verifies representative routes from the beginning, middle, and end of the internal list exist. The global route snapshot may cover registration completeness once its ordering conflict is resolved, but a module-level test gives a clearer failure.

## 11. Migration-generation verification

Because no `pgTable()` call moves or changes, `db:generate` should produce no new migration. The content-hash check is appropriate.

The plan should be precise about generated artifacts:

- Capture hashes and file lists before generation.
- Run generation.
- Compare both names and contents afterward.
- Confirm no new SQL or metadata snapshot appeared.
- Do not rely solely on `git status`, especially in an already dirty worktree.

The ledger schema identity smoke test is more valuable than running typecheck immediately after creating a pure re-export, because typecheck alone does not prove the re-export points to the same table object.

## 12. Precedent for tasks 1.2–1.8

The thin-schema precedent is acceptable only if described as transitional and applied consistently.

It avoids multiplying circular ESM graphs and lets services/routes adopt stable module-local import paths before the database schema graph is decomposed. That is a reasonable two-stage migration:

```text
Phase 1:
  move behavior
  introduce module-facing schema surfaces
  keep central physical definitions

Later schema phase:
  analyze full FK graph/SCCs
  relocate physical definitions safely
  preserve module-local consumers
```

This is better than allowing every task to invent a different cycle or move arbitrary dependency clusters.

However, it creates problems if presented as completed table ownership:

- Future modules may re-export each other’s tables for convenience.
- `db/schema.ts` can remain a permanent monolith with only cosmetic module folders.
- Cross-module direct Drizzle access remains invisible unless imports are split deliberately.
- The mismatch with the physically owned planning table becomes confusing.
- A promised later physical-decomposition task can be indefinitely deferred.

Before locking this in as the template, the roadmap should explicitly establish:

1. `db/schema.ts` remains the sole Drizzle Kit entry point.
2. Thin module schemas export only tables/enums owned by that module.
3. Mixed consumers split ledger-owned and foreign-table imports rather than widening the local barrel.
4. `db/schema.ts` never re-exports a thin schema that itself imports/re-exports `db/schema.ts`.
5. Physical relocation is deferred to a named future task with an explicit FK-graph/SCC design, not vaguely “1.9 or later”.
6. Repository documentation distinguishes physical definitions from module-facing schema surfaces.
7. Each module adds table-identity smoke tests.
8. Cross-module direct table access remains allowed during migration but is inventoried for the later ports/formalization task.

With those constraints, the thin layer is a useful seam. Without them, it risks becoming architecture theater: directory-local names over a permanently flat database and service dependency graph.

## Required plan changes before implementation

1. Resolve the single-plugin versus byte-identical snapshot contradiction. The proposed plugin structure has been shown to change the actual snapshot.
2. Add `services/ai/tools.ts` to the cross-service import update inventory.
3. Add `average-balance.test.ts` and `epf-contributions.test.ts` to Scope, AC4, T7, and the moved-file count.
4. Correct the inbound inventory to include `emi_details.template_id → recurring_templates.id` and use the exact count of 23 FK columns across 19 tables.
5. Replace the wholesale “repoint schema imports” instruction with an explicit split-import policy for mixed ledger/non-ledger table consumers.
6. Require adjustment of every relative import in every moved file, including imports of `db/index.ts`, `lib/*`, and still-flat services.
7. Explicitly define the table and enum exports of `modules/ledger/schema.ts`.
8. Add table-object identity tests for the thin schema surface.
9. Update `CLAUDE.md` to document the transitional thin-schema exception.
10. Add a ledger-plugin-level registration/readiness test, including representative decorated dependencies or routes.
11. Clarify that the many direct ledger-table and raw-SQL consumers outside the module remain intentionally unchanged and are deferred to the later boundary/ports task.
12. Name the future task responsible for physical schema decomposition and FK-graph design.

Once these changes are incorporated—especially the route-snapshot conflict—the plan will be ready for implementation.