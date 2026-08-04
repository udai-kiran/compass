# Implementation report — 006-module-scaffold-and-route-gate

Executed P1–P11 from TASK.md's Plan section, in order, per DELEGATION.md.

## Files changed

**New:**
- `apps/api/src/db/core-schema.ts`
- `apps/api/src/db/schema.smoke.test.ts`
- `apps/api/src/modules/planning/schema.ts`
- `apps/api/src/modules/planning/services/projection-settings.ts`
- `apps/api/src/modules/planning/services/projection-settings.test.ts`
- `apps/api/src/modules/planning/routes/projection-settings.ts`
- `apps/api/src/modules/planning/routes/projection-settings.route.test.ts`
- `apps/api/src/modules/planning/plugin.ts`
- `apps/api/src/route-table.snapshot.txt`
- `apps/api/src/app.route-snapshot.test.ts`

**Modified:**
- `apps/api/src/app.ts`
- `apps/api/src/db/schema.ts`
- `apps/api/src/services/goals.ts`
- `CLAUDE.md`
- `tasks/01.05-migrate-planning.md`
- `tasks/README.md`

**Deleted:**
- `apps/api/src/services/projection-settings.ts`
- `apps/api/src/routes/projection-settings.ts`

Matches the Files and Symbols list in DELEGATION.md exactly. No deviations to which files exist.

---

## P1 — baseline capture (before any file touched)

`grep -n "app.register(" apps/api/src/app.ts` against the **original, unmodified** `app.ts` (39 lines, confirmed before any edit):

```
171:  await app.register(multipart);
174:  await app.register(compress, { global: true, threshold: 1024 });
175:  await app.register(healthRoutes);
176:  await app.register(authRoutes);
177:  await app.register(accountRoutes);
178:  await app.register(categoryRoutes);
179:  await app.register(transactionRoutes);
180:  await app.register(transferRoutes);
181:  await app.register(attachmentRoutes);
182:  await app.register(transactionLinkRoutes);
183:  await app.register(importRoutes);
184:  await app.register(ruleRoutes);
185:  await app.register(budgetRoutes);
186:  await app.register(dashboardRoutes);
187:  await app.register(notificationRoutes);
188:  await app.register(recurringRoutes);
189:  await app.register(goalRoutes);
190:  await app.register(sipRoutes);
191:  await app.register(cashflowRoutes);
192:  await app.register(billRoutes);
193:  await app.register(cardRoutes);
194:  await app.register(emiRoutes);
195:  await app.register(retirementRoutes);
196:  await app.register(accountNpsRoutes);
197:  await app.register(bankDetailsRoutes);
198:  await app.register(overdraftDetailsRoutes);
199:  await app.register(insuranceRoutes);
200:  await app.register(holdingRoutes);
201:  await app.register(netWorthRoutes);
202:  await app.register(insightRoutes);
203:  await app.register(reportRoutes);
204:  await app.register(searchRoutes);
205:  await app.register(backupRoutes);
206:  await app.register(aiRoutes);
207:  await app.register(aiEventRoutes);
208:  await app.register(projectionSettingsRoutes);
209:  await app.register(profileRoutes);
210:  await app.register(inboxRoutes);
211:  await app.register(mailboxRoutes);
212:  await app.register(resourceRoutes);
213:  await app.register(userTaskRoutes);
```

39 registrations excluding `multipart`/`compress` (both HTTP plugins, not routes, per Scope).

A throwaway harness (`apps/api/src/_p1-baseline-harness.test.ts`, deleted immediately after use, never committed) copied these 39 `app.register(...)` calls verbatim. Mechanical diff:

```
$ grep -n "app.register(" apps/api/src/app.ts | sed -n '3,41p' | sed -E 's/^([0-9]+):.*register\(([a-zA-Z]+).*/\2/' > app-ts-registrations.txt
$ grep -oE "await app\.register\([a-zA-Z]+" baseline-harness.test.ts | sed -E 's/.*register\(//' > harness-registrations.txt
$ wc -l app-ts-registrations.txt
39 app-ts-registrations.txt
$ wc -l harness-registrations.txt
39 harness-registrations.txt
$ diff app-ts-registrations.txt harness-registrations.txt && echo "IDENTICAL"
IDENTICAL
```

Baseline harness run (`node --env-file-if-exists=../../.env --test src/_p1-baseline-harness.test.ts` from `apps/api`):

```
✔ P1 baseline capture (270.226503ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1892.974303
EXIT: 0
```

Captured to `/tmp/route-baseline.txt`. **Exact route/line count: 156 lines** (not "~155").

```
$ wc -l /tmp/route-baseline.txt
156 /tmp/route-baseline.txt
$ sha256sum /tmp/route-baseline.txt
062d89155f0f21b3d3fb9f3f431de0337f70071b10ac3128080f146421c235f9  /tmp/route-baseline.txt
```

Throwaway harness file (`apps/api/src/_p1-baseline-harness.test.ts`) deleted immediately after capture, before any other edit was made.

---

## P2 — `db/core-schema.ts` + `db/schema.ts` `users` import/re-export

