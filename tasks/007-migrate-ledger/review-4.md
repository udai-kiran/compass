# Implementation Review — Task 007 Migrate Ledger

## Verdict

**Acceptance-ready. No code-level defect or approved-plan conformance gap found.**

The current implementation correctly performs the ledger relocation without changing the canonical HTTP method/path surface, schema object identity, route behavior, security-hook inheritance, or `ledger.mutated` emission scope.

## Findings

No blocking or non-blocking implementation findings.

## Acceptance Criteria

- **AC1 — Route surface:** Pass. `route-surface.snapshot.txt` contains 283 canonical method/path pairs and is compared byte-for-byte with live routes. The targeted test passes. The separately regenerated raw `route-table.snapshot.txt` also matches current `printRoutes()` output.
- **AC2 — No migration diff:** Pass by code inspection and implementation evidence. `apps/api/src/db/schema.ts` has zero git diff, and the ledger schema definitions were not physically moved or altered.
- **AC3 — Backup invariants:** Pass. `services/backup.ts` is untouched; no changes to `ALL_TABLES`, `USER_TABLES`, or `LINKED_TABLES` were found.
- **AC4 — Verification:** Typecheck and lint are clean. All targeted new gates pass. The API suite, including the 11 relocated tests and two new tests, passes. The root suite reaches an unrelated pre-existing environment failure in `apps/extractor/src/statement-duplicate.test.ts` because `DATABASE_URL` is unavailable; no ledger-related test fails.
- **AC5 — Demo-mode protection:** Pass. The relocated `user-tasks.route.test.ts` retains the AC12 demo-mode test, and it passes.
- **AC6 — Schema safety:** Pass. The schema is a one-way thin re-export, with no reverse ledger export in `db/schema.ts`; runtime identity tests pass.
- **AC7 — Relocation completeness:** Pass. All 35 old locations are deleted, imports resolve under typechecking, and the expected cross-module consumers point to the new ledger service paths.
- **AC8 — Plugin completeness:** Pass. The plugin test checks one uniquely attributable route from each of all 11 route files using `hasRoute()`, without handler execution.

## Detailed Conformance Review

### Schema boundary

`modules/ledger/schema.ts` is genuinely thin:

- It contains no physical `pgTable()` or `pgEnum()` call.
- It exports exactly the required 11 tables:
  `accounts`, `categories`, `resources`, `transactions`, `transactionSplits`, `transferLinks`, `transactionLinks`, `merchantRules`, `recurringTemplates`, `userTasks`, and `attachments`.
- It exports exactly the required seven enums:
  `accountType`, `categoryKind`, `expenseNecessity`, `transactionSource`, `resourceKind`, `recurringFrequency`, and `recurringKind`.
- `db/schema.ts` has zero diff and does not re-export `modules/ledger/schema.ts`. Its only module-schema star export remains the pre-existing planning export.
- `schema.smoke.test.ts` uses `assert.strictEqual` for all 11 tables and additionally verifies the seven enums. Both tests pass.

### Application and plugin registration

`registerRoutes()` now registers exactly one `ledgerRoutes` plugin where the former first ledger registration, `accountRoutes`, appeared: after health/auth and before imports.

`ledgerRoutes` registers all 11 route modules:

1. accounts
2. categories
3. transactions
4. transfers
5. attachments
6. transaction-links
7. rules
8. recurring
9. search
10. resources
11. user-tasks

No prefix was added.

In `buildApp()`, authentication and security are still installed before `registerRoutes(app)`. Fastify’s inherited hooks therefore continue to cover the nested ledger plugin and its routes. Multipart/compression registration also remains before application routes. I found no security-scope regression caused by the extra plugin boundary.

### Route identity gates

The canonical gate is implemented as required:

- An `onRoute` hook is installed before `registerRoutes(app)`.
- `routeOptions.method` is explicitly flattened from string-or-array form.
- Methods are normalized to uppercase.
- Duplicate `(method, url)` pairs are detected and asserted absent before serialization.
- The canonical list is sorted and rendered with exactly one trailing newline:
  `pairs.map(...).sort().join("\n") + "\n"`.
- The committed snapshot itself also ends in one newline.
- It does not parse `printRoutes()` output.

The raw tree remains an independent byte-for-byte `printRoutes({ commonPrefix: false })` gate. Both current comparisons pass.

### Plugin completeness test

`plugin.test.ts` registers `ledgerRoutes` directly on a hermetic Fastify instance and uses `app.hasRoute()` only. It does not use `app.inject()` and does not execute handlers.

