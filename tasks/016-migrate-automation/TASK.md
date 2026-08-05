# Task: 016-migrate-automation (roadmap 1.6)

## Status
COMPLETE — all P1–P14 implemented, all AC1–AC13 proven by independent verification I read literally
(`verification-1.md`), Codex-reviewed (`review-2.md`: every runtime P/AC VALID, no runtime findings; its
one BLOCKING item was P14/AC13 roadmap closure, now landed). Nothing committed — awaits explicit user
request with a coordinator-authored file list.

## Progress & final validation
- **Implementation** (`backend-1.md` iter 1: schema/moves/plugin/app.ts/auth/comments; `backend-2.md`
  iter 2: plugin.test + route test) via `backend-engineer`. Both passes clean, no silent no-ops.
- **Independent verification** (`verification-1.md`, uninvolved worker; I read the literal evidence and
  the decisive files myself):
  - Both snapshots byte-identical — `route-surface` `a368d4eb…4122`, `route-table` `be350058…e1b5`
    (AC1). `app.route-snapshot.test.ts` 7/7 (both surface + raw-tree assertions).
  - All 9 old paths GONE + `services/ai/` dir removed; resolver scan 231 files / 716 specifiers / **0
    unresolvable** (AC10).
  - All 9 moved files: import-lines-only diff, zero body change; `observe` arrow unchanged, no `void`
    (AC4/AC6). `assistant.ts` + `ai-settings.test.ts` byte-identical.
  - `db/schema.ts` + `backup.ts` untouched; `modules/automation/schema.ts` 0 `pgTable`/`pgEnum` (AC2);
    `db:generate` "No schema changes", drizzle dir clean (AC11); `backup.test.ts` 13/13.
  - `apps/api` **848 → 853 (+5)** = 2 smoke + 1 plugin + 2 demo-403; typecheck 0, lint 0, root suite 0
    (AC8/AC9). Demo-403 confirmed genuine (CSRF only fires on present Origin; the 403 is the demo
    chokepoint — I verified security.ts:69-71 + auth.ts:66-74 myself) (AC12).
- **Codex review-2**: P1–P13 and AC1–AC12 all VALID with file:line evidence; no runtime/security/cycle
  finding. Sole BLOCKING item = P14/AC13 roadmap closure not yet landed — expected sequencing; now done.

## Roadmap edits (P14/R1–R3): DONE
Coordinator-authored (`tasks/` files):
- **R1** — `tasks/01.06-migrate-automation.md`: 6 ACs ticked with evidence; closure note recording D2
  (ai-settings moved in) and the corrected byte-identical route-table finding; `status: done`.
- **R2** — `tasks/README.md`: 1.6 row → done.
- **R3** — `tasks/01.09-cross-module-ports.md`: forward note that `modules/automation/` now exists (from
  1.6) as a real home for `autopilot.ts` should 1.9 choose it.

**Task 1.6 is COMPLETE.** Remaining Phase-1 work: 1.7 (ingest), 1.8 (system), then 1.9 + 1.10 (closure).

## Review dispositions — review-2 (implementation)
- **B1 (P14/AC13 roadmap closure absent) — VALID, ACCEPTED.** This was deliberate sequencing (AC13:
  flip to done only after every other AC is proven), not an omission. Now landed via R1–R3. Verified the
  reviewer's own claim: 01.06 was `status: todo` before this edit; it is now `done` with evidence-ticked
  ACs. The verification report's "ALL PASS" was scoped to the runtime ACs it was asked to check and did
  not cover AC13 — noted.
- **No runtime findings.** Codex independently corroborated (checked against code for the load-bearing
  claims): behaviour-identical moves, resolving imports, per-user provider intact, fire-and-forget intact
  at the untouched http.ts boundary, all 5 tools intact, genuine demo-403, thin re-export with no cycle,
  both snapshots byte-identical. Recorded as corroboration, not taken on faith.

---
### (original approved plan follows)
## Original status: APPROVED

## Objective
Move the automation/AI domain into `apps/api/src/modules/automation/`, joining the four completed
modules on the same convention (thin-schema re-export + `plugin.ts` + smoke/plugin/route tests). The
files that move are the 2 AI route files, the 5 `services/ai/*` services, plus `services/ai-settings.ts`
and its colocated test (D2). **No runtime behaviour changes** — every URL, handler body, Zod schema,
SQL predicate, per-user provider resolution and fire-and-forget event-logging path is invariant; the
only structural change is Fastify registration nesting plus file locations, with import-specifier and
doc-comment edits.

