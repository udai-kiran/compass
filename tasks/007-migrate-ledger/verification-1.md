# Verification 1 — task 007-migrate-ledger (independent re-check of implementation-1.md)

Scope: read-only verification. No files edited, nothing staged or committed.
All commands below were run independently by the verifier, not copy-pasted
from the implementer's report, except where noted.

## Files inspected

- `tasks/007-migrate-ledger/TASK.md` (revision 4, AC1-AC8, Root Cause, Plan P1-P13)
- `tasks/007-migrate-ledger/DELEGATION.md`
- `tasks/007-migrate-ledger/implementation-1.md` (full, 1074 lines)
- `apps/api/src/modules/ledger/schema.ts` (full)
- `apps/api/src/modules/ledger/schema.smoke.test.ts` (full)
- `apps/api/src/modules/ledger/plugin.ts` (full)
- `apps/api/src/modules/ledger/plugin.test.ts` (full)
- `apps/api/src/route-surface.snapshot.txt` (line count + head/tail)
- `apps/api/src/app.ts` (full, especially `registerRoutes`)
- `apps/api/src/app.route-snapshot.test.ts` (full)
- `apps/api/src/modules/ledger/services/accounts.ts`, `recurring.ts`, `transactions.ts` (import blocks)
- `apps/api/src/modules/ledger/routes/rules.ts`, `transactions.ts` (full)
- `apps/api/src/services/goals.ts`, `demo.ts`, `dashboard.ts` (diffs)
- `tasks/01.01-migrate-ledger.md`, `tasks/01.09-cross-module-ports.md` (diffs)
- `apps/api/src/db/schema.ts` (grep for `export *` and stale comment references)
- `CLAUDE.md` (diff-stat only)

## Files changed

None by this verifier. All edits below were the implementer's, pre-existing at
session start.

## AC pass/fail table

| AC | Description | Result | Evidence |
|----|---|---|---|
| AC1 | Canonical route-surface byte-identical; raw tree legitimately changed & reviewed | PASS | `node --test src/app.route-snapshot.test.ts` — both the canonical-surface and raw-tree assertions pass (7/7). `route-surface.snapshot.txt` is 283 lines, matches report's head/tail. |
| AC2 | `db:generate` produces no migration diff, content-hash manifest identical | PASS (with a file-count discrepancy noted below) | `npm run db:generate` → "No schema changes, nothing to migrate 😴", 51 tables. Independent before/after `sha256sum` manifest of `apps/api/drizzle/` (135 files) — `diff` produced zero output. |
| AC3 | `backup.test.ts` green, `ALL_TABLES`/`USER_TABLES`/`LINKED_TABLES` unmodified | PASS | `node --env-file-if-exists=../../.env --test src/services/backup.test.ts` → 13/13 pass. `git diff --stat -- apps/api/src/services/backup.ts` not separately re-run, but file does not appear in `git status --porcelain` output at all — confirmed untouched. |
| AC4 | typecheck/lint/test green across all workspaces, incl. 11 moved tests + 2 new tests | PASS | `npm run typecheck` exit 0, zero errors, all 7 workspaces. `npm run lint` exit 0, no output. `npm run test` (root) exit 1 overall but only due to the pre-existing, unrelated `@compass/extractor` env-loading failure (see below) — `@compass/api` is 813/813. All 11 moved test files + `schema.smoke.test.ts` (2/2) + `plugin.test.ts` (1/1) individually confirmed passing. |
| AC5 | Demo-mode 403 on mutating ledger route preserved | PASS | `user-tasks.route.test.ts` run from its new location: `AC12: a demo session's mutating request is rejected 403, and no database row is created or changed` — passes, 6/6 total in that file. |
| AC6 | No circular import; `db/schema.ts` does not `export *` back from ledger | PASS | `grep -n "export \*" apps/api/src/db/schema.ts` → only pre-existing `export * from "../modules/planning/schema.ts";` (line 22), no ledger equivalent. `schema.smoke.test.ts` passes (object-identity, 2/2). |
| AC7 | All cross-module imports updated; all 35 old paths gone | PASS | Independent source-aware import-resolution script (below) found 0 violations against 35 deleted paths (24 production + 11 test — a superset of the implementer's 24-path production-only check). Direct `test -e` loop over all 35 named old paths: 35/35 confirmed absent. Directory listing of `modules/ledger/{services,routes}` shows exactly 22 + 13 = 35 moved files + 4 new top-level files = 39 total, matching the claimed new-file count. |
| AC8 | `plugin.test.ts` asserts one route per each of the 11 route files via lookup, not `app.inject()` | PASS | Read the test file directly: uses `app.hasRoute({ method, url })`, never `app.inject()`. All 11 `EXPECTED_PAIRS` match TASK.md Scope's exact list. `node --test src/modules/ledger/plugin.test.ts` → 1/1 pass. |

## Command output (independently run)

### `git status --porcelain` (repo root)
Matches implementation-1.md's claimed file list exactly: 28 modified, 35
deleted (13 services + 11 routes + 11 test files), plus `?? apps/api/src/modules/ledger/`
(directory) and `?? apps/api/src/route-surface.snapshot.txt`. The extra `??`
entries for `tasks/00.01-00.02-verification-1.md`, `tasks/001-*` through
`tasks/007-*` numbered folders are pre-existing task-board-migration
untracked entries unrelated to this session's ledger work (consistent with
implementation-1.md's framing, though the report's own status-filtering grep
did not explicitly enumerate these `??` lines by name — a minor omission, not
a substantive discrepancy).

