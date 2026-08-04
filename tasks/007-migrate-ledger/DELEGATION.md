# Sonnet Worker Delegation — iteration 1

## Task
007-migrate-ledger (roadmap id 1.1, `tasks/01.01-migrate-ledger.md`)

## Approved Plan
Full detail in `tasks/007-migrate-ledger/TASK.md` (status APPROVED, revision 4 — three rounds of Codex plan review, all required corrections applied). Execute P1 through P13 from that file's Plan section, **in order** — later steps genuinely depend on earlier ones (P9's snapshot comparison depends on P2's baseline; P7's cross-reference updates depend on P4/P5's moves being done; the full gate in P13 depends on everything else). Do not reorder or skip steps.

**Read the full `TASK.md` yourself before starting, especially the Root Cause section.** It documents *why* every design decision was made — three review rounds rejected simpler approaches for reasons explained there. In particular, understand:
- Why table definitions stay in `db/schema.ts` (not physically relocated into `modules/ledger/schema.ts`) — a real bidirectional FK-cycle risk across nearly all future modules, not a stylistic choice.
- Why the route-identity gate is now **two** snapshots, not one: a canonical `route-surface.snapshot.txt` (method+path pairs, the real "must never change" invariant) and the existing raw `route-table.snapshot.txt` (expected to change here, since collapsing 11 registrations into 1 plugin legitimately restructures Fastify's printed tree even though no URL/method changes — this was proven, not assumed, during plan review).
- Why completeness verification (T11) is NOT a basename grep in either direction — a correct new import still contains the moved file's basename, so no basename-shaped check can distinguish old from new.

Also read `tasks/007-migrate-ledger/investigation-1.md` (the original file/line-count/FK/cross-import investigation) — it's the factual basis for the plan and has exact line numbers, exact FK lists, and the exact endpoint enumeration used by `plugin.test.ts`'s assertions.

## Files and Symbols

**New files:**
- `apps/api/src/modules/ledger/schema.ts` — thin named re-export of 11 tables + 7 enums from `../../db/schema.ts` (exact list in TASK.md Root Cause)
- `apps/api/src/modules/ledger/schema.smoke.test.ts` — object-identity test (all 11 tables, barrel vs. module re-export)
- `apps/api/src/modules/ledger/plugin.ts` — `ledgerRoutes(app)`, registers all 11 route plugins internally, no prefix
- `apps/api/src/modules/ledger/plugin.test.ts` — one uniquely-attributable route per each of the 11 registrations, via route-lookup only (never `app.inject()`) — exact 11 (method,path) pairs listed in TASK.md Scope
- `apps/api/src/route-surface.snapshot.txt` — new canonical (method,path) snapshot
- `apps/api/src/modules/ledger/services/{accounts,categories,transactions,transfers,transaction-links,attachments,recurring,merchants,resources,search,user-tasks,average-balance,epf-contributions}.ts` — moved from `apps/api/src/services/`
- `apps/api/src/modules/ledger/routes/{accounts,categories,transactions,transfers,transaction-links,attachments,recurring,rules,resources,search,user-tasks}.ts` — moved from `apps/api/src/routes/`
- 11 moved test files (exact list in TASK.md Scope, includes `average-balance.test.ts` and `epf-contributions.test.ts` which are easy to miss)

**Modified files:**
- `apps/api/src/app.ts` — `registerRoutes()`'s 11 calls collapse to 1 (`ledgerRoutes`)
- `apps/api/src/app.route-snapshot.test.ts` — split into the two gates (canonical hard gate + reclassified raw-tree gate)
- `apps/api/src/route-table.snapshot.txt` — regenerated (expected, document why in evidence)
- ~20 cross-module files (both directions — files importing FROM ledger services, and moved ledger files importing FROM still-flat services — full enumeration in TASK.md Root Cause)
- `tasks/01.01-migrate-ledger.md` — one-line factual correction (remove `imports.ts` mention)
- `tasks/01.09-cross-module-ports.md` — strengthened multi-part edit (see TASK.md Scope for exact required content: `1.1` added to `depends:`, ownership paragraph, cyclic-SCC/transitional-surface/Drizzle-Kit-entry-point/identity acceptance criteria)
- `CLAUDE.md` — short paragraph distinguishing physical schema ownership (0.3's `projection_settings`) from this task's transitional thin surface

**Deleted files:** 13 original service files + 11 original route files + 11 original test-file locations (24 + 11 = 35 paths total) — moved, not duplicated.

## Required Changes
Follow TASK.md's Plan (P1-P13) exactly. The load-bearing details, all justified in TASK.md's Root Cause:

1. **Schema thin re-export, exact surface** (P3): `modules/ledger/schema.ts` re-exports exactly the 11 tables + 7 enums named in Root Cause — verify the enum list against the actual `db/schema.ts` yourself, don't assume it's exhaustive. `db/schema.ts` must **not** `export *` back from `modules/ledger/schema.ts` (that would recreate a cycle).
2. **Split imports for mixed-table files** (P4): `services/accounts.ts` and `services/recurring.ts` are confirmed to import both ledger and still-flat tables — use two separate import statements (one from `../schema.ts` for ledger tables, one from the appropriate depth-adjusted path to `db/schema.ts` for still-flat tables). Check every other moved file's import block individually — don't assume only these two need splitting.
3. **Every relative import in every moved file gets classified and repointed** (P4/P5): ledger-local / ledger schema (`../schema.ts`) / still-flat API code (depth-adjusted, e.g. `services/accounts.ts`'s import of `./ownership.ts` becomes a longer relative path since the file moved two directories deeper) / `@compass/shared` (unaffected). This includes `db/index.ts`, `lib/*.ts`, `jobs/*.ts` imports, not just schema/service imports.
4. **`routes/rules.ts`'s direct `merchantRules` query is relocated as-is** — do not refactor it into a service call. Its schema import repoints to `../schema.ts`.
5. **`ledger.mutated` emission**: only `transactions.ts` (5 sites), `transfers.ts` (3 sites), `recurring.ts` (3 sites) emit today. Do not add or remove any emit call anywhere.
6. **Route-snapshot split** (P2, P9): Before touching any application file, capture (a) the current raw `printRoutes()` output and (b) a canonical (method,url) list built via an `onRoute` hook registered before `registerRoutes(app)` — flatten `routeOptions.method` (string or array) and uppercase each method; assert no duplicate `(method,url)` pairs exist; then sort and render as `pairs.map(p => \`${p.method} ${p.url}\`).sort().join("\n") + "\n"` (this exact newline policy — one trailing newline, nothing else). Commit the canonical list now as `route-surface.snapshot.txt` — **this file is never regenerated after this initial capture**; every later comparison (P9) is against this exact file, never a rewritten version of it. After the migration (P9), recompute the canonical output live and compare byte-for-byte against the untouched committed file (must be identical) — separately, regenerate the raw `route-table.snapshot.txt` and commit the new version, with the diff pasted in your evidence and explicitly checked against three things: every leaf method/path in the new raw tree corresponds to an entry in the (unchanged) canonical set; only ordering/common-prefix-grouping/branch-glyphs/plugin-nesting differ; no unexpected route constraint or duplicated branch appears.
7. **`plugin.test.ts`** (P6): hermetic (no DB/Redis/env), registers `ledgerRoutes` directly, asserts these exact 11 (method,path) pairs resolve via route-lookup/registration introspection only (never `app.inject()`, since handlers need decorations this instance doesn't have): `GET /api/accounts/average-balance`, `GET /api/categories/tree`, `POST /api/epf-contributions`, `GET /api/transfers/suggestions`, `DELETE /api/transaction-links/:id`, `GET /api/attachments/:id`, `GET /api/recurring`, `POST /api/merchants/rename`, `GET /api/resources`, `GET /api/search/recent`, `GET /api/user-tasks`.
8. **`schema.smoke.test.ts`** (P3): for each of the 11 tables, `assert.strictEqual` between the table imported from `../../db/schema.ts` and the same table imported from `./schema.ts` — proves object identity, not just structural equality.
9. **Completeness verification is NOT a basename grep** (P7, T11): prove completeness via (a) clean `npm run typecheck`, (b) direct confirmation all 24 old production files + 11 old test files no longer exist on disk, (c) a source-aware check — write a small script that resolves every relative import specifier in `apps/api/src` to an absolute path and asserts none resolves to one of the 24 deleted flat paths (listed exactly in TASK.md T11). A positive grep for new `modules/ledger/services/`/`modules/ledger/routes/` imports, cross-checked against the Root Cause file list, is useful corroborating evidence but is not the completeness proof by itself.
10. **`db:generate` verification**: content-hash manifest of `apps/api/drizzle/` before/after, must be identical (not just "no new file", not just `git status`).
11. **`tasks/01.09-cross-module-ports.md` edit**: this is a multi-part edit, not a one-line addition — read TASK.md's Scope section for the exact required content (dependency list change + new paragraph + multiple new acceptance criteria).

## Must Not Change
- No URL, HTTP method, handler body, response shape, or status code for any of the 47 ledger endpoints — pure relocation.
- `apps/api/src/services/backup.ts` (`ALL_TABLES`/`USER_TABLES`/`LINKED_TABLES`) is not touched.
- No table definition in `db/schema.ts` changes (only re-exported from `modules/ledger/schema.ts`).
- No Fastify route prefix added anywhere.
- `.github/workflows/ci.yml` is not touched.
- `services/card-due-tasks.ts`, `services/periods.ts`, and every other file in TASK.md's "Explicitly not moved" list are not touched beyond the specific import-path fixes named in Root Cause (their own direct-table-access code stays exactly as-is).
- Do not touch any file under `tasks/` other than `tasks/01.01-migrate-ledger.md`, `tasks/01.09-cross-module-ports.md`, and this task's own `tasks/007-migrate-ledger/` folder.

## Acceptance Criteria
AC1–AC8 exactly as written in `tasks/007-migrate-ledger/TASK.md`'s "Acceptance Criteria" section — read them there.

## Commands
Run from repo root unless noted; DB-backed commands need `.env` loaded (from `apps/api`, use `node --env-file-if-exists=../../.env --test ...`).

1. `npm run typecheck` (root) — run after P3, after P4/P5, and again at the end (P13)
2. `npm run lint` (root)
3. From `apps/api`: `node --test src/modules/ledger/schema.smoke.test.ts`
4. From `apps/api`: `node --test src/app.route-snapshot.test.ts` (covers both the canonical and raw-tree assertions)
5. From `apps/api`: `node --test src/modules/ledger/plugin.test.ts`
6. From `apps/api`: `node --env-file-if-exists=../../.env --test src/services/backup.test.ts`
7. From `apps/api`: run each of the 11 moved test files individually (list in TASK.md Scope)
8. `npm run db:generate` (root) — with before/after content-hash manifest of `apps/api/drizzle/`
9. `npm run test` (root, all workspaces) — full suite
10. Your source-aware import-resolution check (per Required Change 9)

## Required Evidence
- Full list of files changed (created/modified/deleted), matching the lists above exactly — flag any deviation.
- Complete diffs (or full new-file contents for new files).
- Every command's literal output and exit code — no paraphrasing.
- The P2 baseline capture (both raw and canonical), and the P9 comparison showing the canonical snapshot is byte-identical while the raw snapshot's diff is explained per the three-part checklist.
- The before/after content-hash manifest for `apps/api/drizzle/`.
- The full output of your source-aware import-resolution completeness check.
- Any point where you deviated from the plan, and why — call it out explicitly, don't bury it in a diff.
- Direct confirmation (`ls`/equivalent) that all 35 old paths no longer exist.
