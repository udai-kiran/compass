---
status: read-only assessment (no code changed by this pass)
---

# Slice 1 partial-application assessment — 014-migrate-planning

Scope: read-only inventory of the working tree after an implementation tool exited
1 mid-way through Iteration 2 / Slice 1 of `tasks/014-migrate-planning/DELEGATION.md`.
No files were edited, staged, committed, or reverted by this assessment. No test
suite was run (typecheck already fails; brief explicitly said skip it — see note
at the end).

`tasks/014-migrate-planning/DELEGATION.md`, section "Iteration 2 — Slice 1" (lines
154–230), was read in full before starting and is the spec this report is checked
against.

---

## 1. `git status --porcelain` (full) and `git status --porcelain -M`

Both commands produced **identical** output — git's rename heuristic did not fire.
This is expected git behaviour, not a defect: `git status` only pairs a deletion
with an addition as a detected rename when both sides are tracked (staged or
previously committed); here the "new" files are untracked (`??`), so no D/A pair
is eligible for rename pairing regardless of the `-M`/`--find-renames` flag.

```
 M CLAUDE.md
 M apps/api/src/db/schema.ts
 M apps/api/src/modules/ledger/schema.ts
 M apps/api/src/modules/planning/schema.ts
 M apps/api/src/modules/planning/services/projection-settings.ts
 D apps/api/src/routes/budgets.ts
 D apps/api/src/routes/goals.ts
 D apps/api/src/services/budgets.ts
 D apps/api/src/services/goal-allocation.test.ts
 D apps/api/src/services/goal-allocation.ts
 D apps/api/src/services/goal-plan.test.ts
 D apps/api/src/services/goal-plan.ts
 D apps/api/src/services/goal-projection.test.ts
 D apps/api/src/services/goal-projection.ts
 D apps/api/src/services/goal-returns.test.ts
 D apps/api/src/services/goal-returns.ts
 D apps/api/src/services/goals.ts
?? apps/api/src/modules/planning/routes/budgets.ts
?? apps/api/src/modules/planning/routes/goals.ts
?? apps/api/src/modules/planning/schema.smoke.test.ts
?? apps/api/src/modules/planning/services/budgets.ts
?? apps/api/src/modules/planning/services/goal-allocation.test.ts
?? apps/api/src/modules/planning/services/goal-allocation.ts
?? apps/api/src/modules/planning/services/goal-plan.test.ts
?? apps/api/src/modules/planning/services/goal-plan.ts
?? apps/api/src/modules/planning/services/goal-projection.test.ts
?? apps/api/src/modules/planning/services/goal-projection.ts
?? apps/api/src/modules/planning/services/goal-returns.test.ts
?? apps/api/src/modules/planning/services/goal-returns.ts
?? apps/api/src/modules/planning/services/goals.ts
?? tasks/013-release-v1.97.0/commit-pr-final.md
?? tasks/014-migrate-planning/
```

(`git status --porcelain -M` gave byte-identical output to the above; also
cross-checked with `git status --find-renames=30% --porcelain`, same result.)

Note: `tasks/013-release-v1.97.0/commit-pr-final.md` and `tasks/014-migrate-planning/`
are pre-existing untracked task-doc artifacts, unrelated to this code slice —
listed here for completeness per "full" `git status`, not implicated in the break.

**Also observed but NOT part of `git status`** (git doesn't diff untracked
against deleted-tracked): the 5 outside-importer files the slice was supposed to
repoint (`apps/api/src/app.ts`, `apps/api/src/services/notifications.ts`,
`apps/api/src/services/autopilot.ts`, `apps/api/src/services/ai/tools.ts`,
`apps/api/src/modules/investments/services/sip-commitments.ts`) show **zero**
git-status entries — i.e. **none of them were touched at all**. See §5.

---

## 2. Complete `git diff -M`, plus content of every untracked file

`git diff -M` only ever diffs indexed/tracked paths, so it shows the 5 modified
files in full and the 12 deleted files' full removed content — it does **not**
include the untracked new files (git diff never shows untracked files, `-M` or
not). I captured it to a scratch file and confirmed: `grep -c "^diff --git"` = 17
(5 modified + 12 deleted), 2125 lines total. I then read every untracked file
directly via the Read tool. Both are reproduced below.

### 2a. `git diff -M` — the 5 modified + 12 deleted tracked files

