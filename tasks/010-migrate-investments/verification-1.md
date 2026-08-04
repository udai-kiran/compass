# Verification 1 — task 010 "Migrate investments module"

Independent, read-only verification by a worker that did not implement the change. No files edited,
nothing staged, nothing committed. Re-derived every claim from the real repository state rather than
trusting `implementation-1.md`.

---

## Scope of this verification
Read-only. No files edited, nothing staged (`git add` never run), nothing committed.

## 1. `git status --porcelain` — staging check

Full output captured (repo has substantial pre-existing uncommitted ledger/credit-migration work
interleaved, per the brief's warning). Every line's leading two columns are either `??` (untracked) or
space+letter (unstaged `M`/`D`) — **verified programmatically**:
```
git status --porcelain | awk '{print substr($0,1,2)}' | sort -u
??
 D
 M
```
`git diff --cached --stat` returned empty. **Confirmed: nothing is staged.** The implementer's claim
about the accidental `git add -A` / `git reset` cleanup checks out.

## 2. File structure

`apps/api/src/modules/investments/` contains `schema.ts`, `schema.smoke.test.ts`, `plugin.ts`,
`plugin.test.ts`, `services/`, `routes/` — all present.

`services/` — exactly 15 production files (matches spec: 11 unmodified-beyond-imports + 4 sip-split):
`account-nps.ts`, `amfi.ts`, `capital-gains.ts`, `goal-networth.ts`, `holding-details.ts`,
`holdings.ts`, `mf-import.ts`, `mf-scheme-map.ts`, `networth.ts`, `sip-commitments.ts`,
`sip-installments.ts`, `sip-lifecycle.ts`, `sip-schedule.ts`, `tax-lots.ts`, `xirr.ts`. Plus exactly
11 test files (7 unmodified + 4 split).

`routes/` — exactly 4 production files (`holdings.ts`, `sips.ts`, `networth.ts`, `account-nps.ts`) + 1
new test file `networth.route.test.ts` (the demo-mode-403 test).

Total investments test files = 11 + 1 = **12**, matching AC5/T10's corrected count.

## 3. Old paths gone

Scripted existence check across all 24 old paths (4 routes + 12 services + 8 test locations) — zero
matches, all confirmed deleted.

## 4. Schema re-export

`apps/api/src/modules/investments/schema.ts` (48 lines) — pure named `export { ... } from
"../../db/schema.ts"` block, no `pgTable`/`pgEnum` calls, exactly the 8 tables + 10 enums named in
TASK.md. `db/schema.ts` has zero references to `investments` (grep exit code 1, no matches) —
confirmed no `export *` back. `schema.smoke.test.ts` asserts `assert.strictEqual` object identity for
all 18 bindings (8 in `TABLE_NAMES`, 10 in `ENUM_NAMES`), matching AC6.

## 5. `sips.ts` split — cross-file exports

`sip-lifecycle.ts`: `toSip` (line 23), `lastInstallmentDateFor` (line 91), `ownedSip` (line 106) — all
`export`ed. `sip-installments.ts` imports exactly `{ isArchived, isUniqueViolation,
lastInstallmentDateFor, ownedSip, toSip }` from `./sip-lifecycle.ts`. `sip-lifecycle.ts` imports
`dueInstallmentDate` from `./sip-schedule.ts` (line 19). `sip-schedule.ts` and `sip-commitments.ts`
import nothing from any other seam file (verified — their only imports are `@compass/shared`,
`drizzle-orm`, `db/index.ts`/`db/schema.ts`, `../schema.ts`, `goal-allocation.ts`).

`npm run typecheck -w apps/api` from repo root: **exit code 0**, zero errors.

## 6. Cross-module imports — all 7, re-derived independently

Wrote and ran a source-aware Node resolver script (not grep) that parses every relative `import ...
from` in all 218 `.ts` files under `apps/api/src`, resolves each specifier to an absolute path, and
checks against the 16 deleted production paths:
```
ZERO remaining references to any of the 16 deleted production paths.
Scanned 218 .ts files under apps/api/src.
```
Then verified each of the 7 named files individually — all match spec exactly:
1. `modules/ledger/services/transactions.ts:18` — `import { isUniqueViolation } from
   "../../investments/services/sip-lifecycle.ts";`
2. `modules/credit/services/reconciliation-writes.ts:9` — `import { repairSnapshots } from
   "../../investments/services/networth.ts";`
3. `services/cashflow.ts:12` — `import { sipOccurrencesInWindow } from
   "../modules/investments/services/sip-schedule.ts";`
4/5. `services/goals.ts:15,23` — `import { getPortfolio } from
   "../modules/investments/services/holdings.ts";` and `import { committedForGoal } from
   "../modules/investments/services/sip-commitments.ts";`
6. `services/inbox.ts:20` — `import { isUniqueViolation } from
   "../modules/investments/services/sip-lifecycle.ts";`
7. `jobs/index.ts:11-15` — `closePreviousDay, isSystemicFailure, snapshotAllUsers,
   SnapshotPassResult` from `"../modules/investments/services/networth.ts"`.

`git diff` on `cashflow.ts`, `goals.ts`, `inbox.ts` confirmed **only** the documented import line(s)
changed in each — no other logic touched.

## 7. `jobs/index.ts` scheduler code

`grep -n "LEDGER_DAY_SCHEDULERS\|LEDGER_DAY_TZ"` confirms `LEDGER_DAY_TZ = "Etc/UTC"` (line 131)
unchanged, `LEDGER_DAY_SCHEDULERS` (line 141) still includes
`"networth.snapshot"`/`"networth.snapshot.close"`. `git diff -- apps/api/src/jobs/index.ts` shows only
import-line changes (networth + two other pre-existing ledger/credit import lines from the uncommitted
1.1/1.2 work already in this tree) — no scheduler code touched.

## 8. `app.ts`

`git diff` confirms `sipRoutes`, `holdingRoutes`, `netWorthRoutes`, `accountNpsRoutes` imports and
registrations removed, replaced by one `await app.register(investmentsRoutes)` at the position
`sipRoutes` occupied. New doc-comment paragraph added explaining the task-1.3 collapse — matches
implementer's claimed self-report, confirmed by direct read.

## 9. Route snapshots

```
node --test src/app.route-snapshot.test.ts
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte
✔ assertRouteTableMatches rejects an added/removed/renamed route, method change; accepts identical
ℹ tests 7  ℹ pass 7  ℹ fail 0
```
`git diff -- apps/api/src/route-surface.snapshot.txt` — empty. **Caveat worth flagging**: this file is
`??` untracked (created uncommitted by task 1.1, never in a prior commit), so an empty `git diff` here
is trivially true regardless of edits and is weaker evidence than it looks; the stronger proof is the
passing "canonical route surface" test above, which compares live output against this exact file's
committed-in-working-tree content. `route-table.snapshot.txt` **did** change (`git diff --stat`: 29
insertions/29 deletions) — reviewed the full diff; leaf content (routes) is preserved, only
grouping/ordering shifted (consistent with the ledger+credit+investments module consolidations all
landing in this same working tree together).

## 10. Roadmap corrections

`tasks/01.03-migrate-investments.md:10` — `"Routes: holdings (16 endpoints), sips, networth,
account-nps (\`GET\`/\`PUT /api/accounts/:accountId/nps-details\`)."` — 16 not 13, account-nps present
with exact HTTP surface, and line 12 names all previously-unlisted files.
`tasks/01.04-migrate-protection.md:10` — `"Routes: insurance, retirement."` — no `account-nps`
mention.

## 11. New demo-403 test

`apps/api/src/modules/investments/routes/networth.route.test.ts` — targets `POST
/api/net-worth/backfill`, asserts `res.statusCode === 403`, and asserts `net_worth_snapshots` row
count is 0 both before and after the attempted call for that user. Ran individually:
```
✔ a demo session's POST /api/net-worth/backfill is rejected 403, and no net_worth_snapshots row is
  written or changed (157.878275ms)
ℹ tests 1  ℹ pass 1  ℹ fail 0
```

## 12. Full test suite

`npm run typecheck` (root, all 7 workspaces) — **exit 0**, all `tsc --noEmit` clean.

`npm run lint` — **exit 0**, no output.

`npm run test` (root, all workspaces) — **exit 1**, per-workspace summary:
```
@compass/api:       tests 837  pass 837  fail 0
@compass/extractor: tests 63   pass 62   fail 1   ← FAILS
@compass/ingestor:  tests 12   pass 12   fail 0
@compass/web:       tests 264  pass 264  fail 0
@compass/ai:        tests 32   pass 32   fail 0
@compass/shared:    tests 212  pass 212  fail 0
```
The single failure is `apps/extractor/src/statement-duplicate.test.ts`:
```
Error: statement-duplicate.test.ts needs DATABASE_URL set (a real Postgres connection) — this repo
has no DB-mocking infrastructure. Export it (see apps/extractor/.env) before running `npm run test -w
apps/extractor`.
```
This is **entirely outside `apps/api`**, unrelated to the investments migration, and matches exactly
the pre-existing environmental gap the brief itself named ("apps/extractor needing DATABASE_URL"). All
837 `apps/api` tests pass, including the 12 investments files and the demo-403 test. No occurrence of
the named `modules/credit/services/card-due-tasks.test.ts` flake was observed in this run (it passed
cleanly as part of the 837).

Individually ran all 12 investments test files from their new location — all pass (`holdings.test.ts`
29, `networth.test.ts` 39, `goal-networth.test.ts` 8, `capital-gains.test.ts` 7, `tax-lots.test.ts` 30,
`mf-import.test.ts` 23, `xirr.test.ts` 32, `sip-lifecycle.test.ts` 40, `sip-installments.test.ts` 22,
`sip-commitments.test.ts` 8, `sip-schedule.test.ts` 43, `networth.route.test.ts` 1 — 282 total, 0 fail
across all).

**`sips.test.ts` split — name-level accounting**: extracted all `test(...)` names from the old (git
`HEAD`) `sips.test.ts` (113 names, 20 section headers, 1026 lines) and from the 4 new split files
combined (113 names). `diff <(sort old) <(sort new)` → **zero differences**, exact multiset match.
Section-header distribution counted directly: `sip-lifecycle.test.ts`=11,
`sip-installments.test.ts`=2, `sip-commitments.test.ts`=2, `sip-schedule.test.ts`=5 → total 20,
matching TASK.md's corrected table exactly.

## 13. `git diff -- apps/api/src/app.ts`

Registration-code restructuring plus a new doc-comment paragraph only. No route-handler logic touched.

**"Move not rewrite" spot-check on the 11 non-sips service files + 4 route files**: diffed each new
file against its `git show HEAD:...` original. Every diff consists **only** of import-path depth
adjustments and two stale location-comment fixes (`services/sips.ts` → `sip-installments.ts` in
`holdings.ts`'s docstring; `services/tax-lots.ts` → `tax-lots.ts` in `capital-gains.ts`'s docstring).
`tax-lots.ts`, `xirr.ts`, `mf-scheme-map.ts`, and all 4 route files except `routes/sips.ts` showed
**zero diff at all** (their relative sibling imports happen to resolve identically in old and new tree
positions). `routes/sips.ts`'s diff shows exactly the documented import split (lifecycle vs.
installments) plus the `cache.ts` depth adjustment to `../../../services/cache.ts`.