### `apps/api/src/modules/ledger/` directory listing
```
services/: 22 files (13 services + 9 colocated tests)
routes/:    13 files (11 routes + 2 colocated tests)
top-level:  schema.ts, schema.smoke.test.ts, plugin.ts, plugin.test.ts
```
22 + 13 + 4 = 39, matching the claimed "New (39 files)" count exactly.

### 35 old flat paths — direct `test -e` check (not grep)
```
Total old paths listed: 35
Confirmed absent: 35 / 35
```

### `git diff --stat -- apps/api/src/db/schema.ts` → empty (file untouched)
### `git diff --stat -- CLAUDE.md` → empty (file untouched, matches the implementer's declared deviation)

### `node --test src/modules/ledger/schema.smoke.test.ts`
```
✔ modules/ledger/schema.ts re-exports the same 11 table objects as db/schema.ts
✔ modules/ledger/schema.ts re-exports the same 7 owned enum objects as db/schema.ts
ℹ tests 2 / pass 2 / fail 0
EXIT:0
```

### `node --test src/modules/ledger/plugin.test.ts`
```
✔ ledgerRoutes registers one uniquely-attributable route from each of the 11 internal route files
ℹ tests 1 / pass 1 / fail 0
EXIT:0
```

### `node --test src/app.route-snapshot.test.ts`
```
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte
✔ assertRouteTableMatches rejects an added route
✔ assertRouteTableMatches rejects a removed route
✔ assertRouteTableMatches rejects a renamed route
✔ assertRouteTableMatches rejects a method change (GET -> POST)
✔ assertRouteTableMatches accepts identical tables
ℹ tests 7 / pass 7 / fail 0
EXIT:0
```

### `node --env-file-if-exists=../../.env --test src/services/backup.test.ts`
13/13 pass (full list matches implementation-1.md verbatim, including the
`AC11`/`misc-05 AC14` characterization tests).

### 11 moved test files, run individually
```
accounts.test.ts                42/42
attachments.test.ts             4/4
average-balance.test.ts         19/19
epf-contributions.test.ts       17/17
recurring.test.ts               20/20
transaction-links.test.ts       2/2
transactions.test.ts            12/12
transfers.test.ts               9/9
user-tasks.test.ts              18/18
user-tasks.route.test.ts        6/6  (includes AC12 demo-403)
ledger-events.route.test.ts     2/2
```
All 11 confirmed passing individually from their new `modules/ledger/`
location; counts match implementation-1.md exactly.

### Independent source-aware import-resolution check (own script, not the implementer's)

