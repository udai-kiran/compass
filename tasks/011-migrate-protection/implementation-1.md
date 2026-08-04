# Implementation Report — Task 011-migrate-protection (roadmap 1.4)

Written by the sonnet-worker after independently verifying backend-engineer's output and making
the roadmap edits. This file replaces a self-report backend-engineer wrote at this same path
(see "Deviations" below — that write was out of its declared scope).

## Files inspected
- `tasks/011-migrate-protection/DELEGATION.md`, `tasks/011-migrate-protection/TASK.md`
- `apps/api/src/app.ts`, `apps/api/src/db/schema.ts`
- `apps/api/src/modules/protection/{schema.ts, schema.smoke.test.ts, plugin.ts, plugin.test.ts, services/insurance.ts, services/retirement.ts, routes/insurance.ts, routes/retirement.ts, routes/protection.route.test.ts}`
- `apps/api/src/route-surface.snapshot.txt`, `apps/api/src/route-table.snapshot.txt`
- `apps/api/src/services/demo.ts`, `services/goals.ts`, `modules/ledger/services/accounts.ts`, `services/backup.ts`, `services/restore-user.ts`, `jobs/index.ts` (diffed, confirmed untouched)
- `apps/api/drizzle/**` (content-hash manifest, before/after)
- `tasks/01.04-migrate-protection.md`, `tasks/01.09-cross-module-ports.md`, `tasks/README.md`
- `tasks/011-migrate-protection/backend-1.md` (backend-engineer's own closing report)

## Files changed

**Created (backend-engineer, under `apps/api/src/modules/protection/`):**
`schema.ts`, `schema.smoke.test.ts`, `plugin.ts`, `plugin.test.ts`, `services/insurance.ts`,
`services/retirement.ts`, `routes/insurance.ts`, `routes/retirement.ts`, `routes/protection.route.test.ts`

**Modified (backend-engineer):** `apps/api/src/app.ts` (2 imports → 1, 2 registrations → 1 at line
123's position, header comment extended); `apps/api/src/route-table.snapshot.txt` (regenerated,
byte-identical, empty diff)

**Deleted (backend-engineer):** `apps/api/src/routes/insurance.ts`, `apps/api/src/routes/retirement.ts`,
`apps/api/src/services/insurance.ts`, `apps/api/src/services/retirement.ts`

**Modified (sonnet-worker, roadmap):** `tasks/01.04-migrate-protection.md` (AC2 amended + status
flip `todo`→`done`), `tasks/01.09-cross-module-ports.md` (`depends:` extended), `tasks/README.md`
(1.4 row `todo`→`done`, new 1.10 row)

**Created (sonnet-worker, roadmap):** `tasks/01.10-storage-backend-contract-tests.md`

**Not touched by anyone in this task:** `apps/api/src/db/schema.ts`, `services/demo.ts`,
`services/goals.ts`, `modules/ledger/services/accounts.ts`, `services/backup.ts`,
`services/restore-user.ts`, `jobs/index.ts` — all confirmed via `git diff` (exit/output empty).

## Implementation details

### STEP 1 — baseline (captured before any change)
- `npm run test -w apps/api`: **837/837 pass**, exit 0.
- `apps/api/src/route-surface.snapshot.txt` sha256 `a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122` (283 lines).
- `apps/api/src/route-table.snapshot.txt` sha256 `7800feb971c2e570040a299addf207960a0866f2a7feb377c4a2cf84bf4255c8` (156 lines).
- `apps/api/drizzle/` content-hash manifest captured (139 files, sha256 each) — saved to scratchpad, diffed against the post-`db:generate` manifest below (identical).
- Note: `git status --porcelain` at the very start of this session already showed
  ` M tasks/011-migrate-protection/TASK.md` — this modification pre-existed my involvement (it was
  present before Step 1's baseline capture and before backend-engineer ran); I did not cause it and
  did not touch `TASK.md`.

### STEP 2 — backend-engineer delegation
Ran exactly:
```
/home/udai/.claude/bin/backend-engineer tasks/011-migrate-protection/backend-1.md "<full prompt>"
```
The prompt (composed per DELEGATION.md's Routing section) included: the relocation-not-rewrite
objective; instruction to read TASK.md and DELEGATION.md first; the Files-and-Symbols list
(excluding `tasks/*.md`); Required Changes items 1–7 verbatim (both split-imports, every depth
adjustment with line numbers, plugin registration order, the app.ts collapse); the Must-Not-Change
list verbatim; the test requirements (2 smoke tests, `hasRoute()`-only plugin test, both 403 +
no-mutation assertions in the route test); the AC1–AC10 summary; and the Node 24 native-TS
`.ts`-extension requirement. It took ~19 minutes wall-clock to run (backgrounded; polled via `ps`
until exit).

`backend-engineer` finished, printing `backend-engineer report written to:
/home/udai/PennyPilot/tasks/011-migrate-protection/backend-1.md` (exit 0). Its own closing summary
in `backend-1.md` claimed 842/842 green, byte-identical snapshots, zero `db:generate` diff, and
import-only diffs on the 4 moved files — all independently re-verified below rather than taken on
trust.

### STEP 3 — roadmap edits (item 8, parts a–d, then e last)
- (a) `tasks/01.04-migrate-protection.md:16` amended from "Policy document and health-card
  upload/download still work against both S3 and disk storage" to "The `Storage` seam is unchanged
  by the move; live disk-vs-S3 verification is task 1.10".
- (b) Created `tasks/01.10-storage-backend-contract-tests.md` with frontmatter `id: "1.10"`,
  `title: Storage backend contract tests`, `phase: "1 — Module migration"`, `release: "2.0.0"`,
  `status: todo`, `depends: [1.4]`, plus the 5 acceptance criteria verbatim from TASK.md
  Scope-decision-1 (see file for full text — not a placeholder).
- (c) Added a `| 1.10 | ... |` row to `tasks/README.md` immediately after the `1.9` row (numeric
  position), before the `2.1` row.
- (d) Added `1.10` to `tasks/01.09-cross-module-ports.md`'s `depends:` list.
- (e) — done **last**, after every gate below passed — flipped `tasks/01.04-migrate-protection.md`'s
  `status: todo` → `done` and the `tasks/README.md` 1.4 row `todo` → `done`.

## AC9 verification — the 4 moved files' diffs are import-line-only

Diffed each moved file against its pre-move `HEAD` content directly (not relying on
backend-engineer's self-report):

```
$ diff <(git show HEAD:apps/api/src/services/insurance.ts) apps/api/src/modules/protection/services/insurance.ts
15,21c15,22
< import type { Db } from "../db/index.ts";
< import { insuranceHealthCards, insurancePolicies, transactions } from "../db/schema.ts";
< import { HttpError } from "../lib/errors.ts";
< import type { Storage } from "../lib/storage.ts";
< import { assertUploadable } from "../modules/ledger/services/attachments.ts";
< import { createTransaction } from "../modules/ledger/services/transactions.ts";
< import { assertOwnedResource } from "../modules/ledger/services/resources.ts";
---
> import type { Db } from "../../../db/index.ts";
> import { insuranceHealthCards, insurancePolicies } from "../schema.ts";
> import { transactions } from "../../../db/schema.ts";
> import { HttpError } from "../../../lib/errors.ts";
> import type { Storage } from "../../../lib/storage.ts";
> import { assertUploadable } from "../../ledger/services/attachments.ts";
> import { createTransaction } from "../../ledger/services/transactions.ts";
> import { assertOwnedResource } from "../../ledger/services/resources.ts";

$ diff <(git show HEAD:apps/api/src/services/retirement.ts) apps/api/src/modules/protection/services/retirement.ts
4,6c4,7
< import type { Db } from "../db/index.ts";
< import { accounts, retirementDetails } from "../db/schema.ts";
< import { HttpError } from "../lib/errors.ts";
---
> import type { Db } from "../../../db/index.ts";
> import { retirementDetails } from "../schema.ts";
> import { accounts } from "../../../db/schema.ts";
> import { HttpError } from "../../../lib/errors.ts";

$ diff <(git show HEAD:apps/api/src/routes/insurance.ts) apps/api/src/modules/protection/routes/insurance.ts
11,12c11,12
< import { HttpError } from "../lib/errors.ts";
< import { MAX_ATTACHMENT_BYTES } from "../modules/ledger/services/attachments.ts";
---
> import { HttpError } from "../../../lib/errors.ts";
> import { MAX_ATTACHMENT_BYTES } from "../../ledger/services/attachments.ts";

$ diff <(git show HEAD:apps/api/src/routes/retirement.ts) apps/api/src/modules/protection/routes/retirement.ts
(no output — byte-identical)
```
All 4 diffs are exclusively import-line changes. AC9 confirmed.

## Commands run, exact output, exit codes

### `git diff -- apps/api/src/app.ts` (before any typecheck run, confirming item 5)
Matches the spec exactly: 2 imports → 1 `import { protectionRoutes } from "./modules/protection/plugin.ts";`;
2 registrations → 1 `await app.register(protectionRoutes);` at line 123's old position (after
`creditRoutes`, before `insightRoutes`); header comment extended with a 1.4 paragraph. Full diff
pasted in "Full diff" section below.

### `git diff -- apps/api/src/db/schema.ts`
```
(exit 0, empty output — no change)
```

### `git diff -- apps/api/src/services/demo.ts apps/api/src/services/goals.ts apps/api/src/modules/ledger/services/accounts.ts apps/api/src/services/backup.ts apps/api/src/services/restore-user.ts apps/api/src/jobs/index.ts`
```
(exit 0, empty output — no change)
```

### 1. `npm run typecheck`
Exit code: **0**. Tail of output:
```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit

> @compass/docs@0.1.0 typecheck
> tsc --noEmit

> @compass/extractor@0.1.0 typecheck
> tsc --noEmit

> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit

> @compass/web@0.1.0 typecheck
> tsc --noEmit

> @compass/ai@0.1.0 typecheck
> tsc --noEmit

> @compass/shared@0.1.0 typecheck
> tsc --noEmit
```
(No error lines anywhere in the log — all 7 workspaces clean.)

### 2. `npm run lint`
Exit code: **0**. Output:
```
> compass@0.1.0 lint
> eslint .
```

### 3. `npm run test -w apps/api`
Exit code: **0**. Tail:
```
ℹ tests 842
ℹ suites 1
ℹ pass 842
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8120.7445
```
**Before/after arithmetic: 837 → 842 = +5** (2 schema-smoke `test()` cases in `schema.smoke.test.ts`,
1 in `plugin.test.ts`, 2 in `protection.route.test.ts`). Matches AC5 exactly.

### 4. `npm run test` (root)
Exit code: **1**. Per-workspace summary lines:
```
> @compass/api@0.1.0 test
ℹ tests 842
ℹ pass 842
ℹ fail 0

> @compass/extractor@0.1.0 test
ℹ tests 63
ℹ pass 62
ℹ fail 1
npm error Lifecycle script `test` failed with error:
npm error code 1
npm error path /home/udai/PennyPilot/apps/extractor
npm error workspace @compass/extractor@0.1.0
npm error location /home/udai/PennyPilot/apps/extractor
npm error command failed
npm error command sh -c node --test "src/**/*.test.ts"

> @compass/ingestor@0.1.0 test
ℹ tests 12
ℹ pass 12
ℹ fail 0

> @compass/web@0.1.0 test
ℹ tests 264
ℹ pass 264
ℹ fail 0

> @compass/ai@0.1.0 test
ℹ tests 32
ℹ pass 32
ℹ fail 0

> @compass/shared@0.1.0 test
ℹ tests 212
ℹ pass 212
ℹ fail 0
```
The extractor failure was traced to the exact stack trace:
```
file:///home/udai/PennyPilot/apps/extractor/src/statement-duplicate.test.ts:30
Error: statement-duplicate.test.ts needs DATABASE_URL set (a real Postgres connection) — this repo
has no DB-mocking infrastructure. Export it (see apps/extractor/.env) before running
`npm run test -w apps/extractor`.
    at requireDatabaseUrl (file:///home/udai/PennyPilot/apps/extractor/src/statement-duplicate.test.ts:30:11)
✖ src/statement-duplicate.test.ts (458.958684ms)
```
This is the pre-existing, unrelated `DATABASE_URL`-packaging gap TASK.md's Root Cause documented and
waived — confirmed to be the **sole** failure across all 7 workspaces.

### 5. From `apps/api`: `node --test src/app.route-snapshot.test.ts`
Exit code: **0**.
```
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte — the real 'unchanged API surface' gate (207.559834ms)
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte (100.78514ms)
✔ assertRouteTableMatches rejects an added route (0.551867ms)
✔ assertRouteTableMatches rejects a removed route (0.184564ms)
✔ assertRouteTableMatches rejects a renamed route (0.15473ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.183479ms)
✔ assertRouteTableMatches accepts identical tables (0.318973ms)
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

**route-table.snapshot.txt diff** (regenerated by backend-engineer's `db:generate`/verification run,
re-checked independently by the worker via `diff` against the pre-Step-2 saved copy, and via sha256):
```
sha256 before: 7800feb971c2e570040a299addf207960a0866f2a7feb377c4a2cf84bf4255c8
sha256 after:  7800feb971c2e570040a299addf207960a0866f2a7feb377c4a2cf84bf4255c8
diff exit: 0 (empty — byte-identical)
```

**route-surface.snapshot.txt** — byte-frozen check:
```
sha256 before: a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122
sha256 after:  a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122
diff exit: 0 (empty — byte-identical)
```

### 6. From `apps/api`: `node --test src/modules/protection/schema.smoke.test.ts`
Exit code: **0**.
```
✔ modules/protection/schema.ts re-exports the same 3 table objects as db/schema.ts (1.085614ms)
✔ modules/protection/schema.ts re-exports the same 4 owned enum objects as db/schema.ts (0.221537ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

### 7. From `apps/api`: `node --test src/modules/protection/plugin.test.ts`
Exit code: **0**.
```
✔ protectionRoutes registers one uniquely-attributable route from each of the 2 internal route files (107.870597ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```
(Uses `app.hasRoute({ method, url })` introspection only — confirmed by reading the file; no
`app.inject()` call anywhere in it.)

### 8. From `apps/api`: `node --env-file-if-exists=../../.env --test src/modules/protection/routes/protection.route.test.ts`
Exit code: **0**.
```
✔ a demo session's POST /api/insurance/policies is rejected 403, and no insurance_policies row is written (165.380443ms)
✔ a demo session's PUT /api/retirement/:accountId/details is rejected 403, and no retirement_details row is written (35.349944ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
```
Both 403 assertions (`assert.equal(res.statusCode, 403)`) and both no-mutation assertions
(`assert.equal(after_.length, 0, ...)` against `insurance_policies` and `retirement_details`
respectively) are present, per-file read confirmed. The PUT test creates one `accounts` row of type
`ppf` as a fixture (per Required Change 7). The test app does **not** decorate a stub `storage` —
confirmed absent in `buildTestApp()`.

### 9. From `apps/api`: `node --env-file-if-exists=../../.env --test src/services/backup.test.ts`
Exit code: **0**.
```
✔ the full backup covers every table in the schema (5.100404ms)
✔ sips precedes holding_events in ALL_TABLES (holding_events.sip_id FKs sips) (0.510488ms)
✔ the per-user export reconstructs every table (no coverage gaps) (0.452574ms)
✔ no table is scoped both directly and through a parent (0.377015ms)
✔ every storage-key column in the schema is covered by FILE_COLUMNS (1.277676ms)
✔ collectFileRefs pulls every non-empty storage key from a dump (0.889567ms)
✔ the per-user restore covers exactly the exported tables, in parent-first order (0.652034ms)
✔ restore defers cyclic and self-referencing foreign keys (0.8851ms)
✔ restoreDump's second pass issues an update for every column in DEFERRED_RESTORE_COLUMNS (1.991416ms)
✔ misc-05 AC14: restoreDump's first pass carries user_tasks.source/source_key through untouched when present, and omits them (falling back to the column DEFAULT) when the dump predates the migration (1.312332ms)
✔ AC11: a task linked to an owned transaction, and an unlinked task, round-trip through per-user backup/restore (326.176704ms)
✔ misc-05 AC14: the per-user archive round-trips a card-due task's source/sourceKey through restoreUserBackup, alongside an ordinary task (187.32002ms)
✔ misc-05 AC14: a per-user archive predating source/sourceKey (missing both keys entirely) restores via restoreUserBackup by falling back to the column DEFAULTs (29.308839ms)
ℹ tests 13
ℹ pass 13
ℹ fail 0
```
`services/backup.ts` untouched (confirmed via `git diff`, above).

### 10. `npm run db:generate` — content-hash manifest before/after
Exit code: **0**. Tail:
```
No config path provided, using default 'drizzle.config.ts'
Reading config file '/home/udai/PennyPilot/apps/api/drizzle.config.ts'
51 tables
...
No schema changes, nothing to migrate 😴
```
`find drizzle -type f | sort | xargs sha256sum` — before: 139-line manifest captured at Step 1
(before backend-engineer's edits); after: recaptured post-`db:generate` (this session). `diff
before.txt after.txt` → exit **0**, empty output. Manifests identical.

### 11. `git status --porcelain` and full `git diff`
`git status --porcelain` (final):
```
 M apps/api/src/app.ts
 D apps/api/src/routes/insurance.ts
 D apps/api/src/routes/retirement.ts
 D apps/api/src/services/insurance.ts
 D apps/api/src/services/retirement.ts
 M tasks/01.04-migrate-protection.md
 M tasks/01.09-cross-module-ports.md
 M tasks/011-migrate-protection/TASK.md
 M tasks/README.md
?? apps/api/src/modules/protection/
?? tasks/01.10-storage-backend-contract-tests.md
?? tasks/011-migrate-protection/DELEGATION.md
?? tasks/011-migrate-protection/backend-1.md
?? tasks/011-migrate-protection/implementation-1.md
?? tasks/011-migrate-protection/review-2.md
?? tasks/011-migrate-protection/review-3.md
(plus pre-existing untracked task-board directories/files unrelated to this task, present since
before this session started: tasks/00.01-00.02-verification-1.md, tasks/000-agent-harness/,
tasks/001-domain-event-bus/, tasks/001-engineer-routing-memory/, tasks/002-resume-refactor/,
tasks/002-retire-url-regex-hook/, tasks/003-demo-monthday-utc-fix/, tasks/004-fix-eslint-no-undef/,
tasks/005-fix-api-test-env-loading/, tasks/006-module-scaffold-and-route-gate/, tasks/012-release-checkpoint/)
```

`git diff -- apps/api/src/app.ts tasks/01.04-migrate-protection.md tasks/01.09-cross-module-ports.md tasks/README.md`:
```diff
diff --git a/apps/api/src/app.ts b/apps/api/src/app.ts
index eff625a..bf4d97d 100644
--- a/apps/api/src/app.ts
+++ b/apps/api/src/app.ts
@@ -28,8 +28,7 @@ import { investmentsRoutes } from "./modules/investments/plugin.ts";
 import { cashflowRoutes } from "./routes/cashflow.ts";
 import { billRoutes } from "./routes/bills.ts";
 import { creditRoutes } from "./modules/credit/plugin.ts";
-import { retirementRoutes } from "./routes/retirement.ts";
-import { insuranceRoutes } from "./routes/insurance.ts";
+import { protectionRoutes } from "./modules/protection/plugin.ts";
 import { insightRoutes } from "./routes/insights.ts";
 import { reportRoutes } from "./routes/reports.ts";
 import { backupRoutes } from "./routes/backup.ts";
@@ -106,6 +105,15 @@ export function registerLedgerCacheSubscriber(app: FastifyInstance): void {
  * tasks/007-migrate-ledger/TASK.md's / tasks/008-migrate-credit/TASK.md's /
  * tasks/010-migrate-investments/TASK.md's Root Cause for why both snapshots
  * exist.
+ *
+ * As of task 1.4 (migrate-protection), the 2 protection route registrations
+ * (retirement/insurance) are collapsed into the single `protectionRoutes`
+ * plugin, in the same position (`retirementRoutes` used to occupy, with
+ * `insuranceRoutes` immediately after). Unlike the three earlier migrations,
+ * wrapping two already-adjacent, already-in-order registrations in a plugin
+ * does not change the raw `printRoutes()` tree — see
+ * `route-table.snapshot.txt` whose regenerated content is expected
+ * byte-identical.
  */
 export async function registerRoutes(app: FastifyInstance): Promise<void> {
   await app.register(healthRoutes);
@@ -120,8 +128,7 @@ export async function registerRoutes(app: FastifyInstance): Promise<void> {
   await app.register(cashflowRoutes);
   await app.register(billRoutes);
   await app.register(creditRoutes);
-  await app.register(retirementRoutes);
-  await app.register(insuranceRoutes);
+  await app.register(protectionRoutes);
   await app.register(insightRoutes);
   await app.register(reportRoutes);
   await app.register(backupRoutes);
diff --git a/tasks/01.04-migrate-protection.md b/tasks/01.04-migrate-protection.md
index e6923b5..0f93767 100644
--- a/tasks/01.04-migrate-protection.md
+++ b/tasks/01.04-migrate-protection.md
@@ -3,7 +3,7 @@ id: "1.4"
 title: Migrate protection module
 phase: "1 — Module migration"
 release: "2.0.0"
-status: todo
+status: done
 depends: [1.1]
 ---
 
@@ -13,5 +13,5 @@ The smallest domain — a good early confidence check on the migration recipe. I
 
 ## Acceptance criteria
 - [ ] Route snapshot unchanged; no migration diff; `backup.test.ts` green
-- [ ] Policy document and health-card upload/download still work against both S3 and disk storage
+- [ ] The `Storage` seam is unchanged by the move; live disk-vs-S3 verification is task 1.10
 - [ ] typecheck + lint + test green
diff --git a/tasks/01.09-cross-module-ports.md b/tasks/01.09-cross-module-ports.md
index 6946089..fc04347 100644
--- a/tasks/01.09-cross-module-ports.md
+++ b/tasks/01.09-cross-module-ports.md
@@ -4,7 +4,7 @@ title: Cross-module ports + flat-services cleanup
 phase: "1 — Module migration"
 release: "2.0.0"
 status: todo
-depends: [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8]
+depends: [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10]
 ---
 
 Closes Phase 1. Replace the remaining raw cross-domain reads with declared interfaces, so a module depends on a contract rather than another module's tables.
diff --git a/tasks/README.md b/tasks/README.md
index e88b6a9..472d1f8 100644
--- a/tasks/README.md
+++ b/tasks/README.md
@@ -97,12 +97,13 @@ Phase 4 and 5 are **extensions of real working code**, not greenfield. Verified
 | 1.1 | [Migrate ledger module](./01.01-migrate-ledger.md) | 1 — Module migration | done |
 | 1.2 | [Migrate credit module](./01.02-migrate-credit.md) | 1 — Module migration | done |
 | 1.3 | [Migrate investments module](./01.03-migrate-investments.md) | 1 — Module migration | done |
-| 1.4 | [Migrate protection module](./01.04-migrate-protection.md) | 1 — Module migration | todo |
+| 1.4 | [Migrate protection module](./01.04-migrate-protection.md) | 1 — Module migration | done |
 | 1.5 | [Migrate planning module](./01.05-migrate-planning.md) | 1 — Module migration | todo |
 | 1.6 | [Migrate automation/AI module](./01.06-migrate-automation.md) | 1 — Module migration | todo |
 | 1.7 | [Migrate ingest module](./01.07-migrate-ingest.md) | 1 — Module migration | todo |
 | 1.8 | [Migrate system module](./01.08-migrate-system.md) | 1 — Module migration | todo |
 | 1.9 | [Cross-module ports + flat-services cleanup](./01.09-cross-module-ports.md) | 1 — Module migration | todo |
+| 1.10 | [Storage backend contract tests](./01.10-storage-backend-contract-tests.md) | 1 — Module migration | todo |
 | 2.1 | [Postings model & balance invariant](./02.01-postings-model.md) | 2 — Double-entry ledger | todo |
```
The `apps/api/src/routes/{insurance,retirement}.ts` and `apps/api/src/services/{insurance,retirement}.ts`
deletions and the `apps/api/src/modules/protection/` creations show as plain `D`/`??` in
`git status --porcelain` (git does not correlate them as renames since the imports changed); their
content deltas are captured in the AC9 section above via direct `diff` against `HEAD`.

## Literal `depends:` line from `tasks/01.09-cross-module-ports.md`
```
depends: [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10]
```

## Assumptions
- The repo's `git diff --stat` correlation for deleted+created files under different paths does not
  matter for AC9 — a direct `diff <(git show HEAD:old-path) new-path` is the correct, stronger check
  and was used instead.
- Backend-engineer's own report at `backend-1.md` (the wrapper's designated report path) was treated
  as evidence to re-verify, not as ground truth — every claim in it (test counts, snapshot identity,
  import-only diffs) was independently re-run/re-diffed by the sonnet-worker.

## Deviations / unresolved risks

1. **Scope violation by backend-engineer:** despite the prompt's explicit "Scope boundary" section
   stating "Do NOT touch any file under `tasks/`... Only touch `apps/api/src/**`", backend-engineer
   wrote a self-report to `tasks/011-migrate-protection/implementation-1.md` — the exact path the
   coordinator asked the sonnet-worker (not backend-engineer) to write findings to. This file has now
   been overwritten with this report per the coordinator's original instruction. No other file
   outside `apps/api/src/**` was touched by backend-engineer (confirmed via `git status --porcelain`
   immediately after its run: only `apps/api/src/**` changes plus the one `implementation-1.md`
   write existed at that point, before any roadmap edits).
2. **Pre-existing uncommitted `tasks/011-migrate-protection/TASK.md` modification:** `git status
   --porcelain` showed `M tasks/011-migrate-protection/TASK.md` before Step 1's baseline capture and
   before backend-engineer ran. This predates this session's work and was not caused by the
   sonnet-worker or backend-engineer; flagged so it isn't mistaken for an edit made during this task.
3. No other deviations found. All Must-Not-Change items held: `route-surface.snapshot.txt`
   byte-frozen; no `pgTable`/`pgEnum` change in `db/schema.ts`; no `export *` added back;
   `services/demo.ts`/`services/goals.ts`/`modules/ledger/services/accounts.ts` untouched;
   `services/backup.ts`/`services/restore-user.ts`/`jobs/index.ts` untouched; no stub `storage`
   decorated in `protection.route.test.ts`; no Fastify route prefix added. Test delta was exactly
   +5 (837 → 842). `route-table.snapshot.txt` diff was empty (byte-identical), not merely
   structurally equivalent.