```diff
diff --git a/CLAUDE.md b/CLAUDE.md
index 00ccb50..b7b119a 100644
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -46,7 +46,7 @@ node --test apps/api/src/services/capital-gains.test.ts
 - **`plugins/auth.ts`** — Redis-backed sessions (argon2 password hash, signed httpOnly SameSite=Lax cookie). It also holds the **single demo-mode chokepoint**: a demo session is rejected on any mutating HTTP method (`MUTATING_METHODS`), so seeded demo data is immutable and every new POST/PATCH/DELETE route is demo-safe automatically.
 - **`plugins/security.ts`** — hand-rolled (deliberately no `@fastify/helmet`/`rate-limit`/`csrf`): security headers, **CSRF via Origin check** on state-changing requests, and Redis fixed-window rate-limit buckets (`AUTH_BUCKET` etc.).
 - **Jobs:** BullMQ on Redis, started in `jobs/index.ts` (`startJobs`). Config is validated at boot in `config.ts` (Zod) — add new env vars there.
-- **Transitional module scaffold:** `modules/<domain>/` (`schema.ts`, `services/`, `routes/`, `plugin.ts`) is starting to replace the flat `services/x.ts`/`routes/x.ts` layout, one domain at a time (Phase 1 of the roadmap). `app.ts` registers a module's `plugin.ts`, not its routes directly. `db/schema.ts` stays the schema barrel — it re-exports each module's `schema.ts` — and both it and every `modules/<domain>/schema.ts` import shared identity tables from `db/core-schema.ts` (currently just `users`), a deliberately narrow, cycle-free leaf — **not** a general destination for every cross-module foreign key.
+- **Transitional module scaffold:** `modules/<domain>/` (`schema.ts`, `services/`, `routes/`, `plugin.ts`) is starting to replace the flat `services/x.ts`/`routes/x.ts` layout, one domain at a time (Phase 1 of the roadmap). `app.ts` registers a module's `plugin.ts`, not its routes directly. `db/schema.ts` holds every `pgTable()`/`pgEnum()` definition and is the single Drizzle Kit entry point; each `modules/<domain>/schema.ts` is a thin named re-export of that domain's tables, so module code imports tables from `../schema.ts` rather than reaching into the barrel. `db/schema.ts` imports shared identity tables from `db/core-schema.ts` (currently just `users`), a deliberately narrow, cycle-free leaf — **not** a general destination for every cross-module foreign key. Task 1.9 converts these thin re-export surfaces into physical per-module ownership.
 
 ### Money & domain rules
 - **Money is always integer paise** (minor units) end to end — never float rupees. Use `packages/shared/src/money.ts` (`rupeesToPaise`, `formatINR`, `standardEmiPaise`). Formatting is `en-IN` INR.
diff --git a/apps/api/src/db/schema.ts b/apps/api/src/db/schema.ts
index 3e77f46..bc74574 100644
--- a/apps/api/src/db/schema.ts
+++ b/apps/api/src/db/schema.ts
@@ -19,8 +19,6 @@ import {
 } from "drizzle-orm/pg-core";
 import { users } from "./core-schema.ts";
 export { users } from "./core-schema.ts";
-export * from "../modules/planning/schema.ts";
-
 /**
  * Schema conventions:
  * - ids: uuid, generated by Postgres
@@ -29,10 +27,11 @@ export * from "../modules/planning/schema.ts";
  * - timestamps: timestamptz, created_at/updated_at on every table
  * - soft delete / archive: *_at nullable timestamptz
  *
- * `users` lives in `./core-schema.ts` (a cycle-free leaf) and `projectionSettings`
- * lives in `../modules/planning/schema.ts` — both re-exported from this barrel.
- * See `modules/<domain>/` for the emerging module-scaffold convention that
- * later Phase-1 tasks will extend to the rest of these tables.
+ * `users` lives in `./core-schema.ts` (a cycle-free leaf), re-exported from this barrel.
+ * Every `pgTable()`/`pgEnum()` definition lives here — the single Drizzle Kit entry point.
+ * Each `modules/<domain>/schema.ts` is a thin named re-export of its domain's tables,
+ * so module code imports from `../schema.ts`. Task 1.9 converts these thin surfaces
+ * into physical ownership.
  */
 
 /** Per-user profile information. */
@@ -746,6 +745,17 @@ export const subscriptionDismissals = pgTable(
   (t) => [uniqueIndex("subscription_dismissals_unique_idx").on(t.userId, t.merchant)],
 );
 
+/** Per-user assumptions used only for forward-looking goal projections. */
+export const projectionSettings = pgTable("projection_settings", {
+  userId: uuid("user_id")
+    .primaryKey()
+    .references(() => users.id, { onDelete: "cascade" }),
+  /** Broad-equity annual return assumption (1200 = 12%). */
+  equityReturnBps: integer("equity_return_bps").notNull().default(1200),
+  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
+  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
+});
+
 export const notificationPrefs = pgTable(
   "notification_prefs",
   {
diff --git a/apps/api/src/modules/ledger/schema.ts b/apps/api/src/modules/ledger/schema.ts
index 0183857..da26f4e 100644
--- a/apps/api/src/modules/ledger/schema.ts
+++ b/apps/api/src/modules/ledger/schema.ts
@@ -6,10 +6,9 @@
  * outbound FKs to still-flat tables (goals, insurance_policies, sips,
  * statement_reconciliations) and 23 inbound FK columns from still-flat tables
  * into these 11, so physically relocating the table definitions here would
- * create a genuine bidirectional ES-module cycle with `db/schema.ts` (unlike
- * task 0.3's single-table `projection_settings` case). Table definitions stay
- * in `db/schema.ts`, unmoved, until task 1.9's cross-module FK-graph/SCC work
- * decides a final, acyclic home for each one.
+ * create a genuine bidirectional ES-module cycle with `db/schema.ts`. Table
+ * definitions stay in `db/schema.ts`, unmoved, until task 1.9's cross-module
+ * FK-graph/SCC work decides a final, acyclic home for each one.
  *
  * Services/routes inside `modules/ledger/` import table objects from this
  * local file (never reaching into `../../db/schema.ts` directly for
@@ -18,11 +17,9 @@
  * to change this one file, not every service/route that already imports from
  * `./schema.ts`.
  *
- * `db/schema.ts` does NOT `export *` back from this file — unlike
- * `projection_settings` (a single-owner table where the barrel genuinely
- * needs the module's only copy), the ledger tables' only home is still
- * `db/schema.ts` itself, so the reverse direction would just recreate a
- * pointless cycle.
+ * `db/schema.ts` does NOT `export *` back from this file — the ledger tables'
+ * only home is still `db/schema.ts` itself, so the reverse direction would
+ * just recreate a pointless cycle (same reasoning as all five modules).
  */
 export {
   accounts,
diff --git a/apps/api/src/modules/planning/schema.ts b/apps/api/src/modules/planning/schema.ts
index dc6d429..1d6018c 100644
--- a/apps/api/src/modules/planning/schema.ts
+++ b/apps/api/src/modules/planning/schema.ts
@@ -1,13 +1,33 @@
-import { integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
-import { users } from "../../db/core-schema.ts";
-
-/** Per-user assumptions used only for forward-looking goal projections. */
-export const projectionSettings = pgTable("projection_settings", {
-  userId: uuid("user_id")
-    .primaryKey()
-    .references(() => users.id, { onDelete: "cascade" }),
-  /** Broad-equity annual return assumption (1200 = 12%). */
-  equityReturnBps: integer("equity_return_bps").notNull().default(1200),
-  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
-  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
-});
+/**
+ * Thin, named re-export of the planning domain's 6 tables + 2 owned enums.
+ *
+ * This is deliberately NOT where the `pgTable()`/`pgEnum()` calls live —
+ * planning is now uniform with the other four modules (ledger, credit,
+ * investments, protection). `goals.id` has inbound FKs from `accounts`,
+ * `holdings` and `sips`; `budget_lines`/`budget_alerts` have outbound FKs
+ * to `categories`. Physically relocating the table definitions here would
+ * create a genuine cross-file ES-module cycle with `db/schema.ts`. Table
+ * definitions stay in `db/schema.ts`, unmoved, until task 1.9's cross-module
+ * FK-graph/SCC work decides a final, acyclic home for each one.
+ *
+ * Services/routes inside `modules/planning/` import table objects from this
+ * local file (never reaching into `../../db/schema.ts` directly for
+ * planning-owned tables) — this is the module-boundary discipline that matters:
+ * it costs nothing today and means a future physical decomposition only has
+ * to change this one file, not every service/route that already imports from
+ * `./schema.ts`.
+ *
+ * `db/schema.ts` does NOT `export *` back from this file — the planning tables'
+ * only home is still `db/schema.ts` itself, so the reverse direction would
+ * just recreate a pointless cycle (same reasoning as the other four modules).
+ */
+export {
+  budgets,
+  budgetLines,
+  budgetAlerts,
+  goals,
+  subscriptionDismissals,
+  projectionSettings,
+  budgetPeriod,
+  goalType,
+} from "../../db/schema.ts";
diff --git a/apps/api/src/modules/planning/services/projection-settings.ts b/apps/api/src/modules/planning/services/projection-settings.ts
index 0aaf1ef..6429474 100644
--- a/apps/api/src/modules/planning/services/projection-settings.ts
+++ b/apps/api/src/modules/planning/services/projection-settings.ts
@@ -3,7 +3,7 @@ import type { ProjectionSettings, UpdateProjectionSettings } from "@compass/shar
 import { UpdateProjectionSettingsSchema } from "@compass/shared";
 import type { Db } from "../../../db/index.ts";
 import { projectionSettings } from "../schema.ts";
-import { DEFAULT_EQUITY_RETURN_BPS } from "../../../services/goal-returns.ts";
+import { DEFAULT_EQUITY_RETURN_BPS } from "./goal-returns.ts";
 
 export async function getProjectionSettings(db: Db, userId: string): Promise<ProjectionSettings> {
   const row = await db.query.projectionSettings.findFirst({
```

