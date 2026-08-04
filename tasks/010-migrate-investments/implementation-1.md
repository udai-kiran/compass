# Implementation 1 — task 010 "Migrate investments module"

Implementer's own self-report, executing `DELEGATION.md`/`TASK.md`'s P1-P14. Not independently verified
at the time of writing — see `verification-1.md` for the independent re-derivation. Preserved verbatim
below as the orchestration record.

---

## Summary

Executed the full P1–P14 plan from `tasks/010-migrate-investments/TASK.md` / `DELEGATION.md`: migrated
the investments domain (holdings, sips, networth, goal-networth, holding-details, account-nps,
capital-gains, tax-lots, mf-import, xirr, amfi, mf-scheme-map) from flat `apps/api/src/routes/*.ts` /
`apps/api/src/services/*.ts` into `apps/api/src/modules/investments/{schema.ts, services/, routes/,
plugin.ts}`, split `sips.ts`/`sips.test.ts` into 4 seam files each, updated all 7 cross-module imports,
added the new demo-403 test, and corrected both roadmap files.

**Important environment note:** this repo's working tree already contained substantial **uncommitted,
unrelated** changes when I started — an in-progress ledger/credit module migration (tasks 007/008) and
other unrelated fixes (`db/bootstrap.ts`, `db/seed.ts`, `services/auth.ts`, etc.), all showing as
`M`/`D`/`??` in `git status` before I touched anything. I did not create, revert, or otherwise interact
with any of that pre-existing work beyond depending on `modules/ledger/`/`modules/credit/` as the
template (as instructed) and editing the two specific already-migrated files DELEGATION named
(`modules/ledger/services/transactions.ts`, `modules/credit/services/reconciliation-writes.ts`) by
exactly the one/two lines it specified. All diffs below are scoped to my own edits; where `git diff`
against `HEAD` also shows pre-existing unrelated lines, I've called that out explicitly.

## Pre-implementation grep sweep (before starting)

Ran `grep -rn` across `apps/api/src` for all 16 moved filenames before making any change. Result:
**confirmed complete — exactly the 7 external cross-module imports DELEGATION lists**, plus the
documented in-domain edges from Root Cause §5(b)/(c). No unlisted external consumer found.

**One thing found that was NOT in DELEGATION's 7-item list, flagging as instructed rather than silently
fixing:** `apps/api/src/routes/sips.ts` (now `modules/investments/routes/sips.ts`) had `import {
invalidateUserCache } from "../services/cache.ts";` — a still-flat file. This isn't a new *external
consumer* of investments code (the class of risk the 7-item list was built to catch); it's investments'
own route file importing a still-flat sibling, exactly the same category as
`goal-allocation.ts`/`ownership.ts` (Root Cause §5b, "not moved, depth-adjust only") — just a specific
file DELEGATION's route-file inventory didn't individually name. Since P6 explicitly covers "same
classify-and-repoint discipline" for the 4 route files and the file cannot compile without the depth
adjustment, I fixed it (`"../services/cache.ts"` → `"../../../services/cache.ts"`) rather than leave it
broken, but I'm surfacing it here since it wasn't literally on the list.

## Files changed

**New (35 files under `apps/api/src/modules/investments/`):**
`schema.ts`, `schema.smoke.test.ts`, `plugin.ts`, `plugin.test.ts`;
`services/{holdings,networth,goal-networth,holding-details,account-nps,capital-gains,tax-lots,mf-import,
xirr,amfi,mf-scheme-map}.ts` (11, moved) + their 7 tests
(`holdings,networth,goal-networth,capital-gains,tax-lots,mf-import,xirr`.test.ts) + `xirr.test.ts`;
`services/{sip-lifecycle,sip-installments,sip-commitments,sip-schedule}.ts` + their 4 `.test.ts` files
(split from `sips.ts`/`sips.test.ts`); `routes/{holdings,sips,networth,account-nps}.ts` (moved);
`routes/networth.route.test.ts` (new, P11).