New file `apps/api/src/db/core-schema.ts`:
```ts
import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Shared identity leaf: tables that genuinely need a cycle-free home because
 * both `db/schema.ts` (the remaining inline tables) and `modules/<domain>/schema.ts`
 * files reference them via `.references(() => users.id, ...)`. Deliberately
 * narrow — starts with just `users` — and is NOT a general destination for
 * every cross-module foreign key; future cross-module FK targets get their
 * own explicit ownership decision in whichever Phase-1 task introduces them.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  /** the seeded, read-only demo account; excluded from the owner-bootstrap count */
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

`db/schema.ts` at this point in the sequence (`projectionSettings` still inline, as TASK.md's P2 specifies — moved only in P5): added
```ts
import { users } from "./core-schema.ts";
export { users } from "./core-schema.ts";
```
and removed the old inline `users` table definition (kept `projectionSettings` inline for now).

`npm run typecheck -w apps/api` after this step: **EXIT 0**, zero errors — confirms every existing FK to `users` still resolves.

`node --test src/db/schema.smoke.test.ts` (hermetic) at this point:
```
✔ schema barrel exposes users and projectionSettings exactly once, with correct table names/columns (1.968424ms)
✔ a real createDb() instance (non-connecting stub pool) exposes db.query.users and db.query.projectionSettings at runtime (3.183687ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
EXIT: 0
```
(`projectionSettings` still imported from `./schema.ts` at this stage, per Plan's note that this half is "updated again in P5 once it moves.")

---

## P3 — extract `registerRoutes(app)`

`apps/api/src/app.ts`: added
```ts
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  ... (same 39 calls, same order) ...
  await app.register(userTaskRoutes);
}
```
called from `buildApp()` as `await registerRoutes(app);` in place of the inline 39 calls. `multipart`/`compress` stay in `buildApp()`. `projectionSettingsRoutes` import unchanged at this point (module move is P5).

`npm run typecheck -w apps/api`: EXIT 0.

Recaptured `printRoutes()` via a throwaway generator script and diffed against P1:
```
$ diff /tmp/route-baseline.txt apps/api/src/route-table.snapshot.txt
(no output)
```
Byte-identical (156 lines, same sha256 `062d89155f0f21b3d3fb9f3f431de0337f70071b10ac3128080f146421c235f9`).

---

## P4 — `app.route-snapshot.test.ts` + committed `route-table.snapshot.txt`

New files: `apps/api/src/route-table.snapshot.txt` (156 lines, generated via `registerRoutes(app)` + `app.printRoutes({ commonPrefix: false })`) and `apps/api/src/app.route-snapshot.test.ts` (full contents below under "New file contents").

`node --test src/app.route-snapshot.test.ts` (hermetic):
```
✔ route table matches the committed snapshot byte-for-byte (214.420945ms)
✔ assertRouteTableMatches rejects an added route (0.570149ms)
✔ assertRouteTableMatches rejects a removed route (0.242519ms)
✔ assertRouteTableMatches rejects a renamed route (0.203008ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.184048ms)
✔ assertRouteTableMatches accepts identical tables (0.29392ms)
ℹ tests 6
ℹ pass 6
ℹ fail 0
EXIT: 0
```

---

## P5 — `modules/planning/*` scaffold, barrel update, app.ts/goals.ts import updates, old-file deletion

Created:
- `apps/api/src/modules/planning/schema.ts` — `projectionSettings`, importing `users` from `../../db/core-schema.ts` (never the barrel).
- `apps/api/src/modules/planning/services/projection-settings.ts` — moved from `services/projection-settings.ts`, import paths updated (`../schema.ts`, `../../../db/index.ts`, `../../../services/goal-returns.ts`).
- `apps/api/src/modules/planning/routes/projection-settings.ts` — moved from `routes/projection-settings.ts`, same URLs/handler bodies.
- `apps/api/src/modules/planning/plugin.ts` — `planningRoutes(app)` registers `projectionSettingsRoutes`; this is what `app.ts`'s `registerRoutes()` now registers (not a bypassed re-export).

`db/schema.ts` updated to:
```ts
import { users } from "./core-schema.ts";
export { users } from "./core-schema.ts";
export * from "../modules/planning/schema.ts";
```
and the inline `projectionSettings` table definition removed.

`app.ts`: `import { planningRoutes } from "./modules/planning/plugin.ts";` replacing `import { projectionSettingsRoutes } from "./routes/projection-settings.ts";`; `await app.register(planningRoutes);` replacing `await app.register(projectionSettingsRoutes);` (same position in the 39-call list).

`services/goals.ts`: `import { getProjectionSettings } from "../modules/planning/services/projection-settings.ts";` replacing `from "./projection-settings.ts"`.

Old files deleted: `apps/api/src/services/projection-settings.ts`, `apps/api/src/routes/projection-settings.ts`.

Grep confirming no remaining old-path imports outside `modules/planning` (T10, exact command from DELEGATION.md):
```
$ grep -rn "services/projection-settings\|routes/projection-settings" apps/api/src --include=*.ts | grep -v modules/planning
(no output — exit 1, meaning zero matches)
```

Direct confirmation both old files no longer exist on disk:
```
$ ls apps/api/src/services/projection-settings.ts
lsd: No such file or directory (os error 2)
$ ls apps/api/src/routes/projection-settings.ts
lsd: No such file or directory (os error 2)
```

`schema.smoke.test.ts` updated: `projectionSettings` now imported from `../modules/planning/schema.ts` instead of `./schema.ts`.

`npm run typecheck -w apps/api`: EXIT 0.

---

## P6 — recapture printRoutes, confirm still byte-identical to P1

```
$ diff /tmp/route-baseline.txt /tmp/route-p6.txt && echo "P6 CHECKPOINT: byte-identical to P1 baseline"
P6 CHECKPOINT: byte-identical to P1 baseline
$ sha256sum /tmp/route-baseline.txt /tmp/route-p6.txt apps/api/src/route-table.snapshot.txt
062d89155f0f21b3d3fb9f3f431de0337f70071b10ac3128080f146421c235f9  /tmp/route-baseline.txt
062d89155f0f21b3d3fb9f3f431de0337f70071b10ac3128080f146421c235f9  /tmp/route-p6.txt
062d89155f0f21b3d3fb9f3f431de0337f70071b10ac3128080f146421c235f9  apps/api/src/route-table.snapshot.txt
$ wc -l /tmp/route-p6.txt
156 /tmp/route-p6.txt
```
All three hashes identical after the module move — proves the relocation changed nothing about the URL table.

`node --test src/app.route-snapshot.test.ts` re-run (post module move): same 6/6 pass as above (re-confirmed again at P11, see below).

---

## P7 — new colocated tests

`node --env-file-if-exists=../../.env --test src/modules/planning/services/projection-settings.test.ts src/modules/planning/routes/projection-settings.route.test.ts` (from `apps/api`):
```
✔ an unauthenticated request to GET /api/projection-settings is rejected (35.385808ms)
✔ a demo session's PUT /api/projection-settings is rejected 403, with no database effect (113.55608ms)
✔ an authenticated GET/PUT round-trip works (40.96468ms)
✔ getProjectionSettings returns the default equityReturnBps (1200) when no row exists (121.097875ms)
✔ updateProjectionSettings validates and upserts a new row (25.396012ms)
✔ a second updateProjectionSettings call updates the existing row rather than inserting a duplicate (13.420584ms)
✔ two different users' projection settings do not affect each other (18.458985ms)
ℹ tests 7
ℹ pass 7
ℹ fail 0
EXIT: 0
```

---

## P8 — db:generate content-hash manifest (before/after)

Before (135 files under `apps/api/drizzle/`):
```
$ find apps/api/drizzle -type f | sort | xargs sha256sum > drizzle-manifest-before.txt
$ wc -l drizzle-manifest-before.txt
135 drizzle-manifest-before.txt
$ sha256sum drizzle-manifest-before.txt
3af08d40249d049b3a410844910c082d6615c791e376eae719c8ac1b4a4dd6eb  drizzle-manifest-before.txt
```

`npm run db:generate` (root) — literal output:
```
> compass@0.1.0 db:generate
> npm run db:generate -w apps/api

> @compass/api@0.1.0 db:generate
> node --env-file-if-exists=../../.env ../../node_modules/drizzle-kit/bin.cjs generate

No config path provided, using default 'drizzle.config.ts'
Reading config file '/home/udai/PennyPilot/apps/api/drizzle.config.ts'
51 tables
account_nps_details 9 columns 0 indexes 2 fks
accounts 15 columns 1 indexes 2 fks
ai_events 14 columns 1 indexes 3 fks
ai_settings 7 columns 0 indexes 1 fks
alert_ledger 5 columns 1 indexes 1 fks
attachments 7 columns 1 indexes 1 fks
bank_details 10 columns 0 indexes 2 fks
budget_alerts 6 columns 1 indexes 2 fks
budget_lines 7 columns 1 indexes 2 fks
budgets 6 columns 1 indexes 1 fks
card_details 10 columns 0 indexes 2 fks
card_issuer_settings 8 columns 0 indexes 1 fks
card_statements 9 columns 1 indexes 2 fks
categories 12 columns 2 indexes 1 fks
email_ingestions 13 columns 2 indexes 2 fks
emi_details 10 columns 0 indexes 3 fks
extracted_transactions 20 columns 3 indexes 6 fks
family_members 13 columns 1 indexes 1 fks
goals 11 columns 1 indexes 1 fks
gold_details 7 columns 0 indexes 2 fks
holding_events 11 columns 2 indexes 2 fks
holding_valuations 6 columns 1 indexes 1 fks
holdings 14 columns 1 indexes 2 fks
import_presets 7 columns 1 indexes 2 fks
import_rows 16 columns 2 indexes 1 fks
imports 11 columns 1 indexes 2 fks
insurance_health_cards 9 columns 1 indexes 2 fks
insurance_policies 28 columns 1 indexes 2 fks
mailbox_accounts 13 columns 1 indexes 1 fks
mailbox_credentials 7 columns 1 indexes 1 fks
merchant_rules 5 columns 1 indexes 1 fks
net_worth_snapshots 8 columns 1 indexes 1 fks
notification_prefs 9 columns 1 indexes 2 fks
notifications 9 columns 1 indexes 1 fks
nps_details 9 columns 0 indexes 2 fks
overdraft_details 6 columns 0 indexes 2 fks
recurring_templates 17 columns 1 indexes 4 fks
resources 11 columns 1 indexes 1 fks
retirement_details 8 columns 0 indexes 2 fks
reward_entries 8 columns 2 indexes 3 fks
sips 15 columns 3 indexes 5 fks
statement_reconciliations 19 columns 2 indexes 3 fks
subscription_dismissals 4 columns 1 indexes 1 fks
transaction_links 5 columns 1 indexes 1 fks
transaction_splits 6 columns 1 indexes 2 fks
transactions 21 columns 8 indexes 8 fks
transfer_links 6 columns 1 indexes 3 fks
user_profiles 4 columns 0 indexes 1 fks
user_tasks 11 columns 3 indexes 2 fks
users 7 columns 0 indexes 0 fks
projection_settings 4 columns 0 indexes 1 fks

No schema changes, nothing to migrate 😴
EXIT: 0
```

After:
```
$ find apps/api/drizzle -type f | sort | xargs sha256sum > drizzle-manifest-after.txt
$ wc -l drizzle-manifest-after.txt
135 drizzle-manifest-after.txt
$ diff drizzle-manifest-before.txt drizzle-manifest-after.txt && echo "MANIFEST IDENTICAL — no db:generate diff"
MANIFEST IDENTICAL — no db:generate diff
```
135 files before and after, byte-identical content hashes throughout — no new file, no changed file.

---

## P9 — backup.test.ts

`node --env-file-if-exists=../../.env --test src/services/backup.test.ts` (from `apps/api`):
```
✔ the full backup covers every table in the schema (2.095155ms)
✔ sips precedes holding_events in ALL_TABLES (holding_events.sip_id FKs sips) (0.248455ms)
✔ the per-user export reconstructs every table (no coverage gaps) (0.214308ms)
✔ no table is scoped both directly and through a parent (0.178219ms)
✔ every storage-key column in the schema is covered by FILE_COLUMNS (1.041497ms)
✔ collectFileRefs pulls every non-empty storage key from a dump (1.600255ms)
✔ the per-user restore covers exactly the exported tables, in parent-first order (1.307512ms)
✔ restore defers cyclic and self-referencing foreign keys (1.993676ms)
✔ restoreDump's second pass issues an update for every column in DEFERRED_RESTORE_COLUMNS (5.135032ms)
✔ misc-05 AC14: restoreDump's first pass carries user_tasks.source/source_key through untouched when present, and omits them (falling back to the column DEFAULT) when the dump predates the migration (1.909169ms)
✔ AC11: a task linked to an owned transaction, and an unlinked task, round-trip through per-user backup/restore (309.54798ms)
✔ misc-05 AC14: the per-user archive round-trips a card-due task's source/sourceKey through restoreUserBackup, alongside an ordinary task (167.174705ms)
✔ misc-05 AC14: a per-user archive predating source/sourceKey (missing both keys entirely) restores via restoreUserBackup by falling back to the column DEFAULTs (26.503259ms)
ℹ tests 13
ℹ pass 13
ℹ fail 0
EXIT: 0
```
`ALL_TABLES`/`USER_TABLES` in `services/backup.ts` untouched (confirmed by `git diff` showing no changes to that file).

---

## P10 — CLAUDE.md / tasks/01.05 / tasks/README.md

`CLAUDE.md` — one bullet added under "Backend — apps/api":
```diff
 - **Jobs:** BullMQ on Redis, started in `jobs/index.ts` (`startJobs`). Config is validated at boot in `config.ts` (Zod) — add new env vars there.
+- **Transitional module scaffold:** `modules/<domain>/` (`schema.ts`, `services/`, `routes/`, `plugin.ts`) is starting to replace the flat `services/x.ts`/`routes/x.ts` layout, one domain at a time (Phase 1 of the roadmap). `app.ts` registers a module's `plugin.ts`, not its routes directly. `db/schema.ts` stays the schema barrel — it re-exports each module's `schema.ts` — and both it and every `modules/<domain>/schema.ts` import shared identity tables from `db/core-schema.ts` (currently just `users`), a deliberately narrow, cycle-free leaf — **not** a general destination for every cross-module foreign key.
```

`tasks/01.05-migrate-planning.md` — one line changed:
```
Routes: budgets, goals, cashflow, bills, projection-settings, dashboard, insights, reports. Tables: budgets, budget_lines, budget_alerts, goals, subscription_dismissals, projection_settings.
```
(added `, projection_settings` to the Tables list; nothing else in the file touched.)

`tasks/README.md` — one line added to "Known traps" (after the pre-existing "Never `git add -A`" line):
```
- **The 0.3 route-table snapshot proves URL/method identity only** — it does not prove auth requirements, `config.public` metadata, demo-write protection, or CSRF/rate-limit classification survive a plugin-encapsulation change. Tasks 1.1-1.8 must each verify those separately as their own acceptance criterion when converting flat route registrations into prefixed/nested module plugins.
```
Note: `tasks/README.md` had substantial **pre-existing, uncommitted** changes already present in the working tree before this task began (confirmed via `git status` at the start of this session, before any edit was made — part of an earlier session's roadmap replan referenced in TASK.md's Status section). This task's contribution is exactly the one Known-traps line above; verified directly against the diff (see "Full git diff" below).

---

## P11 — full gate

`npm run typecheck` (root, all 6 workspaces):
```
> @compass/api@0.1.0 typecheck / tsc --noEmit
> @compass/docs@0.1.0 typecheck / tsc --noEmit
> @compass/extractor@0.1.0 typecheck / tsc --noEmit
> @compass/ingestor@0.1.0 typecheck / tsc --noEmit
> @compass/web@0.1.0 typecheck / tsc --noEmit
> @compass/ai@0.1.0 typecheck / tsc --noEmit
> @compass/shared@0.1.0 typecheck / tsc --noEmit
EXIT: 0
```

`npm run lint` (root):
```
> compass@0.1.0 lint
> eslint .
EXIT: 0
```
(One transient lint error was found and fixed during implementation: `schema.smoke.test.ts` imported `projectionSettings` but only used `schema.projectionSettings` — fixed by asserting `schema.projectionSettings === projectionSettings` directly, so the import is exercised. Re-ran lint after the fix: 0 errors.)

`npm run test` (root, all workspaces) — full literal summary per workspace:
```
@compass/api:      ℹ tests 808  ℹ pass 808  ℹ fail 0
@compass/extractor: ℹ tests 63   ℹ pass 62   ℹ fail 1   <-- pre-existing, unrelated (see below)
@compass/ingestor:  ℹ tests 12   ℹ pass 12   ℹ fail 0
@compass/web:       ℹ tests 264  ℹ pass 264  ℹ fail 0
@compass/ai:        ℹ tests 32   ℹ pass 32   ℹ fail 0
@compass/shared:    ℹ tests 212  ℹ pass 212  ℹ fail 0
```
Overall `npm run test` exit code: **1** (because of the `@compass/extractor` failure below). This is **not** a regression from this task.

### Pre-existing, out-of-scope failure (apps/extractor)

```
file:///home/udai/PennyPilot/apps/extractor/src/statement-duplicate.test.ts:30
    throw new Error(
          ^

Error: statement-duplicate.test.ts needs DATABASE_URL set (a real Postgres connection) — this repo has no DB-mocking infrastructure. Export it (see apps/extractor/.env) before running `npm run test -w apps/extractor`.
    at requireDatabaseUrl (file:///home/udai/PennyPilot/apps/extractor/src/statement-duplicate.test.ts:30:11)
    ...
✖ src/statement-duplicate.test.ts (429.03813ms)
ℹ tests 63
ℹ pass 62
ℹ fail 1
```
Root cause: `apps/extractor/package.json`'s `test` script is `"node --test \"src/**/*.test.ts\""` — unlike `apps/api`'s `"node --env-file-if-exists=../../.env --test ..."`, it never loads `.env`, so `DATABASE_URL` is unset when the root `npm run test` fans out to it. This task did not touch any file under `apps/extractor`; this is a pre-existing gap in that workspace's own test script, unrelated to task 006's scope (not in DELEGATION.md's file list). Flagging it, not fixing it, per scope discipline.

### Individual gate commands re-run cleanly (final confirmation)

`node --test src/db/schema.smoke.test.ts` (from `apps/api`):
```
✔ schema barrel exposes users and projectionSettings exactly once, with correct table names/columns (1.920121ms)
✔ a real createDb() instance (non-connecting stub pool) exposes db.query.users and db.query.projectionSettings at runtime (3.50721ms)
ℹ tests 2  ℹ pass 2  ℹ fail 0
EXIT: 0
```

`node --test src/app.route-snapshot.test.ts` (from `apps/api`):
```
✔ route table matches the committed snapshot byte-for-byte (220.723087ms)
✔ assertRouteTableMatches rejects an added route (0.574641ms)
✔ assertRouteTableMatches rejects a removed route (0.216184ms)
✔ assertRouteTableMatches rejects a renamed route (0.198861ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.19013ms)
✔ assertRouteTableMatches accepts identical tables (0.268898ms)
ℹ tests 6  ℹ pass 6  ℹ fail 0
EXIT: 0
```

`node --env-file-if-exists=../../.env --test src/services/backup.test.ts` (from `apps/api`):
```
ℹ tests 13  ℹ pass 13  ℹ fail 0
EXIT: 0
```

`node --env-file-if-exists=../../.env --test src/modules/planning/services/projection-settings.test.ts src/modules/planning/routes/projection-settings.route.test.ts` (from `apps/api`):
```
ℹ tests 7  ℹ pass 7  ℹ fail 0
EXIT: 0
```

`grep -rn "services/projection-settings\|routes/projection-settings" apps/api/src --include=*.ts | grep -v modules/planning`:
```
(no output)
```

---

## Full git diff (modified files)

### CLAUDE.md
```diff
diff --git a/CLAUDE.md b/CLAUDE.md
index e4a2589..00ccb50 100644
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -46,6 +46,7 @@ node --test apps/api/src/services/capital-gains.test.ts
 - **`plugins/auth.ts`** — Redis-backed sessions (argon2 password hash, signed httpOnly SameSite=Lax cookie). It also holds the **single demo-mode chokepoint**: a demo session is rejected on any mutating HTTP method (`MUTATING_METHODS`), so seeded demo data is immutable and every new POST/PATCH/DELETE route is demo-safe automatically.
 - **`plugins/security.ts`** — hand-rolled (deliberately no `@fastify/helmet`/`rate-limit`/`csrf`): security headers, **CSRF via Origin check** on state-changing requests, and Redis fixed-window rate-limit buckets (`AUTH_BUCKET` etc.).
 - **Jobs:** BullMQ on Redis, started in `jobs/index.ts` (`startJobs`). Config is validated at boot in `config.ts` (Zod) — add new env vars there.
