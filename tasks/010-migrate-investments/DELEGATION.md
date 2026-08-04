# Sonnet Worker Delegation

## Task
010 — Migrate investments module (roadmap task 1.3), `tasks/010-migrate-investments/TASK.md`

**Read `TASK.md` in full before starting — it is the source of truth for this delegation.** It has
been through 3 revisions and 2 rounds of Codex review (`review-1.md`, `review-2.md`); every number,
file path, and import in it has been independently re-verified against the real code at least once,
several twice. Do not re-derive scope from the roadmap file (`tasks/01.03-migrate-investments.md`)
directly — `TASK.md`'s Root Cause section documents exactly where that file's own prose is wrong or
incomplete and why. Also read the two investigation files (`investigation-1.md`, `investigation-2.md`)
for full context on the `sips.ts` cross-seam call graph — `TASK.md`'s Root Cause section quotes the
load-bearing facts from both, but the full files have more detail if anything is ambiguous.

## Approved Plan
P1-P14 exactly as written in `TASK.md`'s Plan section. Execute in order. Do not skip P9's
nonexistence-confirmation step even though P4-P6's `mv`-based moves already remove the old paths.

## Files and Symbols — critical exact specifications, do not deviate

### Schema (P3)
`apps/api/src/modules/investments/schema.ts` — thin named re-export (NOT physical `pgTable()`
relocation — mirror `apps/api/src/modules/ledger/schema.ts` / `apps/api/src/modules/credit/schema.ts`
exactly, including their doc-comment style explaining why) of these 8 tables + 10 enums from
`../../db/schema.ts`:
- Tables: `holdings`, `accountNpsDetails`, `npsDetails`, `goldDetails`, `holdingValuations`,
  `holdingEvents`, `sips`, `netWorthSnapshots`
- Enums: `assetClass`, `gainsTaxClass`, `npsTier`, `goldForm`, `holdingEventType`,
  `holdingEventSource`, `sipTargetKind`, `sipStatus`, `sipFundingSource`, `sipFrequency`

`db/schema.ts` must NOT `export *` back from `modules/investments/schema.ts` — same rule as
ledger/credit.

`schema.smoke.test.ts` must assert object identity (`assert.strictEqual`, same object reference) for
**all 18** bindings (8 tables + 10 enums) — both prior modules' smoke tests check enums too, this one
must match.

### `sips.ts` split (P5) — exact cross-file export requirement, verified twice against the real file
Split `apps/api/src/services/sips.ts` (1319 lines) into 4 files in
`apps/api/src/modules/investments/services/`:
- `sip-lifecycle.ts` (orig. lines 1-550)
- `sip-installments.ts` (orig. lines 551-1039)
- `sip-commitments.ts` (orig. lines 1041-1126)
- `sip-schedule.ts` (orig. lines 1128-1319)

**Exactly 3 currently-private functions must become `export`ed** in `sip-lifecycle.ts` because
`sip-installments.ts` calls them across the split: `toSip` (orig. line 34), `lastInstallmentDateFor`
(orig. line 102), `ownedSip` (orig. line 117). Two already-exported names (`isArchived`,
`isUniqueViolation`) are also called cross-file from installments — no export change needed, just a new
import path. `sip-lifecycle.ts` itself imports `dueInstallmentDate` from `./sip-schedule.ts` (already
exported). No other cross-seam call exists anywhere in the file (confirmed exhaustively, twice, by
per-identifier grep against the real 1319-line file — see `investigation-2.md` if you want to re-verify
yourself, but do not treat this list as incomplete without direct evidence).

`routes/sips.ts`'s single import splits into two: 5 names from `sip-lifecycle.ts` (`createSip`,
`deleteSip`, `listAllSips`, `listSipsForGoal`, `updateSip`), 4 from `sip-installments.ts`
(`linkSipInstallment`, `listSipInstallmentCandidates`, `recordSipInstallment`,
`unlinkSipInstallment`).

### `sips.test.ts` split (P5) — exact 20-row mapping, use the table in `TASK.md`'s Root Cause verbatim
`TASK.md`'s Root Cause section ("`sips.test.ts` (1026 lines) — split follows the same 4 files") has the
full 20-row section→file table (line numbers, verbatim header text, destination file) — use it exactly.
Requirements:
- Every section is relocated **verbatim** (zero assertion changes) — only import statements change.
- Original relative order is preserved **within** each destination file.
- Produce a name-level accounting: every `test(...)` name in the original file, mapped to exactly one
  destination file, compared as a multiset against the original — paste this comparison in your report,
  not just "sections moved."
- Resulting distribution: `sip-lifecycle.test.ts` gets 11 sections, `sip-schedule.test.ts` gets 5,
  `sip-commitments.test.ts` gets 2, `sip-installments.test.ts` gets 2. Total 20.

### Cross-module imports to update (P8) — all 6, not just the obvious 2
1. `apps/api/src/modules/ledger/services/transactions.ts:18` — `isUniqueViolation` from `sips.ts` →
   `../../investments/services/sip-lifecycle.ts`
2. `apps/api/src/modules/credit/services/reconciliation-writes.ts:9` — `repairSnapshots` from
   `networth.ts` → `../../investments/services/networth.ts`
3. `apps/api/src/services/cashflow.ts:12` — `sipOccurrencesInWindow` from `sips.ts` →
   `../modules/investments/services/sip-schedule.ts`
4. `apps/api/src/services/goals.ts:23` — `committedForGoal` from `sips.ts` →
   `../modules/investments/services/sip-commitments.ts`
5. `apps/api/src/services/goals.ts:15` — **a second, separate import in the same file** —
   `getPortfolio` from `holdings.ts` → `../modules/investments/services/holdings.ts`