**Deleted (24 = 16 production + 8 test, confirmed gone from disk via T12 check):**
`routes/{holdings,sips,networth,account-nps}.ts`;
`services/{holdings,networth,goal-networth,holding-details,account-nps,capital-gains,tax-lots,mf-import,
xirr,amfi,mf-scheme-map,sips}.ts`;
`services/{holdings,networth,goal-networth,capital-gains,tax-lots,mf-import,xirr,sips}.test.ts`.

**Modified by me:**
`apps/api/src/app.ts`, `apps/api/src/jobs/index.ts`, `apps/api/src/route-table.snapshot.txt`
(regenerated), `apps/api/src/services/cashflow.ts`, `apps/api/src/services/goals.ts`,
`apps/api/src/services/inbox.ts`, `apps/api/src/modules/ledger/services/transactions.ts` (2 lines:
import + a stale comment word), `apps/api/src/modules/credit/services/reconciliation-writes.ts` (1
line), `tasks/01.03-migrate-investments.md`, `tasks/01.04-migrate-protection.md`.

**Not touched (verified):** `db/schema.ts`, `db/core-schema.ts`,
`services/{goal-allocation,ownership,retirement,backup}.ts`, `routes/retirement.ts`,
`route-surface.snapshot.txt`.

## Content-diff verification for verbatim-moved files (AC11)

Diffed each moved file's pre-move committed content (`git show HEAD:<old>`) against its new location.
**Every diff consists exclusively of import-path changes** plus the two documented stale-comment fixes:
- `holdings.ts`: `` `services/sips.ts`'s `recordSipInstallment` `` → `` `sip-installments.ts`'s
  `recordSipInstallment` ``
- `capital-gains.ts`: `per services/tax-lots.ts` → `per tax-lots.ts`

`tax-lots.ts`, `xirr.ts`, `mf-scheme-map.ts`, `holdings.test.ts`, `goal-networth.test.ts`,
`capital-gains.test.ts`, `tax-lots.test.ts`, `mf-import.test.ts`, `xirr.test.ts`,
`networth.ts`(routes), `account-nps.ts`(routes) had **zero** diff beyond move. `routes/sips.ts` diff is
exactly the documented single-import→two-import split. No route-handler body, status code, or
non-`sips.ts` service logic changed anywhere.

`app.ts`, `jobs/index.ts`, `cashflow.ts`, `goals.ts`, `inbox.ts` diffs show only the documented import
line(s) — confirmed by direct `git diff` read; where those diffs also contain pre-existing unrelated
lines (e.g. `app.ts`'s ledger/credit route consolidation, `jobs/index.ts`'s credit/ledger import
lines), those are the pre-existing uncommitted work, not mine.

## `sips.ts` → 4-file split (P5)

Split at exactly lines 1–550 / 551–1039 / 1041–1126 / 1128–1319 as specified. The 3 functions (`toSip`,
`lastInstallmentDateFor`, `ownedSip`) became `export`ed in `sip-lifecycle.ts`; `isArchived`/
`isUniqueViolation` needed only new import paths (already exported); `sip-lifecycle.ts` imports
`dueInstallmentDate` from `./sip-schedule.ts`. `routes/sips.ts` now imports 5 names from
`sip-lifecycle.ts` and 4 from `sip-installments.ts`. Table imports were split per-file between the
local `../schema.ts` (investments-owned: `holdingEvents`, `holdings`, `sips`) and
`../../../db/schema.ts` (still-flat: `accounts`, `transactions`), matching the ledger/credit precedent.
Verified via `diff` against the original body (modulo the 3 sanctioned `export` additions and import-
block content) — no unexpected differences.

## `sips.test.ts` → 4-file split — name-level accounting

```
git show HEAD:apps/api/src/services/sips.test.ts | grep -oP '(?<=^test\(")[^"]*' | sort  → 113 names
cat sip-lifecycle.test.ts sip-installments.test.ts sip-commitments.test.ts sip-schedule.test.ts \
  | grep -oP '(?<=^test\(")[^"]*' | sort → 113 names
diff <old> <new>  → empty (exit 0)
```
Zero dropped, zero duplicated, zero renamed. Distribution matches DELEGATION exactly:
`sip-lifecycle.test.ts` 11 sections/40 tests, `sip-schedule.test.ts` 5 sections/43 tests,
`sip-commitments.test.ts` 2 sections/8 tests, `sip-installments.test.ts` 2 sections/22 tests
(40+43+8+22 = 113).

