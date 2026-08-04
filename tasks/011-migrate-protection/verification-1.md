# Independent Verification — Task 011-migrate-protection (roadmap 1.4)

Read-only verification. No files were edited, staged, or committed by this worker except this report.
`implementation-1.md` (the prior worker's self-report) was treated as claims to check, not as truth;
every command below was re-run independently in this session and every diff re-derived from the repo.

## Files inspected
- `tasks/011-migrate-protection/TASK.md`, `DELEGATION.md`, `implementation-1.md`
- `apps/api/src/app.ts`, `apps/api/src/db/schema.ts`
- `apps/api/src/modules/protection/{schema.ts, schema.smoke.test.ts, plugin.ts, plugin.test.ts,
  services/insurance.ts, services/retirement.ts, routes/insurance.ts, routes/retirement.ts,
  routes/protection.route.test.ts}` (full reads and/or diffs against `HEAD`'s deleted originals)
- `apps/api/src/route-surface.snapshot.txt`, `apps/api/src/route-table.snapshot.txt` (sha256 only)
- `apps/api/src/services/demo.ts`, `services/goals.ts`, `modules/ledger/services/accounts.ts`,
  `services/backup.ts`, `services/restore-user.ts`, `jobs/index.ts` (diffed against `HEAD`)
- `tasks/01.04-migrate-protection.md`, `tasks/01.09-cross-module-ports.md`, `tasks/01.10-storage-backend-contract-tests.md`,
  `tasks/README.md`
- `tasks/01.01-migrate-ledger.md`, `tasks/01.02-migrate-credit.md`, `tasks/01.03-migrate-investments.md`
  (precedent comparison for the roadmap-file convention)
- `apps/api/drizzle/` (content-hash manifest before/after `npm run db:generate`, independently captured)

## Files changed by this verification
None. Only `tasks/011-migrate-protection/verification-1.md` was written.

---

## 1. `git status --porcelain`

```
$ git status --porcelain
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
?? tasks/00.01-00.02-verification-1.md
?? tasks/000-agent-harness/
?? tasks/001-domain-event-bus/
?? tasks/001-engineer-routing-memory/
?? tasks/002-resume-refactor/
?? tasks/002-retire-url-regex-hook/
?? tasks/003-demo-monthday-utc-fix/
?? tasks/004-fix-eslint-no-undef/
?? tasks/005-fix-api-test-env-loading/
?? tasks/006-module-scaffold-and-route-gate/
?? tasks/01.10-storage-backend-contract-tests.md
?? tasks/011-migrate-protection/DELEGATION.md
?? tasks/011-migrate-protection/backend-1.md
?? tasks/011-migrate-protection/implementation-1.md
?? tasks/011-migrate-protection/review-2.md
?? tasks/011-migrate-protection/review-3.md
?? tasks/011-migrate-protection/review-4.md
?? tasks/012-release-checkpoint/
```

This matches Scope exactly: the 4 deletions, the `app.ts` modification, the 3 roadmap-file
modifications, the new `01.10` file, and the new `modules/protection/` directory. The
`tasks/00*/tasks/000-*/…/tasks/012-*` untracked entries were present in the working tree at the
start of this session (confirmed against the pre-session `git status` snapshot supplied in the
system context) — unrelated pre-existing task-board scaffolding, not touched by this task.
`tasks/011-migrate-protection/{DELEGATION.md, backend-1.md, implementation-1.md, review-2.md,
review-3.md}` are this task's own working artefacts; `review-4.md` appeared between my first and
second `git status` reads during this session (evidence of concurrent coordinator/reviewer
activity outside my scope — not caused by this verification, and not investigated further per the
read-only brief).

**`tasks/011-migrate-protection/TASK.md` is `M` (modified) — not in this task's declared Scope
(Scope only lists `apps/api/src/**`, the 4 roadmap files, and the new files/deletions above;
`TASK.md` itself is not listed as a file this task modifies).** `implementation-1.md` flags this as
pre-existing ("present before Step 1's baseline capture and before backend-engineer ran... not
caused by the sonnet-worker or backend-engineer"). I cannot independently confirm *when* the edit
was made, but I can confirm its current content is coordinator/review narrative (Status,
Review-1/2/3 dispositions, Scope-decisions) plus one section titled "### Post-implementation
finding (coordinator, direct read — not reported by any worker or reviewer)" that is dated after
implementation and flags a real, currently-unresolved defect — see §14 below. This is process
narrative, not a change to the task's operative content (Scope/Acceptance Criteria sections were
edited too, e.g. AC5's arithmetic and AC2's wording — this is the coordinator's own record of the
plan-approval process, consistent with the file's role as the living task record).

## 2. Complete `git diff`

Full diff captured to `/tmp/claude-1001/.../scratchpad/full-git-diff.txt` (1023 lines) and reviewed
in full. Reproduced verbatim below, covering `apps/api/src/app.ts`, the 4 deleted files (full
content, confirming what existed before the move), `tasks/01.04-migrate-protection.md`,
`tasks/01.09-cross-module-ports.md`, `tasks/011-migrate-protection/TASK.md`, and `tasks/README.md`:

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
```
(The 4 deleted-file diffs — `apps/api/src/routes/{insurance,retirement}.ts`,
`apps/api/src/services/{insurance,retirement}.ts` — are the full pre-move file contents, shown as
deletions since git does not correlate them with the new `modules/protection/` files as renames.
Their content is compared line-for-line against the new files in §3 below, not repeated here.)

```diff
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

`git diff --stat` (full, unfiltered):
```
 apps/api/src/app.ts                  |  15 +-
 apps/api/src/routes/insurance.ts     | 166 -----------------
 apps/api/src/routes/retirement.ts    |  30 ----
 apps/api/src/services/insurance.ts   | 334 -----------------------------------
 apps/api/src/services/retirement.ts  |  73 --------
 tasks/01.04-migrate-protection.md    |   4 +-
 tasks/01.09-cross-module-ports.md    |   2 +-
 tasks/011-migrate-protection/TASK.md | 214 +++++++++++++++++++---
 tasks/README.md                      |   3 +-
 9 files changed, 201 insertions(+), 640 deletions(-)
```

**New untracked files** in `apps/api/src/modules/protection/`: `schema.ts`, `schema.smoke.test.ts`,
`plugin.ts`, `plugin.test.ts`, `services/insurance.ts`, `services/retirement.ts`,
`routes/insurance.ts`, `routes/retirement.ts`, `routes/protection.route.test.ts` — all read in full
during verification (contents quoted where relevant in §3, §9, §10 below). `tasks/01.10-storage-backend-contract-tests.md`
content quoted in full in §14.

---

## 3. AC9 "move not rewrite" — independently re-diffed against `HEAD`

```
$ diff <(git show HEAD:apps/api/src/services/insurance.ts) apps/api/src/modules/protection/services/insurance.ts; echo "EXIT:$?"
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
EXIT:1

$ diff <(git show HEAD:apps/api/src/services/retirement.ts) apps/api/src/modules/protection/services/retirement.ts; echo "EXIT:$?"
4,6c4,7
< import type { Db } from "../db/index.ts";
< import { accounts, retirementDetails } from "../db/schema.ts";
< import { HttpError } from "../lib/errors.ts";
---
> import type { Db } from "../../../db/index.ts";
> import { retirementDetails } from "../schema.ts";
> import { accounts } from "../../../db/schema.ts";
> import { HttpError } from "../../../lib/errors.ts";
EXIT:1

$ diff <(git show HEAD:apps/api/src/routes/insurance.ts) apps/api/src/modules/protection/routes/insurance.ts; echo "EXIT:$?"
11,12c11,12
< import { HttpError } from "../lib/errors.ts";
< import { MAX_ATTACHMENT_BYTES } from "../modules/ledger/services/attachments.ts";
---
> import { HttpError } from "../../../lib/errors.ts";
> import { MAX_ATTACHMENT_BYTES } from "../../ledger/services/attachments.ts";
EXIT:1

$ diff <(git show HEAD:apps/api/src/routes/retirement.ts) apps/api/src/modules/protection/routes/retirement.ts; echo "EXIT:$?"
EXIT:0
```

All 4 diffs consist exclusively of import-line changes (`retirement.ts` route file is byte-identical
— exit 0, no output). **AC9: PASS.**

---

## 4. AC1 — snapshot byte-identity

```
$ sha256sum apps/api/src/route-surface.snapshot.txt apps/api/src/route-table.snapshot.txt
a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122  apps/api/src/route-surface.snapshot.txt
7800feb971c2e570040a299addf207960a0866f2a7feb377c4a2cf84bf4255c8  apps/api/src/route-table.snapshot.txt

$ git show HEAD:apps/api/src/route-surface.snapshot.txt | sha256sum
a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122  -

$ git show HEAD:apps/api/src/route-table.snapshot.txt | sha256sum
7800feb971c2e570040a299addf207960a0866f2a7feb377c4a2cf84bf4255c8  -

$ git diff --stat -- apps/api/src/route-surface.snapshot.txt apps/api/src/route-table.snapshot.txt
(no output — zero diff, both files not even listed as modified in git diff --stat)
```
Both snapshots are byte-identical to `HEAD`. **AC1 snapshot portion: PASS** (empty diff, the
expected result per TASK.md).

---

## 5. AC5 — `npm run test -w apps/api`

```
$ npm run test -w apps/api
... (842 test lines) ...
ℹ tests 842
ℹ suites 1
ℹ pass 842
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7986.915615
$ echo $?
0
```
**842 pass, 0 fail, exit 0 — confirmed.** Per the brief's instruction ("checking out nothing — just
report the current number"), I did not revert to re-measure the 837 baseline myself. Cross-check on
the +5 arithmetic: `grep -c "^test("` on the 3 new test files gives `schema.smoke.test.ts` → 2,
`plugin.test.ts` → 1, `protection.route.test.ts` → 2 = **5**, and the precedent
`credit`/`ledger`/`investments` `schema.smoke.test.ts` files each also have exactly 2 `test()`
cases (matching TASK.md's claimed precedent). 837 + 5 = 842, consistent with the observed count.
**AC5: PASS** (with the stated caveat that the 837 baseline itself was not independently
re-derived in this session, per the brief's own instruction not to check anything out).

---

## 6. `npm run typecheck` and `npm run lint`

```
$ npm run typecheck
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
$ echo $?
0
```
No error lines in any workspace. Exit code **0**.

```
$ npm run lint
> compass@0.1.0 lint
> eslint .
$ echo $?
0
```
Exit code **0**, no output (clean). **AC3: PASS.**

---

## 7. `npm run test` (root)

```
$ npm run test
...
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
$ echo $?
1
```

The extractor's sole failure, traced by stack trace:
```
file:///home/udai/PennyPilot/apps/extractor/src/statement-duplicate.test.ts:30
Error: statement-duplicate.test.ts needs DATABASE_URL set (a real Postgres connection) — this repo
has no DB-mocking infrastructure. Export it (see apps/extractor/.env) before running
`npm run test -w apps/extractor`.
    at requireDatabaseUrl (file:///home/udai/PennyPilot/apps/extractor/src/statement-duplicate.test.ts:30:11)
✖ src/statement-duplicate.test.ts (434.215377ms)
```
This is the documented pre-existing `DATABASE_URL` packaging gap, unrelated to this task.
**Confirmed: this is the ONLY failure across all 7 workspaces.** No second failure anywhere.
**AC5 root-test-exits-1-only-because-of-extractor waiver: PASS.**

---

## 8. AC8 — `protection.route.test.ts` (demo-403)

```
$ cd apps/api && node --env-file-if-exists=../../.env --test src/modules/protection/routes/protection.route.test.ts
✔ a demo session's POST /api/insurance/policies is rejected 403, and no insurance_policies row is written (164.826116ms)
✔ a demo session's PUT /api/retirement/:accountId/details is rejected 403, and no retirement_details row is written (34.071277ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
$ echo $?
0
```

Read the test source directly (`apps/api/src/modules/protection/routes/protection.route.test.ts`).
Both tests assert BOTH the 403 status and the absence of the underlying mutation:

```ts
// Test 1 (POST /api/insurance/policies):
const res = await app.inject({ method: "POST", url: "/api/insurance/policies", ... });
assert.equal(res.statusCode, 403);
const after_ = await app.db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId));
assert.equal(after_.length, 0, "a rejected demo request must not have written any insurance_policies row");

// Test 2 (PUT /api/retirement/:accountId/details):
const res = await app.inject({ method: "PUT", url: `/api/retirement/${acc!.id}/details`, ... });
assert.equal(res.statusCode, 403);
const after_ = await app.db.select().from(retirementDetails).where(eq(retirementDetails.userId, userId));
assert.equal(after_.length, 0, "a rejected demo request must not have written any retirement_details row");
```

`buildTestApp()` in the same file decorates only `config`, `pg`, `db`, `redis` and installs
`setupAuth`/`setupSecurity` — **no `app.decorate("storage", ...)` call exists anywhere in the
file** (confirmed by full read; grep for `storage` inside this file matches only the file's own
explanatory comment about why it deliberately omits it). **AC8: PASS.**

---

## 9. AC7 — `plugin.test.ts`

Full file read (`apps/api/src/modules/protection/plugin.test.ts`). It:
- imports only `node:test`, `node:assert/strict`, `fastify`, `fastify-type-provider-zod`, and
  `./plugin.ts` — no DB/Redis/env.
- registers `protectionRoutes` on a bare `Fastify()` instance and asserts via
  `app.hasRoute({ method, url })` for exactly 2 pairs:
  `{ method: "GET", url: "/api/retirement/:accountId/details", routeFile: "retirement.ts" }` and
  `{ method: "GET", url: "/api/insurance/policies", routeFile: "insurance.ts" }`.
- **No `app.inject()` call appears anywhere in the file** (confirmed by grep — zero matches).

One route from each of the 2 internal registrations (`retirementRoutes`, `insuranceRoutes`) is
covered. **AC7: PASS.**

```
$ cd apps/api && node --test src/modules/protection/plugin.test.ts
✔ protectionRoutes registers one uniquely-attributable route from each of the 2 internal route files (139.101724ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
$ echo $?
0
```

---

## 10. AC4 — `schema.ts` / `schema.smoke.test.ts`

`apps/api/src/modules/protection/schema.ts` (full content):
```ts
export {
  retirementDetails,
  insuranceKind,
  vehicleKind,
  healthType,
  premiumFrequency,
  insurancePolicies,
  insuranceHealthCards,
} from "../../db/schema.ts";
```
This is a thin **named** re-export (no `export *`, no new `pgTable()`/`pgEnum()` calls). 7 bindings
(3 tables + 4 enums), matching Scope.

```
$ grep -n "protection" apps/api/src/db/schema.ts
(no output)
```
`db/schema.ts` does **not** `export *` back from the module — zero matches for "protection" of any
kind.

`schema.smoke.test.ts` has exactly 2 `test()` cases:
```
✔ modules/protection/schema.ts re-exports the same 3 table objects as db/schema.ts (0.988411ms)
✔ modules/protection/schema.ts re-exports the same 4 owned enum objects as db/schema.ts (0.22207ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
$ echo $?
0
```
`TABLE_NAMES` (3: `retirementDetails`, `insurancePolicies`, `insuranceHealthCards`) and
`ENUM_NAMES` (4: `insuranceKind`, `vehicleKind`, `healthType`, `premiumFrequency`) together cover
all 7 bindings, checked with `assert.strictEqual` (object identity, not structural equality).
**AC4: PASS.**

---

## 11. AC6 — deleted flat paths, source-aware check

```
$ ls apps/api/src/routes/insurance.ts apps/api/src/routes/retirement.ts apps/api/src/services/insurance.ts apps/api/src/services/retirement.ts
lsd: apps/api/src/routes/insurance.ts: No such file or directory (os error 2).
lsd: apps/api/src/routes/retirement.ts: No such file or directory (os error 2).
lsd: apps/api/src/services/insurance.ts: No such file or directory (os error 2).
lsd: apps/api/src/services/retirement.ts: No such file or directory (os error 2).
```
All 4 confirmed absent from disk (exit 2).

Ran a Node script (not a basename grep) that walks every `.ts`/`.tsx` file under `apps/api/src`,
`apps/ingestor/src`, `apps/extractor/src`, `packages/shared/src`, `packages/ai/src`, parses every
relative `import`/`export … from` specifier, resolves it against the importing file's directory,
and checks the resolved absolute path against the 4 deleted paths:
```
$ node check-imports.mjs
NO REMAINING REFERENCES to any of the 4 deleted flat paths.
```
**AC6: PASS.**

---

## 12. AC10 — boundary convention

```
$ grep -n "^import" apps/api/src/modules/protection/services/insurance.ts \
    apps/api/src/modules/protection/services/retirement.ts \
    apps/api/src/modules/protection/routes/insurance.ts \
    apps/api/src/modules/protection/routes/retirement.ts
```
Key lines (full output captured, relevant subset shown):
```
services/retirement.ts:5:import { retirementDetails } from "../schema.ts";
services/retirement.ts:6:import { accounts } from "../../../db/schema.ts";
services/insurance.ts:16:import { insuranceHealthCards, insurancePolicies } from "../schema.ts";
services/insurance.ts:17:import { transactions } from "../../../db/schema.ts";
```
Protection-owned tables (`retirementDetails`, `insuranceHealthCards`, `insurancePolicies`) import
from `../schema.ts`; every non-protection table (`transactions`, `accounts`) imports from
`../../../db/schema.ts`. No import from a peer module's `schema.ts`. **AC10: PASS.**

---

## 13. Must-Not-Change files

```
$ git diff -- apps/api/src/services/demo.ts apps/api/src/services/goals.ts apps/api/src/modules/ledger/services/accounts.ts apps/api/src/services/backup.ts apps/api/src/services/restore-user.ts apps/api/src/jobs/index.ts
$ echo $?
0
(empty output)

$ git diff -- apps/api/src/db/schema.ts
$ echo $?
0
(empty output)
```
All 6 named files are byte-identical to `HEAD`; no `pgTable`/`pgEnum` definition in `db/schema.ts`
changed. **PASS.**

---

## 14. AC2 tracking (roadmap)

`tasks/01.04-migrate-protection.md` (current content, full):
```
---
id: "1.4"
title: Migrate protection module
phase: "1 — Module migration"
release: "2.0.0"
status: done
depends: [1.1]
---

Routes: insurance, retirement. Tables: insurance_policies, insurance_health_cards, retirement_details.

The smallest domain — a good early confidence check on the migration recipe. Includes policy-document and health-card uploads, so it exercises the `Storage` abstraction across a module boundary.

## Acceptance criteria
- [ ] Route snapshot unchanged; no migration diff; `backup.test.ts` green
- [ ] The `Storage` seam is unchanged by the move; live disk-vs-S3 verification is task 1.10
- [ ] typecheck + lint + test green
```
Line 16 does carry the amended structural wording ("The `Storage` seam is unchanged by the move;
live disk-vs-S3 verification is task 1.10") and `status: done` is set. That portion of AC2's
requirement is satisfied.

**However — a defect not asked about directly by the brief but surfaced by inspection:** despite
`status: done`, **all 3 acceptance-criteria checkboxes are still `- [ ]` (unticked)**, and the file
carries no "Full implementation record: `tasks/011-migrate-protection/`" pointer paragraph. Every
one of the 3 predecessor tasks (1.1, 1.2, 1.3) ticks every checkbox `- [x]` when flipping to
`status: done` — confirmed directly:
```
$ grep -n "^\- \[" tasks/01.01-migrate-ledger.md tasks/01.02-migrate-credit.md
tasks/01.01-migrate-ledger.md:17:- [x] ...
tasks/01.01-migrate-ledger.md:18:- [x] ...
tasks/01.01-migrate-ledger.md:19:- [x] ...
tasks/01.01-migrate-ledger.md:20:- [x] ...
tasks/01.01-migrate-ledger.md:21:- [x] ...
tasks/01.02-migrate-credit.md:15:- [x] ...
tasks/01.02-migrate-credit.md:16:- [x] ...
tasks/01.02-migrate-credit.md:17:- [x] ...
tasks/01.02-migrate-credit.md:18:- [x] ...
tasks/01.02-migrate-credit.md:19:- [x] ...
```
and `tasks/01.03-migrate-investments.md` ticks all 4 boxes `- [x]` **and** adds the "Full
implementation record: `tasks/010-migrate-investments/` (...)" paragraph. `01.04` currently matches
neither convention. Notably, `tasks/011-migrate-protection/TASK.md` itself, in the current working
tree, already documents this exact gap in a section titled "### Post-implementation finding
(coordinator, direct read — not reported by any worker or reviewer)": *"`tasks/01.04-migrate-protection.md`
was flipped to `status: done` but its 3 acceptance-criteria checkboxes are still `- [ ]` and it
carries no implementation-record pointer. That breaks the convention every completed predecessor
follows... **Fix required before COMPLETE** — documentation-only, no code impact."* So this is an
acknowledged-but-not-yet-fixed defect at the time of this verification, not a new finding — I am
independently confirming it is still present in the current working tree.

`tasks/01.10-storage-backend-contract-tests.md` (full content):
```
---
id: "1.10"
title: Storage backend contract tests
phase: "1 — Module migration"
release: "2.0.0"
status: todo
depends: [1.4]
---

The `Storage` abstraction (`apps/api/src/lib/storage.ts`) has never had a live backend contract test. The only `Storage` referenced by any test today is `services/backup.test.ts:275`'s deliberately-throwing stub, whose own comment states storage is never actually touched by that fixture — so no test anywhere exercises a real disk or S3-compatible backend. Task 1.4 (migrate-protection) proved the `Storage` seam is structurally unchanged by the module move, but explicitly declined to run a live upload/download verification rather than silently claim it — this task owns that verification.

Build the harness fresh (there is nothing to extend), exercising both protection resource types (policy documents, health cards) against both a temporary disk-backed store and an S3-compatible backend (MinIO).

## Acceptance criteria
- [ ] Exercises both real backends — a temporary disk-backed store and an S3-compatible backend (MinIO) — not a mock or stub standing in for either
- [ ] Covers both protection resource types: policy documents and health cards
- [ ] For each resource type against each backend: upload, then download, asserting the bytes returned are identical to the bytes uploaded, plus delete
- [ ] Documents backend setup/teardown and the exact command or CI environment used to run it
- [ ] Fails loudly if either backend is skipped or silently replaced by a stub — a green run that quietly tested one backend is the exact failure mode 1.4 is deferring, and must not recur
```
All 5 acceptance criteria from Scope-decision-1 are present verbatim, and the file is concrete
(names the exact stub location, the exact bytes-identity/delete requirement, the fail-loudly
requirement) — judged **not** a placeholder.

`tasks/README.md`:
```
| 1.4 | [Migrate protection module](./01.04-migrate-protection.md) | 1 — Module migration | done |
...
| 1.9 | [Cross-module ports + flat-services cleanup](./01.09-cross-module-ports.md) | 1 — Module migration | todo |
| 1.10 | [Storage backend contract tests](./01.10-storage-backend-contract-tests.md) | 1 — Module migration | todo |
```
1.10 row present in numeric position after 1.9; 1.4 shows `done`.

**Literal `depends:` line from `tasks/01.09-cross-module-ports.md`:**
```
depends: [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10]
```
Contains `1.10`.

**AC2 verdict: PASS on the letter of AC2 as written** (roadmap amendment present, 1.10 file exists
with all 5 concrete ACs, README row present, 1.9's `depends:` contains 1.10). **Separately flagged:
the checkbox/implementation-record convention break on `01.04-migrate-protection.md` is a real,
currently-unresolved documentation defect**, already acknowledged in `TASK.md`'s own
"Post-implementation finding" section as "Fix required before COMPLETE." This task is therefore
**not yet in a fully closed-out state** even though every functional/code acceptance criterion
passes.

---

## 15. `npm run db:generate` — content-hash manifest

```
$ find apps/api/drizzle -type f | sort | xargs sha256sum > drizzle-before.txt
$ wc -l drizzle-before.txt
135 drizzle-before.txt

$ npm run db:generate
...
No schema changes, nothing to migrate 😴
$ echo $?
0

$ find apps/api/drizzle -type f | sort | xargs sha256sum > drizzle-after.txt
$ diff drizzle-before.txt drizzle-after.txt; echo "EXIT:$?"
EXIT:0
(empty diff)

$ wc -l drizzle-after.txt
135 drizzle-after.txt

$ git status --porcelain apps/api/drizzle
(no output)
```
Zero diff, no new migration file generated, `git status` on the directory is clean. Note: my
independently-captured manifest is 135 files; `implementation-1.md` claimed 139. This numeric
discrepancy is unexplained but immaterial — my own before/after manifests (both 135) are identical
to each other and `git status` on the directory shows no change either way. **PASS.**

---

## Additional: app boot / route registration

```
$ cd apps/api && node --test src/app.route-snapshot.test.ts
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte — the real 'unchanged API surface' gate (212.341837ms)
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte (105.70998ms)
✔ assertRouteTableMatches rejects an added route (0.533211ms)
✔ assertRouteTableMatches rejects a removed route (0.220906ms)
✔ assertRouteTableMatches rejects a renamed route (0.197079ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.202453ms)
✔ assertRouteTableMatches accepts identical tables (0.374128ms)
ℹ tests 7
ℹ pass 7
ℹ fail 0
$ echo $?
0
```
Also ran (T9): `node --env-file-if-exists=../../.env --test src/services/backup.test.ts`:
```
ℹ tests 13
ℹ pass 13
ℹ fail 0
$ echo $?
0
```
Also ran (T6): `node --test src/modules/protection/schema.smoke.test.ts`: 2/2 pass, exit 0 (§10).
Also ran (T7): `node --test src/modules/protection/plugin.test.ts`: 1/1 pass, exit 0 (§9).
Also ran (T8): `node --env-file-if-exists=../../.env --test src/modules/protection/routes/protection.route.test.ts`: 2/2 pass, exit 0 (§8).

---

## Assumptions
- The pre-session `git status` snapshot supplied in the system context was used as the reference
  point for "pre-existing, unrelated to this task" for the `tasks/00*`/`tasks/000-*`… scaffolding
  directories — I did not independently reconstruct their provenance beyond that.
- Did not independently re-derive the 837 baseline test count by reverting any file, per the
  brief's explicit instruction ("checking out nothing — just report the current number").
- Treated `tasks/011-migrate-protection/TASK.md`'s modification as coordinator/review process
  narrative rather than an implementation-scope violation, since its content is Status/review
  disposition/Scope-decision narrative, not a change to `apps/api/src/**`.

## Unresolved risks / findings
1. **`tasks/01.04-migrate-protection.md` acceptance-criteria checkboxes remain unticked (`- [ ]`)
   despite `status: done`, and no "Full implementation record" pointer paragraph exists**, breaking
   the convention set by all 3 predecessor tasks (1.1, 1.2, 1.3 all tick every box; 1.3 additionally
   adds the pointer paragraph). This is documentation-only (no code/behavior impact) but is a real,
   currently-open gap — already self-identified in `TASK.md`'s own "Post-implementation finding"
   section as requiring a fix before this task is COMPLETE. As of this verification, that fix has
   **not** been applied.
2. `tasks/011-migrate-protection/TASK.md` is `M` (modified) in `git status`, outside this task's
   declared Scope list, though its content is coordinator process narrative, not an
   `apps/api/src/**` or roadmap-file change of the kind Scope enumerates. Flagged per the brief's
   "anything outside the expected set" instruction; not independently resolvable as pass/fail by a
   read-only verifier.
3. The drizzle manifest file count differs between my independent capture (135) and
   `implementation-1.md`'s claim (139) — immaterial to the zero-diff result (both my before/after
   captures match each other and `git status` confirms no directory change), but noted as an
   unexplained discrepancy in the prior worker's report.
4. `review-4.md` appeared in the working tree partway through this verification session — evidence
   of concurrent coordinator/reviewer activity not part of this verification's scope.

---

## Per-acceptance-criterion verdict

| AC | Verdict | Note |
|---|---|---|
| AC1 (snapshots, db:generate, backup.test.ts) | **PASS** | Both snapshots byte-identical; db:generate zero diff; backup.test.ts 13/13 |
| AC2 (roadmap Storage carve-out) | **PASS** (letter of AC2) | All 4 required artefacts present; see finding #1 for a separate, acknowledged-but-open documentation gap on 01.04's own checkboxes |
| AC3 (typecheck/lint) | **PASS** | Both exit 0, all 7 workspaces |
| AC4 (schema.ts thin re-export) | **PASS** | No `export *` back; 2-test smoke covering all 7 bindings, object-identity |
| AC5 (test count, 837→842) | **PASS** | 842/842 confirmed this session; +5 arithmetic cross-checked structurally; 837 baseline not re-derived (per brief instruction) |
| AC6 (import completeness) | **PASS** | Source-aware resolver script: zero remaining references to the 4 deleted paths |
| AC7 (plugin.test.ts) | **PASS** | hasRoute()-only, one route per each of 2 registrations |
| AC8 (demo-403) | **PASS** | Both 403 + both no-mutation assertions confirmed by direct read; no stub storage decorated |
| AC9 (move not rewrite) | **PASS** | All 4 diffs independently re-derived, import-lines-only (1 file byte-identical) |
| AC10 (import boundary convention) | **PASS** | Protection tables from `../schema.ts`, others from `../../../db/schema.ts` |
| Must-Not-Change files | **PASS** | All 6 files + db/schema.ts empty diff vs HEAD |
| Root `npm run test` extractor-only-failure waiver | **PASS** | Confirmed sole failure across all 7 workspaces |

**Overall: every functional/code acceptance criterion (AC1, AC3–AC10, and AC2's 4 required
artefacts) PASSES on independent re-verification.** One documentation-only, already-self-identified
gap remains open on `tasks/01.04-migrate-protection.md` (unticked checkboxes, no implementation
pointer) — not a code defect, but the task's own tracking file is not yet in the state its
predecessors' convention requires for a fully closed-out `status: done`.