**IMPORTANT — this section (`CLAUDE.md`, `db/schema.ts`, `modules/ledger/schema.ts`,
`modules/planning/schema.ts`, `modules/planning/services/projection-settings.ts`)
is entirely Iteration-1/Slice-0 (D1 schema relocation) content, already landed
and matching the DELEGATION.md Slice-0 spec** (`projectionSettings` moved
into `db/schema.ts` right after `subscriptionDismissals`, the `export *` line
deleted, `modules/planning/schema.ts` rewritten as a thin re-export, doc
comments updated in ledger/schema.ts and db/schema.ts, and the intra-module
rewrite in `projection-settings.ts` per Slice-1's rule 4). This is *not* new
damage from the interrupted Slice-1 run — it was already committed-clean state
before Slice 1 started, per the diff being against `HEAD`.

The remaining 12 diff hunks in `git diff -M` are the **full deleted content**
of the 12 old flat files (`apps/api/src/routes/budgets.ts`, `routes/goals.ts`,
`services/budgets.ts`, `services/goal-allocation.ts` (+`.test.ts`),
`services/goal-plan.ts` (+`.test.ts`), `services/goal-projection.ts`
(+`.test.ts`), `services/goal-returns.ts` (+`.test.ts`), `services/goals.ts`).
Total 2125-line diff was captured verbatim to
`/tmp/claude-1001/.../scratchpad/slice1.diff`; omitted here for length since
§2b below reproduces the *current* (moved) content of every one of those files
and a line-by-line comparison (done manually, see §6) confirms **byte-identical
bodies except import lines** — i.e. no logic delta, consistent with the
"import-line-only" AC. The full raw diff is available on request; I did not
truncate it silently, I am summarizing purely to avoid repeating ~2000 lines
of code that is reproduced in full below under its new path.

### 2b. Untracked files — full content of all 13 new files

13, not 12: `apps/api/src/modules/planning/schema.smoke.test.ts` is also
untracked, but that is the Slice-0 smoke test (P2), not one of Slice 1's 12
moves — included here for completeness since the brief asked for "content of
any untracked file."

#### `apps/api/src/modules/planning/services/budgets.ts` (new path; was `apps/api/src/services/budgets.ts`)
```ts
import { and, eq } from "drizzle-orm";
import type {
  Budget,
  BudgetComparison,
  BudgetPeriod,
  BudgetUtilization,
  CreateBudget,
  UtilizationLine,
} from "@compass/shared";
import { CreateBudgetSchema } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { budgetLines, budgets } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { assertOwnedCategory } from "../../../services/ownership.ts";
import { currentPeriodKey, periodRange, prevPeriodKey, spentByCategory } from "../../../services/periods.ts";

/** Past periods are closed: viewable with their then-current budget, never editable. */
export function isClosed(period: BudgetPeriod, key: string): boolean {
  return key < currentPeriodKey(period);
}
... [body identical to the deleted apps/api/src/services/budgets.ts, 286 lines
     of logic unchanged — verified line-for-line against the git-diff deletion
     in §2a; only the 4 import lines differ, per §6 below] ...
```
(Full body reproduced verbatim in the Read-tool transcript of this session;
omitted here beyond the import block since the rest is byte-identical to the
deleted file already shown in §2a — see §6 for the import-line diff table.)

The same applies to the other 11 moved files
(`modules/planning/services/goals.ts`, `goal-allocation.ts` (+`.test.ts`),
`goal-plan.ts` (+`.test.ts`), `goal-projection.ts` (+`.test.ts`),
`goal-returns.ts` (+`.test.ts`), `modules/planning/routes/budgets.ts`,
`modules/planning/routes/goals.ts`): each was read in full and its non-import
body is byte-identical to the corresponding deleted file in §2a; only the
import lines changed. §6 below is the exhaustive import-line accounting the
brief specifically asked for, so it is not repeated a third time here.

`apps/api/src/modules/planning/schema.smoke.test.ts` (new, not a move — Slice-0's
P2 smoke test) — full content:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";
import { createDb } from "../../db/index.ts";
import * as barrel from "../../db/schema.ts";
import * as planningSchema from "./schema.ts";

const TABLE_NAMES: Record<string, string> = {
  budgets: "budgets",
  budgetLines: "budget_lines",
  budgetAlerts: "budget_alerts",
  goals: "goals",
  subscriptionDismissals: "subscription_dismissals",
  projectionSettings: "projection_settings",
} as const;

const ENUM_NAMES = ["budgetPeriod", "goalType"] as const;

test("modules/planning/schema.ts re-exports the same 6 table objects as db/schema.ts with correct SQL names", () => { ... });
test("modules/planning/schema.ts re-exports the same 2 owned enum objects as db/schema.ts", () => { ... });
test("a real createDb() instance (non-connecting stub pool) exposes db.query for all 6 planning tables at runtime", () => { ... });
```
(3 `test()` cases, matching the Slice-0 AC of "exactly 3 test() cases" — full
body was read and matches the pattern in `db/schema.smoke.test.ts:34-53`.)

---

## 3. `npm run typecheck` — full literal output and exit code

Command: `npm run typecheck` (repo root). Ran twice: once piped through `tee`
(exit code of that pipeline is `tee`'s, not npm's — noted for transparency),
then again with output redirected directly so the true exit code was captured.

**Exit code: 2**

Full literal output:
```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present


> @compass/api@0.1.0 typecheck
> tsc --noEmit

src/app.ts(23,30): error TS2307: Cannot find module './routes/budgets.ts' or its corresponding type declarations.
src/app.ts(26,28): error TS2307: Cannot find module './routes/goals.ts' or its corresponding type declarations.
src/modules/investments/services/sip-commitments.ts(6,90): error TS2307: Cannot find module '../../../services/goal-allocation.ts' or its corresponding type declarations.
src/services/ai/tools.ts(7,32): error TS2307: Cannot find module '../budgets.ts' or its corresponding type declarations.
src/services/ai/tools.ts(10,27): error TS2307: Cannot find module '../goals.ts' or its corresponding type declarations.
src/services/ai/tools.ts(76,42): error TS7006: Parameter 'l' implicitly has an 'any' type.
src/services/ai/tools.ts(137,18): error TS7006: Parameter 'g' implicitly has an 'any' type.
src/services/ai/tools.ts(138,15): error TS7006: Parameter 'g' implicitly has an 'any' type.
src/services/autopilot.ts(7,57): error TS2307: Cannot find module './goal-plan.ts' or its corresponding type declarations.
src/services/autopilot.ts(8,44): error TS2307: Cannot find module './goals.ts' or its corresponding type declarations.
src/services/autopilot.ts(197,55): error TS7006: Parameter 'g' implicitly has an 'any' type.
src/services/dashboard.ts(7,32): error TS2307: Cannot find module './budgets.ts' or its corresponding type declarations.
src/services/notifications.ts(7,32): error TS2307: Cannot find module './budgets.ts' or its corresponding type declarations.
npm error Lifecycle script `typecheck` failed with error:
npm error code 2
npm error path /home/udai/PennyPilot/apps/api
npm error workspace @compass/api@0.1.0
npm error location /home/udai/PennyPilot/apps/api
npm error command failed
npm error command sh -c tsc --noEmit


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

Every other workspace (`docs`, `extractor`, `ingestor`, `web`, `ai`, `shared`)
typechecked clean; only `@compass/api` failed.

### Every distinct error, grouped by root cause

**Root cause A — TS2307 "Cannot find module": the 5 outside-importer repoints
from DELEGATION.md's "Outside importers to repoint in this slice" list were
never applied (9 errors):**
- `src/app.ts:23:30` — `Cannot find module './routes/budgets.ts'`
- `src/app.ts:26:28` — `Cannot find module './routes/goals.ts'`
- `src/modules/investments/services/sip-commitments.ts:6:90` — `Cannot find module '../../../services/goal-allocation.ts'`
- `src/services/ai/tools.ts:7:32` — `Cannot find module '../budgets.ts'`
- `src/services/ai/tools.ts:10:27` — `Cannot find module '../goals.ts'`
- `src/services/autopilot.ts:7:57` — `Cannot find module './goal-plan.ts'`
- `src/services/autopilot.ts:8:44` — `Cannot find module './goals.ts'`
- `src/services/notifications.ts:7:32` — `Cannot find module './budgets.ts'`

**Root cause B — TS2307, a 9th unresolvable import in a file NOT named anywhere
in DELEGATION.md's outside-importer list:**
- `src/services/dashboard.ts:7:32` — `Cannot find module './budgets.ts'`
  `dashboard.ts` is explicitly one of "the 5 flat services that move in the
  next slice" per DELEGATION.md's own "Must not change" list for this slice —
  yet it already imports the now-deleted `./budgets.ts`, so it is broken by
  this slice's file move even though the delegation brief never told the
  implementer to repoint it. This is a gap in the brief's own outside-importer
  enumeration, not (necessarily) a mistake by the implementer — flagged for
  the coordinator, not fixed.

**Root cause C — TS7006 implicit-any (4 errors), pre-existing/cascading, NOT
import-resolution failures:**
- `src/services/ai/tools.ts:76:42` — `Parameter 'l' implicitly has an 'any' type.`
- `src/services/ai/tools.ts:137:18` — `Parameter 'g' implicitly has an 'any' type.`
- `src/services/ai/tools.ts:138:15` — `Parameter 'g' implicitly has an 'any' type.`
- `src/services/autopilot.ts:197:55` — `Parameter 'g' implicitly has an 'any' type.`

These four are on lines that call `getUtilization(...)`/`listGoals(...)` — with
the import unresolved, TS can no longer infer the callback parameter types
from the (now-invisible) return type, so `l`/`g` fall back to implicit `any`
under `noImplicitAny`. These are very likely a direct *consequence* of Root
Cause A/B rather than a fifth, independent defect — I did not attempt to
verify this by patching imports (out of scope for a read-only assessment) —
flagging as an assumption, not a confirmed fact.

13 distinct errors total (9 TS2307 + 4 TS7006).

---

## 4. Status of each of the 12 intended file moves

All 12 landed at the new path; all 12 are gone from the old path. Verified via
`git status --porcelain` (old paths show `D`, no new-path entries exist as `D`)
and `Read`/`ls` on the new paths.

| # | File | Old path exists? | New path exists? |
|---|------|-------------------|-------------------|
| 1 | `budgets.ts` (service) | No (deleted) | Yes — `apps/api/src/modules/planning/services/budgets.ts` |
| 2 | `goals.ts` (service) | No (deleted) | Yes — `apps/api/src/modules/planning/services/goals.ts` |
| 3 | `goal-allocation.ts` | No (deleted) | Yes — `apps/api/src/modules/planning/services/goal-allocation.ts` |
| 4 | `goal-plan.ts` | No (deleted) | Yes — `apps/api/src/modules/planning/services/goal-plan.ts` |
| 5 | `goal-projection.ts` | No (deleted) | Yes — `apps/api/src/modules/planning/services/goal-projection.ts` |
| 6 | `goal-returns.ts` | No (deleted) | Yes — `apps/api/src/modules/planning/services/goal-returns.ts` |
| 7 | `goal-allocation.test.ts` | No (deleted) | Yes — `apps/api/src/modules/planning/services/goal-allocation.test.ts` |
| 8 | `goal-plan.test.ts` | No (deleted) | Yes — `apps/api/src/modules/planning/services/goal-plan.test.ts` |
| 9 | `goal-projection.test.ts` | No (deleted) | Yes — `apps/api/src/modules/planning/services/goal-projection.test.ts` |
| 10 | `goal-returns.test.ts` | No (deleted) | Yes — `apps/api/src/modules/planning/services/goal-returns.test.ts` |
| 11 | `budgets.ts` (route) | No (deleted) | Yes — `apps/api/src/modules/planning/routes/budgets.ts` |
| 12 | `goals.ts` (route) | No (deleted) | Yes — `apps/api/src/modules/planning/routes/goals.ts` |

None are "both" or "neither" — every move is clean (old gone, new present).
The file *moves themselves* are complete; what is missing is entirely the
import-repointing work in the *unmoved* outside-importer files, plus the
message-string edit in `db/schema.smoke.test.ts`.

---

## 5. Each intended import repoint — current literal line, done or not

- **`apps/api/src/app.ts`** — `budgetRoutes`/`goalRoutes` import specifiers.
  **NOT done.** Current lines (`grep -n`):
  ```
  23:import { budgetRoutes } from "./routes/budgets.ts";
  26:import { goalRoutes } from "./routes/goals.ts";
  ```
  Both still point at the deleted flat paths.

- **`apps/api/src/services/notifications.ts` line ~7** — `./budgets.ts` →
  `../modules/planning/services/budgets.ts`. **NOT done.** Current line 7:
  ```
  import { getUtilization } from "./budgets.ts";
  ```

- **`apps/api/src/services/autopilot.ts` lines ~6, ~7, ~9** — `./goal-plan.ts`
  and `./goals.ts` → planning paths (leaving `./cashflow.ts` alone).
  **NOT done.** Current lines 6–8:
  ```
  6:import { getForecast } from "./cashflow.ts";
  7:import { equityShareOfInvestable, OTHER_BAND_PCT } from "./goal-plan.ts";
  8:import { getGoalProgress, listGoals } from "./goals.ts";
  ```
  (Line numbers in the current file are 6/7/8, not 6/7/9 as the brief
  estimated — a one-line drift, immaterial; `cashflow.ts` on line 6 is
  correctly still untouched per the "leave alone" instruction, but lines 7–8
  are also still untouched, which is the defect.)

- **`apps/api/src/services/ai/tools.ts` lines ~7, ~10** — `../budgets.ts`,
  `../goals.ts` → planning paths. **NOT done.** Current lines:
  ```
  7:import { getUtilization } from "../budgets.ts";
  10:import { listGoals } from "../goals.ts";
  ```

- **`apps/api/src/modules/investments/services/sip-commitments.ts` line ~6** —
  `../../../services/goal-allocation.ts` → `../../planning/services/goal-allocation.ts`.
  **NOT done.** Current line 6:
  ```
  import { accountAllocationClass, holdingAllocationClass, type GoalAllocationClass } from "../../../services/goal-allocation.ts";
  ```

- **`apps/api/src/db/schema.smoke.test.ts` line ~22** — the assertion message
  string ("re-exported from modules/planning/schema.ts" → language reflecting
  that it's defined in `db/schema.ts` and re-exported *to* planning).
  **NOT done.** Current lines 18–22:
  ```
  test("schema barrel exposes users and projectionSettings exactly once, with correct table names/columns", () => {
    assert.equal(schema.users, users, "users must be the same table object re-exported from core-schema.ts");
    assert.equal(
      schema.projectionSettings,
      projectionSettings,
      "projectionSettings must be the same table object re-exported from modules/planning/schema.ts",
  ```
  The message string on the line matching the brief's "line ~22" still reads
  `"projectionSettings must be the same table object re-exported from
  modules/planning/schema.ts"` — unchanged, still backwards per the brief's
  own description of what's stale.

**Summary: 0 of 6 intended import repoints in this section were applied.**

---

## 6. Import lines inside each of the 12 moved files, as they now stand

For every file: quoting every relative-looking import line, and flagging any
that still points at the wrong depth/target.

### `modules/planning/services/budgets.ts`
```ts
import type { Db } from "../../../db/index.ts";
import { budgetLines, budgets } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { assertOwnedCategory } from "../../../services/ownership.ts";
import { currentPeriodKey, periodRange, prevPeriodKey, spentByCategory } from "../../../services/periods.ts";
```
Correct: own tables (`budgetLines`, `budgets`) from `../schema.ts`; everything
else correctly depth-adjusted to `../../../{db,lib,services}/...`. No flag.

### `modules/planning/services/goals.ts`
```ts
import type { Db } from "../../../db/index.ts";
import { alertLedger, holdingEvents, retirementDetails, transactions } from "../../../db/schema.ts";
import { goals } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { listAccounts } from "../../ledger/services/accounts.ts";
import { getPortfolio } from "../../investments/services/holdings.ts";
import { accountReturnBps, holdingReturnBps } from "./goal-returns.ts";
import { projectGoal } from "./goal-projection.ts";
import { buildGoalPlan } from "./goal-plan.ts";
import { createNotification } from "../../../services/notifications.ts";
import { incomeExpense, periodRange, prevPeriodKey, currentPeriodKey } from "../../../services/periods.ts";
import { prefEnabled } from "../../../services/prefs.ts";
import { getProjectionSettings } from "./projection-settings.ts";
import { committedForGoal } from "../../investments/services/sip-commitments.ts";
import {
  accountAllocationClass,
  allocationPercentages,
  holdingAllocationClass,
  sortAssetsByAllocation,
} from "./goal-allocation.ts";
```
**The split-import rule was applied correctly**: `goals` alone comes from
`../schema.ts`; `alertLedger, holdingEvents, retirementDetails, transactions`
come from `../../../db/schema.ts` — exactly the split DELEGATION.md's rule 1
specifies by name for this file. `getProjectionSettings` correctly rewritten
to the intra-module `./projection-settings.ts` (rule 4). Peer-module imports
(`listAccounts` from ledger, `getPortfolio`/`committedForGoal` from
investments) correctly depth-adjusted to `../../<module>/services/...` (rule
3). Flat shared services (`notifications`, `periods`, `prefs`) correctly
depth-adjusted to `../../../services/...` (rule 2). No flag.

### `modules/planning/services/goal-allocation.ts`
No relative imports (only `import type { AccountType, AssetClass, GainsTaxClass } from "@compass/shared";`,
a package import). Nothing to repoint; matches the pre-move file. No flag.

### `modules/planning/services/goal-plan.ts`
No relative imports (only `import type { GoalPlan } from "@compass/shared";`).
No flag.

### `modules/planning/services/goal-projection.ts`
No imports at all (pure module). No flag.

### `modules/planning/services/goal-returns.ts`
```ts
import type { AccountType, AssetClass, GainsTaxClass } from "@compass/shared";
import { holdingAllocationClass } from "./goal-allocation.ts";
import type { GoalAllocationClass } from "./goal-allocation.ts";
```
Sibling intra-module import unchanged (`./goal-allocation.ts` resolves
correctly since both files moved together). No flag.

### `modules/planning/services/goal-allocation.test.ts`
```ts
import {
  accountAllocationClass,
  allocationPercentages,
  holdingAllocationClass,
  sortAssetsByAllocation,
} from "./goal-allocation.ts";
```
Correctly updated (was already `./goal-allocation.ts` pre-move, still resolves
post-move since sibling). No flag.

### `modules/planning/services/goal-plan.test.ts`
```ts
import { buildGoalPlan, equityShareOfInvestable, targetAllocation } from "./goal-plan.ts";
```
No flag.

### `modules/planning/services/goal-projection.test.ts`
```ts
import { projectGoal } from "./goal-projection.ts";
```
No flag.

### `modules/planning/services/goal-returns.test.ts`
```ts
import { accountReturnBps, DEFAULT_EQUITY_RETURN_BPS, holdingReturnBps } from "./goal-returns.ts";
```
No flag.

### `modules/planning/routes/budgets.ts`
```ts
import {
  comparePeriods,
  copyFromPreviousPeriod,
  deleteBudgetLine,
  getUtilization,
  suggestBudget,
  upsertBudget,
  upsertBudgetLine,
} from "../services/budgets.ts";
import { invalidateUserCache } from "../../../services/cache.ts";
import { enqueueBudgetEvaluation } from "../../../jobs/index.ts";
```
`../services/budgets.ts` resolves correctly (sibling-relative-to-module, per
rule 5 — verified, both route and service now live under
`modules/planning/`). `cache.ts` and `jobs/index.ts` correctly depth-adjusted
to `../../../...`. No flag.

### `modules/planning/routes/goals.ts`
```ts
import {
  createGoal,
  deleteGoal,
  getGoalProgress,
  listGoals,
  reorderGoals,
  updateGoal,
} from "../services/goals.ts";
```
Resolves correctly (sibling). No flag.

**None of the 12 moved files import `../db/schema.ts`, `../services/...`
(wrong-depth flat-service form), `../lib/...` (wrong depth), or a peer
module's `schema.ts` directly. `modules/planning/services/goals.ts` correctly
splits its table imports exactly as DELEGATION.md's rule 1 names: `goals` from
`../schema.ts`; `alertLedger, holdingEvents, retirementDetails, transactions`
from `../../../db/schema.ts`.**

**Conclusion for §6: the 12 moved files themselves are internally correct —
100% of the import-rule work *inside* the moved files was done properly.**
The entire defect is external: the outside-importer repoints (§5) and the
`db/schema.smoke.test.ts` message-string edit (§5) were never applied, leaving
`app.ts` and 4 other files with 9 dangling import specifiers.

---

## 7. Route snapshot sha256 — unchanged, as required

```
$ sha256sum apps/api/src/route-surface.snapshot.txt apps/api/src/route-table.snapshot.txt
a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122  apps/api/src/route-surface.snapshot.txt
7800feb971c2e570040a299addf207960a0866f2a7feb377c4a2cf84bf4255c8  apps/api/src/route-table.snapshot.txt
```

Both match the expected hashes given in the assessment brief exactly
(`a368d4eb…4122` and `7800feb9…55c8`). **Unchanged, as required by both this
slice and the byte-freeze constraint.**

---

## 8. Out-of-scope check

- **`apps/api/src/db/schema.ts`** — modified, but that modification is
  entirely the already-landed Slice-0 (D1) change (moving `projectionSettings`
  into the barrel), not new Slice-1 damage. No further edits to this file were
  made or attempted by whatever ran in this session — `git diff -M` shows only
  the one Slice-0 hunk, matching Slice-0's spec exactly (inserted right after
  `subscriptionDismissals`'s closing `);`, same 4 columns, same doc comment
  style). Confirmed not touched again this slice, consistent with Slice 1's
  "Must not change: `db/schema.ts` — no further edits; Slice 0 finished with
  it."
- **`modules/planning/plugin.ts`** — `git status --porcelain` on that exact
  path returned nothing; file is untouched. Confirmed out-of-scope, as
  required ("Iteration 4 owns those").
- **Every `app.register(...)` call site** — `app.ts` itself has **zero** git-
  status entries (not even listed as modified), so its `app.register(...)`
  calls, their count (24, counted via `grep -c "app.register("`), and their
  order are provably untouched — the whole file is byte-identical to `HEAD`.
  This also means the required `budgetRoutes`/`goalRoutes` import-specifier
  edit was never attempted, not just incompletely done (§5).
- **The 5 next-slice services and their routes**
  (`cashflow.ts`, `bills.ts`, `dashboard.ts`, `insights.ts`, `reports.ts`) —
  all 5 confirmed still present at their original flat path
  (`ls apps/api/src/services/{cashflow,bills,dashboard,insights,reports}.ts`
  succeeded for all 5, no errors) and none show up in `git status`. Untouched,
  as required — **with one caveat**: `dashboard.ts` still imports the now-
  deleted `./budgets.ts` (§3, Root Cause B) — this is not the *service file
  being edited*, it's a pre-existing import of `budgets.ts` (a file this slice
  *did* legitimately move) that nobody repointed. That import breakage is a
  side effect of Slice 1, but the fix for it (repointing `dashboard.ts`) is
  arguably itself out-of-scope for Slice 1 per the "must not touch" list,
  which is a **conflict** in the brief worth flagging to the coordinator, not
  resolved here.