## Commands run — literal output

**1. `npm run typecheck` (root, all workspaces)** — clean, zero errors, all 7 workspaces (api, docs,
extractor, ingestor, web, ai, shared).

**2. `npm run lint`** — `eslint .` — clean, zero errors.

**3. `npm run test` (root, all workspaces)** — final run:
```
@compass/api       : tests 837, pass 837, fail 0
@compass/extractor : tests 63,  pass 62,  fail 1   (pre-existing, unrelated — see below)
@compass/ingestor  : tests 12,  pass 12,  fail 0
@compass/web       : tests 264, pass 264, fail 0
@compass/ai        : tests 32,  pass 32,  fail 0
@compass/shared    : tests 212, pass 212, fail 0
```
Overall exit code 1 (from the extractor failure only). **`apps/extractor`'s
`statement-duplicate.test.ts` fails with `"needs DATABASE_URL set ... export it before running npm run
test -w apps/extractor"`** — apps/extractor's own `test` script (`node --test "src/**/*.test.ts"`, no
`--env-file-if-exists`) doesn't pick up `.env` the way `apps/api`'s does, and I never exported
`DATABASE_URL` in the parent shell. `apps/extractor` is entirely outside this task's scope (I never
touched any of its files) — this is a pre-existing environment gap, not a regression.

**Transient flake encountered and resolved during this session, reporting for transparency:** one
intermediate run of `npm run test` showed `apps/api` at 810/837 pass with 27 failures, all in
`modules/credit/services/card-due-tasks.test.ts` (a `before()` hook guard that refuses to run if it
sees a non-demo `card_details` row in the shared dev Postgres — explicitly documented in that file's
own comment as having "no test-DB isolation" against concurrently-running test files). Immediately
re-running the identical command produced 837/837 pass, 0 fail. This file is entirely outside my scope
(credit module, untouched by me) — the flake is a pre-existing hazard of parallel `node --test` files
racing on the shared, non-isolated dev Postgres, not something my changes caused. Final and
second-to-last runs both show 837/837 clean.

**4. `npm run db:generate`** — content-hash manifest of `apps/api/drizzle/` (135 files, `sha256sum`)
identical before/after:
`2817956ddf2f999bfaa29134d67bdb474be11663889ca24484ae2f080aa4899c` both times. Output: `"No schema
changes, nothing to migrate 😴"`. `git status --porcelain apps/api/drizzle/` empty.

**5. `node --env-file-if-exists=../../.env --test src/services/backup.test.ts`** (from apps/api) —
13/13 pass.

**6. `node --test src/app.route-snapshot.test.ts`** (from apps/api) — 7/7 pass, including both the
canonical route-surface test (byte-identical, unchanged) and the raw route-table test (passes against
the regenerated snapshot).

**7. `node --test src/modules/investments/schema.smoke.test.ts`** — 2/2 pass (8-table + 10-enum
object-identity, all 18 bindings).

**8. `node --test src/modules/investments/plugin.test.ts`** — 1/1 pass (4 registrations resolve,
including account-nps).

**9. Each of the 12 resulting investments test files run individually:**
```
holdings.test.ts          29/29
networth.test.ts          39/39
goal-networth.test.ts      8/8
capital-gains.test.ts      7/7
tax-lots.test.ts          30/30
mf-import.test.ts         23/23
xirr.test.ts              32/32
sip-lifecycle.test.ts     40/40
sip-installments.test.ts  22/22
sip-commitments.test.ts    8/8
sip-schedule.test.ts      43/43
networth.route.test.ts     1/1  (the new demo-403 test)
```
All 12 pass, 0 fail each.

