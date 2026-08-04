# Sonnet Worker Delegation — iteration 1

## Task
006-module-scaffold-and-route-gate (roadmap id 0.3, `tasks/00.03-module-scaffold-and-route-gate.md`)

## Approved Plan
Full detail in `tasks/006-module-scaffold-and-route-gate/TASK.md` (status APPROVED, revision 3). Execute P1 through P11 from that file's Plan section, **in order** — later steps depend on earlier ones (P3 depends on P2's typecheck passing; P5 depends on P3/P4's snapshot existing to diff against; etc.). Do not reorder or skip steps. If you find you must deviate materially from the approved plan (not a small implementation detail, but a change to which files exist, what they do, or what the acceptance criteria mean), STOP and report back rather than improvising — that would require a new plan review.

Read the full `TASK.md` yourself before starting — it contains the Root Cause section explaining *why* each design decision was made (the `db/core-schema.ts` circular-import fix, why the route-snapshot harness is hermetic, why `plugin.ts` must be a real Fastify plugin, etc.). Do not just follow the Plan bullets mechanically without understanding the reasoning; three rounds of Codex plan review already rejected simpler approaches for reasons documented there.

## Files and Symbols
**New files:**
- `apps/api/src/db/core-schema.ts` (the `users` table, moved verbatim from `apps/api/src/db/schema.ts`)
- `apps/api/src/db/schema.smoke.test.ts` (hermetic runtime schema test)
- `apps/api/src/modules/planning/schema.ts` (the `projectionSettings` table, moved from `apps/api/src/db/schema.ts`)
- `apps/api/src/modules/planning/services/projection-settings.ts` (moved from `apps/api/src/services/projection-settings.ts`)
- `apps/api/src/modules/planning/services/projection-settings.test.ts` (new)
- `apps/api/src/modules/planning/routes/projection-settings.ts` (moved from `apps/api/src/routes/projection-settings.ts`)
- `apps/api/src/modules/planning/routes/projection-settings.route.test.ts` (new)
- `apps/api/src/modules/planning/plugin.ts` (new — real Fastify plugin entry)
- `apps/api/src/route-table.snapshot.txt` (committed snapshot)
- `apps/api/src/app.route-snapshot.test.ts` (new)

**Modified files:**
- `apps/api/src/app.ts` (extract `registerRoutes()`, import `planningRoutes` instead of `projectionSettingsRoutes`)
- `apps/api/src/db/schema.ts` (becomes a barrel for `users`/`projectionSettings`; every other table unchanged)
- `apps/api/src/services/goals.ts` (update import path for `getProjectionSettings`)
- `CLAUDE.md` (short addition documenting the transitional module convention)
- `tasks/01.05-migrate-planning.md` (add `projection_settings` to the Tables list — this is a roadmap task file under `tasks/`; edit only the one line described)
- `tasks/README.md` (add one line to "Known traps" — again, edit only that one addition)

**Deleted files:**
- `apps/api/src/services/projection-settings.ts`
- `apps/api/src/routes/projection-settings.ts`

