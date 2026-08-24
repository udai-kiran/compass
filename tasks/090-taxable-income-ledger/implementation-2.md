# Implementation report — iteration 2 (review-3 blocker fixes), task 090

Resumed after a process restart. **All P1–P7 work was already on disk**; this
session made **zero file edits** and only re-verified disk state and ran gates.

## Disk-state re-verification (per item)

| Item | Verdict | Evidence |
|---|---|---|
| P1 schema columns | DONE | `apps/api/src/modules/tax/schema.ts:233` `section: text("section")`, `:242` `sourcePriority: integer("source_priority").notNull().default(0)` |
| P1 migration | DONE, clean | `apps/api/drizzle/0017_common_terror.sql` = exactly the two `ALTER TABLE ... ADD COLUMN` statements (1 line, breakpoint-separated); `meta/0017_snapshot.json` differs from `0016` only by `id`/`prevId` + those two columns (25 diff lines, all `section`/`source_priority`); `_journal.json` entry `idx:17, tag:0017_common_terror` |
| P2 `afterTdsPaise` | DONE | `packages/shared/src/schemas/tax.ts:284` `afterTdsPaise: z.number().int()`; computed at `services/income-events.ts:82` `afterTdsPaise: row.grossPaise - row.tdsPaise` |
| P3 summary `acceptedCount` + `notes[]` | DONE | shared `tax.ts:381` `acceptedCount`, `:389` `notes: z.array(z.string())`; service `getSummary` lines 310/327–333 (`GROSS_NOT_TAXABLE_NOTE` + pending-exclusion note) |
| P4 force `sourceKind='manual'` | DONE | `sourceKind` removed from `CreateIncomeEventBodySchema` (shared `tax.ts:305–331`); service forces `sourceKind: "manual", sourceId: null` (`income-events.ts:124–125`) |
| P5 real-date validation | DONE | route body uses `z.iso.date()`; service guards with `isRealIsoDate` → `HttpError(400)` (`income-events.ts:110–112`) |
| P6 null `grossPaise` | DONE, **400** per coordinator adjudication | `income-events.ts:373–375` `throw new HttpError(400, "Payslip has no gross amount — cannot derive income event")` |
| P7 test expansion | DONE | `services/income-events.test.ts` = 860 lines, 8 suites, **56 tests**, fully hermetic (fake db handles, no `DATABASE_URL`) |

### Constraint checks
- **EPF files untouched by me:** `epf-contributions.ts` mtime 18:36:18, `0016_mighty_blonde_phantom.sql` mtime 18:41:28 — both predate DELEGATION-2 (19:24:56).
- **Route snapshots byte-identical:** `route-surface.snapshot.txt` / `route-table.snapshot.txt` mtime 18:47:10 — untouched this iteration.
- **Observation (not mine, not fixed):** `apps/api/src/modules/tax/services/payslip-parse.ts` (19:38:16) and `payslip-parse.test.ts` were modified inside this iteration's window, alongside `tasks/091-epf-passbook/{TASK.md,followup-vpf.md,verification-1.md}`. This looks like the parallel task-091 VPF followup (the shared `CanonicalComponentKindSchema` now carries `vpf`). I did not touch or revert them. Flagging for the coordinator.

## Files changed by this session

**None.** No edits, no staging, no git mutations.

## Files inspected
- `/work/personal/compass/tasks/090-taxable-income-ledger/DELEGATION-2.md`
- `/work/personal/compass/tasks/090-taxable-income-ledger/review-3.md`
- `/work/personal/compass/apps/api/drizzle/0017_common_terror.sql`
- `/work/personal/compass/apps/api/drizzle/meta/_journal.json`, `meta/0016_snapshot.json`, `meta/0017_snapshot.json`
- `/work/personal/compass/apps/api/src/modules/tax/schema.ts`
- `/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts`
- `/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts`
- `/work/personal/compass/apps/api/src/modules/tax/routes/income-events.ts`
- `/work/personal/compass/packages/shared/src/schemas/tax.ts`, `packages/shared/src/date.ts` (`isRealIsoDate` pre-existing at `date.ts:159`, tested in `date.test.ts:311–336`)

## Uncommitted diff summary (cumulative for task 090, iterations 1+2)
```
 apps/api/drizzle/meta/_journal.json |  28 +++
 apps/api/src/modules/tax/schema.ts  | 306 ++++++++++++++++++++++-
 packages/shared/src/schemas/tax.ts  | 477 ++++++++++++++++++++++++++++++++++++
 3 files changed, 809 insertions(+), 2 deletions(-)
```
Untracked (new): `apps/api/drizzle/0017_common_terror.sql` (1 line),
`apps/api/drizzle/meta/0017_snapshot.json`,
`apps/api/src/modules/tax/services/income-events.ts` (504 lines),
`apps/api/src/modules/tax/services/income-events.test.ts` (860 lines),
`apps/api/src/modules/tax/routes/income-events.ts` (227 lines).

