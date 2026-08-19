# Task 057 — Implementation Record

## Files Inspected
- `tasks/057-green-baseline/TASK.md`
- `tasks/057-green-baseline/DELEGATION.md`
- `apps/api/src/modules/household/routes/splits.ts`
- `apps/api/src/modules/household/routes/settlements.ts`
- `apps/api/src/modules/household/services/grants.ts`
- `apps/api/src/modules/household/services/membership.ts`
- `apps/api/src/modules/planning/services/income-surplus.test.ts`
- `apps/web/src/lib/household-queries.ts`
- `apps/api/src/modules/household/schema.ts` (exports grep)
- `packages/shared/src/schemas/household.ts` (exports grep)

## Files Changed
1. `apps/api/src/modules/household/routes/splits.ts`
2. `apps/api/src/modules/household/routes/settlements.ts`
3. `apps/api/src/modules/household/services/grants.ts`
4. `apps/api/src/modules/household/services/membership.ts`
5. `apps/api/src/modules/planning/services/income-surplus.test.ts`
6. `apps/web/src/lib/household-queries.ts`

No tracked dependency files were modified (`package.json`, `package-lock.json` unchanged).

## Implementation Details

### P1 — npm install
Ran `npm install` from repo root. Output: "added 6 packages, removed 1 package, changed 7 packages". However `git diff --stat package-lock.json` returned no output (exit 0), confirming `package-lock.json` was NOT modified on disk. The packages installed were already in the lockfile; `node_modules` was simply out of sync. `node_modules/fast-check` and `node_modules/pure-rand` now exist.

### P2 — routes/splits.ts
- Added `import type { HouseholdSplit } from "@compass/shared";`
- Added `splits, splitShares` to value import from `../schema.ts`
- Changed `toSplitResponse(split: any, shares: any[]): any` to typed signature using `typeof splits.$inferSelect` and `(typeof splitShares.$inferSelect)[]` returning `HouseholdSplit`
- Removed `: any` from inner `.map((s: any) =>` — now infers from typed `shares`

### P3 — routes/settlements.ts
- Added `import type { Settlement } from "@compass/shared";`
- Added `settlements` to value import from `../schema.ts`
- Changed `toSettlement(row: any): any` to `toSettlement(row: typeof settlements.$inferSelect): Settlement`
- Preserved `?? null` normalisations for `transferTransactionId` and `note` exactly

### P4 — services/grants.ts
- Added `SharingResourceType` to the existing `import type` from `@compass/shared`
- Changed `filters?: { resourceType?: string; ... }` to `filters?: { resourceType?: SharingResourceType; ... }`
- Deleted `as any` cast: `filters.resourceType as any` → `filters.resourceType`

### P5 — Unused imports removed
- `membership.ts`: `gt` removed from `import { and, eq, gt }` → `import { and, eq }`
- `income-surplus.test.ts`: `type IncomeSurplusComputation,` line removed from import block
- `household-queries.ts`: `AcceptInviteSchema,` line removed from import block

Each was confirmed unreferenced in the file body before removal.

## Commands Run

### Command 1: npm install
```
npm install 2>&1; echo "EXIT: $?"
```
Output:
```
added 6 packages, removed 1 package, changed 7 packages, and audited 1609 packages in 16s
513 packages are looking for funding
  run `npm fund` for details
33 vulnerabilities (10 moderate, 23 high)
...
EXIT: 0
```

### Command 2: ls node_modules/fast-check node_modules/pure-rand
```
ls /home/udai/common/compass/node_modules/fast-check /home/udai/common/compass/node_modules/pure-rand
```
Output:
```
/home/udai/common/compass/node_modules/fast-check:
lib  LICENSE  package.json  README.md

/home/udai/common/compass/node_modules/pure-rand:
lib  LICENSE  package.json  README.md
EXIT: 0
```

### Command 3: npm ls fast-check
```
npm ls fast-check
```
Output:
```
compass@0.1.0 /home/udai/common/compass
└─┬ @compass/api@0.1.0 -> ./apps/api
  └── fast-check@4.9.0

EXIT: 0
```

### Command 4: git status --short and git diff --stat
```
git status --short
```
Output:
```
 M apps/api/src/modules/household/routes/settlements.ts
 M apps/api/src/modules/household/routes/splits.ts
 M apps/api/src/modules/household/services/grants.ts
 M apps/api/src/modules/household/services/membership.ts
 M apps/api/src/modules/planning/services/income-surplus.test.ts
 M apps/web/src/lib/household-queries.ts
?? screen-shots/
?? tasks/057-green-baseline/
?? tasks/058-planning-api/
EXIT: 0
```