**Nothing out-of-scope was edited.** The only content changes beyond the 12
file moves are the pre-existing (and in-spec) Slice-0 diff and the module-
internal import lines inside the 12 moved files (§6), which are explicitly
in-scope for Slice 1.

---

## 9. Resolver-based unresolvable-import scan

Script written to
`/tmp/claude-1001/-home-udai-PennyPilot/ad09ead0-26c7-444d-9b89-3b727c4e538e/scratchpad/resolve-scan.mjs`
(not committed to the repo). It walks every `*.ts` under `apps/api/src`,
extracts every static specifier via 5 regexes covering `import ... from "..."`
(including `import type`), `export ... from "..."` (including `export type`,
`export *`, `export { ... }`), bare side-effect `import "..."`, and dynamic
`import("...")`; keeps only specifiers starting with `.`; resolves each
against its own file's directory, accepting only a **regular file**, trying
the exact path, then `+".ts"`, then `+"/index.ts"`.

Command and full literal output:
```
$ node /tmp/.../scratchpad/resolve-scan.mjs
Files scanned: 224
Specifiers scanned (relative only, deduped per file/line): 689
Unresolvable: 9
/home/udai/PennyPilot/apps/api/src/app.ts:23: ./routes/budgets.ts  -- import { budgetRoutes } from "./routes/budgets.ts";
/home/udai/PennyPilot/apps/api/src/app.ts:26: ./routes/goals.ts  -- import { goalRoutes } from "./routes/goals.ts";
/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-commitments.ts:6: ../../../services/goal-allocation.ts  -- import { accountAllocationClass, holdingAllocationClass, type GoalAllocationClass } from "../../../services/goal-allocation.ts";
/home/udai/PennyPilot/apps/api/src/services/ai/tools.ts:7: ../budgets.ts  -- import { getUtilization } from "../budgets.ts";
/home/udai/PennyPilot/apps/api/src/services/ai/tools.ts:10: ../goals.ts  -- import { listGoals } from "../goals.ts";
/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:7: ./goal-plan.ts  -- import { equityShareOfInvestable, OTHER_BAND_PCT } from "./goal-plan.ts";
/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:8: ./goals.ts  -- import { getGoalProgress, listGoals } from "./goals.ts";
/home/udai/PennyPilot/apps/api/src/services/dashboard.ts:7: ./budgets.ts  -- import { getUtilization } from "./budgets.ts";
/home/udai/PennyPilot/apps/api/src/services/notifications.ts:7: ./budgets.ts  -- import { getUtilization } from "./budgets.ts";
```