## Required Changes
Follow `TASK.md`'s Plan section P1–P11 exactly. Key non-negotiable details (all justified in TASK.md's Root Cause / Scope — read them for the "why"):
1. **P1 must run first, before any other edit.** Capture the pre-change route table from the *current, unmodified* `app.ts` using a throwaway harness that duplicates the 39 `app.register(...)` calls, cross-checked line-by-line against the real `app.ts` (`grep -n "app.register(" apps/api/src/app.ts`), with the exact captured line/route count recorded (not "~155"). Save to a scratch path outside git (e.g. `/tmp/route-baseline.txt`), keep it until P6 confirms against it, then it can be discarded (do not commit it).
2. `db/schema.ts`'s barrel wiring must be `import { users } from "./core-schema.ts"; export { users } from "./core-schema.ts"; export * from "../modules/planning/schema.ts";` — an `export *` alone does not create a local binding for `db/schema.ts`'s own remaining inline tables that reference `users` in `.references(() => users.id, ...)`.
3. `modules/planning/schema.ts` imports `users` from `../../db/core-schema.ts` directly — never from the `db/schema.ts` barrel (that would recreate the circular import Codex's first review caught).
4. `modules/planning/plugin.ts` must be the actual production registration path — `app.ts`'s `registerRoutes()` registers `planningRoutes` (from `plugin.ts`), which itself registers `projectionSettingsRoutes`. Do not have `app.ts` import `projectionSettingsRoutes` directly and treat `plugin.ts` as decorative.
5. The route-snapshot test (`app.route-snapshot.test.ts`) must be hermetic: `Fastify({ logger: false })` + `setValidatorCompiler`/`setSerializerCompiler` (Zod) + `registerRoutes(app)` + `await app.ready()` only. No `requireEnv()`, no Postgres/Redis/storage/config/eventBus/auth/security decorations — confirmed unnecessary by Codex's own independent test during review. Use `app.printRoutes({ commonPrefix: false })`, load the committed snapshot via `new URL("./route-table.snapshot.txt", import.meta.url)`, and close the app in `t.after()`.
6. The synthetic added/removed/renamed/method-changed sub-test in that same test file proves the **comparison helper's** rejection behavior (`assert.throws`) against hand-written strings — it is not a substitute for the real P1→P3→P6 baseline-diff chain, and must not be described as proving `printRoutes()` itself detects every change.
7. `schema.smoke.test.ts` must construct an actual Drizzle instance via `createDb()` passed a non-connecting stub `pg.Pool` (no query issued, no connection opened — `drizzle(pool, { schema })` only stores the pool reference and builds `db.query.*` from the schema object at construction time) and assert `db.query.users`/`db.query.projectionSettings` **exist on that real object** — checking only against the `NodePgDatabase<typeof schema>` TypeScript type is not sufficient (a type has no runtime existence); this was Codex's review-3 finding.
8. `npm run db:generate` verification must use a content-hash manifest (e.g. `sha256sum` per file) of everything under `apps/api/drizzle/`, captured before and diffed after — not just `git status --short` (status text can be identical while content differs).
9. New tests: `modules/planning/services/projection-settings.test.ts` (real DB, `requireEnv()`-guarded per the existing convention — see `apps/api/src/services/user-tasks.test.ts` or similar for the pattern) covering: GET default (`equityReturnBps: 1200`) when no row exists; PUT validates and upserts; second PUT updates the same row; two users' settings don't affect each other. `modules/planning/routes/projection-settings.route.test.ts` using the `buildTestApp()` pattern from `apps/api/src/routes/user-tasks.route.test.ts` (real Postgres/Redis, `setupAuth`/`setupSecurity`, **not** `startJobs`/`buildApp()`) covering: unauthenticated request rejected, demo session rejected on `PUT`, authenticated GET/PUT round-trip. Clean up created users/sessions in `t.after()`.
10. Grep confirms no remaining imports of `services/projection-settings.ts`/`routes/projection-settings.ts` from their old flat paths, and confirm by direct check that both old files no longer exist on disk.
11. `CLAUDE.md` addition must describe `core-schema.ts` narrowly (shared identity tables, starting with `users` — not a general cross-module-FK destination) to match TASK.md's Root Cause/Scope wording.
12. `tasks/01.05-migrate-planning.md`: add `projection_settings` to the existing "Tables:" line only — do not otherwise edit that file.
13. `tasks/README.md`: add exactly one line to "Known traps" (see TASK.md Scope for the exact content/framing — it must be phrased as a verification *obligation* for tasks 1.1-1.8, not as something this task's snapshot already guarantees).

## Must Not Change
- No URL, HTTP method, handler body, or response shape for `GET`/`PUT /api/projection-settings` — pure relocation.
- No other table in `apps/api/src/db/schema.ts` besides `users` and `projectionSettings` moves or changes.
- No Fastify route `prefix` added anywhere.
- `apps/api/src/services/backup.ts` (`ALL_TABLES`/`USER_TABLES`) is not touched.
- `.github/workflows/ci.yml` is not touched.
- `multipart`/`compress` plugin registration stays in `buildApp()`, not inside the extracted `registerRoutes()`.
- Do not touch any file under `tasks/` other than the two named one-line additions above and this task's own `tasks/006-module-scaffold-and-route-gate/` folder.

## Acceptance Criteria
AC1–AC5 exactly as written in `tasks/006-module-scaffold-and-route-gate/TASK.md`'s "Acceptance Criteria" section — read them there; do not paraphrase from memory.

## Commands
Run these (adjust paths/working directory as needed; all DB-backed commands need `.env` loaded — from `apps/api`, use `node --env-file-if-exists=../../.env --test ...` per the existing convention in `apps/api/package.json`'s own `test` script):

1. `npm run typecheck` (root)
2. `npm run lint` (root)
3. From `apps/api`: `node --test src/db/schema.smoke.test.ts`
4. From `apps/api`: `node --test src/app.route-snapshot.test.ts`
5. From `apps/api`: `node --env-file-if-exists=../../.env --test src/services/backup.test.ts`
6. From `apps/api`: `node --env-file-if-exists=../../.env --test src/modules/planning/services/projection-settings.test.ts src/modules/planning/routes/projection-settings.route.test.ts`
7. `npm run db:generate` (root) — with before/after content-hash manifest of `apps/api/drizzle/`
8. `npm run test` (root, all workspaces) — full suite
9. `grep -rn "services/projection-settings\|routes/projection-settings" apps/api/src --include=*.ts | grep -v modules/planning`

## Required Evidence
Report back with:
- Full list of files changed (created/modified/deleted), matching the "Files and Symbols" list above exactly — flag any deviation.
- Complete `git diff` (or per-file diffs for new files, since `git diff` won't show new-file content by default — use `git diff --no-index /dev/null <newfile>` or just paste new file contents).
- Every command from "Commands" above with its literal output and exit code — no paraphrasing, no "tests passed" without the actual `node:test` summary line.
- The P1 baseline capture output, the mechanical diff against `app.ts`'s real registrations, and the exact route/line count recorded.
- The before/after content-hash manifest diff for `apps/api/drizzle/`.
- Any point where you deviated from the plan, and why, called out explicitly — do not bury a deviation in a diff and let it go unmentioned.
- Confirmation the two old files (`services/projection-settings.ts`, `routes/projection-settings.ts`) no longer exist on disk.

---

## Iteration 2 (fix, after independent verification + Codex implementation review `review-4.md`)

Implementation was otherwise accepted (Codex `review-4.md`: AC1, AC2, AC3, AC5 pass; route/service behavior unchanged; security/auth/demo-mode preserved; conventions clean). One blocking finding remains:

**Medium — `modules/planning/services/projection-settings.test.ts`'s test named `"updateProjectionSettings validates and upserts a new row"` does not actually exercise validation.** It only calls `updateProjectionSettings(db, userId, { equityReturnBps: 900 })` — a valid value. There is no case with an out-of-range input, no `assert.rejects()`, and no check that an invalid call leaves the database unchanged. The test name overstates what it proves; DELEGATION.md's original required-change 9 asked for "PUT validates and upserts" coverage, and only the upsert half is covered.

### Required fix
In `apps/api/src/modules/planning/services/projection-settings.test.ts`, add a new test (do not just rename the existing one — keep the existing valid-upsert case as-is) that:
1. Calls `updateProjectionSettings(db, userId, { equityReturnBps: <out-of-range value> })` with a value outside `UpdateProjectionSettingsSchema`'s bounds (`packages/shared/src/schemas/goals.ts`: `z.number().int().min(0).max(10_000)` — so e.g. `10_001`, or `-1`, or a non-integer like `1.5`, is invalid).
2. Asserts the call rejects (`updateProjectionSettings` calls `UpdateProjectionSettingsSchema.parse(input)` internally, which throws a `ZodError` on an invalid value — use `await assert.rejects(() => updateProjectionSettings(db, userId, { equityReturnBps: 10_001 }), ...)` or equivalent).
3. Confirms no row was created/changed as a side effect of the rejected call — e.g. call `getProjectionSettings(db, userId)` afterward and assert it still returns the default (`1200`) if no prior valid call was made for that user, or its prior value if one was.

Use a fresh `createUser()`/`t.after(cleanupUser)` pair for this new test, following the existing pattern in the same file — do not reuse another test's user.

### Commands (re-run after the fix)
1. From `apps/api`: `node --env-file-if-exists=../../.env --test src/modules/planning/services/projection-settings.test.ts src/modules/planning/routes/projection-settings.route.test.ts` — must show the new test passing alongside all previously-passing ones (8 tests total, not 7).
2. `npm run typecheck` (root) — exit 0.
3. `npm run lint` (root) — exit 0.
4. From `apps/api`: re-confirm no leftover test users via the same DB query pattern used in `verification-1.md` (`SELECT ... WHERE email ILIKE '%projection-settings%test%@example.invalid'` — must be 0 rows after the new test's `t.after()` cleanup runs).

### Must Not Change (iteration 2)
- Do not touch any other file — this is a single-test addition to a single file.
- Do not change `updateProjectionSettings`'s production implementation — it already validates correctly; this is purely a missing-test fix.

### Required Evidence (iteration 2)
- The diff of `projection-settings.test.ts` (just the added test).
- Literal test output showing 8/8 pass (or however many tests result), exit 0.
- `npm run typecheck`/`npm run lint` exit codes.
- The leftover-user DB query result (0 rows).