## Commands and literal output

### 1. `npm run typecheck` — exit 0
```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present


> @compass/api@0.1.0 typecheck
> tsc --noEmit


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

EXIT=0
```

### 2. `npm run lint` — exit 0
```
> compass@0.1.0 lint
> eslint .

EXIT=0
```

### 3. `node --test apps/api/src/modules/tax/services/income-events.test.ts` — exit 0
```
▶ lastDayOfMonth
  ✔ returns last day of June (0.470236ms)
  ✔ returns last day of January (0.084121ms)
  ✔ returns last day of February (non-leap year) (0.076707ms)
  ✔ returns last day of February (leap year) (0.065815ms)
  ✔ returns last day of March (0.074903ms)
  ✔ returns last day of April (0.071416ms)
  ✔ returns last day of December (0.072297ms)
✔ lastDayOfMonth (1.559502ms)
▶ buildIncomeEventDto
  ✔ converts a pending salary row to DTO (0.391085ms)
  ✔ computes afterTdsPaise as grossPaise - tdsPaise (0.112755ms)
  ✔ computes afterTdsPaise = grossPaise when there is no TDS (0.127794ms)
  ✔ computes afterTdsPaise = 0 when TDS equals gross (0.082617ms)
  ✔ converts an accepted row with acceptedAt to DTO (0.421533ms)
  ✔ converts a rejected row to DTO (0.066587ms)
  ✔ handles null sourceId for manual entry (0.062018ms)
  ✔ handles dividend income kind (0.060375ms)
  ✔ sets tdsPaise to 0 when default (0.061036ms)
  ✔ passes through PAN and TAN when set (0.06847ms)
✔ buildIncomeEventDto (1.696192ms)
▶ createIncomeEvent
  ✔ forces sourceKind='manual' and sourceId=null even if the client claims payslip provenance (0.392809ms)
  ✔ forces sourceKind='manual' even if the client claims ais provenance (0.107575ms)
  ✔ derives fy server-side from accrualDate and always inserts status='pending' (0.10508ms)
  ✔ derives fy across the 31 March / 1 April FY boundary (0.130478ms)
  ✔ rejects an impossible calendar date with 400 before any DB call (0.344616ms)
  ✔ rejects 29 February in a non-leap year with 400 (0.107405ms)
  ✔ rejects an out-of-range month with 400 (0.101584ms)
  ✔ accepts a valid leap day (2024-02-29) (0.116122ms)
  ✔ defaults tdsPaise to 0 when omitted (0.105531ms)
✔ createIncomeEvent (1.687124ms)
▶ acceptIncomeEvent
  ✔ 404s when the row does not exist or belongs to another user (0.324488ms)
  ✔ 409s when the event is already accepted (one-way transition) (0.119999ms)
  ✔ 409s when the event is already rejected (one-way transition) (0.124898ms)
  ✔ 409s when the guarded UPDATE claims nothing (concurrent accept/reject race loser) (0.203067ms)
  ✔ sets status='accepted' with acceptedAt and no originalValues when there are no corrections (0.173982ms)
  ✔ snapshots the pre-correction values into originalValues and applies the corrections (0.15721ms)
  ✔ treats an explicit null correction as a correction (snapshot taken) (0.159694ms)
✔ acceptIncomeEvent (1.412933ms)
▶ rejectIncomeEvent
  ✔ sets status='rejected' and never sets acceptedAt (0.18852ms)
  ✔ 409s when the row exists but is no longer pending (0.136781ms)
  ✔ 404s when the row does not exist or belongs to another user (0.129327ms)
✔ rejectIncomeEvent (0.531874ms)
▶ getSummary
  ✔ aggregates accepted rows only; pending rows count, rejected rows are ignored (0.243464ms)
  ✔ always returns all five income kinds, zeroed when empty (0.149265ms)
  ✔ sums multiple accepted rows of the same kind (0.090453ms)
  ✔ always states that salary amounts are gross, not taxable salary (0.135298ms)
  ✔ adds a pending-exclusion note when pending rows exist (0.090282ms)
  ✔ singularizes the pending-exclusion note for one pending row (0.085133ms)
✔ getSummary (0.914323ms)
▶ deriveFromPayslip
  ✔ 404s when the payslip is missing or owned by another user (0.203999ms)
  ✔ 400s when the payslip is not accepted (0.119948ms)
  ✔ 400s when the payslip has a null grossPaise (0.096874ms)
  ✔ maps an accepted payslip to a pending salary event with section='192' (0.132743ms)
  ✔ treats a null tdsCurrentPaise as zero TDS (0.111262ms)
  ✔ derives a March payslip into the FY that ends in that March (0.106373ms)
  ✔ is idempotent: on conflict it returns the existing row instead of a new one (0.129807ms)
  ✔ 500s when the insert conflicted but the existing row cannot be re-fetched (0.124066ms)
✔ deriveFromPayslip (1.17581ms)
▶ deriveFromHoldingEvent
  ✔ 404s when the holding event does not exist (0.192136ms)
  ✔ 404s when the holding belongs to another user (0.114158ms)
  ✔ 400s for a buy event (0.093578ms)
  ✔ 400s for a sell event (0.090943ms)
  ✔ maps a dividend event to a pending dividend income event (0.106422ms)
  ✔ is idempotent: on conflict it returns the existing row (0.11024ms)
✔ deriveFromHoldingEvent (0.814382ms)
ℹ tests 56
ℹ suites 8
ℹ pass 56
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 502.611872
EXIT=0
```