Wrote and ran `/tmp/.../scratchpad/import-check.mjs` — walks every `.ts` file
under `apps/api/src`, extracts every `from "..."`/`import("...")` relative
specifier, resolves it via `path.resolve(dirname(file), specifier)`, and
checks against **35** deleted paths (24 production + 11 test — a superset of
the implementer's own script, which checked only the 24 production paths per
T11's literal wording):

```
Scanned 195 .ts files under /home/udai/PennyPilot/apps/api/src
Total relative import/export specifiers examined: 592
Extensionless relative specifiers (would be a separate bug, unrelated to this check): 0
Deleted-path violations found: 0
PASS: no relative import in apps/api/src resolves to any of the 35 deleted flat paths (24 production + 11 test).
```
(Implementer's own script reported 591 specifiers against the 24-path set;
the 1-specifier difference is attributable to this script also matching
dynamic `import(...)` calls — not a material discrepancy, and both scripts
agree: zero violations.)

### `npm run typecheck` (root)
Exit 0. Zero errors printed across all 7 workspaces (`@compass/api`, `docs`,
`extractor`, `ingestor`, `web`, `ai`, `shared`).

### `npm run lint` (root)
Exit 0. No output (zero lint errors).

### `npm run db:generate` (root)
```
51 tables
... (all 51 tables printed, unchanged)
No schema changes, nothing to migrate 😴
```
Exit 0. Matches implementation-1.md's output verbatim.

**Content-hash manifest, independently built:** `find apps/api/drizzle -type f | sort | xargs sha256sum` before and after `db:generate` — `diff` produced zero output ("IDENTICAL MANIFEST").

**Discrepancy found:** implementation-1.md claims "138 files total" for the
`apps/api/drizzle/` manifest; this verifier's independent `find` count is
**135 files** (67 top-level `.sql`/config-adjacent files + 68 files under
`meta/`). This is a factual discrepancy in the report's file count. It does
not affect the substance of AC2/T8 — the before/after diff is genuinely
empty either way — but the report's stated count (138) does not match what
exists on disk (135).

### `npm run test` (root, all workspaces)
Exit code **1**. Per-workspace summary (independently grepped from the full log):
```
@compass/api:        tests 813 / pass 813 / fail 0
@compass/extractor:   tests 63  / pass 62  / fail 1
@compass/ingestor:    tests 12  / pass 12  / fail 0
@compass/web:         tests 264 / pass 264 / fail 0
@compass/ai:          tests 32  / pass 32  / fail 0
@compass/shared:      tests 212 / pass 212 / fail 0
```
The one extractor failure, pasted verbatim from the log:
```
file:///home/udai/PennyPilot/apps/extractor/src/statement-duplicate.test.ts:30
    throw new Error(
          ^
Error: statement-duplicate.test.ts needs DATABASE_URL set (a real Postgres connection) — this repo has no DB-mocking infrastructure. Export it (see apps/extractor/.env) before running `npm run test -w apps/extractor`.
    at requireDatabaseUrl (file:///home/udai/PennyPilot/apps/extractor/src/statement-duplicate.test.ts:30:11)
✖ src/statement-duplicate.test.ts (411.810991ms)
ℹ tests 63 / pass 62 / fail 1
```
`git status --porcelain -- apps/extractor` returns empty — confirms zero
files under `apps/extractor` were touched by this task, so this failure is
pre-existing/environmental, not a regression introduced by the migration.
Matches implementation-1.md's claim exactly.

### `git diff -- tasks/01.01-migrate-ledger.md tasks/01.09-cross-module-ports.md`
Read in full; matches implementation-1.md's pasted diff exactly:
- `01.01`: one-line removal of the `imports.ts (878)` mention from the
  "Heaviest services" prose. Nothing else changed in that file.
- `01.09`: `depends: [1.2...1.8]` → `depends: [1.1, 1.2...1.8]`; a new
  ownership paragraph (FK graph/SCC, per-table assignment, cyclic-SCC policy,
  thin-surface conversion, single Drizzle Kit entry point, zero-diff +
  object-identity proof); 5 new `- [ ]` acceptance criteria matching that
  paragraph one-for-one.

### `git diff --stat -- CLAUDE.md`
Empty output — confirms the file is genuinely untouched, consistent with the
implementer's stated deviation (declined to edit CLAUDE.md via a delegation
chain, citing an internal rule). This verifier did not attempt the edit
either, per the brief's instruction.

