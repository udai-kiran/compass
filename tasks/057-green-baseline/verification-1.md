# Verification Report — Task 057 Green Baseline

Date: 2026-08-18

## Commands Run and Literal Output

### 1. `git status --short`
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
```
Exit code: 0

### 2. `git diff --stat`
```
apps/api/src/modules/household/routes/settlements.ts          |  5 +++--
apps/api/src/modules/household/routes/splits.ts               | 10 +++++++---
apps/api/src/modules/household/services/grants.ts             |  6 +++---
apps/api/src/modules/household/services/membership.ts         |  2 +-
apps/api/src/modules/planning/services/income-surplus.test.ts |  1 -
apps/web/src/lib/household-queries.ts                         |  1 -
6 files changed, 14 insertions(+), 11 deletions(-)
```

### 3. `git diff` (complete)

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
 import type { HouseholdMember, HouseholdInvite } from "@compass/shared";
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

### 4. `npm run typecheck`
Exit code: **0**

Full output:
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

### 5. `npm run lint`
Exit code: **0**

Output: (no warnings or errors — blank output after the script header)

### 6. `npm run test 2>&1 | tail -60`
Per-workspace summary lines from full run:
```
apps/api:       ℹ tests 735  ℹ pass 709  ℹ fail 25  ℹ skipped 1
apps/extractor: ℹ tests 74   ℹ pass 73   ℹ fail 1
apps/docs:      ℹ tests 12   ℹ pass 12   ℹ fail 0
apps/web:       ℹ tests 270  ℹ pass 270  ℹ fail 0
apps/ai:        ℹ tests 32   ℹ pass 32   ℹ fail 0
packages/shared:ℹ tests 212  ℹ pass 212  ℹ fail 0

TOTAL: 1335 tests, 1308 pass, 26 fail, 1 skipped
```

### 7. `npm ls fast-check`
```
compass@0.1.0 /home/udai/common/compass
└─┬ @compass/api@0.1.0 -> ./apps/api
  └── fast-check@4.9.0