**10. Source-aware import-resolution script** (not grep — resolves every relative import specifier in
every `.ts` file under `apps/api/src` to an absolute path and compares against the 24-path deleted-file
set): **218 files checked, 0 violations.** Positive-grep corroboration (`from
".*investments/services/"`) confirms exactly the 7 expected external references (jobs/index.ts,
cashflow.ts, goals.ts ×2, inbox.ts, transactions.ts, reconciliation-writes.ts).

**T12 — old-path nonexistence:** all 24 old paths (16 production + 8 test) confirmed absent from disk
via direct `[ -e ]` check on each.

**T4/AC1/AC4 extras run:** `jobs/index.test.ts` (7/7 pass — `LEDGER_DAY_SCHEDULERS`/`LEDGER_DAY_TZ`
unchanged, scheduler registration byte-identical).

**Route-table regeneration (P10):** regenerated via a scratch script calling `registerRoutes(app)` +
`printRoutes({commonPrefix:false})` (matching the documented generator). Raw diff shows substantial
reordering (expected — 4 interleaved registrations collapsed into one contiguous plugin at an earlier
position). Verified via the 3-part checklist: stripped tree-drawing glyphs and sorted both old/new —
**156/156 lines identical as a multiset, zero diff** — confirming leaf content matches exactly, only
ordering/nesting differs, no unexpected constraint or duplicate branch. `route-surface.snapshot.txt`
(283 lines) was never touched/regenerated, and the canonical-surface test passed byte-identical
throughout.

## Judgment calls / deviations to flag

1. **`services/cache.ts` import in `routes/sips.ts`** — not in DELEGATION's 7-item list; fixed as a
   mechanical depth-adjustment inherent to the P6 route move (see grep-sweep section above). Flagging
   per instructions rather than treating it as silently in-scope.
2. **Accidental `git add -A -- <pathspec>` mistake:** partway through gathering evidence I ran `git add
   -A` scoped to two paths, which violates the "never `git add -A`" rule regardless of pathspec
   scoping, and this is an Implement brief where I was never asked to stage anything. I caught this
   immediately and ran `git reset HEAD -- <same paths>` to fully undo it. Confirmed via `git status
   --porcelain | grep -c "^[MADR]"` → `0` staged entries remain. Nothing was committed. Flagging this
   explicitly as required.
3. **`app.ts`'s `registerRoutes` doc comment** — I added a new paragraph documenting task 1.3's
   registration-order change, mirroring the existing paragraphs task 1.1/1.2 already wrote there (same
   file, same convention, not a new file). This is a documentation-only addition following the file's
   own established pattern, not new production logic.

## Assumptions
- DELEGATION's "already-migrated, merged" description of tasks 1.1/1.2 doesn't match actual git
  history (they're uncommitted in this same working tree, no merge commit exists) — I treated the
  `modules/ledger/`/`modules/credit/` directories present in the working tree as the authoritative
  template to mirror, per the instruction to use them as such, regardless of their commit status.
- Used the dev Postgres/Redis at `192.168.2.196` via the repo-root `.env` for all DB-backed tests (per
  `CLAUDE.md`/memory notes), matching DELEGATION's own command spec
  (`--env-file-if-exists=../../.env`).

## Unresolved risks
- `apps/extractor`'s pre-existing `DATABASE_URL`-dependent test failure is unresolved and out of scope
  — noted, not fixed.
- The working tree still contains a large amount of unrelated, pre-existing uncommitted work
  (ledger/credit migrations + other fixes) that I did not audit or verify beyond what was needed to
  confirm my own investments changes didn't collide with it.

## Key file paths
- `/home/udai/PennyPilot/apps/api/src/modules/investments/` (all new/moved investments module files)
- `/home/udai/PennyPilot/apps/api/src/app.ts`, `/home/udai/PennyPilot/apps/api/src/jobs/index.ts`
- `/home/udai/PennyPilot/apps/api/src/services/{cashflow,goals,inbox}.ts`
- `/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts`,
  `/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts`
- `/home/udai/PennyPilot/apps/api/src/route-table.snapshot.txt`
- `/home/udai/PennyPilot/tasks/01.03-migrate-investments.md`,
  `/home/udai/PennyPilot/tasks/01.04-migrate-protection.md`