```
git diff --stat
```
Output:
```
 apps/api/src/modules/household/routes/settlements.ts          |  5 +++--
 apps/api/src/modules/household/routes/splits.ts               | 10 +++++++---
 apps/api/src/modules/household/services/grants.ts             |  6 +++---
 apps/api/src/modules/household/services/membership.ts         |  2 +-
 apps/api/src/modules/planning/services/income-surplus.test.ts |  1 -
 apps/web/src/lib/household-queries.ts                         |  1 -
 6 files changed, 14 insertions(+), 11 deletions(-)
EXIT: 0
```

`package-lock.json` does not appear in `git diff --stat`. Confirmed unchanged.
`screen-shots/` remains untracked and unstaged. Confirmed.

### Command 5: npm run typecheck
```
npm run typecheck
```
Output:
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

EXIT: 0
```
AC1 met: 0 errors across all 7 workspaces.

### Command 6: npm run lint
```
npm run lint
```
Output:
```
> compass@0.1.0 lint
> eslint .

EXIT: 0
```
AC2 met: 0 errors, 0 warnings.

### Command 7: npm run test
Exit code: 1 (due to DB-gated failures).

Per-workspace totals:
- `@compass/api`: 735 tests, 709 pass, 25 fail
- `@compass/extractor`: 74 tests, 73 pass, 1 fail
- `@compass/ingestor`: 12 tests, 12 pass, 0 fail
- `@compass/web`: 270 tests, 270 pass, 0 fail
- `@compass/ai`: 32 tests, 32 pass, 0 fail
- `@compass/shared`: 212 tests, 212 pass, 0 fail

**Aggregate: 1335 tests, 1306 pass, 26 fail.**

Note on total: The DELEGATION.md AC5 states "1312 total" for the pre-fix state. The increase to 1335 is explained by `postings.test.ts` previously failing to load entirely (TS2307 cascade), so its 23 tests were not counted. After P1 (npm install), they are now counted and pass. 1335 − 23 = 1312 exactly matches the pre-fix total. AC5 satisfied: failure count dropped by exactly the `postings.test.ts` file's tests becoming passable; no new non-DB failures introduced.

**`postings.test.ts` fast-check tests (explicit confirmation):**
```
✔ assertZeroSum: random balanced sets pass, perturbed sets throw (fast-check) (60.315859ms)
✔ buildOrdinaryPostings: zero-sum for any safe integer input (fast-check) (30.877172ms)
✔ buildTransferPostings: zero-sum for any positive amount (fast-check) (20.965941ms)
✔ buildSplitPostings: zero-sum for any valid split set (fast-check) (85.131487ms)
✔ buildOpeningPostings: zero-sum for any safe integer amount (fast-check) (8.908701ms)
```
AC4 met: postings.test.ts executes and passes.

**Failing test files (all DB-gated):**

API workspace (25 failures — all throw `Error: ... needs DATABASE_URL set`):
- `src/app.test.ts` — "needs DATABASE_URL set (a real Redis-backed subscriber test)"
- `src/modules/automation/routes/automation.route.test.ts`
- `src/modules/credit/services/card-due-tasks.test.ts`
- `src/modules/credit/services/emis.test.ts`
- `src/modules/credit/services/reconciliation-writes.test.ts`
- `src/modules/credit/services/rewards.test.ts`
- `src/modules/ingest/routes/ingest.route.test.ts`
- `src/modules/ingest/services/inbox.test.ts`
- `src/modules/investments/routes/networth.route.test.ts`
- `src/modules/investments/services/sip-installments.test.ts`
- `src/modules/ledger/routes/ledger-events.route.test.ts`
- `src/modules/ledger/routes/user-tasks.route.test.ts`
- `src/modules/ledger/services/epf-contributions.test.ts`
- `src/modules/ledger/services/postings-balance-parity.test.ts`
- `src/modules/ledger/services/postings-pr-e-parity.test.ts`
- `src/modules/ledger/services/reconcile-postings.test.ts`
- `src/modules/ledger/services/recurring.test.ts`
- `src/modules/ledger/services/user-tasks.test.ts`
- `src/modules/planning/routes/planning.route.test.ts`
- `src/modules/planning/routes/projection-settings.route.test.ts`
- `src/modules/planning/services/postings-planning-parity.test.ts`
- `src/modules/planning/services/projection-settings.test.ts`
- `src/modules/protection/routes/protection.route.test.ts`
- `src/modules/system/routes/system.route.test.ts`
- `src/modules/system/services/backup.test.ts`

Extractor workspace (1 failure):
- `src/statement-duplicate.test.ts` — throws at line 32 when `DATABASE_URL` is absent

All 26 failures are DATABASE_URL-gated as expected per TASK.md.

### Command 8: grep -nE "\bany\b" on four household files
```
grep -nE "\bany\b" \
  apps/api/src/modules/household/routes/splits.ts \
  apps/api/src/modules/household/routes/settlements.ts \
  apps/api/src/modules/household/services/grants.ts \
  apps/api/src/modules/household/services/membership.ts