## Root Cause
Not a defect — roadmap task 1.6, sixth of eight Phase-1 module migrations (1.1 ledger, 1.2 credit,
1.3 investments, 1.4 protection, 1.5 planning are `done`).

## Decisive facts (verified — investigation-1.md, investigation-2.md, and my own reads)

**F1 — external consumers of the 7 core files are `app.ts` only.** `routes/ai.ts`+`routes/ai-events.ts`
are imported nowhere but `app.ts:28,29` (registered `:130,131`). The 5 `services/ai/*` files are
imported only by those two routes (and `assistant.ts`↔`tools.ts` intra-folder). Zero importers in
apps/web, apps/extractor, apps/ingestor, packages/*. (investigation-1 §1.)

**F2 — `services/ai-settings.ts` has exactly three consumers**: `routes/ai.ts` (moving), `routes/auth.ts`
(flat, system-domain — task 1.8), and its own colocated test `services/ai-settings.test.ts`. The
extractor does NOT depend on it — `apps/extractor/src/db.ts:50` has its own raw-SQL `loadAiSettings`.
So `ai-settings.ts` can move into the module at the cost of exactly one repoint (`auth.ts:20`).
(investigation-1 §3.) I verified `auth.ts`'s use myself: `getAiSettings`+`getUserAiProvider` are called
only inside the `GET /api/capabilities` read handler (`auth.ts:149-153`) — a read, no write, no cycle
(automation does not import auth/system).

**F3 — the AI tables have no inbound FKs and only outbound FKs to `users`/`emailIngestions`/`accounts`.**
`ai_settings` (db/schema.ts:107-120) → `users.id` only. `ai_events` (db/schema.ts:1739-1763) → `users.id`,
`emailIngestions.id` (set null), `accounts.id` (set null). Grep for `.references(() => aiSettings` /
`aiEvents` returns nothing (investigation-2 §1). So a thin re-export is safe and uniform with 1.1–1.5;
physical relocation is deferred to task 1.9 (Non-Goal), exactly as every prior module did.

**F4 — three enums are owned by this domain**: `aiProvider` (db/schema.ts:92-99), `aiEventKind`
(1722-1729), `aiEventStatus` (1730). The module `schema.ts` re-exports 2 tables + 3 enums.

**F5 — `db/schema.ts` does NOT `export *` from any automation module** (grep "automation" → nothing).
So unlike the planning special case (1.5 F2/D1), there is no `export *` line to delete and no cycle to
resolve — this is the plain credit/investments/protection recipe, not the planning one.

**F6 — backup coverage already present.** `ai_settings` and `ai_events` are in both `ALL_TABLES`
(backup.ts:34,40) and `USER_TABLES` (:49,58). This migration adds no tables, so `backup.ts`/`backup.test.ts`
need no change (AC-r1's `backup.test.ts` green is a no-op-preservation check). (investigation-2 §2.)

**F7 — shared schemas are untouched.** Routes consume `@compass/shared` schemas (`AiSettingsSchema`,
`UpdateAiSettingsSchema`, `AiCategorize*`, `AiSummary*`, `AiChatRequestSchema`, `AiEvent*`,
`ListAiEventsQuerySchema`, and the closed `AiEventKind` enum) and `@compass/ai` (`AiUnavailableError`,
`effectiveModel`, `AiObserver`). All are package imports, unchanged by a file move. The "ai_events kinds
are a closed enum" trap does not apply — no kind is added. (investigation-2 §3.)

**F8 — no colocated tests under `services/ai/`; one under `services/ai-settings.test.ts`.** The latter
tests `assertAllowedBaseUrl` (2 `test()` cases) and moves with `ai-settings.ts` (same-directory `./`
import unchanged). No `routes/ai*.test.ts` exists. (investigation-1 §5.)

**F9 — baseline.** `npm run test -w apps/api` → **848 pass / 0 fail / exit 0**. `route-surface.snapshot.txt`
sha256 `a368d4eb…4122`; `route-table.snapshot.txt` sha256 `be350058…e1b5`. typecheck exit 0.
(investigation-2 §6.) Watch for the known `modules/credit/services/card-due-tasks.test.ts` shared-dev-DB
flake (documented in tasks/014-migrate-planning/TASK.md); re-run and confirm rather than misread it.

**F10 — split-import rule targets (made definite per review-1).** After the move, module services import
their OWN tables from `../schema.ts` (the thin re-export). Confirmed against the file bodies:
`services/ai/events.ts` uses ONLY `aiEvents` — its `ingestionId`/`accountId` are nullable columns
inserted as values (events.ts:15,40), not queried against `emailIngestions`/`accounts` — so its schema
import becomes exactly `import { aiEvents } from "../schema.ts";` with NO remaining `../../../db/schema.ts`
import. `ai-settings.ts` uses ONLY `aiSettings` → `import { aiSettings } from "../schema.ts";`. The
general split-import rule (non-owned tables stay at `../../../db/schema.ts`) still stands for any file
that references both, but neither of these two does.

**F11 — stale doc comments referencing the old paths** (investigation-1 §6): `modules/planning/services/
goals.ts:19` and `reports.ts:27` name `services/ai/tools.ts`; `app.ts:157` names `services/ai-settings.ts`;
`apps/extractor/src/extract.ts:61` names `apps/api/src/services/ai/tools.ts`. All four are live source doc
comments whose path references go stale under this move; all four are corrected (comment-only). Per
review-1, the extractor comment is NOT deferred — a path-comment edit in another workspace is negligible
risk and leaving it stale while fixing the equivalent planning/app.ts comments would be inconsistent.

## Design decisions

**D1 — module directory name is `automation`.** The roadmap names it both ways ("Migrate automation/AI
module"; task 1.9: "belongs in the planning module or **an automation module**"). `automation` is the
forward-looking domain name (task 1.9 may later home `services/autopilot.ts` here). Directory:
`apps/api/src/modules/automation/`; plugin export `automationRoutes`.

**D2 — `services/ai-settings.ts` + its test move INTO the module.** It owns the `ai_settings` table and
provides `getUserAiProvider`, the per-user provider resolution that AC-r2 exists to protect; leaving the
module's own table-service flat while claiming the module owns the table (roadmap lists `ai_settings`
under 1.6) is inconsistent. Cost is one repoint (`auth.ts:20` → the module path) with no cycle (F2) and
no extractor risk. *Rejected alternative:* leave `ai-settings.ts` flat and defer to 1.9 — minimal scope
and matches the roadmap's literal "services/ai/*" wording, but it fragments the domain (module owns the
table, not its service) and forces 1.9 to move it anyway. Recorded so 1.9 does not relitigate. **This is
the one genuine scope judgment in the task; flagged for plan review.**

**D3 — thin re-export schema, physical relocation deferred to 1.9.** `modules/automation/schema.ts` is a
thin named re-export of `aiSettings, aiEvents, aiProvider, aiEventKind, aiEventStatus` from
`../../db/schema.ts`, modelled exactly on `modules/credit/schema.ts`. `db/schema.ts` is not touched (no
`export *` added). Uniform with 1.1–1.5; F3 proves it is acyclic.

## Scope
- CREATE `apps/api/src/modules/automation/`:
  - `schema.ts` — thin re-export (D3)
  - `routes/ai.ts`, `routes/ai-events.ts` — moved, import-specifier edits only
  - `services/{assistant,categorize,events,summary,tools,ai-settings}.ts` — moved, import-specifier edits only
  - `services/ai-settings.test.ts` — moved (same-dir `./` import unchanged)
  - `plugin.ts` — registers `aiRoutes` then `aiEventRoutes`
  - `schema.smoke.test.ts` (2 tests), `plugin.test.ts` (1 test), `routes/automation.route.test.ts` (2 tests)
- EDIT `apps/api/src/app.ts` — collapse the 2 imports (28-29) + 2 registrations (130-131) into one plugin
  import + one `await app.register(automationRoutes)` at line 130's position; fix the `:157` doc comment;
  add a short automation paragraph to the `registerRoutes` migration-history comment (75-117) modelled on
  the protection paragraph (110-117), stating that two already-adjacent, already-in-order registrations
  were wrapped WITHOUT changing either snapshot.
- EDIT `apps/api/src/routes/auth.ts:20` — repoint `ai-settings.ts` import specifier only.
- EDIT comment-only: `modules/planning/services/goals.ts:19`, `modules/planning/services/reports.ts:27`,
  `apps/extractor/src/extract.ts:61`.
- `apps/api/src/route-table.snapshot.txt` — expected BYTE-IDENTICAL (NOT regenerated). Corrected per
  review-1: the two registrations are already adjacent and in order, so plugin-wrapping does not change
  `printRoutes()` (same as the protection precedent, app.ts:110-117). The `app.route-snapshot.test.ts`
  "raw printRoutes() tree" test (:120) enforces byte-identity and will fail if the tree drifts.
- Roadmap: `tasks/01.06-migrate-automation.md`, `tasks/README.md`, and a one-line forward note in
  `tasks/01.09` recording that `ai-settings.ts` now lives in the automation module (the project maintains
  such forward-task notes — task 1.5 added the equivalent autopilot.ts note to 1.09).

## Dependencies
1.1 (`done`) established the recipe; 1.3/1.5 (`done`) established the sibling-module import targets that
`tools.ts`/`summary.ts` point at (ledger `search`, planning `reports`/`budgets`/`insights`/`goals`). No
blocking dependency.

## Plan
- P1: Baseline — re-confirm 848/0, both snapshot sha256s (F9) before touching anything; capture the
  drizzle content-hash manifest of `apps/api/drizzle/`.
- P2: Create `modules/automation/schema.ts` (D3) and `schema.smoke.test.ts` (2 tests: 2-table identity,
  3-enum identity, modelled on `modules/credit/schema.smoke.test.ts`). Gate: `schema.smoke.test.ts`
  green, typecheck clean, `db:generate` zero diff.
- P3: Move the 6 service files + the 1 service test into `modules/automation/services/`, applying the
  depth rule (`../../db|lib/X` → `../../../db|lib/X`; `../periods.ts` → `../../../services/periods.ts`;
  sibling modules `../../modules/planning|ledger/services/X` → `../../planning|ledger/services/X`) and the
  split-import rule F10 (own tables from `../schema.ts`, others from `../../../db/schema.ts`).
  `assistant.ts`↔`tools.ts` stay `./`. `ai-settings.test.ts`'s `./ai-settings.ts` stays `./`.
- P4: Move the 2 route files into `modules/automation/routes/` (intra-module service imports become
  `../services/X`; `../lib/errors.ts` → `../../../lib/errors.ts`; flat `../services/{ai-settings? ,
  mailboxes}.ts` → `ai-settings` is now `../services/ai-settings.ts` (intra-module, D2), `mailboxes` is
  `../../../services/mailboxes.ts`).
- P5: Create `plugin.ts` — `automationRoutes(app)` registering `aiRoutes` then `aiEventRoutes` (preserve
  the app.ts order), with a header comment in the 1.2/1.5 style.
- P6: Update `app.ts` — one plugin import replacing 28-29; one `await app.register(automationRoutes)` at
  the position lines 130-131 occupy (between `backupRoutes` and `profileRoutes`); fix the `:157` comment;
  add the automation migration-history paragraph (Scope).
- P7: Repoint `auth.ts:20` (D2) and update the F11 doc comments (planning goals.ts/reports.ts + extractor
  extract.ts).
- P8: Add `routes/automation.route.test.ts` — 2 demo-403 cases (PUT `/api/ai/settings` asserting no
  `ai_settings` row written; POST `/api/ai/categorize` asserting 403 and no `ai_events` row written),
  mirroring `planning.route.test.ts`. Ensure `buildTestApp`'s config carries `AI_ALLOWED_BASE_URLS` and
  any decorators the handlers touch (`db`, `redis`, `config` — not `storage`/`queues`, confirmed).
- P9: Add `plugin.test.ts` — 1 hermetic `hasRoute` test asserting 2 pairs (GET `/api/ai/settings`,
  GET `/api/ai-events`), `EXPECTED_PAIRS.length === 2`, no `app.inject()`.
- P10: Confirm the 8 moved PRODUCTION paths (2 routes + 5 `services/ai/*` + `ai-settings.ts`) plus the
  9th moved file (`ai-settings.test.ts`) no longer exist at their old locations, and that `services/ai/`
  is removed; run the resolver-based import check (AC10) over every `*.ts` under `apps/api/src` — zero
  unresolvable specifiers.
- P11: Compare (do NOT regenerate) BOTH snapshots — `route-surface.snapshot.txt` and
  `route-table.snapshot.txt` are each expected byte-identical (corrected per review-1). Confirm
  `app.route-snapshot.test.ts` passes both its surface and its raw-tree assertions. Only if the raw tree
  unexpectedly differs, read the diff, confirm it is pure re-nesting with no added/removed/renamed
  (method,path), and explain before regenerating.
- P12: `npm run db:generate` — zero diff, proven by the content-hash manifest before/after.
- P13: Full gate — typecheck, lint, `npm run test -w apps/api` (848 → 853, +5 reconciled), root
  `npm run test`. Read the complete diff file by file.
- P14: Roadmap — R1: tick 1.06's ACs with evidence, note D2 (ai-settings moved in) and that only
  `bills.remind`/`autopilot.goals`-style crons are untouched, flip `status: todo → done` LAST; R2: README
  1.6 row → done; R3: add a one-line note in `tasks/01.09` that `ai-settings.ts` now lives in the
  automation module (removes it from 1.9's flat-services cleanup ambiguity).

## Acceptance Criteria
- AC1: BOTH snapshots byte-identical — `route-surface.snapshot.txt` sha256 still `a368d4eb…4122` AND
  `route-table.snapshot.txt` sha256 still `be350058…e1b5` (corrected per review-1: two already-adjacent,
  already-in-order registrations wrapped in a plugin do not change `printRoutes()`, matching the
  protection precedent). `app.route-snapshot.test.ts` passes both assertions unmodified.
- AC2: `modules/automation/schema.ts` contains no `pgTable(`/`pgEnum(` declaration (a line-anchored check
  `^export const \w+ = pgTable`/`pgEnum`, NOT a bare substring — doc comments legitimately contain the
  words, per the coordinator-error note in tasks/014). `db/schema.ts` is byte-unchanged.
- AC3: per-user provider resolution unchanged — `getUserAiProvider`/`getAiSettings`/`upsertAiSettings`
  bodies byte-identical (import lines aside); no global provider introduced; `NullProvider` fallback and
  `assertAllowedBaseUrl` allowlist logic intact.
- AC4: AI event logging still fire-and-forget (corrected per review-1). The observer body in
  `routes/ai.ts`'s `providerFor` is byte-identical — it continues to RETURN `recordAiEvent(...)`'s promise
  from the arrow (it is NOT and must NOT be rewritten to `void recordAiEvent(...)`; adding `void` would
  violate AC6). Fire-and-forget is guaranteed by the untouched `void report(...)` at the HTTP boundary in
  `packages/ai/src/http.ts` (not in scope, not edited), and `recordAiEvent` additionally swallows its own
  persistence failures (`services/…/events.ts`) — so a failing observer cannot break a model call.
- AC5: assistant tool loop intact — `tools.ts`'s 5 tools (`get_spending_summary`, `get_budget_status`,
  `get_financial_health`, `search_transactions`, `list_goals`) resolve their cross-module imports
  (planning `reports`/`budgets`/`insights`/`goals`, ledger `search`) via the new sibling-module paths;
  `TOOL_SPECS`/`runTool` bodies byte-identical.
- AC6: the moved production files' diffs consist EXCLUSIVELY of import-line (and F11 comment) changes; the
  moved `ai-settings.test.ts` changes only its import specifiers (or nothing). No handler body, route URL,
  status code, Zod schema, SQL predicate or `userId` filter gained or lost.
- AC7: `auth.ts` change is the single import-specifier repoint on line 20; its `/api/capabilities` handler
  body is byte-identical.
- AC8: `npm run test -w apps/api` green, **848 → 853 (+5)** = 2 schema-smoke + 1 plugin + 2 demo-403.
  Re-measure the baseline first; if the delta is not exactly +5, explain rather than round.
- AC9: typecheck exit 0, lint exit 0 across all workspaces. Root `npm run test` may exit 1 ONLY from the
  known pre-existing `apps/extractor` `DATABASE_URL` packaging gap (waived identically by tasks 1.3/1.4);
  any other failure is real.
- AC10: every relative import specifier under `apps/api/src` resolves to a real regular file (resolver-
  based, not substring grep — reuse the T17 method from tasks/014: all four specifier forms, package
  specifiers excluded, file-only resolution with `.ts`/`/index.ts` fallbacks). Report files+specifiers
  scanned. Zero unresolvable. Run before AND after — before proves the check reports zero on a clean tree.
- AC11: `npm run db:generate` produces zero diff, proven by a content-hash manifest of `apps/api/drizzle/`
  before and after. `backup.test.ts` green unmodified.
- AC12: demo-write protection intact — a demo session gets 403 on PUT `/api/ai/settings` and POST
  `/api/ai/categorize`, with no row written (proven by `automation.route.test.ts`).
- AC13: R1-R3 landed; 1.6 `status: done` only after every other AC is proven.

## Verification
- T1: sha256 of both snapshots before/after — BOTH expected unchanged (`a368d4eb…4122`, `be350058…e1b5`).
- T2: line-anchored `pgTable`/`pgEnum` count in `modules/automation/schema.ts` → 0; `git diff -- db/schema.ts` empty.
- T3: `node --test src/modules/automation/schema.smoke.test.ts`
- T4: `node --test src/modules/automation/plugin.test.ts`
- T5: `node --env-file-if-exists=../../.env --test src/modules/automation/routes/automation.route.test.ts`
- T6: `node --env-file-if-exists=../../.env --test src/services/backup.test.ts` (unmodified)
- T7: `npm run typecheck`; T8: `npm run lint`
- T9: `npm run test -w apps/api` — before/after counts, +5 reconciled
- T10: `npm run test` (root)
- T11: `npm run db:generate` + drizzle manifest before/after
- T12: resolver-based import check (AC10) before and after, with scanned counts
- T13: explicit `test ! -e <path>` for each of the 8 moved paths (2 routes + 5 services + ai-settings.ts)
  and `test ! -e src/services/ai-settings.test.ts`; confirm `src/services/ai/` directory removed.
- T14: full `git diff`, read file by file.
- T15: literal before/after of `auth.ts:20` and `app.ts:157`.

## Non-Goals
- Physically relocating `ai_settings`/`ai_events` (task 1.9).
- Adopting `services/autopilot.ts` into the module (task 1.9 decides its home).
- Moving `services/mailboxes.ts` (task 1.7) or `services/periods.ts` (task 1.9).
- Adding/removing any AI event kind or shared schema field.
- Editing `packages/ai/src/http.ts` or `db/schema.ts` (both byte-unchanged).
- Changing any route URL, handler body, Zod schema, provider resolution or event-logging semantics.

## Review dispositions — review-1
- **B1 (route-table.snapshot.txt should NOT change) — VALID, ACCEPTED.** I verified against app.ts:110-117
  (protection precedent: wrapping two already-adjacent, already-in-order registrations does not change
  `printRoutes()`) and app.route-snapshot.test.ts:120 (the raw-tree test enforces byte-identity). The AI
  registrations at app.ts:130-131 are exactly that case. AC1/P11/T1/Scope now expect BOTH snapshots
  byte-identical and do not regenerate route-table.
- **B2 (AC4 named the wrong fire-and-forget boundary) — VALID, ACCEPTED.** I verified routes/ai.ts:36
  myself: the observer arrow RETURNS `recordAiEvent(...)`'s promise; it is not `void`-prefixed.
  Fire-and-forget lives in the untouched `packages/ai/src/http.ts` `void report(...)`. AC4 rewritten to
  require the observer body byte-identical and explicitly forbid adding `void`.
- **F10 precision (events.ts uses only aiEvents) — VALID, ACCEPTED.** F10 made definite.
- **app.ts migration-history paragraph — ACCEPTED.** Added to Scope/P6.
- **Extractor comment made explicit — ACCEPTED.** Moved from Non-Goal into F11/Scope/P7.
- **P10 counting wording (8 production paths + 9th test) — ACCEPTED.** Clarified.
- **Task 1.9 forward note — KEPT.** The project maintains such notes (task 1.5 added the autopilot.ts
  note to 1.09); reframed as a forward record, not an ambiguity fix.
- **Redundant gates — KEPT deliberately.** The `test ! -e`/resolver/manifest gates are cheap and are the
  established migration evidence; thoroughness is preferred over brevity here.
- Review confirmed as VALID (corroboration, checked against code): D2 safe/acyclic, D3 acyclic thin
  re-export with no `db/schema.ts` edit, all depth adjustments, AC8 arithmetic (+5 → 853), decorator
  inheritance (`config`/`db`/`redis` on root), and auth/demo/CSRF/rate-limit survival of nesting.