+- **Transitional module scaffold:** `modules/<domain>/` (`schema.ts`, `services/`, `routes/`, `plugin.ts`) is starting to replace the flat `services/x.ts`/`routes/x.ts` layout, one domain at a time (Phase 1 of the roadmap). `app.ts` registers a module's `plugin.ts`, not its routes directly. `db/schema.ts` stays the schema barrel — it re-exports each module's `schema.ts` — and both it and every `modules/<domain>/schema.ts` import shared identity tables from `db/core-schema.ts` (currently just `users`), a deliberately narrow, cycle-free leaf — **not** a general destination for every cross-module foreign key.
 
 ### Money & domain rules
 - **Money is always integer paise** (minor units) end to end — never float rupees. Use `packages/shared/src/money.ts` (`rupeesToPaise`, `formatINR`, `standardEmiPaise`). Formatting is `en-IN` INR.
```

### apps/api/src/app.ts
```diff
diff --git a/apps/api/src/app.ts b/apps/api/src/app.ts
index f3c8532..21395f9 100644
--- a/apps/api/src/app.ts
+++ b/apps/api/src/app.ts
@@ -49,7 +49,7 @@ import { searchRoutes } from "./routes/search.ts";
 import { backupRoutes } from "./routes/backup.ts";
 import { aiRoutes } from "./routes/ai.ts";
 import { aiEventRoutes } from "./routes/ai-events.ts";