```

### 8. `git diff -- package-lock.json | head -20` and `git diff --stat -- package-lock.json`
```
(no output — empty diff)
```
package-lock.json is UNCHANGED.

### 9. `git diff --stat -- '*package.json'`
```
(no output — empty diff)
```
No package.json files changed.

---

## Answers to Verification Questions

### A. Is `package-lock.json` genuinely UNCHANGED? Is any `package.json` changed?
**YES, package-lock.json is unchanged** — `git diff -- package-lock.json` produces no output.
**NO package.json was changed** — `git diff --stat -- '*package.json'` produces no output.

### B. Is the diff strictly annotation-only?
**YES.** Examining every hunk:

- `settlements.ts`: adds `import type { Settlement }` and changes `toSettlement(row: any): any` → `toSettlement(row: typeof settlements.$inferSelect): Settlement`. The function body is untouched; `?? null` normalisations for `transferTransactionId` and `note` are preserved (body is identical, only signature changed).
- `splits.ts`: adds `import type { HouseholdSplit }`, imports `splits`/`splitShares` (values, not types — correctly not `import type`), changes function signature of `toSplitResponse`, drops `(s: any)` annotation from lambda. No change to returned field set.
- `grants.ts`: adds `SharingResourceType` to existing `import type`, changes `resourceType?: string` to `resourceType?: SharingResourceType`, removes `as any` cast. The `as any` cast removal changes how the Drizzle `eq()` call is type-checked but produces the same runtime expression.
- `membership.ts`: removes unused `gt` from import. Pure import change.
- `income-surplus.test.ts`: removes unused `type IncomeSurplusComputation` import. Pure import change.
- `household-queries.ts`: removes unused `AcceptInviteSchema` import. Pure import change.

**No hunk changes any runtime expression, statement, control flow, or returned field set.**

The `as any` removal in `grants.ts` line 59 is annotation-only: the `eq()` call expression itself is unchanged — only the type cast is removed.

### C. Was `apps/api/src/modules/ledger/services/postings.test.ts` modified?
**NO.** It does not appear in `git status --short` or `git diff --stat`. It was not touched.

### D. Are there any `eslint-disable`, `@ts-ignore`, or `@ts-expect-error` anywhere in the diff?
**NO.** `grep -nE "ts-ignore|ts-expect-error|eslint-disable"` across all 6 touched files returned no output.

### E. Do all new type-only imports use `import type`?
**YES.**
- `import type { Settlement } from "@compass/shared"` in `settlements.ts` — correct.
- `import type { HouseholdSplit } from "@compass/shared"` in `splits.ts` — correct.
- `import type { ..., SharingResourceType } from "@compass/shared"` in `grants.ts` — added to existing `import type` line, correct.
- `splits` and `splitShares` in `splits.ts` are imported as values (`typeof T.$inferSelect` requires the value), not as `import type` — this is correct per the plan.

### F. Test Count Reconciliation

Current: **1335 total, 1308 pass, 26 fail, 1 skipped**

`postings.test.ts` direct run: `ℹ tests 24  ℹ pass 24  ℹ fail 0` — **passes completely**.

`grep -c "^test(\|^  test(" apps/api/src/modules/ledger/services/postings.test.ts` → **24**

The implementer claims +23 (1312 → 1335). Postings.test.ts has 24 tests, not 23. The reconciliation is:
- Before fix: postings.test.ts failed to load → counts as 1 failed test in the total (a file-level failure is 1 entry).
- After fix: postings.test.ts has 24 tests, all pass.
- Net delta: +24 tests added, -1 failed file entry = +23 to total count.
- **1312 + 23 = 1335. Reconciles exactly** when accounting for the file-level failure previously consuming 1 count.

This reconciliation holds: 1312 (old) + 24 (new tests) - 1 (old file-failure entry) = 1335. The implementer's "+23" is correct.

### G. Failing Test Files (26 total) — all DATABASE_URL-gated

**API (25 failures)** — all DATABASE_URL-gated (verified via grep):

| File | Guard line |
|---|---|
| `src/app.test.ts` | line 31: `requireEnv("DATABASE_URL")` |
| `src/modules/automation/routes/automation.route.test.ts` | line 42: `requireEnv("DATABASE_URL")` |
| `src/modules/credit/services/card-due-tasks.test.ts` | line 29-30: `requireDatabaseUrl()` throws if absent |
| `src/modules/credit/services/emis.test.ts` | line 229-230: `requireDatabaseUrl()` |
| `src/modules/credit/services/reconciliation-writes.test.ts` | line 24-25: `requireDatabaseUrl()` |
| `src/modules/credit/services/rewards.test.ts` | line 97-98: `requireDatabaseUrl()` |
| `src/modules/ingest/routes/ingest.route.test.ts` | line 60: `requireEnv("DATABASE_URL")` |
| `src/modules/ingest/services/inbox.test.ts` | line 151-152: `requireDatabaseUrl()` |
| `src/modules/investments/routes/networth.route.test.ts` | line 39: `requireEnv("DATABASE_URL")` |
| `src/modules/investments/services/sip-installments.test.ts` | line 174-175: `requireDatabaseUrl()` |
| `src/modules/ledger/routes/ledger-events.route.test.ts` | line 48: `requireEnv("DATABASE_URL")` |
| `src/modules/ledger/routes/user-tasks.route.test.ts` | line 55: `requireEnv("DATABASE_URL")` |
| `src/modules/ledger/services/epf-contributions.test.ts` | line 24-25: `requireDatabaseUrl()` |
| `src/modules/ledger/services/postings-balance-parity.test.ts` | line 33-34: `requireDatabaseUrl()` |
| `src/modules/ledger/services/postings-pr-e-parity.test.ts` | line 46-47: `requireDatabaseUrl()` |
| `src/modules/ledger/services/reconcile-postings.test.ts` | line 13-14: `requireDatabaseUrl()` |
| `src/modules/ledger/services/recurring.test.ts` | line 37-38: `requireDatabaseUrl()` |
| `src/modules/ledger/services/user-tasks.test.ts` | line 26-27: `requireDatabaseUrl()` |
| `src/modules/planning/routes/planning.route.test.ts` | line 42: `requireEnv("DATABASE_URL")` |
| `src/modules/planning/routes/projection-settings.route.test.ts` | line 40: `requireEnv("DATABASE_URL")` |
| `src/modules/planning/services/postings-planning-parity.test.ts` | line 21-22: `requireDatabaseUrl()` |
| `src/modules/planning/services/projection-settings.test.ts` | line 16-17: `requireDatabaseUrl()` |
| `src/modules/protection/routes/protection.route.test.ts` | line 49: `requireEnv("DATABASE_URL")` |
| `src/modules/system/routes/system.route.test.ts` | line 48: `requireEnv("DATABASE_URL")` |
| `src/modules/system/services/backup.test.ts` | line 337-338: `requireDatabaseUrl()` |

**Extractor (1 failure):**

| File | Guard line |
|---|---|
| `src/statement-duplicate.test.ts` | line 31-32: `requireDatabaseUrl()` throws if absent; line 43: `createPool(requireDatabaseUrl())` |

**Every failing test is DATABASE_URL-gated. No failure is ungated.**

### H. Is `screen-shots/` still untracked and unstaged?
**YES.** `git status --short` shows `?? screen-shots/` — it is untracked and unstaged. It was not committed.

---

## Additional Checks

**fast-check and pure-rand installed:**
- `node_modules/fast-check` exists (lib/, LICENSE, package.json, README.md)
- `node_modules/pure-rand` exists (lib/, LICENSE, package.json, README.md)
- `npm ls fast-check` → `fast-check@4.9.0`

**No `\bany\b` in the four touched household files** — grep returned no output.

**AC5 discrepancy note:** The task's AC5 says "Total test count stays 1312" but the actual total is now 1335. This is because `postings.test.ts` failing to load previously kept its 24 tests out of the count; now they are counted. The task text is contradictory (AC5 says "stays 1312" but also describes a post-fix pass/fail split that implies 26 failures). The actual result (1335 total, 26 fail, 1308 pass) matches the net expected behavior described in AC5's invariant: `postings.test.ts` moved from fail-to-load to fully passing, and all remaining failures are DB-gated. There are 26 failing tests, not the ~26 predicted (matches exactly).

---

## Summary Verdict

All acceptance criteria are met:
- **AC1**: typecheck exits 0 (all 7 workspaces clean) ✓
- **AC2**: lint exits 0 (0 errors, 0 warnings) ✓
- **AC3**: No `any` remaining in household files; no suppression directives used ✓
- **AC4**: postings.test.ts passes with 24 tests (including fast-check property tests) ✓
- **AC5**: 26 failing tests, all DB-gated; postings.test.ts no longer fails ✓
- **AC6**: Diff is annotation-only; no runtime expressions changed ✓
- **AC7**: package-lock.json and all package.json files unchanged ✓