224 files scanned, 689 relative specifiers, **9 unresolvable** — a 1:1 match
with the 9 `TS2307` errors from `npm run typecheck` (§3), which is a
consistency cross-check between the two independent methods (tsc's module
resolver vs. this hand-rolled resolver), not a coincidence.

---

## Assumptions

- The Root-Cause-C TS7006 implicit-any errors (`ai/tools.ts:76/137/138`,
  `autopilot.ts:197`) are assumed to be a *consequence* of the unresolved
  imports (TS can't infer callback-parameter types from an unresolvable
  return type) rather than a fifth, independent defect. Not verified by
  patching (out of scope for read-only assessment) — flagged as an assumption.
- `dashboard.ts`'s dangling `./budgets.ts` import (§3 Root Cause B, §8) is
  treated as a gap in DELEGATION.md's own "Outside importers to repoint"
  enumeration rather than an implementer error, since the brief never named
  `dashboard.ts` — but DELEGATION.md's "Must not change" list also explicitly
  forbids touching the 5 next-slice services including `dashboard.ts`. This is
  a genuine conflict in the brief and is reported, not resolved.

## Unresolved risks / open questions for the completion pass

1. The single remaining piece of work to make `npm run typecheck` pass is:
   repoint the 5 named outside-importer files (`app.ts`, `notifications.ts`,
   `autopilot.ts`, `ai/tools.ts`, `sip-commitments.ts`) exactly as
   DELEGATION.md's Iteration 2 "Outside importers to repoint" section
   specifies, **plus** decide what to do about `dashboard.ts`'s import of the
   now-moved `budgets.ts` (not named in that list but broken by the move) —
   the DELEGATION.md conflict noted above needs a decision before that file is
   touched.
2. `apps/api/src/db/schema.smoke.test.ts:22`'s message-string edit is also
   still outstanding (in-scope for this slice per DELEGATION.md's "Also in
   this slice" section) — untouched.
3. Test suite was **not run**, per the assessment brief's explicit instruction
   ("Do NOT run the test suite — typecheck is failing and the suite will be
   noisy; skip it and say you skipped it."). **Skipped as instructed.**
   `npm run lint` was likewise not part of this brief's required command list
   and was not run.
4. I did not verify whether `node --test` for the 4 individually-moved test
   files would pass on their own (their imports are internally consistent per
   §6, and typecheck doesn't flag them), but this was outside the requested
   scope (§9's resolver scan and §3's typecheck were the only checks asked
   for) and the brief said not to run tests.
