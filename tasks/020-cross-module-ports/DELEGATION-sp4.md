# sonnet-worker Delegation — SP4 (docs + final gate, AC5/AC6/AC4)

## Task
020-cross-module-ports (roadmap 1.9), sub-phase SP4 — the CLOSER's docs pass. Update the root CLAUDE.md
architecture section to the final post-1.9 module layout, correct ALL stale schema-architecture comments in
active source, remove the empty flat routes/ dir, then run the full gate. COMMENT/DOC edits ONLY — zero code
logic, zero test-assertion, zero schema/route/migration change.

## P1 — CLAUDE.md (exact replacements)
File: /home/udai/PennyPilot/CLAUDE.md

### Edit A (line ~42) — replace this EXACT substring:
`Business logic and all DB access live in `+"`services/*.ts`"+`; each service takes a `+"`Db | Tx`"+` handle plus `+"`userId`"+`. `+"`repositories/`"+` is nearly empty (only `+"`users.ts`"+`) — **write new logic in `+"`services/`"+`, not `+"`repositories/`"+`.**`
with:
`Business logic and all DB access live in `+"`modules/<domain>/services/*.ts`"+`; DB-backed service operations take a `+"`Db | Tx`"+` handle and, where user-scoped, a `+"`userId`"+` (some services are pure, e.g. `+"`cycle-math`/`xirr`"+`). The flat `+"`services/`/`routes/`/`repositories/`"+` source dirs are gone — **all domain code lives under `+"`modules/`"+`; cross-cutting, domain-neutral helpers live in `+"`lib/`"+` (e.g. `+"`cache.ts`, `ownership.ts`, `periods.ts`"+`).**`

### Edit B (line ~43) — replace this EXACT substring:
`then registers every `+"`routes/*.ts`"+`. A new feature = new schema in `+"`packages/shared`"+`, new `+"`services/x.ts`"+`, new `+"`routes/x.ts`"+`, register it in `+"`app.ts`"+`.`
with:
`then registers each module's `+"`plugin.ts`"+`. The shared Zod/API contract lives in `+"`packages/shared`"+` (distinct from a module's Drizzle persistence `+"`schema.ts`"+`); a feature in an EXISTING domain adds/updates files inside that `+"`modules/<domain>/`"+` and registers its route in that module's existing `+"`plugin.ts`"+`, while a NEW domain adds a `+"`modules/<domain>/`"+` (`+"`schema.ts`"+` for new tables, `+"`services/x.ts`, `routes/x.ts`, `plugin.ts`"+`) and registers its `+"`plugin.ts`"+` in `+"`app.ts`"+`.`

### Edit C (line 49) — replace the ENTIRE "Transitional module scaffold" bullet:
OLD bullet begins `- **Transitional module scaffold:** ` and ends `…Task 1.9 converts these thin re-export surfaces into physical per-module ownership.`
NEW bullet (verbatim):
`- **Module layout (Phase 1 complete):** every domain lives in `+"`modules/<domain>/`"+` (`+"`schema.ts`, `services/`, `routes/`, `plugin.ts`"+`); `+"`app.ts`"+` registers each module's `+"`plugin.ts`"+`, not routes directly. Schema ownership is physical: each `+"`modules/<domain>/schema.ts`"+` defines the real `+"`pgTable()`/`pgEnum()`"+` for its RESIDENT tables/enums, and re-exports the cross-domain ones it references. The 12 tables referenced across modules (and their shared enums) are physically defined in DAG-layered files under `+"`db/shared/`"+` (`+"`foundation`"+` → `+"`hubs`"+` → `+"`recurring`"+` → `+"`spines`"+` → `+"`ledger`"+`; each layer may import `+"`db/core-schema.ts`"+` and only PRECEDING shared layers), and `+"`db/core-schema.ts`"+` holds the cycle-free core identity (`+"`users`"+`) that the shared layers and module schemas depend on. A module's `+"`schema.ts`"+` imports its cross-domain FK targets from `+"`db/shared/*`"+` and `+"`users`"+` from `+"`db/core-schema.ts`"+` — it NEVER imports another module's `+"`schema.ts`"+`. `+"`db/schema.ts`"+` is now a pure re-export barrel that re-exports every table + enum exactly once and remains the single Drizzle Kit entry point (`+"`drizzle.config.ts`"+` points only at it); service/runtime code may still import tables from `+"`db/schema.ts`"+`, but module `+"`schema.ts`"+` files import from the shared layers directly to keep the schema graph acyclic. Runtime cross-module SERVICE imports are still allowed — only cross-module SCHEMA imports are forbidden.`