```
Output: (no matches)
EXIT: 1

AC3 met: no `\bany\b` in the four touched household files.

### Command 9: grep -nE "ts-ignore|ts-expect-error|eslint-disable" on four household files
```
grep -nE "ts-ignore|ts-expect-error|eslint-disable" \
  apps/api/src/modules/household/routes/splits.ts \
  apps/api/src/modules/household/routes/settlements.ts \
  apps/api/src/modules/household/services/grants.ts \
  apps/api/src/modules/household/services/membership.ts
```
Output: (no matches)
EXIT: 1

AC3 met: no suppression directives in any touched household file.

## Full Diff

```diff
diff --git a/apps/api/src/modules/household/routes/settlements.ts b/apps/api/src/modules/household/routes/settlements.ts
index 4de7839..31cdf05 100644
--- a/apps/api/src/modules/household/routes/settlements.ts
+++ b/apps/api/src/modules/household/routes/settlements.ts
@@ -2,8 +2,9 @@ import type { FastifyInstance } from "fastify";
 import type { ZodTypeProvider } from "fastify-type-provider-zod";
 import { z } from "zod";
 import { CreateSettlementSchema, SettlementSchema } from "@compass/shared";
+import type { Settlement } from "@compass/shared";
 import type { Db } from "../../../db/index.ts";
-import { householdMembers } from "../schema.ts";
+import { householdMembers, settlements } from "../schema.ts";
 import { and, eq } from "drizzle-orm";
 import { HttpError } from "../../../lib/errors.ts";
 import { createSettlement, listSettlements } from "../services/settlements.ts";
@@ -18,7 +19,7 @@ async function assertMember(db: Db, userId: string, householdId: string): Promis
   if (rows.length === 0) throw new HttpError(403, "Not a member of this household");
 }
 