## 14. `db:generate`

Content-hash manifest of `apps/api/drizzle/` (135 files) before/after `npm run db:generate -w
apps/api`: `diff` exit 0, identical. Command output ends with `No schema changes, nothing to migrate
😴`.

## 15. `backup.test.ts`

```
node --env-file-if-exists=../../.env --test src/services/backup.test.ts
ℹ tests 13  ℹ pass 13  ℹ fail 0
```

## Discrepancies found
None. Every check against TASK.md/DELEGATION.md's requirements passed: file structure, counts
(15/11/4/1), schema re-export (8 tables + 10 enums, no cycle), the exact 3-function sip-lifecycle
export requirement, all 7 cross-module import fixes, scheduler code untouched, app.ts registration
collapse, route-surface snapshot unchanged (with the untracked-file caveat noted above), route-table
snapshot regenerated with preserved leaf content, roadmap-text corrections, the new demo-403 test
(both 403 and no-mutation), the sips.test.ts split's exact name-level and section-level accounting,
"move not rewrite" diffs, zero-diff `db:generate`, and passing `backup.test.ts`.

## Unresolved risks / notes for the coordinator
- The `route-surface.snapshot.txt` empty-diff evidence is weaker than it appears because the file
  itself is untracked (`??`) in this working tree (created by the still-uncommitted task 1.1). The
  stronger, corroborating evidence is the passing "canonical route surface" runtime test, which was
  run directly.
- `npm run test` at the root has a real failure, but it is isolated to `apps/extractor` and
  pre-existing/environmental (missing `DATABASE_URL`), not caused by this migration.
- This working tree currently interleaves three uncommitted module migrations (ledger 1.1, credit 1.2,
  investments 1.3) — several of the diffs pasted (e.g. `jobs/index.ts`, `cashflow.ts`) contain
  import-line changes from more than one of those tasks; the report calls out which lines belong to
  this investments task specifically.