### 4. `node --test packages/shared` — **exit 1 (harness invocation error, not a code failure)**
The command as named fails because `node --test <dir>` in Node 24 treats the
argument as a module path, not a test-directory glob:
```
node:internal/modules/cjs/loader:1503
  throw err;
  ^

Error: Cannot find module '/work/personal/compass/packages/shared'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1500:15)
    at wrapResolveFilename (node:internal/modules/cjs/loader:1071:27)
    at defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1095:10)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1116:12)
    at Module._load (node:internal/modules/cjs/loader:1285:25)
    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19)
    at Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)
    at node:internal/main/run_main_module:33:47 {
  code: 'MODULE_NOT_FOUND',
  requireStack: []
}

Node.js v24.16.0
✖ packages/shared (19.853492ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 24.230242

✖ failing tests:

test at packages/shared:1:1
✖ packages/shared (19.853492ms)
  'test failed'
EXIT=1
```

### 4b. Substitute for the intent of (4): `npm run test -w packages/shared` — exit 0
(Repo-canonical form of the same gate. Tail of output.)
```
EXIT=0
✔ StatementReconciliationSchema accepts a negative (credit) ledgerDuePaise, never clamped (0.077468ms)
✔ StatementReconciliationSchema accepts both ledger fields null (no statement date/total due) (0.061417ms)
✔ StatementReconciliationSchema rejects a response missing ledgerDuePaise/dueDriftPaise (required, not optional) (0.128304ms)
✔ UpsertDepositDetailsSchema rejects totalInstallments above MAX_RD_INSTALLMENTS (0.429419ms)
ℹ tests 352
ℹ suites 0
ℹ pass 352
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 310.705421
```
Truncated: only the last 12 lines are shown; the preceding ~350 `✔` lines are
individual passing assertions with no failures among them (`fail 0`).

## Deviations
1. **Command 4 substitution.** `node --test packages/shared` cannot work as
   written in Node 24; I ran it verbatim, reported the failure, and then ran the
   repo-canonical `npm run test -w packages/shared` as clearly-labelled
   supplementary evidence. The brief's intended gate (352 shared schema tests,
   incl. deepEqual expectations) passes.
2. **No edits made.** Everything the brief asked for was already on disk from
   the interrupted run; redoing it would have risked churn. Verified item by
   item rather than re-applied.
3. **P6 uses 400, not 422** — per coordinator adjudication; review-3's 422 text
   is superseded.

## Assumptions
- The interrupted run's P1–P7 edits are the ones I inspected (no third party
  edited `income-events.*` or the shared income-event schema block).
- `section` / `sourcePriority` were required as *persisted columns* only; the
  brief's P2 asked only for `afterTdsPaise` on the DTO, so neither is exposed in
  `IncomeEventSchema`. `sourcePriority` is never written explicitly (DB default 0);
  `section='192'` is written only by `deriveFromPayslip`.

## Unresolved risks
- **DB integration coverage still absent.** All 56 tests are hermetic (fake db
  handles). The guarded `UPDATE ... WHERE status='pending' RETURNING`, the partial
  unique index, and the three CHECK constraints are therefore *asserted at the
  call-shape level only* — no test exercises real Postgres. Review-3's AC9 gap
  (`DATABASE_URL` unavailable locally) persists by design of the brief.
- **`section` for non-salary kinds.** Only `'192'` is ever set; 194A/194K/194-I
  are left null (interest/dividend/rent derivations do not populate it). If the
  reviewer reads AC1 as requiring per-kind sections, this is still open.
- **`payslip-parse.*` moved during this window** (see Observation above) — almost
  certainly the parallel 091 VPF followup, but it means the working tree for
  090 is not isolated from 091 at commit time.
- Migration `0017` has not been applied (`npm run db:migrate` not run; no DB).