(If any exact old substring differs by whitespace/punctuation from the file, STOP and report — do not guess.)

## P4 — fix ALL stale schema-architecture comments (comments ONLY)
RULE — a comment is STALE (fix it to the post-1.9 reality) iff it states/implies ANY of:
 (i) a `modules/<domain>/schema.ts` is a "thin re-export" / re-exports the barrel / is "not an independent definition";
 (ii) physical table ownership or inline `pgTable()` defs live in `db/schema.ts`;
 (iii) `db/schema.ts` holds "remaining inline tables";
 (iv) an OLD flat path `services/autopilot.ts` or `services/balances.ts` (or other removed flat path).
Reality to reflect: each module `schema.ts` PHYSICALLY defines its resident tables/enums and re-exports the
cross-domain ones from `db/shared/*`; `db/schema.ts` is a PURE re-export barrel (zero inline defs).

Enumerate the FULL set yourself: `grep -rn` in `apps/api/src` for `thin re-export`, `remaining inline`,
`services/autopilot.ts`, `services/balances.ts`, and any `plugin.ts`/`schema.smoke.test.ts` comment describing a
module schema as a re-export. KNOWN sites to fix:
- `apps/api/src/db/core-schema.ts:5` ("`db/schema.ts` (the remaining inline tables)" → the barrel is pure re-export; module schemas + shared layers hold the physical defs).
- `apps/api/src/modules/ledger/plugin.ts` (~line 15-17: "thin re-export … physical ownership remains in db/schema.ts" → ledger/schema.ts now physically owns its resident tables).
- `apps/api/src/modules/investments/plugin.ts:10` ("thin re-export").
- Any other `modules/*/plugin.ts` calling schema a thin re-export (review-9 cited automation/credit/system — VERIFY each and fix).
- The 8 `modules/*/schema.smoke.test.ts` comment blocks ("… is a thin re-export, not an [independent definition] … exact same object as the barrel") → reword to: the module now PHYSICALLY defines its resident tables; the test asserts the module's export is the exact same object as the barrel's (identity through the barrel). DO NOT change any test code/assertion — only the comment lines.
- `apps/api/src/modules/planning/services/goals.ts:16` (`services/autopilot.ts` → `modules/automation/services/autopilot.ts`).
- `apps/api/src/modules/investments/services/sip-lifecycle.ts:89` (`services/balances.ts` → `modules/ledger/services/balances.ts`).

LEAVE UNTOUCHED (already accurate — DO NOT edit):
- `db/schema.ts`'s own header ("pure re-export barrel … ZERO inline `pgTable()`").
- The `modules/*/schema.ts` (~line 10) header comments (they correctly say the file imports shared LAYER files and never another module's schema; `db/schema.ts` is the barrel entry point).
- `db/schema.decomposition.test.ts` (accurate).

## P5 — remove empty flat routes dir
If `apps/api/src/routes/` exists and is EMPTY, remove it (`rmdir`). If it contains any file, STOP and report.

## Must NOT change
- Any code logic, function signature, SQL, test assertion, schema, route, or migration. Comment/markdown text ONLY.
- The LEAVE-UNTOUCHED comments above.

## P6 — final gate (capture exact command, literal output, exit code for each)
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -w apps/api` (report total pass/fail/skip; confirm schema.decomposition + all schema.smoke tests + route-surface + route-table still pass)
4. `npm run db:generate` (must report "No schema changes")
5. `git diff --exit-code -- apps/api/drizzle` (exit 0)
6. `git status --porcelain`

## Required evidence (report back)
- Files edited (paths); complete diff (must be comment/markdown-only outside CLAUDE.md; CLAUDE.md is the 3 edits).
- The full list of stale-comment sites you found + fixed.
- Each command's exact invocation, literal output (incl. counts), exit code.
- Confirmation routes/ dir handled.
- Any old-substring mismatch, unexpected file content, or deviation — STOP and report, do not guess.
