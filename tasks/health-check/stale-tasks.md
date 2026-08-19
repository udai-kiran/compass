# Stale Micro-Task Health Check — 2026-08-14

## Commands run

```
ls tasks/0[3-9]*.md tasks/micro-*.md 2>/dev/null
find tasks/ -name '*.md' | grep -E '(035|040|041|micro)'
find tasks/ -name '*.md' -exec grep -l 'status: in-progress|status: blocked|status: implementing|status: planning' {} \;
```

The `grep -l 'status: ...'` command returned **no output** — all task files use
freeform prose under `## Status` rather than a YAML `status:` key, so the grep
pattern never matched. The stale tasks were found via the `find | grep` above.

---

## Task 035 — investments-font

**Task file:** `tasks/035-investments-font/TASK.md`  
**Reported status:** IMPLEMENTING  
**Actual state: DONE — implementation already in place.**

`apps/web/src/lib/viz.tsx:393` reads:

```
<p className="mt-1 text-xl font-semibold text-slate-800">{value}</p>
```

The AC1 criterion (`text-xl` on the StatTile value `<p>`) is met. No other
StatTile layout was changed. The task file status is stale — it still says
IMPLEMENTING but the one-line change has already been applied.

**Action needed:** Mark task 035 COMPLETE; no code change required.

---

## Task 040 — opening-transaction-test-debt

**Task file:** `tasks/040-opening-transaction-test-debt/TASK.md`  
**Reported status:** BLOCKED — waiting on task 039  
**Actual state: UNBLOCKED — test debt still exists, ready to implement.**

Task 039 (`tasks/039-epf-opening-section-dedup/TASK.md`) is COMPLETE (commit
`5f98814b1893e57f98059c1ccdae6d83139aaf9c`, PR #192). The blocker is gone.

The test debt itself remains: `grep -n 'openingTxnPaise\|openingTransactionPaise\|is_opening'` in
`apps/api/src/modules/ledger/services/epf-contributions.test.ts` returned **no output**
(exit 1 — file matched no lines). The `openingTransactionPaise` aggregate
(implemented at `accounts.ts:198-224`) has zero test coverage.

The aggregate at `accounts.ts:198`:
```sql
coalesce(sum(amountPaise) filter (where ... is_opening ... and deletedAt is null ...), 0)
```
...sums every non-deleted opening posting. The `updateAccount` path (`accounts.ts:441-457`)
selects only the earliest (`limit 1`). Two active opening rows → UI shows their
sum, saving that sum updates only one row → non-idempotent growth. No DB
constraint prevents this; no test asserts the aggregate or guards the invariant.

Plan P1–P5 in the task file (including the decision on a partial unique index)
remains entirely unimplemented.

**Action needed:** Task 040 is ready to implement. Reopen and schedule it.

---

## Task 041 — epf-eps-double-edit

**Task file:** `tasks/041-epf-eps-double-edit/TASK.md`  
**Reported status:** PLANNING — filed so it is not lost. Not scheduled.  
**Actual state: UNBLOCKED — bug confirmed still present.**

Task 039 is COMPLETE, satisfying the stated dependency.

The double-edit bug is live in
`apps/web/src/routes/settings/AccountDetailPage.tsx`. For an EPF account:

- **Line 109–113:** `account.type === "epf"` → renders `EpfOpeningSection`  
- **Line 119:** `isRetirementAccount(account.type)` — confirmed true for `"epf"`
  (`packages/shared/src/schemas/ledger.ts:33`, verified by test at
  `packages/shared/src/schemas/wealth.test.ts:57`) → also renders `RetirementSection`

Both components write `epsBalancePaise` via `useRetirementDetailsMutation`:

- `EpfOpeningSection.submit()` (lines 511–517): sends `epsBalancePaise: epsPaise`
  plus echoes back `annualRateBps: retData?.annualRateBps ?? 0` and
  `referenceNumber: retData?.referenceNumber ?? ""` from its own cached query.
- `RetirementSection.submit()` (lines 983–993): sends
  `epsBalancePaise: isEpf ? (data?.epsBalancePaise ?? null) : null`
  plus echoes back the retirement-section's own cached EPS value.

Each component seeds from the same query but holds its own React state. Whichever
saves last wins; the other keeps stale text until its query re-fetches. The
lost-update risk described in the task (stale `annualRateBps`/`referenceNumber`
echoed back on an EPS-only save) is present at line 512–515 of `EpfOpeningSection`.

**Action needed:** Task 041 is ready to move from PLANNING to IMPLEMENTING.

---

## Other tasks with non-done/non-todo status

The pattern `find tasks/ -name '*.md' -exec grep -l 'status: in-progress|...'`
returned no results — the status field is prose, not YAML key-value. Manual
inspection of the `ls` output found no other task directories with TASK.md files
containing non-COMPLETE, non-TODO freeform status lines beyond the three above.

---

## Summary

| Task | File-stated status | Code state | Ready? |
|------|--------------------|------------|--------|
| 035 | IMPLEMENTING | Change already applied — `text-xl` at viz.tsx:393 | Mark COMPLETE |
| 040 | BLOCKED (on 039) | Blocker gone (039 COMPLETE); zero test coverage remains | Ready to implement |
| 041 | PLANNING | Blocker gone (039 COMPLETE); double-edit bug confirmed live | Ready to implement |