-import { projectionSettingsRoutes } from "./routes/projection-settings.ts";
+import { planningRoutes } from "./modules/planning/plugin.ts";
 import { profileRoutes } from "./routes/profile.ts";
 import { inboxRoutes } from "./routes/inbox.ts";
 import { mailboxRoutes } from "./routes/mailboxes.ts";
@@ -88,6 +88,56 @@ export function registerLedgerCacheSubscriber(app: FastifyInstance): void {
   });
 }
 
+/**
+ * Registers every application route module (not the HTTP-level `multipart`/
+ * `compress` plugins, which stay in `buildApp()` since they aren't routes).
+ * Same 39 registrations, same order, as `buildApp()` always had — extracted so
+ * a hermetic test (`app.route-snapshot.test.ts`) can build a minimal Fastify
+ * instance around just this function and snapshot the resulting route table
+ * without booting Postgres/Redis/storage/jobs/auth/security.
+ */
+export async function registerRoutes(app: FastifyInstance): Promise<void> {
+  await app.register(healthRoutes);
+  await app.register(authRoutes);
+  await app.register(accountRoutes);
+  await app.register(categoryRoutes);
+  await app.register(transactionRoutes);
+  await app.register(transferRoutes);
+  await app.register(attachmentRoutes);
+  await app.register(transactionLinkRoutes);
+  await app.register(importRoutes);
+  await app.register(ruleRoutes);
+  await app.register(budgetRoutes);
+  await app.register(dashboardRoutes);
+  await app.register(notificationRoutes);
+  await app.register(recurringRoutes);
+  await app.register(goalRoutes);
+  await app.register(sipRoutes);
+  await app.register(cashflowRoutes);
+  await app.register(billRoutes);
+  await app.register(cardRoutes);
+  await app.register(emiRoutes);
+  await app.register(retirementRoutes);
+  await app.register(accountNpsRoutes);
+  await app.register(bankDetailsRoutes);
+  await app.register(overdraftDetailsRoutes);
+  await app.register(insuranceRoutes);
+  await app.register(holdingRoutes);
+  await app.register(netWorthRoutes);
+  await app.register(insightRoutes);
+  await app.register(reportRoutes);
+  await app.register(searchRoutes);
+  await app.register(backupRoutes);
+  await app.register(aiRoutes);
+  await app.register(aiEventRoutes);
+  await app.register(planningRoutes);
+  await app.register(profileRoutes);
+  await app.register(inboxRoutes);
+  await app.register(mailboxRoutes);
+  await app.register(resourceRoutes);
+  await app.register(userTaskRoutes);
+}
+
 export async function buildApp(config: Config): Promise<FastifyInstance> {
   const app = Fastify({
     logger: {
@@ -172,45 +222,7 @@ export async function buildApp(config: Config): Promise<FastifyInstance> {
   // gzip/brotli JSON responses above ~1KB (transaction pages, reports, aggregates).
   // Skips small bodies where compression overhead isn't worth it.
   await app.register(compress, { global: true, threshold: 1024 });
-  await app.register(healthRoutes);
-  await app.register(authRoutes);
-  await app.register(accountRoutes);
-  await app.register(categoryRoutes);
-  await app.register(transactionRoutes);
-  await app.register(transferRoutes);
-  await app.register(attachmentRoutes);
-  await app.register(transactionLinkRoutes);
-  await app.register(importRoutes);
-  await app.register(ruleRoutes);
-  await app.register(budgetRoutes);
-  await app.register(dashboardRoutes);
-  await app.register(notificationRoutes);
-  await app.register(recurringRoutes);
-  await app.register(goalRoutes);
-  await app.register(sipRoutes);
-  await app.register(cashflowRoutes);
-  await app.register(billRoutes);
-  await app.register(cardRoutes);
-  await app.register(emiRoutes);
-  await app.register(retirementRoutes);
-  await app.register(accountNpsRoutes);
-  await app.register(bankDetailsRoutes);
-  await app.register(overdraftDetailsRoutes);
-  await app.register(insuranceRoutes);
-  await app.register(holdingRoutes);
-  await app.register(netWorthRoutes);
-  await app.register(insightRoutes);
-  await app.register(reportRoutes);
-  await app.register(searchRoutes);
-  await app.register(backupRoutes);
-  await app.register(aiRoutes);
-  await app.register(aiEventRoutes);
-  await app.register(projectionSettingsRoutes);
-  await app.register(profileRoutes);
-  await app.register(inboxRoutes);
-  await app.register(mailboxRoutes);
-  await app.register(resourceRoutes);
-  await app.register(userTaskRoutes);
+  await registerRoutes(app);
 
   // Best-effort cleanup; in-flight microtask handlers may still reference closed resources.
   app.addHook("onClose", () => {
```

### apps/api/src/db/schema.ts
```diff
diff --git a/apps/api/src/db/schema.ts b/apps/api/src/db/schema.ts
index 92bd2fb..3e77f46 100644
--- a/apps/api/src/db/schema.ts
+++ b/apps/api/src/db/schema.ts
@@ -17,6 +17,9 @@ import {
   uuid,
   type AnyPgColumn,
 } from "drizzle-orm/pg-core";
+import { users } from "./core-schema.ts";
+export { users } from "./core-schema.ts";
+export * from "../modules/planning/schema.ts";
 
 /**
  * Schema conventions:
@@ -25,30 +28,13 @@ import {
  *   sign convention: negative = outflow (expense), positive = inflow (income)
  * - timestamps: timestamptz, created_at/updated_at on every table
  * - soft delete / archive: *_at nullable timestamptz
+ *
+ * `users` lives in `./core-schema.ts` (a cycle-free leaf) and `projectionSettings`
+ * lives in `../modules/planning/schema.ts` — both re-exported from this barrel.
+ * See `modules/<domain>/` for the emerging module-scaffold convention that
+ * later Phase-1 tasks will extend to the rest of these tables.
  */
 
-export const users = pgTable("users", {
-  id: uuid("id").primaryKey().defaultRandom(),
-  email: text("email").notNull().unique(),
-  passwordHash: text("password_hash").notNull(),
-  displayName: text("display_name").notNull(),
-  /** the seeded, read-only demo account; excluded from the owner-bootstrap count */
-  isDemo: boolean("is_demo").notNull().default(false),
-  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
-  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
-});
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
-
 /** Per-user profile information. */
 export const userProfiles = pgTable("user_profiles", {
   userId: uuid("user_id")
```

### apps/api/src/services/goals.ts
```diff
diff --git a/apps/api/src/services/goals.ts b/apps/api/src/services/goals.ts
index 4a21453..c685107 100644
--- a/apps/api/src/services/goals.ts
+++ b/apps/api/src/services/goals.ts
@@ -19,7 +19,7 @@ import { buildGoalPlan } from "./goal-plan.ts";
 import { createNotification } from "./notifications.ts";
 import { incomeExpense, periodRange, prevPeriodKey, currentPeriodKey } from "./periods.ts";
 import { prefEnabled } from "./prefs.ts";
-import { getProjectionSettings } from "./projection-settings.ts";
+import { getProjectionSettings } from "../modules/planning/services/projection-settings.ts";
 import { committedForGoal } from "./sips.ts";
 import {
   accountAllocationClass,
```

### tasks/01.05-migrate-planning.md
One line changed (line 10):
```
-Routes: budgets, goals, cashflow, bills, projection-settings, dashboard, insights, reports. Tables: budgets, budget_lines, budget_alerts, goals, subscription_dismissals.
+Routes: budgets, goals, cashflow, bills, projection-settings, dashboard, insights, reports. Tables: budgets, budget_lines, budget_alerts, goals, subscription_dismissals, projection_settings.
```
(This file was untracked at session start, so `git diff` shows no baseline; confirmed via direct read that this is the only change from the file's pre-session content.)

### tasks/README.md
`git diff --stat` shows 321 lines changed for this file, but that is **pre-existing** (present in the working tree before this task began, from an earlier session's roadmap replan — confirmed via `git status` at the very start of this session). This task's own contribution is exactly one appended line, confirmed directly:
```diff
+- **The 0.3 route-table snapshot proves URL/method identity only** — it does not prove auth requirements, `config.public` metadata, demo-write protection, or CSRF/rate-limit classification survive a plugin-encapsulation change. Tasks 1.1-1.8 must each verify those separately as their own acceptance criterion when converting flat route registrations into prefixed/nested module plugins.
```
placed immediately after the pre-existing "Never `git add -A`" bullet.

---

## New file contents

### apps/api/src/modules/planning/schema.ts
```ts
import { integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "../../db/core-schema.ts";

/** Per-user assumptions used only for forward-looking goal projections. */
export const projectionSettings = pgTable("projection_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Broad-equity annual return assumption (1200 = 12%). */
  equityReturnBps: integer("equity_return_bps").notNull().default(1200),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### apps/api/src/modules/planning/services/projection-settings.ts
```ts
import { eq } from "drizzle-orm";
import type { ProjectionSettings, UpdateProjectionSettings } from "@compass/shared";
import { UpdateProjectionSettingsSchema } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { projectionSettings } from "../schema.ts";
import { DEFAULT_EQUITY_RETURN_BPS } from "../../../services/goal-returns.ts";

export async function getProjectionSettings(db: Db, userId: string): Promise<ProjectionSettings> {
  const row = await db.query.projectionSettings.findFirst({
    where: eq(projectionSettings.userId, userId),
  });
  return { equityReturnBps: row?.equityReturnBps ?? DEFAULT_EQUITY_RETURN_BPS };
}

export async function updateProjectionSettings(
  db: Db,
  userId: string,
  input: UpdateProjectionSettings,
): Promise<ProjectionSettings> {
  const parsed = UpdateProjectionSettingsSchema.parse(input);
  const [row] = await db
    .insert(projectionSettings)
    .values({ userId, ...parsed })
    .onConflictDoUpdate({
      target: projectionSettings.userId,
      set: { ...parsed, updatedAt: new Date() },
    })
    .returning();
  return { equityReturnBps: row!.equityReturnBps };
}
```

### apps/api/src/modules/planning/routes/projection-settings.ts
```ts
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { ProjectionSettingsSchema, UpdateProjectionSettingsSchema } from "@compass/shared";
import {
  getProjectionSettings,
  updateProjectionSettings,
} from "../services/projection-settings.ts";

export async function projectionSettingsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/projection-settings",
    { schema: { response: { 200: ProjectionSettingsSchema } } },
    async (req) => getProjectionSettings(app.db, req.session!.userId),
  );

  r.put(
    "/api/projection-settings",
    {
      schema: {
        body: UpdateProjectionSettingsSchema,
        response: { 200: ProjectionSettingsSchema },
      },
    },
    async (req) => updateProjectionSettings(app.db, req.session!.userId, req.body),
  );
}
```

### apps/api/src/modules/planning/plugin.ts
```ts
import type { FastifyInstance } from "fastify";
import { projectionSettingsRoutes } from "./routes/projection-settings.ts";

/**
 * `modules/<domain>/` convention (introduced by task 0.3, the first slice of
 * the planning module task 1.5 will complete): `schema.ts` (Drizzle tables),
 * `services/` (business logic + db access), `routes/` (thin Fastify handlers
 * validated with `@compass/shared` Zod schemas), `plugin.ts` (this file — the
 * single Fastify plugin entry `app.ts` registers for the whole module).
 *
 * Today this only wires up `projection_settings`. Task 1.5 registers the rest
 * of the planning module here (budgets, goals, cashflow, bills, dashboard,
 * insights, reports).
 */
export async function planningRoutes(app: FastifyInstance): Promise<void> {
  await app.register(projectionSettingsRoutes);
}
```

### apps/api/src/db/core-schema.ts
(shown above in P2)

### apps/api/src/db/schema.smoke.test.ts
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";
import { createDb } from "./index.ts";
import { schema } from "./index.ts";
import { users } from "./core-schema.ts";
import { projectionSettings } from "../modules/planning/schema.ts";

// Hermetic runtime schema check: no live DB connection, no query issued. See
// Root Cause item 2 in tasks/006-module-scaffold-and-route-gate/TASK.md for
// why constructing createDb() with a non-connecting stub pg.Pool is safe and
// still a genuine runtime check (drizzle(pool, { schema }) only stores the
// pool reference and builds db.query.* from the schema object itself at
// construction time — it issues no query and opens no connection).

test("schema barrel exposes users and projectionSettings exactly once, with correct table names/columns", () => {
  assert.equal(schema.users, users, "users must be the same table object re-exported from core-schema.ts");
  assert.equal(
    schema.projectionSettings,
    projectionSettings,
    "projectionSettings must be the same table object re-exported from modules/planning/schema.ts",
  );

  const usersConfig = getTableConfig(schema.users);
  assert.equal(usersConfig.name, "users");

  const projectionSettingsConfig = getTableConfig(schema.projectionSettings);
  assert.equal(projectionSettingsConfig.name, "projection_settings");
  const columnNames = projectionSettingsConfig.columns.map((c) => c.name).sort();
  assert.deepEqual(columnNames, ["created_at", "equity_return_bps", "updated_at", "user_id"]);
});

test("a real createDb() instance (non-connecting stub pool) exposes db.query.users and db.query.projectionSettings at runtime", () => {
  // A stub pg.Pool that would throw if drizzle ever tried to use it — proving
  // no query is issued and no connection is opened during construction.
  const stubPool = {
    query: () => {
      throw new Error("stub pool must never be queried by this test");
    },
    connect: () => {
      throw new Error("stub pool must never be connected to by this test");
    },
  } as unknown as pg.Pool;

  const db = createDb(stubPool);

  assert.ok(db.query.users, "db.query.users must exist on the constructed Drizzle instance");
  assert.ok(
    db.query.projectionSettings,
    "db.query.projectionSettings must exist on the constructed Drizzle instance",
  );
});
```

### apps/api/src/app.route-snapshot.test.ts
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { registerRoutes } from "./app.ts";

// Hermetic route-table identity gate: Fastify + the two Zod compilers +
// registerRoutes(app) + app.ready() only — no requireEnv(), no Postgres,
// Redis, storage, config, eventBus, auth, or security plugins. Confirmed
// sufficient because setupAuth/setupSecurity only add per-request hooks (not
// routes) and route handlers never execute during app.ready()/printRoutes().
//
// Trailing-newline policy: the committed snapshot (route-table.snapshot.txt)
// is the raw, unmodified string returned by
// `app.printRoutes({ commonPrefix: false })`, written byte-for-byte via
// writeFileSync with no extra trailing newline appended — so the comparison
// below is a literal `===` against the file's exact bytes (decoded as UTF-8),
// not a trimmed comparison.

const SNAPSHOT_URL = new URL("./route-table.snapshot.txt", import.meta.url);

/**
 * The exact comparison function the main snapshot test calls. Throws with a
 * diagnostic message on any mismatch — added route, removed route, renamed
 * route, or a changed HTTP method are all just string differences from this
 * function's point of view. This function's *rejection* behavior is what the
 * synthetic sub-test below proves; it does not, by itself, prove that
 * `printRoutes()` renders every production route change as a string diff —
 * that assurance comes from the real P1 → P3 → P6 baseline-diff chain
 * documented in tasks/006-module-scaffold-and-route-gate/TASK.md.
 */
function assertRouteTableMatches(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(
      "Route table does not match the committed snapshot (route-table.snapshot.txt) — " +
        "an added, removed, renamed, or method-changed route was detected. " +
        "Phase 1 module-migration tasks must not change this snapshot; if a route " +
        "genuinely needs to change, update route-table.snapshot.txt deliberately.",
    );
  }
}

test("route table matches the committed snapshot byte-for-byte", async (t) => {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await registerRoutes(app);
  await app.ready();
  t.after(() => app.close());

  const actual = app.printRoutes({ commonPrefix: false });
  const expected = readFileSync(SNAPSHOT_URL, "utf8");

  assertRouteTableMatches(actual, expected);
});

// ---------- Synthetic comparison-helper sub-test ----------
//
// This proves assertRouteTableMatches() itself rejects an added route, a
// removed route, a renamed route, and a method change (GET -> POST) against
// hand-written before/after strings. It is a unit test of the helper's
// rejection behavior only, NOT a claim that printRoutes() would render every
// such production change identically to these synthetic examples.

test("assertRouteTableMatches rejects an added route", () => {
  const before = "├── /api/accounts (GET, HEAD, POST)\n";
  const after = "├── /api/accounts (GET, HEAD, POST)\n├── /api/new-thing (GET, HEAD)\n";
  assert.throws(() => assertRouteTableMatches(after, before));
});

test("assertRouteTableMatches rejects a removed route", () => {
  const before = "├── /api/accounts (GET, HEAD, POST)\n├── /api/goals (GET, HEAD)\n";
  const after = "├── /api/accounts (GET, HEAD, POST)\n";
  assert.throws(() => assertRouteTableMatches(after, before));
});

test("assertRouteTableMatches rejects a renamed route", () => {
  const before = "├── /api/goals (GET, HEAD)\n";
  const after = "├── /api/goal-plans (GET, HEAD)\n";
  assert.throws(() => assertRouteTableMatches(after, before));
});

test("assertRouteTableMatches rejects a method change (GET -> POST)", () => {
  const before = "├── /api/projection-settings (GET, HEAD, PUT)\n";
  const after = "├── /api/projection-settings (POST, HEAD, PUT)\n";
  assert.throws(() => assertRouteTableMatches(after, before));
});

test("assertRouteTableMatches accepts identical tables", () => {
  const table = "├── /api/accounts (GET, HEAD, POST)\n";
  assert.doesNotThrow(() => assertRouteTableMatches(table, table));
});
```

### apps/api/src/modules/planning/services/projection-settings.test.ts
```ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { users } from "../../../db/core-schema.ts";
import { getProjectionSettings, updateProjectionSettings } from "./projection-settings.ts";

// These need a real Postgres connection (DATABASE_URL) — this repo has no
// DB-mocking infrastructure (see services/user-tasks.test.ts's identical
// DB-backed section). Each test creates its own throwaway user(s) and cleans
// them up via t.after(); deleting the user cascades to its projection_settings
// row (see modules/planning/schema.ts's `onDelete: "cascade"`).

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "projection-settings.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres " +
        "connection) — this repo has no DB-mocking infrastructure. Export it (see apps/api/.env) " +
        "before running `npm run test -w apps/api`.",
    );
  }
  return url;
}

const pool = createPool(requireDatabaseUrl());
const db = createDb(pool);
after(async () => {
  await pool.end();
});

async function createUser(): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email: `projection-settings-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "projection-settings.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}

test("getProjectionSettings returns the default equityReturnBps (1200) when no row exists", async (t) => {
  const userId = await createUser();
  t.after(async () => {
    await cleanupUser(userId);
  });

  const settings = await getProjectionSettings(db, userId);
  assert.equal(settings.equityReturnBps, 1200);
});

test("updateProjectionSettings validates and upserts a new row", async (t) => {
  const userId = await createUser();
  t.after(async () => {
    await cleanupUser(userId);
  });

  const result = await updateProjectionSettings(db, userId, { equityReturnBps: 900 });
  assert.equal(result.equityReturnBps, 900);

  const fetched = await getProjectionSettings(db, userId);
  assert.equal(fetched.equityReturnBps, 900);
});

test("a second updateProjectionSettings call updates the existing row rather than inserting a duplicate", async (t) => {
  const userId = await createUser();
  t.after(async () => {
    await cleanupUser(userId);
  });

  await updateProjectionSettings(db, userId, { equityReturnBps: 900 });
  const second = await updateProjectionSettings(db, userId, { equityReturnBps: 1500 });
  assert.equal(second.equityReturnBps, 1500);

  const fetched = await getProjectionSettings(db, userId);
  assert.equal(fetched.equityReturnBps, 1500);
});

test("two different users' projection settings do not affect each other", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });

  await updateProjectionSettings(db, userA, { equityReturnBps: 800 });
  await updateProjectionSettings(db, userB, { equityReturnBps: 1400 });

  const a = await getProjectionSettings(db, userA);
  const b = await getProjectionSettings(db, userB);
  assert.equal(a.equityReturnBps, 800);
  assert.equal(b.equityReturnBps, 1400);
});
```

### apps/api/src/modules/planning/routes/projection-settings.route.test.ts
```ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { loadConfig } from "../../../config.ts";
import { createPool } from "../../../infra/db.ts";
import { createRedis } from "../../../infra/redis.ts";
import { createDb } from "../../../db/index.ts";
import { setupAuth, SESSION_COOKIE } from "../../../plugins/auth.ts";
import { setupSecurity } from "../../../plugins/security.ts";
import { planningRoutes } from "../plugin.ts";
import { createSession, destroySession } from "../../../services/session.ts";
import { users } from "../../../db/core-schema.ts";

// A Fastify injection test exercising the real HTTP layer (planningRoutes ->
// projectionSettingsRoutes, the auth hook, and demo-mode). Follows the
// buildTestApp() convention established by routes/user-tasks.route.test.ts:
// deliberately NOT built on buildApp() from app.ts (that also calls
// startJobs(), which registers BullMQ schedulers/queues against the shared
// dev Redis and never closes its "ingestor" queue connection, hanging
// `node --test`). This harness wires up only what these routes need —
// Postgres, Redis, the auth/security plugins, and planningRoutes itself.
//
// Needs a real Postgres + Redis connection (DATABASE_URL, REDIS_URL,
// SESSION_SECRET) — export them (see apps/api/.env) before running
// `npm run test -w apps/api`.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `projection-settings.route.test.ts needs ${name} set (a real Postgres/Redis-backed app ` +
        "boot) — export it (see apps/api/.env) before running `npm run test -w apps/api`.",
    );
  }
  return value;
}
requireEnv("DATABASE_URL");
requireEnv("REDIS_URL");
requireEnv("SESSION_SECRET");

async function buildTestApp(): Promise<FastifyInstance> {
  const config = loadConfig();
  const app = Fastify({ logger: false, trustProxy: true });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("config", config);
  app.decorate("pg", createPool(config.DATABASE_URL));
  app.decorate("db", createDb(app.pg));
  app.decorate("redis", createRedis(config.REDIS_URL));
  await setupAuth(app);
  await setupSecurity(app);
  await app.register(planningRoutes);
  app.addHook("onClose", async () => {
    await app.pg.end();
    app.redis.disconnect();
  });
  return app;
}

const app = await buildTestApp();
after(async () => {
  await app.close();
});

async function createUser(): Promise<string> {
  const [u] = await app.db
    .insert(users)
    .values({
      email: `projection-settings-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "projection-settings.route.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await app.db.delete(users).where(eq(users.id, userId));
}

/** A `cookies` map for `app.inject()`, carrying a signed session cookie. */
function sessionCookie(sessionId: string): Record<string, string> {
  return { [SESSION_COOKIE]: app.signCookie(sessionId) };
}

test("an unauthenticated request to GET /api/projection-settings is rejected", async () => {
  const res = await app.inject({ method: "GET", url: "/api/projection-settings" });
  assert.equal(res.statusCode, 401);
});

test("a demo session's PUT /api/projection-settings is rejected 403, with no database effect", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, { demo: true });
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "PUT",
    url: "/api/projection-settings",
    cookies: sessionCookie(sessionId),
    payload: { equityReturnBps: 700 },
  });
  assert.equal(res.statusCode, 403);
});

test("an authenticated GET/PUT round-trip works", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const getDefault = await app.inject({
    method: "GET",
    url: "/api/projection-settings",
    cookies: sessionCookie(sessionId),
  });
  assert.equal(getDefault.statusCode, 200);
  assert.equal((getDefault.json() as { equityReturnBps: number }).equityReturnBps, 1200);

  const put = await app.inject({
    method: "PUT",
    url: "/api/projection-settings",
    cookies: sessionCookie(sessionId),
    payload: { equityReturnBps: 1000 },
  });
  assert.equal(put.statusCode, 200);
  assert.equal((put.json() as { equityReturnBps: number }).equityReturnBps, 1000);

  const getAfter = await app.inject({
    method: "GET",
    url: "/api/projection-settings",
    cookies: sessionCookie(sessionId),
  });
  assert.equal(getAfter.statusCode, 200);
  assert.equal((getAfter.json() as { equityReturnBps: number }).equityReturnBps, 1000);
});
```

### apps/api/src/route-table.snapshot.txt
156 lines, `app.printRoutes({ commonPrefix: false })` output. sha256: `062d89155f0f21b3d3fb9f3f431de0337f70071b10ac3128080f146421c235f9`. First/last 20 lines:
```
├── /health (GET, HEAD)
├── /api/auth/bootstrap (GET, HEAD)
├── /api/auth/demo (POST)
├── /api/auth/register (POST)
├── /api/auth/login (POST)
├── /api/auth/logout (POST)
├── /api/auth/me (GET, HEAD)
├── /api/auth/profile (PATCH)
├── /api/auth/password (POST)
├── /api/auth/sessions (GET, HEAD)
│   └── /:id (DELETE)
├── /api/accounts (GET, HEAD, POST)
│   ├── /average-balance (GET, HEAD)
│   └── /:id|:accountId (PATCH, DELETE)
│       ├── /nps-details (GET, HEAD, PUT)
│       ├── /bank-details (GET, HEAD, PUT)
│       └── /overdraft-details (GET, HEAD, PUT)
├── /api/attachments/:id (GET, HEAD, DELETE)
├── /api/ai/settings (GET, HEAD, PUT)
├── /api/ai/summary (POST)
...
├── /api/forecast (GET, HEAD)
├── /api/family (GET, HEAD, POST)
│   └── /:id (PATCH, DELETE)
├── /api/portfolio (GET, HEAD)
├── /api/projection-settings (GET, HEAD, PUT)
├── /api/profile (GET, HEAD, PUT)
├── /api/holdings (POST)
│   ├── /capital-gains (GET, HEAD)
│   ├── /refresh-nav (POST)
│   ├── /import-mf/preview (POST)
│   ├── /import-mf/commit (POST)
│   └── /:id (PATCH, DELETE)
│       ├── /valuation (PUT)
│       ├── /events (POST)
│       │   └── /:eventId (DELETE)
│       │       └── /move (POST)
│       ├── /nps (GET, HEAD, PUT)
│       └── /gold (GET, HEAD, PUT)
└── /api/user-tasks (GET, HEAD, POST)
    └── /:id (GET, HEAD, PATCH, DELETE)
```

---

## Deviations from the plan

None to which files exist, what they do, or what the acceptance criteria mean. Two implementation-level notes, both corrected in-flight and re-verified:

1. My first pass at editing `db/schema.ts` in P2 mistakenly moved `projectionSettings` out and added `export * from "../modules/planning/schema.ts"` prematurely (before `modules/planning/schema.ts` existed) — caught before running any command, corrected to keep `projectionSettings` inline until P5 as TASK.md's Plan literally specifies ("at this point in the sequence only `users` has moved"). No test or typecheck was run against the incorrect intermediate state.
2. `schema.smoke.test.ts` initially imported `projectionSettings` from `modules/planning/schema.ts` but only asserted against `schema.projectionSettings`, leaving the import unused — caught by `npm run lint` (1 error), fixed by asserting `schema.projectionSettings === projectionSettings` (mirroring the existing `users` identity assertion). Re-ran lint (0 errors) and the smoke test (2/2 pass) after the fix.

---

## Confirmation: old files no longer exist

```
$ ls apps/api/src/services/projection-settings.ts
lsd: /home/udai/PennyPilot/apps/api/src/services/projection-settings.ts: No such file or directory (os error 2)
$ ls apps/api/src/routes/projection-settings.ts
lsd: /home/udai/PennyPilot/apps/api/src/routes/projection-settings.ts: No such file or directory (os error 2)
```

## Unresolved risks

- `apps/extractor`'s `test` script does not load `.env`, so the root `npm run test` always exits 1 on that workspace regardless of this task — a pre-existing gap, out of this task's scope (not in DELEGATION.md's file list), flagged here rather than fixed.
- The route-table snapshot gate protects URL/method identity only, as documented in Non-Goals/Known-traps — it does not prove auth/public/demo/CSRF/rate-limit scope survives Phase 1's later plugin-encapsulation work. Each of tasks 1.1–1.8 must write its own acceptance criterion for that, per the new `tasks/README.md` line.