6. `apps/api/src/services/inbox.ts:20` — `isUniqueViolation` from `sips.ts` →
   `../modules/investments/services/sip-lifecycle.ts`
7. `apps/api/src/jobs/index.ts:10-15` — `closePreviousDay`/`isSystemicFailure`/`snapshotAllUsers`/
   `SnapshotPassResult` from `networth.ts` → `../modules/investments/services/networth.ts`. Do **not**
   touch `LEDGER_DAY_SCHEDULERS`, `LEDGER_DAY_TZ`, or the scheduler registration code itself — only the
   import line.

Before starting, run your own `grep -rn` sweep across `apps/api/src` for every one of the 16 moved
filenames to reconfirm this list is complete — two prior review rounds already did this and found the
above 7 items complete, but re-confirm before you start, and immediately flag (do not silently fix) if
you find anything beyond this list.

### Route/plugin files (P6-P7)
Move `routes/{holdings,sips,networth,account-nps}.ts` into `modules/investments/routes/`. Create
`modules/investments/plugin.ts` (`investmentsRoutes(app)`, registers all 4 internally, no prefix) and
`modules/investments/plugin.test.ts` (hermetic, route-lookup only, never `app.inject()`) asserting one
uniquely-attributable route from each of the 4: `GET /api/portfolio` or `GET /api/holdings` (holdings),
`GET /api/sips` (sips), `GET /api/net-worth` (networth), `GET /api/accounts/:accountId/nps-details`
(account-nps — this one specifically proves the account-nps ownership correction landed in plugin
registration).

Update `app.ts`: 4 separate registrations (`sipRoutes`, `holdingRoutes`, `netWorthRoutes`,
`accountNpsRoutes`) → one `await app.register(investmentsRoutes)` at the position of the earliest of
the four (`sipRoutes`, currently line 112).

### Roadmap-text corrections (P1)
- `tasks/01.03-migrate-investments.md`: endpoint count "13" → "16"; Routes line gains `account-nps` and
  names its HTTP surface (`GET/PUT /api/accounts/:accountId/nps-details`); prose names
  `holding-details.ts`, `capital-gains.ts`, `tax-lots.ts`, `mf-import.ts`, `xirr.ts`, `amfi.ts`,
  `mf-scheme-map.ts`, `goal-networth.ts`.
- `tasks/01.04-migrate-protection.md`: Routes line removes `account-nps` (its Tables line already
  excludes `account_nps_details` — no other change to this file).

### New demo-mode-403 test (P11)
Target `POST /api/net-worth/backfill` specifically (not a different endpoint). Assert both: (a) a demo
session gets HTTP 403, (b) no `net_worth_snapshots` row was written/changed as a result — mirror the
strength of `apps/api/src/routes/user-tasks.route.test.ts`'s existing "AC12" test (reject + no-mutation,
not just status code).

## Must Not Change
- Table definitions in `db/schema.ts` (re-exported, not moved).
- `LEDGER_DAY_SCHEDULERS` array, `LEDGER_DAY_TZ` constant, or scheduler registration code in
  `jobs/index.ts` — only its networth import line.
- `services/goal-allocation.ts`, `services/ownership.ts`, `services/retirement.ts`,
  `routes/retirement.ts` — none of these move or change (see `TASK.md`'s "Not moved, and why").
- `backup.ts` — no change needed (all 8 tables already correctly classified).
- Any route handler body, status code, or non-`sips.ts` service logic beyond import-path updates and
  stale location-comment fixes (AC11 — this is diff-reviewed explicitly, so do not casually "improve"
  anything while moving it).
- `services/goals.ts`, `services/cashflow.ts`, `services/inbox.ts` beyond their documented one/two-line
  import fixes — no other logic in these files changes.

## Acceptance Criteria
AC1-AC11 exactly as written in `tasks/010-migrate-investments/TASK.md`'s Acceptance Criteria section.
Read them there — do not rely on this summary alone for the exact wording.

## Commands
Run from repo root unless noted (see `CLAUDE.md` for the general command reference):
1. `npm run typecheck` (all workspaces)
2. `npm run lint`
3. `npm run test` (all workspaces) — full literal output, pass/fail counts, exit code
4. `npm run db:generate` — capture content-hash manifest of `apps/api/drizzle/` before and after,
   confirm identical
5. `node --env-file-if-exists=../../.env --test src/services/backup.test.ts` (from `apps/api`)
6. `node --test src/app.route-snapshot.test.ts` (from `apps/api`)
7. `node --test src/modules/investments/schema.smoke.test.ts` (from `apps/api`)
8. `node --test src/modules/investments/plugin.test.ts` (from `apps/api`)
9. Individually run each of the 12 resulting investments test files from their new location
10. Your own source-aware import-resolution script (not grep) proving zero remaining reference to any
    of the 16 deleted production paths or 8 deleted test paths — per `TASK.md` T11's exact method
    (resolve every relative import specifier to an absolute path, compare against the deleted-path set
    — a basename-shaped grep is explicitly insufficient, see `TASK.md`/task 1.1's own precedent for why)

## Required Evidence
- Full list of files changed/moved/deleted/created.
- Complete diff for every modified file (not moved-and-untouched ones — for those, confirm via a
  content-diff against the pre-move version that only import paths and stale comments changed).
- Every command above, with literal output, pass/fail counts, exit codes.
- The name-level `sips.test.ts` test-name accounting (old vs. new multiset comparison).
- Confirmation of the content-hash manifest match for `apps/api/drizzle/`.
- Any plan deviation, blocker, or judgment call you had to make that wasn't fully specified above —
  flag explicitly, do not silently resolve and not mention it.
- If you find any cross-module import beyond the 7 listed above during your own pre-start grep sweep,
  stop and report it rather than silently fixing it outside this delegation's scope — it may indicate
  the plan itself needs another look.