## Spot-checks of moved files

- `apps/api/src/modules/ledger/services/accounts.ts`: confirmed the claimed
  split import — `accounts, transactions` from `../schema.ts`;
  `bankDetails, retirementDetails, sips` from `../../../db/schema.ts`. Also
  imports `assertOwnedGoal` from `../../../services/ownership.ts` (correct
  depth-adjusted reverse-direction import).
- `apps/api/src/modules/ledger/services/recurring.ts`: confirmed the claimed
  split import — `recurringTemplates, transactions` from `../schema.ts`;
  `emiDetails` from `../../../db/schema.ts`. Also imports `lockAccountPair`/
  `stepAmortization` from `../../../services/emis.ts` and `assertOwnedAccount`/
  `assertOwnedCategory` from `../../../services/ownership.ts` — correct.
- `apps/api/src/modules/ledger/services/transactions.ts`: schema imports
  (`recurringTemplates, transactions, transactionSplits, transferLinks`) all
  from `../schema.ts` (no split needed, confirmed — matches the report's
  claim these are all ledger-owned).
- `apps/api/src/modules/ledger/routes/rules.ts`: confirmed the direct
  `merchantRules` Drizzle query (`app.db.query.merchantRules.findMany`,
  `app.db.delete(merchantRules)...`) was relocated verbatim, not refactored
  into a service call — matches the documented technical-debt carry-over.
- `apps/api/src/modules/ledger/routes/transactions.ts`: confirmed exactly 5
  `app.eventBus.emit("ledger.mutated", ...)` call sites — POST /transactions,
  PATCH /:id, DELETE /:id, PUT /:id/splits, POST /bulk — matching the claimed
  count and call sites exactly.

## Discrepancies found (explicit list)

1. **Drizzle manifest file-count mismatch**: implementation-1.md states "138
   files total" for the `apps/api/drizzle/` content-hash manifest; this
   verifier's independent `find apps/api/drizzle -type f | wc -l` returns
   **135**. The substantive claim (zero diff before/after `db:generate`) is
   confirmed true regardless, so this does not affect AC2/T8's pass verdict,
   but the stated count in the report is factually wrong.
2. **Minor script-coverage note (not a defect)**: the implementer's T11
   completeness script checked only the 24 deleted *production* paths (its
   own text says "not the 11 test paths, matching the letter of TASK.md's
   T11 verification"). This verifier's independent script checked all 35
   (24 production + 11 test) and also found zero violations — a strictly
   stronger positive result, not a contradiction.
3. No other discrepancy found between implementation-1.md's claims and
   independently-observed reality — every file list, diff, test count, and
   command output checked above matched the report verbatim.

## Unresolved risks (carried over from implementation-1.md, independently confirmed)

- Two comments in `apps/api/src/db/schema.ts` still say "services/categories.ts"
  in prose (confirmed via `grep -n "services/categories.ts" apps/api/src/db/schema.ts`
  → lines 227 and 246) even though the file now lives at
  `modules/ledger/services/categories.ts`. `db/schema.ts` is on the
  Must-Not-Change list, so this stale comment was left as-is — confirmed
  present, not fixed by either party.
- `CLAUDE.md`'s planned documentation paragraph (distinguishing physical
  schema ownership from transitional thin surfaces) was not added — confirmed
  by empty `git diff --stat -- CLAUDE.md`. This is P12's other half, left
  undone by the implementer's declared operating-rule deviation.
- The root `npm run test` exits 1 today (both before and after this task,
  per the implementer's own caveat) due to the unrelated `@compass/extractor`
  env-loading issue — confirmed independently, not something this verifier's
  own re-run could root-cause further without reverting the migration itself.

## Conclusion

All 8 acceptance criteria (AC1-AC8) verified PASS via independent command
execution and direct file reads. Every quantitative claim in
implementation-1.md (file counts, test counts, diff content, git status) was
independently reproduced except the drizzle-manifest "138 files" figure,
which this verifier measures as 135 — a factual error in the report that does
not change the pass/fail verdict of any acceptance criterion.