Its 11 assertions match the approved list, with one route attributed to every route file:

- accounts: `GET /api/accounts/average-balance`
- categories: `GET /api/categories/tree`
- transactions: `POST /api/epf-contributions`
- transfers: `GET /api/transfers/suggestions`
- transaction-links: `DELETE /api/transaction-links/:id`
- attachments: `GET /api/attachments/:id`
- recurring: `GET /api/recurring`
- rules: `POST /api/merchants/rename`
- resources: `GET /api/resources`
- search: `GET /api/search/recent`
- user-tasks: `GET /api/user-tasks`

The test passes.

### Moved services and routes

Every moved pre-existing service, route, and colocated test was compared with its former `HEAD` content. The only changes are the relative import adjustments required by the move.

The mixed-schema cases are correct:

- `accounts.ts` imports ledger-owned `accounts` and `transactions` from `../schema.ts`, while `bankDetails`, `retirementDetails`, and `sips` remain imported from `../../../db/schema.ts`.
- `recurring.ts` imports ledger-owned `recurringTemplates` and `transactions` from `../schema.ts`, while `emiDetails` remains imported from `../../../db/schema.ts`.

The requested spot-checks are also correct:

- `transactions.ts` imports only ledger-owned schema objects from `../schema.ts`.
- `transfers.ts` imports only ledger-owned schema objects from `../schema.ts`.
- `categories.ts` imports only ledger-owned schema objects from `../schema.ts`.

No split was needed in those three files.

`routes/rules.ts` still queries `merchantRules` directly through Drizzle. It was relocated as-is, with only its schema and utility/service paths adjusted; it was not converted into a service call.

All relative imports use `.ts` extensions and tests remain colocated with their moved production files.

### Cross-module imports

The inspected cross-module changes—including the specifically requested files—are narrow path updates:

- `services/goals.ts`
- `services/inbox.ts`
- `services/imports.ts`
- `jobs/index.ts`
- `services/ai/tools.ts`
- `services/insurance.ts`
- `services/dashboard.ts`
- `db/bootstrap.ts`
- `routes/cards.ts`

The broader diff shows the same import-only treatment for the remaining cross-module consumers. Both directions are handled: flat modules import relocated ledger services, while moved ledger files still import flat services through the appropriate deeper relative paths.

### Event emission invariants

Production ledger route emission remains exactly:

- `transactions.ts`: 5 sites
- `transfers.ts`: 3 sites
- `recurring.ts`: 3 sites

No other ledger route gained an emission. Comparison with the predecessor files shows no addition or removal in these handlers. Other existing non-ledger emitters, such as imports, inbox, and jobs, remain outside this relocation and are unchanged in behavior.

### Must-not-change boundary

Confirmed untouched by git diff:

- `apps/api/src/db/schema.ts`
- `apps/api/src/services/backup.ts`
- `apps/api/src/services/card-due-tasks.ts`
- `apps/api/src/services/periods.ts`
- `.github/workflows/ci.yml`
- `CLAUDE.md`

The `CLAUDE.md` deviation is therefore accurately disclosed: the planned documentation edit was declined, and the file is genuinely untouched.

No unexpected edits were found in the protected production files. The unrelated pre-existing task-directory worktree entries are outside this implementation’s changes.

### Roadmap task edits

`tasks/01.01-migrate-ledger.md` has exactly the requested factual correction: the misleading `imports.ts` reference was removed from the heaviest-services sentence.

`tasks/01.09-cross-module-ports.md` contains the complete strengthened edit:

- `1.1` was added to `depends`.
- Physical schema decomposition ownership is explicitly assigned to task 1.9.
- FK graph and SCC analysis are required.
- Cyclic SCC disposition is required.
- Transitional thin surfaces must be converted or removed.
- Exactly one Drizzle Kit entry point must remain.
- Migration-diff and object-identity verification are required.

## Verification Performed

The following read-only verification succeeded:

- `npm run typecheck`: all workspaces typechecked without reported errors.
- `npm run lint`: passed.
- `node --test src/modules/ledger/schema.smoke.test.ts src/modules/ledger/plugin.test.ts src/app.route-snapshot.test.ts`: 10 tests passed, zero failures.
- Full API test suite: passed, including the relocated ledger tests, demo-mode AC12, route event tests, and both new tests.
- Root test command: ledger/API, AI, shared, and other displayed suites passed; overall exit was caused solely by the extractor integration test requiring an unavailable `DATABASE_URL`.

The extractor environment failure is not a defect in this implementation and does not indicate a ledger regression.

**Final assessment: acceptance-ready.**