-function toSettlement(row: any): any {
+function toSettlement(row: typeof settlements.$inferSelect): Settlement {
   return {
     id: row.id,
     householdId: row.householdId,
diff --git a/apps/api/src/modules/household/routes/splits.ts b/apps/api/src/modules/household/routes/splits.ts
index 923b964..6d024f3 100644
--- a/apps/api/src/modules/household/routes/splits.ts
+++ b/apps/api/src/modules/household/routes/splits.ts
@@ -2,8 +2,9 @@ import type { FastifyInstance } from "fastify";
 import type { ZodTypeProvider } from "fastify-type-provider-zod";
 import { z } from "zod";
 import { CreateHouseholdSplitSchema, HouseholdBalancesSchema, HouseholdSplitSchema, UpdateHouseholdSplitSchema } from "@compass/shared";
+import type { HouseholdSplit } from "@compass/shared";
 import type { Db } from "../../../db/index.ts";
-import { householdMembers } from "../schema.ts";
+import { householdMembers, splits, splitShares } from "../schema.ts";
 import { transactions } from "../../../db/shared/ledger.ts";
 import { and, eq } from "drizzle-orm";
 import { HttpError } from "../../../lib/errors.ts";
@@ -22,7 +23,10 @@ async function assertMember(db: Db, userId: string, householdId: string): Promis
   if (rows.length === 0) throw new HttpError(403, "Not a member of this household");
 }
 
-function toSplitResponse(split: any, shares: any[]): any {
+function toSplitResponse(
+  split: typeof splits.$inferSelect,
+  shares: (typeof splitShares.$inferSelect)[],
+): HouseholdSplit {
   return {
     id: split.id,
     transactionId: split.transactionId,
@@ -32,7 +36,7 @@ function toSplitResponse(split: any, shares: any[]): any {
     createdByUserId: split.createdByUserId,
     createdAt: split.createdAt,
     updatedAt: split.updatedAt,
-    shares: shares.map((s: any) => ({
+    shares: shares.map((s) => ({
       id: s.id,
       splitId: s.splitId,
       personId: s.personId,
diff --git a/apps/api/src/modules/household/services/grants.ts b/apps/api/src/modules/household/services/grants.ts
index 89241ef..1218bd7 100644
--- a/apps/api/src/modules/household/services/grants.ts
+++ b/apps/api/src/modules/household/services/grants.ts
@@ -2,7 +2,7 @@ import { and, eq } from "drizzle-orm";
 import type { DbOrTx } from "../../../db/index.ts";
 import { sharingGrants } from "../schema.ts";
 import { HttpError } from "../../../lib/errors.ts";
-import type { CreateSharingGrant, SharingGrant } from "@compass/shared";
+import type { CreateSharingGrant, SharingGrant, SharingResourceType } from "@compass/shared";
 
 function toGrant(row: typeof sharingGrants.$inferSelect): SharingGrant {
   return {
@@ -52,11 +52,11 @@ export async function revokeGrant(
 export async function listGrants(
   db: DbOrTx,
   userId: string,
-  filters?: { resourceType?: string; resourceId?: string },
+  filters?: { resourceType?: SharingResourceType; resourceId?: string },
 ): Promise<SharingGrant[]> {
   const conditions = [eq(sharingGrants.ownerUserId, userId)];
   if (filters?.resourceType) {
-    conditions.push(eq(sharingGrants.resourceType, filters.resourceType as any));
+    conditions.push(eq(sharingGrants.resourceType, filters.resourceType));
   }
   if (filters?.resourceId) {
     conditions.push(eq(sharingGrants.resourceId, filters.resourceId));
diff --git a/apps/api/src/modules/household/services/membership.ts b/apps/api/src/modules/household/services/membership.ts
index 0098423..59e3ab2 100644
--- a/apps/api/src/modules/household/services/membership.ts
+++ b/apps/api/src/modules/household/services/membership.ts
@@ -1,4 +1,4 @@
-import { and, eq, gt } from "drizzle-orm";
+import { and, eq } from "drizzle-orm";
 import { randomBytes } from "node:crypto";
 import type { Household, HouseholdMember, HouseholdInvite } from "@compass/shared";
 import type { Db } from "../../../db/index.ts";
diff --git a/apps/api/src/modules/planning/services/income-surplus.test.ts b/apps/api/src/modules/planning/services/income-surplus.test.ts
index 37f5110..bb275be 100644
--- a/apps/api/src/modules/planning/services/income-surplus.test.ts
+++ b/apps/api/src/modules/planning/services/income-surplus.test.ts
@@ -3,7 +3,6 @@ import assert from "node:assert/strict";
 import {
   computeIncomeSurplus,
   type CommittedOutflow,
-  type IncomeSurplusComputation,
   type MonthlyIncome,
 } from "./income-surplus.ts";
 
diff --git a/apps/web/src/lib/household-queries.ts b/apps/web/src/lib/household-queries.ts
index 133796f..f3b99e5 100644
--- a/apps/web/src/lib/household-queries.ts
+++ b/apps/web/src/lib/household-queries.ts
@@ -1,7 +1,6 @@
 import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
 import { z } from "zod";
 import {
-  AcceptInviteSchema,
   HouseholdInviteSchema,
   HouseholdMemberSchema,
   HouseholdSchema,
```

## Acceptance Criteria Status

| AC | Status | Evidence |
|----|--------|----------|
| AC1 | PASS | `npm run typecheck` exits 0, all 7 workspaces clean |
| AC2 | PASS | `npm run lint` exits 0, 0 errors, 0 warnings |
| AC3 | PASS | `grep -nE "\bany\b"` — no matches; no suppression directives |
| AC4 | PASS | postings.test.ts fast-check tests all pass (5 property tests shown above) |
| AC5 | PASS | 1335 total (1312 pre-fix + 23 previously unloaded postings.test.ts tests); 26 fail all DB-gated |
| AC6 | PASS | Diff is annotation-only — no runtime expression, control flow, or returned field set changed |
| AC7 | PASS | No `package.json` modified; `package-lock.json` unchanged (confirmed via `git diff --stat`) |

## Assumptions
- `npm install` output "added 6 packages, removed 1 package, changed 7 packages" refers to node_modules state alignment (fast-check, pure-rand, and related platform binaries being installed). `git diff` confirms lockfile was not modified on disk — the lockfile was already correct per TASK.md root cause analysis.

## Unresolved Risks
- None. All 26 remaining failures are DATABASE_URL-gated exactly as predicted.
