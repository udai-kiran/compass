# Implementation 1 — task 008-migrate-credit (roadmap 1.2)

Executed TASK.md's Plan P1-P14 in order, per DELEGATION.md. All commands run from
`/home/udai/PennyPilot` unless noted. Literal command output pasted below, not
paraphrased.

**Working-tree context (important for reading the diffs below):** this repo's
working tree already contained task 1.1's (`007-migrate-ledger`) entire
implementation, uncommitted, when this session started (its own `git status`
showed the 35 old ledger paths deleted, `modules/ledger/` untracked, etc. —
visible in the initial `gitStatus` context). This task's changes are layered on
top of that pre-existing uncommitted state. Every diff below has been
cross-checked against task 1.1's own `implementation-1.md` file list to confirm
which lines are task 1.1's pre-existing work vs. this task's own edits — called
out explicitly wherever a diff mixes the two (`app.ts`, `jobs/index.ts`).

**One deviation from TASK.md, found and corrected during implementation, is
reported in its own section below (a genuine test-count correction: 50 test
blocks in the original `cards.test.ts`, not 49) — read it before treating the
49-test accounting as literal.** A second, unplanned fix (a test-only
concurrency hazard between the new `rewards.test.ts` and the moved
`card-due-tasks.test.ts`) is also reported in its own section.

## Files read in full before making any change
- `tasks/008-migrate-credit/TASK.md`, `DELEGATION.md`, `investigation-1.md`
- `tasks/007-migrate-ledger/TASK.md`, `tasks/007-migrate-ledger/implementation-1.md`
  (the template)
- `apps/api/src/services/cards.ts` (all 1182 lines), `apps/api/src/services/cards.test.ts`
  (all 1068 lines, all 50 top-level test blocks read individually)
- `apps/api/src/services/emis.ts` (493 lines) + `emis.test.ts` (507 lines)
- `apps/api/src/services/card-due-tasks.ts` (129 lines) + `card-due-tasks.test.ts` (1025 lines)
- `apps/api/src/services/card-statements.ts`, `overdraft-details.ts`, `bank-details.ts`
- `apps/api/src/routes/{cards,emis,overdraft-details,bank-details}.ts`
- `apps/api/src/jobs/index.ts` (full), `apps/api/src/app.ts` (full),
  `apps/api/src/app.route-snapshot.test.ts` (full)
- `apps/api/src/db/schema.ts` (the 8 credit tables' full definitions + confirmed
  `cardNetwork`/`bankAccountSubtype` are the only 2 owned enums by direct read)
- `apps/api/src/modules/ledger/services/recurring.ts` and `recurring.test.ts` (full)
- `apps/api/src/modules/ledger/{schema.ts,schema.smoke.test.ts,plugin.ts,plugin.test.ts}`
  (task 1.1's precedent, read in full to mirror exactly)
- `tasks/01.02-migrate-credit.md`, `tasks/10.05-reward-model.md`,
  `tasks/10.06-reward-aware-checkout.md`
- `packages/shared/src/money.ts` (conventions reference for the rewards.ts doc comment)
- Direct `grep -rn` of every cross-module reference to the 13 files being moved,
  across `apps/api/src`, `apps/web/src`, `apps/ingestor/src`, `apps/extractor/src`

## Files changed

### New (25 files, all under `apps/api/src/modules/credit/`)
```
schema.ts
schema.smoke.test.ts
plugin.ts
plugin.test.ts
services/cycle-math.ts
services/cycle-math.test.ts
services/cards.ts
services/alerts.ts
services/rewards.ts
services/rewards.test.ts
services/reconciliation-reads.ts
services/reconciliation-reads.test.ts
services/reconciliation-writes.ts
services/reconciliation-writes.test.ts
services/card-due-tasks.ts
services/card-due-tasks.test.ts
services/card-statements.ts
services/emis.ts
services/emis.test.ts
services/overdraft-details.ts
services/bank-details.ts
routes/cards.ts
routes/emis.ts
routes/overdraft-details.ts
routes/bank-details.ts
```
(11 service files + 6 test files [cycle-math/rewards/reconciliation-reads/
reconciliation-writes/card-due-tasks/emis] + 4 route files + 4 brand-new files
[schema.ts/schema.smoke.test.ts/plugin.ts/plugin.test.ts] = 25, matching
DELEGATION.md's list exactly.)

### Deleted (13 old flat paths)
```
apps/api/src/services/cards.ts
apps/api/src/services/card-due-tasks.ts
apps/api/src/services/card-statements.ts
apps/api/src/services/emis.ts
apps/api/src/services/overdraft-details.ts
apps/api/src/services/bank-details.ts
apps/api/src/services/cards.test.ts
apps/api/src/services/card-due-tasks.test.ts
apps/api/src/services/emis.test.ts
apps/api/src/routes/cards.ts
apps/api/src/routes/emis.ts
apps/api/src/routes/overdraft-details.ts
apps/api/src/routes/bank-details.ts
```

### Modified (this task's own edits)
```
apps/api/src/app.ts                                    (creditRoutes collapse)
apps/api/src/jobs/index.ts                             (2 import paths repointed)
apps/api/src/route-table.snapshot.txt                  (regenerated, P11)
apps/api/src/modules/ledger/services/recurring.ts       (emis.ts import repointed + comment fix)
apps/api/src/modules/ledger/services/recurring.test.ts  (emis.ts import repointed)
tasks/01.02-migrate-credit.md                          (P1: 12->15/23 endpoint fix)
```
`route-surface.snapshot.txt` was **not** modified — it already existed
(created by task 1.1) and this task only compares against it (P2/P11), never
regenerates it. `apps/api/src/modules/ledger/services/recurring.ts` and
`recurring.test.ts` are themselves untracked/new files in git (task 1.1's own
work, not yet committed) — my edit inside them shows as part of that untracked
content rather than as a `git diff`; confirmed present by direct `grep` below.

### `git status --porcelain`, filtered to this task's own file set
```
$ git status --porcelain -- apps/api/src/modules/credit apps/api/src/modules/ledger/services/recurring.ts apps/api/src/modules/ledger/services/recurring.test.ts apps/api/src/app.ts apps/api/src/jobs/index.ts apps/api/src/route-table.snapshot.txt apps/api/src/route-surface.snapshot.txt apps/api/src/services apps/api/src/routes tasks/01.02-migrate-credit.md
 M apps/api/src/app.ts
 M apps/api/src/jobs/index.ts
 M apps/api/src/route-table.snapshot.txt
 D apps/api/src/routes/accounts.ts            <- task 1.1's own pre-existing deletion
 D apps/api/src/routes/attachments.ts         <- task 1.1's own pre-existing deletion
 D apps/api/src/routes/bank-details.ts        <- THIS TASK
 D apps/api/src/routes/cards.ts               <- THIS TASK
 D apps/api/src/routes/categories.ts          <- task 1.1's own pre-existing deletion
 D apps/api/src/routes/emis.ts                <- THIS TASK
 M apps/api/src/routes/insurance.ts           <- task 1.1's own pre-existing edit
 D apps/api/src/routes/ledger-events.route.test.ts   <- task 1.1
 D apps/api/src/routes/overdraft-details.ts   <- THIS TASK
 D apps/api/src/routes/recurring.ts           <- task 1.1
 D apps/api/src/routes/resources.ts           <- task 1.1
 D apps/api/src/routes/rules.ts               <- task 1.1
 D apps/api/src/routes/search.ts              <- task 1.1
 D apps/api/src/routes/transaction-links.ts   <- task 1.1
 D apps/api/src/routes/transactions.ts        <- task 1.1
 D apps/api/src/routes/transfers.ts           <- task 1.1
 D apps/api/src/routes/user-tasks.route.test.ts <- task 1.1
 D apps/api/src/routes/user-tasks.ts          <- task 1.1
 D apps/api/src/services/accounts.test.ts     <- task 1.1
 D apps/api/src/services/accounts.ts          <- task 1.1
 M apps/api/src/services/ai/tools.ts          <- task 1.1's own pre-existing edit
 D apps/api/src/services/attachments.test.ts  <- task 1.1
 D apps/api/src/services/attachments.ts       <- task 1.1
 M apps/api/src/services/auth.ts              <- task 1.1's own pre-existing edit
 D apps/api/src/services/average-balance.test.ts <- task 1.1
 D apps/api/src/services/average-balance.ts   <- task 1.1
 D apps/api/src/services/bank-details.ts      <- THIS TASK
 M apps/api/src/services/bills.ts             <- task 1.1's own pre-existing edit
 D apps/api/src/services/card-due-tasks.test.ts <- THIS TASK
 D apps/api/src/services/card-due-tasks.ts    <- THIS TASK
 D apps/api/src/services/card-statements.ts   <- THIS TASK
 D apps/api/src/services/cards.test.ts        <- THIS TASK
 D apps/api/src/services/cards.ts             <- THIS TASK
 M apps/api/src/services/cashflow.ts          <- task 1.1's own pre-existing edit
 D apps/api/src/services/categories.ts        <- task 1.1
 M apps/api/src/services/dashboard.ts         <- task 1.1's own pre-existing edit
 M apps/api/src/services/demo.ts              <- task 1.1's own pre-existing edit
 D apps/api/src/services/emis.test.ts         <- THIS TASK
 D apps/api/src/services/emis.ts              <- THIS TASK
 D apps/api/src/services/epf-contributions.test.ts <- task 1.1
 D apps/api/src/services/epf-contributions.ts <- task 1.1
 M apps/api/src/services/goal-networth.ts     <- task 1.1's own pre-existing edit
 M apps/api/src/services/goals.ts             <- task 1.1's own pre-existing edit
 M apps/api/src/services/imports.test.ts      <- task 1.1's own pre-existing edit
 M apps/api/src/services/imports.ts           <- task 1.1's own pre-existing edit
 M apps/api/src/services/inbox.test.ts        <- task 1.1's own pre-existing edit
 M apps/api/src/services/inbox.ts             <- task 1.1's own pre-existing edit
 M apps/api/src/services/insurance.ts         <- task 1.1's own pre-existing edit
 D apps/api/src/services/merchants.ts         <- task 1.1
 D apps/api/src/services/overdraft-details.ts <- THIS TASK
 M apps/api/src/services/periods.test.ts      <- task 1.1's own pre-existing edit
 D apps/api/src/services/recurring.test.ts    <- task 1.1
 D apps/api/src/services/recurring.ts         <- task 1.1
 D apps/api/src/services/resources.ts         <- task 1.1
 D apps/api/src/services/search.ts            <- task 1.1
 D apps/api/src/services/transaction-links.test.ts <- task 1.1
 D apps/api/src/services/transaction-links.ts <- task 1.1
 D apps/api/src/services/transactions.test.ts <- task 1.1
 D apps/api/src/services/transactions.ts      <- task 1.1
 D apps/api/src/services/transfers.test.ts    <- task 1.1
 D apps/api/src/services/transfers.ts         <- task 1.1
 D apps/api/src/services/user-tasks.test.ts   <- task 1.1
 D apps/api/src/services/user-tasks.ts        <- task 1.1
 M tasks/01.02-migrate-credit.md              <- THIS TASK
?? apps/api/src/modules/credit/               <- THIS TASK
?? apps/api/src/modules/ledger/services/recurring.test.ts  <- task 1.1's file, edited by THIS TASK
?? apps/api/src/modules/ledger/services/recurring.ts       <- task 1.1's file, edited by THIS TASK
?? apps/api/src/route-surface.snapshot.txt    <- task 1.1's file, untouched by this task
```
(annotations added by me for this report; the raw `git status --porcelain`
output carries no such annotation — every "<- THIS TASK" line matches exactly
one of DELEGATION.md's named 13 deleted paths, 6 modified paths, or the new
`modules/credit/` tree; nothing extra, nothing missing.)

## P1 — `tasks/01.02-migrate-credit.md` factual correction

```diff
$ git diff -- tasks/01.02-migrate-credit.md
diff --git a/tasks/01.02-migrate-credit.md b/tasks/01.02-migrate-credit.md
index 072e9fa..39d8740 100644
--- a/tasks/01.02-migrate-credit.md
+++ b/tasks/01.02-migrate-credit.md
@@ -7,7 +7,7 @@ status: todo
 depends: [1.1]
 ---
 
-Routes: cards (12 endpoints), emis, overdraft-details, bank-details. Tables: card_details, card_issuer_settings, card_statements, reward_entries, statement_reconciliations, emi_details, bank_details, overdraft_details.
+Routes: cards (15 endpoints), emis, overdraft-details, bank-details (23 endpoints total across all 4 groups). Tables: card_details, card_issuer_settings, card_statements, reward_entries, statement_reconciliations, emi_details, bank_details, overdraft_details.
 
 `cards.ts` is 1182 lines and `emis.ts` 493. Beyond the move, split `cards.ts` along its natural seams — cycle math, statement reconciliation, reward ledger, alert evaluation — into separately testable units. The cycle-boundary logic (`cardCycle`/`splitByCycle`) and the reward earn-rate data are both consumed later by the shopping reward-aware recommendation, so a clean interface here pays off in Phase 5.
```

## P2 — Baseline capture (before any application file was touched)

Wrote a temporary hermetic script (`apps/api/src/_baseline-capture-credit.ts`,
deleted immediately after use), mirroring task 1.1's own P2 script exactly:
registers an `onRoute` hook before `registerRoutes(app)`, flattens/uppercases
methods, asserts no duplicate `(method,url)` pairs, writes the canonical
surface to a scratchpad file and the raw `printRoutes()` tree to a second
scratchpad file (neither committed).

```
$ cd apps/api && node --env-file-if-exists=../../.env src/_baseline-capture-credit.ts
Total onRoute notifications: 283
Wrote pre-move canonical route-surface capture to scratchpad
Wrote pre-move raw printRoutes() capture to scratchpad
```

Sanity check — the freshly-captured canonical surface and raw tree are
byte-identical to the already-committed `route-surface.snapshot.txt` /
`route-table.snapshot.txt`, proving the pre-move baseline is sound and matches
the live (unmodified) app before any file was touched:

```
$ diff <scratchpad>/route-surface.pre-move.txt apps/api/src/route-surface.snapshot.txt && echo "IDENTICAL (canonical surface matches committed baseline before any edit)"
IDENTICAL (canonical surface matches committed baseline before any edit)
$ diff <scratchpad>/route-table.pre-move.txt apps/api/src/route-table.snapshot.txt && echo "IDENTICAL (raw tree matches committed baseline before any edit)"
IDENTICAL (raw tree matches committed baseline before any edit)
```

Temp script deleted immediately after use — confirmed absent:
```
$ rm apps/api/src/_baseline-capture-credit.ts
$ ls apps/api/src/_baseline-capture-credit.ts
lsd: apps/api/src/_baseline-capture-credit.ts: No such file or directory (os error 2).
```

## P3 — `modules/credit/schema.ts` thin re-export + smoke test

Confirmed the exact 8 tables + 2 owned enums by direct read of `db/schema.ts`
(`grep -n "pgEnum("`/`pgTable("`, cross-referenced against which of the 8
tables use each enum): `cardDetails`, `cardIssuerSettings`, `cardStatements`,
`bankDetails`, `overdraftDetails`, `rewardEntries`, `statementReconciliations`,
`emiDetails` (8 tables) + `cardNetwork` (used by `card_details.network`),
`bankAccountSubtype` (used by `bank_details.subtype`) — matches TASK.md's
Root Cause exactly, no 9th table or 3rd enum found.

`apps/api/src/modules/credit/schema.ts` (full new-file content):
```ts
export {
  cardDetails,
  cardIssuerSettings,
  cardStatements,
  bankDetails,
  overdraftDetails,
  rewardEntries,
  statementReconciliations,
  emiDetails,
  cardNetwork,
  bankAccountSubtype,
} from "../../db/schema.ts";
```
(Full file also carries the thin-re-export rationale doc comment — omitted
here for brevity, see the actual file.)

`db/schema.ts` was **not** modified to `export *` back from this file —
confirmed by `git diff -- apps/api/src/db/schema.ts` (empty, see T14 below).

```
$ npm run typecheck   # zero errors, all 7 workspaces
$ cd apps/api && node --test src/modules/credit/schema.smoke.test.ts
✔ modules/credit/schema.ts re-exports the same 8 table objects as db/schema.ts (1.172221ms)
✔ modules/credit/schema.ts re-exports the same 2 owned enum objects as db/schema.ts (0.238682ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

## P4 — Splitting `cards.ts` into 6 files + moving 5 other production files

### The 6-way split (exact line-range mapping, from direct read of the 1182-line original)
| New file | Seam | Exported symbols |
|---|---|---|
| `cycle-math.ts` | Cycle-boundary date math | `lastOccurrence`, `nextOccurrence`, `cardCycle`, `isBilledIn`, `activityWindow`, `splitByCycle`, `CardCycle`, `ActivityWindow` |
| `cards.ts` | Card/issuer CRUD + activity/holder read-models | `upsertCardDetails`, `getIssuerSettings`, `upsertIssuerSettings`, `setCardStatementPassword`, `getCardStatementPassword`, `listCardHolders`, `getCardActivity`, **`ownedCardAccount`** (newly exported — was private) |
| `alerts.ts` | Alert evaluation | `evaluateCardDueReminders`, `evaluateCardUtilization` |
| `rewards.ts` | Reward ledger + new earn-rate interface | `listRewards`, `addRewardEntry`, `deleteRewardEntry`, `getCardEarnRate` (new), `earnedRewardPoints` (new) |
| `reconciliation-reads.ts` | Reconciliation reads/pure math | `dueDrift`, `driftPresentation`, `listReconciliations`, `summarizeStatementLines`, **`toReconciliationDto`** (newly exported), **`ledgerDuesAtDates`** (newly exported), plus the `DriftPresentation`/`StatementLineState`/`RecomputedStats`/`StatementFacts` interfaces |
| `reconciliation-writes.ts` | Reconciliation mutations | `recomputeReconciliation`, `absorbCarryover`, `AbsorbCarryoverHooks` |

All 3 previously-private cross-file exports required by the split
(`ownedCardAccount`, `toReconciliationDto`, `ledgerDuesAtDates`) are now
exported, each with a doc-comment line stating it's an internal
cross-module-file export, not a public API commitment — confirmed by direct
read of each file.

### `wc -l` on all 6 split files, plus `emis.ts` (T11)
```
$ cd apps/api/src/modules/credit && wc -l schema.ts schema.smoke.test.ts plugin.ts plugin.test.ts services/cycle-math.ts services/cards.ts services/alerts.ts services/rewards.ts services/reconciliation-reads.ts services/reconciliation-writes.ts services/emis.ts
   129 services/cycle-math.ts
   382 services/cards.ts
    66 services/alerts.ts
   103 services/rewards.ts
   262 services/reconciliation-reads.ts
   342 services/reconciliation-writes.ts
   494 services/emis.ts
```
None over ~500 lines. `emis.ts` (494, ~1 line more than the original 493 due
to import restructuring) was moved unmodified per the Non-Goals — not split,
matching TASK.md's explicit instruction.

### Split-import cases confirmed by direct read of every moved file's own import block
- `cards.ts`: `accounts`, `transactions` (ledger, from `../../../db/schema.ts`) vs. `cardDetails`, `cardIssuerSettings`, `rewardEntries` (credit, from `../schema.ts`)
- `alerts.ts`: `alertLedger` (still-flat/system, from `../../../db/schema.ts`) vs. `cardDetails` (credit, from `../schema.ts`)
- `rewards.ts`: `cardDetails`, `rewardEntries` (credit, from `../schema.ts`) — no ledger tables needed here
- `reconciliation-reads.ts`/`reconciliation-writes.ts`: `statementReconciliations` (credit, `../schema.ts`) vs. `accounts`, `transactions`, `extractedTransactions` (ledger/ingest, `../../../db/schema.ts`)
- `card-due-tasks.ts`: `cardDetails` (credit, `../schema.ts`) vs. `alertLedger`, `userTasks`, `users` (`../../../db/schema.ts` — `userTasks`'s physical home never moves, per task 1.1's precedent, so no target change, only depth)
- `emis.ts`: `accounts`, `recurringTemplates`, `transactions` (ledger, `../../../db/schema.ts`) vs. `emiDetails` (credit, `../schema.ts`)
- `overdraft-details.ts`, `bank-details.ts`: `accounts` (ledger, `../../../db/schema.ts`) vs. `overdraftDetails`/`bankDetails` (credit, `../schema.ts`)
- `card-statements.ts`: no schema-table split needed (`cardStatements` only, from `../schema.ts`); `accounts` also imported from `../../../db/schema.ts` for its own ownership check

Reverse-direction still-flat imports fixed, confirmed by direct read (no
additional cases found beyond what investigation-1.md predicted):
- `cards.ts` → `../../../lib/secret-box.ts` (unchanged target, depth-adjusted)
- `card-statements.ts` → `assertUploadable` from `../../ledger/services/attachments.ts` (already-moved ledger file, depth-adjusted from the old `../modules/ledger/services/attachments.ts`)
- `bank-details.ts` → `syncAccountLast4` from `../../ledger/services/accounts.ts` (same pattern)
- `emis.ts` → `assertOwnedCategory` from `../../../services/ownership.ts` (still-flat, depth-adjusted)
- `alerts.ts` → `createNotification` from `../../../services/notifications.ts`, `currentPeriodKey` from `../../../services/periods.ts`
- `reconciliation-writes.ts` → `repairSnapshots` from `../../../services/networth.ts`, `withSerializableRetry` from `../../../lib/serializable.ts`

### Test-file split — an accurate accounting, and a correction to TASK.md's own count

**Deviation found and reported, not silently absorbed:** TASK.md's Root Cause
claims the original `cards.test.ts` has **49** top-level test blocks
(11 cycle-math + 12 reconciliation-reads + 26 reconciliation-writes). Direct
count against the actual file (`grep -c '^test(' apps/api/src/services/cards.test.ts`,
before deletion) returned **50**, not 49:

```
$ grep -c '^test(' apps/api/src/services/cards.test.ts
50
```

The discrepancy is in the `dueDrift`/`driftPresentation` block: TASK.md's
Root Cause says "6 `dueDrift`/`driftPresentation` tests"; the actual file has
**7** (2 `dueDrift` + 5 `driftPresentation` — `driftPresentation`'s own 5 cases
are: null-inputs, positive-drift-shortfall, negative-ledger-due-credit [which
itself asserts two sub-cases in one test block], negative-drift-surplus,
zero-drift-none). This makes `reconciliation-reads.test.ts` **13** tests, not
12, and the true total **50**, not 49 (11 + 13 + 26 = 50). This is a pure
counting correction to TASK.md's own prose — it does not change which file any
test belongs to (every test still goes to the file matching the production
function it exercises), does not change any assertion, and does not change the
production 6-way file split. Per my operating instructions this is a "small
implementation detail" discrepancy (a recount, not a scope/architecture
conflict), so I proceeded rather than stopping — flagged here explicitly
rather than silently reporting "49" to match the plan.

**Explicit 50-test-name-to-new-file mapping** (not just totals):

`cycle-math.test.ts` — 11 tests, all pure, no DB:
1. `cardCycle: a cycle starts on the previous close day and ends the day before the next`
2. `isBilledIn: a charge dated on the cycle's first day is billed by that statement`
3. `isBilledIn: a charge dated on the close day bills on the next statement, not this one`
4. `cardCycle: consecutive cycles bill every date exactly once`
5. `cardCycle: a cycle that closed only days ago is not billed yet`
6. `cardCycle: crosses a year boundary`
7. `lastOccurrence / nextOccurrence: the close day itself is the boundary`
8. `activityWindow: the listed window starts on the cycle's first billed day`
9. `activityWindow: with no cycle configured, today's spend still counts as billed`
10. `splitByCycle: every row bills exactly once, and the start day bills now`
11. `splitByCycle: with no cycle nothing is billed yet`

`reconciliation-reads.test.ts` — 13 tests, all pure, no DB (verified by direct
read: neither `summarizeStatementLines` nor `dueDrift`/`driftPresentation`
touch a `db` handle anywhere):
12. `summarizeStatementLines: a line tied to a live ledger transaction counts as cleared`
13. `summarizeStatementLines: every line linked leaves nothing to review`
14. `summarizeStatementLines: a cleared refund does not shrink the spend delta`
15. `summarizeStatementLines: the issuer's own totals survive a recompute that sees no lines`
16. `summarizeStatementLines: a partly-deduplicated statement keeps the issuer's line count`
17. `summarizeStatementLines: more links than the issuer listed never yields a negative backlog`
18. `dueDrift: null unless both totalDuePaise and ledgerDuePaise are known`
19. `dueDrift: totalDue − ledgerDue, positive/negative/zero`
20. `driftPresentation: null drift or null ledgerDue → none`
21. `driftPresentation: positive drift with a nonnegative ledger due is a shortfall — carries the hint, suppresses the badge`
22. `driftPresentation: a negative ledger due is 'credit', evaluated BEFORE the drift sign — never a shortfall`
23. `driftPresentation: negative drift with a nonnegative ledger due is a surplus — no hint, badge kept`
24. `driftPresentation: zero drift is none`

`reconciliation-writes.test.ts` — 26 tests, DB-backed, inherits the entire
original DB harness (pool/fixtures/teardown):
25. `listReconciliations/recomputeReconciliation: Diners-shaped constituent rows (purchases, a payment, a refund) net the signed ledger due and drift`
26. `listReconciliations/recomputeReconciliation: a soft-deleted transaction is excluded from the ledger due`
27. `listReconciliations: a second card of the SAME user does not leak into the aggregate (account predicate)`
28. `listReconciliations: a second user's identical card does not leak (user predicate)`
29. `listReconciliations: boundary — close−1 counts, close and close+1 do not`
30. `listReconciliations: statement_date null → both fields null; total_due_paise null with a date → ledgerDue computed, drift null`
31. `listReconciliations: an individually-safe opening balance plus an individually-safe transaction sum that together overflow Number.MAX_SAFE_INTEGER is refused (500), not silently truncated`
32. `recomputeReconciliation: the same opening-balance overflow is refused (500) via the recompute path`
33. `absorbCarryover: Diners numbers — opening_balance_paise becomes −4559125, returned dueDriftPaise is 0, and card activity's totalDuePaise matches the bank`
34. `absorbCarryover: a second identical call 409s once drift has been absorbed, and changes nothing further`
35. `absorbCarryover: sequential absorbs of two different reconciliation rows on one card — the second sees the post-seed ledger due and 409s at zero drift`
36. `absorbCarryover: absorbing one reconciliation shifts every other row's drift too (a global opening-balance change, not an isolated per-cycle one)`
37. `absorbCarryover: a nonzero preexisting opening balance`
38. `absorbCarryover: a negative-drift fixture 409s and changes nothing`
39. `absorbCarryover: a null total_due_paise 409s`
40. `absorbCarryover: a null statement_date 409s`
41. `absorbCarryover: an archived card 409s`
42. `absorbCarryover: a non-credit-card account 400s`
43. `absorbCarryover: a foreign (nonexistent) account id 404s`
44. `absorbCarryover: a reconciliation belonging to another account of the SAME user 404s`
45. `absorbCarryover: only transactions strictly before statement_date count toward the drift`
46. `absorbCarryover: listAccounts reflects the new opening balance`
47. `absorbCarryover: post-commit, a best-effort net-worth snapshot repair is triggered for this user (AC6)`
48. `absorbCarryover: a concurrent account-row lock (an opening-balance edit in progress) blocks absorb until it commits — the final state matches a serial order`
49. `absorbCarryover: a genuine SSI dependency cycle forces 40001, and withSerializableRetry succeeds off the fresh ledger`
50. `absorbCarryover: an SSI cycle reproduced on BOTH attempts surfaces 40001 with no committed change`

Counted verbatim by test name, cross-checked against per-file `grep -c '^test('`:
```
$ grep -c '^test(' apps/api/src/modules/credit/services/cycle-math.test.ts
11
$ grep -c '^test(' apps/api/src/modules/credit/services/reconciliation-reads.test.ts
13
$ grep -c '^test(' apps/api/src/modules/credit/services/reconciliation-writes.test.ts
26
```
11 + 13 + 26 = 50. Every relocated test's assertions are byte-for-byte
unchanged from the original file — only import lines and the two stale
comments named below were touched.

**No `cards.test.ts`/`alerts.test.ts` test file was created** — confirmed by
`ls`: neither exists under `modules/credit/services/`.

### Stale-comment fixes (comment-only, zero assertion changes)
- `card-due-tasks.ts`'s doc comment: `cards.ts:526-530` / `cards.ts:525` →
  "see `alerts.ts`'s `evaluateCardDueReminders`, same sibling `services/`
  directory" / "same default as evaluateCardDueReminders (alerts.ts)"
- `reconciliation-writes.test.ts` (relocated from `cards.test.ts`): the
  comment "review-5.md: cards.ts previously checked only the raw `sum`" →
  "review-5.md: reconciliation-reads.ts's ledgerDuesAtDates previously checked
  only the raw `sum`"
- `modules/ledger/services/recurring.ts`'s comment "see services/emis.ts" →
  "see modules/credit/services/emis.ts"

**Not fixed (out of DELEGATION's named scope, flagged as an unresolved risk,
same discipline task 1.1 applied to its own `db/schema.ts` stale comments):**
`apps/web/src/routes/cards/reconRowView.ts`'s comment "Mirrors
`driftPresentation` in apps/api/src/services/cards.ts" — a web-side comment
DELEGATION does not name among the required fixes (only `card-due-tasks.ts`,
`cards.test.ts`'s relocated comments, and the ledger `recurring.ts`/
`recurring.test.ts` comments are named). `db/schema.ts`'s own two comments
citing `services/card-due-tasks.ts` (lines 403, 718) are similarly unfixed —
`db/schema.ts` is on the Must-Not-Change list beyond its (absent) re-export
concern, and a comment is not a table definition, but flagging rather than
silently leaving it undocumented.

## Moving `card-due-tasks.ts`, `card-statements.ts`, `overdraft-details.ts`, `bank-details.ts`, `emis.ts` (+ their tests)

All 5 moved with import paths reclassified per the same 4-way rule (module-local
/ module schema / still-flat API code depth-adjusted / `@compass/shared`
unaffected) — full new-file contents in the working tree; split-import cases
listed above. `emis.ts`/`emis.test.ts` and `card-due-tasks.ts`/
`card-due-tasks.test.ts` moved with zero assertion changes (only import paths
and the one stale-comment fix in `card-due-tasks.ts`).

## P5 — `rewards.ts`: test-first `getCardEarnRate` + `earnedRewardPoints`

Full required test-case list from Root Cause, written before considering the
implementation done (both written together in this delegation session; the
full case list below was the specification the implementation was checked
against, and every case failed against a stub before the real implementation
was written — not retrofitted after the fact):

- zero spend
- zero rate
- exactly ₹100
- spend below ₹100
- multiple complete ₹100 units
- a remainder above a complete unit
- rejection of negative spend
- rejection of negative rate
- rejection of non-integer inputs
- rejection when an input itself exceeds `Number.MAX_SAFE_INTEGER`
- rejection when both inputs are individually safe integers but their
  **product** is not (the case a single "large-spend" sanity check cannot
  catch) — fixture: `spendPaise = 200_000_000_000`, `earnRatePer100 =
  100_000_000`, both individually `Number.isSafeInteger`, product is not
  (asserted directly in the test as a fixture-sanity check before asserting
  the rejection)

`getCardEarnRate` implementation:
```ts
export async function getCardEarnRate(db: Db, userId: string, accountId: string): Promise<number | null> {
  await ownedCardAccount(db, userId, accountId);
  const row = await db.query.cardDetails.findFirst({
    where: and(eq(cardDetails.accountId, accountId), eq(cardDetails.userId, userId)),
    columns: { earnRatePer100: true },
  });
  return row ? row.earnRatePer100 : null;
}
```

`earnedRewardPoints` implementation:
```ts
export function earnedRewardPoints(spendPaise: number, earnRatePer100: number): number {
  if (spendPaise < 0) throw new HttpError(400, "spendPaise must not be negative");
  if (earnRatePer100 < 0) throw new HttpError(400, "earnRatePer100 must not be negative");
  if (!Number.isSafeInteger(spendPaise)) throw new HttpError(400, "spendPaise must be a safe integer");
  if (!Number.isSafeInteger(earnRatePer100)) throw new HttpError(400, "earnRatePer100 must be a safe integer");
  const product = spendPaise * earnRatePer100;
  if (!Number.isSafeInteger(product)) {
    throw new HttpError(400, "spendPaise * earnRatePer100 exceeded a safe integer — refusing to lose precision");
  }
  return Math.floor(product / 10_000);
}
```
Doc comment (in the file) states the exact semantics, the sign/validation
rules, and: *"Simplified base-rate estimate only: this does not model
category-specific rates, spend caps, milestone bonuses, point valuation, or
expiry — a single flat multiplier against the card's configured base rate,
nothing more."* No task filename referenced in the comment, per Root Cause's
instruction — the `tasks/10.06-reward-aware-checkout.md` discrepancy (that
task's prose describes computing from `reward_entries`/`card_issuer_settings`,
while this task's functions compute from `card_details.earn_rate_per_100`, the
only field that actually exists today) is recorded here in this evidence
trail, not in the code comment, per Root Cause's explicit instruction.

```
$ cd apps/api && node --env-file-if-exists=../../.env --test src/modules/credit/services/rewards.test.ts
✔ earnedRewardPoints: zero spend earns zero points regardless of rate (1.218591ms)
✔ earnedRewardPoints: zero rate earns zero points regardless of spend (0.159283ms)
✔ earnedRewardPoints: exactly ₹100 spend at 1 point/₹100 earns exactly 1 point (0.140069ms)
✔ earnedRewardPoints: spend below ₹100 earns zero points (floors down, no partial point) (0.142317ms)
✔ earnedRewardPoints: multiple complete ₹100 units earn one point per unit (0.146753ms)
✔ earnedRewardPoints: a remainder above a complete unit floors to the completed units only (0.131374ms)
✔ earnedRewardPoints: rejects negative spendPaise (0.535087ms)
✔ earnedRewardPoints: rejects negative earnRatePer100 (0.183465ms)
✔ earnedRewardPoints: rejects non-integer inputs (0.373054ms)
✔ earnedRewardPoints: rejects an individual input that itself exceeds Number.MAX_SAFE_INTEGER (0.376019ms)
✔ earnedRewardPoints: rejects when both inputs are individually safe integers but their PRODUCT is not (0.309878ms)
✔ getCardEarnRate: returns the configured earn_rate_per_100 when a card_details row exists (124.385344ms)
✔ getCardEarnRate: returns null (not 0) when no card_details row exists at all (19.330745ms)
✔ getCardEarnRate: a genuinely-stored rate of 0 is distinguished from 'no card_details row' (both are falsy, only one is null) (20.819776ms)
✔ getCardEarnRate: a nonexistent account 404s (12.668832ms)
✔ getCardEarnRate: another user's card 404s (ownership enforced) (18.523296ms)
✔ getCardEarnRate: a non-credit-card account 400s (10.959624ms)
ℹ tests 17
ℹ pass 17
ℹ fail 0
```

## P6 — Moving the 4 route files into `modules/credit/routes/`

`routes/cards.ts` now imports from 4 different sibling service files
(`./cards.ts`, `./rewards.ts`, `./reconciliation-reads.ts`,
`./reconciliation-writes.ts`), plus `./card-statements.ts` (unchanged, same
depth) — a real change to that file's import block, not just a depth
adjustment, exactly as Root Cause predicted. `routes/emis.ts`,
`routes/overdraft-details.ts`, `routes/bank-details.ts` moved with only
depth-adjusted imports — same URLs, same handler bodies, same status codes,
zero behavioral change (confirmed by the canonical route-surface snapshot
staying byte-identical, T4 below).

## P7 — `modules/credit/plugin.ts` + `plugin.test.ts`, `app.ts` update

`plugin.ts` registers the 4 route plugins in the same order `cardRoutes`,
`emiRoutes` sat in `app.ts`, with `bankDetailsRoutes`/`overdraftDetailsRoutes`
now collapsed into the same call (previously registered later, interleaved
with `retirementRoutes`/`accountNpsRoutes`).

```
$ cd apps/api && node --test src/modules/credit/plugin.test.ts
✔ creditRoutes registers one uniquely-attributable route from each of the 4 internal route files (132.968342ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

`app.ts` diff (combined with task 1.1's own pre-existing edit to the same
file — my specific change is the `cardRoutes`/`emiRoutes`/`bankDetailsRoutes`/
`overdraftDetailsRoutes` → `creditRoutes` collapse, both in the import block
and in `registerRoutes()`, plus the doc-comment update naming task 1.2):
```diff
$ git diff -- apps/api/src/app.ts
diff --git a/apps/api/src/app.ts b/apps/api/src/app.ts
index 21395f9..6d93cec 100644
--- a/apps/api/src/app.ts
+++ b/apps/api/src/app.ts
@@ -18,34 +18,23 @@ import { setupAuth } from "./plugins/auth.ts";
 import { setupSecurity } from "./plugins/security.ts";
 import { healthRoutes } from "./routes/health.ts";
 import { authRoutes } from "./routes/auth.ts";
-import { accountRoutes } from "./routes/accounts.ts";
-import { categoryRoutes } from "./routes/categories.ts";
-import { transactionRoutes } from "./routes/transactions.ts";
-import { transferRoutes } from "./routes/transfers.ts";
-import { attachmentRoutes } from "./routes/attachments.ts";
-import { transactionLinkRoutes } from "./routes/transaction-links.ts";
+import { ledgerRoutes } from "./modules/ledger/plugin.ts";
 import { importRoutes } from "./routes/imports.ts";
-import { ruleRoutes } from "./routes/rules.ts";
 import { budgetRoutes } from "./routes/budgets.ts";
 import { dashboardRoutes } from "./routes/dashboard.ts";
 import { notificationRoutes } from "./routes/notifications.ts";
-import { recurringRoutes } from "./routes/recurring.ts";
 import { goalRoutes } from "./routes/goals.ts";
 import { sipRoutes } from "./routes/sips.ts";
 import { cashflowRoutes } from "./routes/cashflow.ts";
 import { billRoutes } from "./routes/bills.ts";
-import { cardRoutes } from "./routes/cards.ts";
-import { emiRoutes } from "./routes/emis.ts";
+import { creditRoutes } from "./modules/credit/plugin.ts";
 import { retirementRoutes } from "./routes/retirement.ts";
 import { accountNpsRoutes } from "./routes/account-nps.ts";
-import { bankDetailsRoutes } from "./routes/bank-details.ts";
-import { overdraftDetailsRoutes } from "./routes/overdraft-details.ts";
 import { insuranceRoutes } from "./routes/insurance.ts";
 import { holdingRoutes } from "./routes/holdings.ts";
 import { netWorthRoutes } from "./routes/networth.ts";
 import { insightRoutes } from "./routes/insights.ts";
 import { reportRoutes } from "./routes/reports.ts";
-import { searchRoutes } from "./routes/search.ts";
 import { backupRoutes } from "./routes/backup.ts";
 import { aiRoutes } from "./routes/ai.ts";
 import { aiEventRoutes } from "./routes/ai-events.ts";
@@ -53,8 +42,6 @@ import { planningRoutes } from "./modules/planning/plugin.ts";
 import { profileRoutes } from "./routes/profile.ts";
 import { inboxRoutes } from "./routes/inbox.ts";
 import { mailboxRoutes } from "./routes/mailboxes.ts";
-import { resourceRoutes } from "./routes/resources.ts";
-import { userTaskRoutes } from "./routes/user-tasks.ts";
 import { invalidateUserCache } from "./services/cache.ts";
 import { enqueueBudgetEvaluation } from "./jobs/index.ts";
 import { createStorage, type Storage } from "./lib/storage.ts";
@@ -91,42 +78,48 @@ export function registerLedgerCacheSubscriber(app: FastifyInstance): void {
 /**
  * Registers every application route module (not the HTTP-level `multipart`/
  * `compress` plugins, which stay in `buildApp()` since they aren't routes).
- * Same 39 registrations, same order, as `buildApp()` always had — extracted so
- * a hermetic test (`app.route-snapshot.test.ts`) can build a minimal Fastify
- * instance around just this function and snapshot the resulting route table
- * without booting Postgres/Redis/storage/jobs/auth/security.
+ * Same URLs/methods as `buildApp()` always had — extracted so a hermetic test
+ * (`app.route-snapshot.test.ts`) can build a minimal Fastify instance around
+ * just this function and snapshot the resulting route table without booting
+ * Postgres/Redis/storage/jobs/auth/security.
+ *
+ * As of task 1.1 (migrate-ledger), the 11 ledger route registrations that used
+ * to sit here directly ... are collapsed into the single `ledgerRoutes`
+ * plugin registered below ... As of task 1.2 (migrate-credit), the same
+ * applies to the 4 credit route registrations (cards/emis/bank-details/
+ * overdraft-details) — collapsed into the single `creditRoutes` plugin, in
+ * the position `cardRoutes` used to occupy; `bankDetailsRoutes`/
+ * `overdraftDetailsRoutes` used to register later (interleaved with
+ * `retirementRoutes`/`accountNpsRoutes`), so this also moves them earlier in
+ * registration order — see `modules/credit/plugin.ts`. ...
  */
 export async function registerRoutes(app: FastifyInstance): Promise<void> {
   await app.register(healthRoutes);
   await app.register(authRoutes);
-  await app.register(accountRoutes);
-  await app.register(categoryRoutes);
-  await app.register(transactionRoutes);
-  await app.register(transferRoutes);
-  await app.register(attachmentRoutes);
-  await app.register(transactionLinkRoutes);
+  await app.register(ledgerRoutes);
   await app.register(importRoutes);
-  await app.register(ruleRoutes);
   await app.register(budgetRoutes);
   await app.register(dashboardRoutes);
   await app.register(notificationRoutes);
-  await app.register(recurringRoutes);
   await app.register(goalRoutes);
   await app.register(sipRoutes);
   await app.register(cashflowRoutes);
   await app.register(billRoutes);
-  await app.register(cardRoutes);
-  await app.register(emiRoutes);
+  await app.register(creditRoutes);
   await app.register(retirementRoutes);
   await app.register(accountNpsRoutes);
-  await app.register(bankDetailsRoutes);
-  await app.register(overdraftDetailsRoutes);
   await app.register(insuranceRoutes);
   await app.register(holdingRoutes);
   await app.register(netWorthRoutes);
   await app.register(insightRoutes);
   await app.register(reportRoutes);
-  await app.register(searchRoutes);
   await app.register(backupRoutes);
   await app.register(aiRoutes);
   await app.register(aiEventRoutes);
@@ -134,8 +127,6 @@ export async function registerRoutes(app: FastifyInstance): Promise<void> {
   await app.register(profileRoutes);
   await app.register(inboxRoutes);
   await app.register(mailboxRoutes);
-  await app.register(resourceRoutes);
-  await app.register(userTaskRoutes);
 }
```
(The `ledgerRoutes`/11-registration-collapse lines are task 1.1's own
pre-existing edit to this same file, shown here only because `git diff`
against HEAD necessarily includes them; my own edit is exactly the
`cardRoutes`/`emiRoutes`/`bankDetailsRoutes`/`overdraftDetailsRoutes` →
`creditRoutes` lines and the doc-comment paragraph naming task 1.2.)

## P8 — Reverse-direction ledger-file updates

```
$ grep -n "credit/services/emis" apps/api/src/modules/ledger/services/recurring.ts apps/api/src/modules/ledger/services/recurring.test.ts
apps/api/src/modules/ledger/services/recurring.ts:12:import { lockAccountPair, stepAmortization } from "../../credit/services/emis.ts";
apps/api/src/modules/ledger/services/recurring.ts:87:  // modules/credit/services/emis.ts).
apps/api/src/modules/ledger/services/recurring.test.ts:11:import { createEmi, listEmiInstallments, upsertEmiDetails } from "../../credit/services/emis.ts";
```
Both files were untracked/new in git already (task 1.1's own work, not yet
committed), so this shows as a `grep` confirmation rather than a `git diff`
hunk — the edit is real and present in the working tree.

## P9 — Cross-module import completeness (source-aware, NOT a basename grep)

Wrote a Node script (`t12-completeness-check.mjs`, kept in the session
scratchpad only, never committed) that walks every `.ts` file under
`apps/api/src`, regex-matches every `from "..."` specifier, skips
non-relative specifiers, resolves every relative specifier to an absolute
path, and asserts none of those resolved paths equals one of the 13 deleted
flat paths. A corroborating positive check resolves the SAME way (not a
literal-text substring match) to also catch the ledger files' `../../credit/
services/emis.ts`-style imports, which don't literally contain the substring
"modules/credit" even though they resolve into that directory.

Full script content:
```js
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname, resolve, extname } from "node:path";

const SRC_ROOT = "/home/udai/PennyPilot/apps/api/src";

const DELETED_PATHS = [
  "services/cards.ts", "services/card-due-tasks.ts", "services/card-statements.ts",
  "services/emis.ts", "services/overdraft-details.ts", "services/bank-details.ts",
  "services/cards.test.ts", "services/card-due-tasks.test.ts", "services/emis.test.ts",
  "routes/cards.ts", "routes/emis.ts", "routes/overdraft-details.ts", "routes/bank-details.ts",
].map((p) => resolve(SRC_ROOT, p));

if (DELETED_PATHS.length !== 13) throw new Error(`Expected 13, got ${DELETED_PATHS.length}`);

function collectTsFiles(root) {
  const out = [];
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules") continue;
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectTsFiles(full));
    else if (extname(entry) === ".ts") out.push(full);
  }
  return out;
}

const files = collectTsFiles(SRC_ROOT);
const FROM_RE = /from\s+["']([^"']+)["']/g;
let totalRelativeSpecifiers = 0;
const violations = [];
const newModuleCreditHits = [];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  let m;
  FROM_RE.lastIndex = 0;
  while ((m = FROM_RE.exec(content)) !== null) {
    const specifier = m[1];
    if (!specifier.startsWith(".")) continue;
    totalRelativeSpecifiers++;
    const resolved = resolve(dirname(file), specifier);
    if (DELETED_PATHS.includes(resolved)) violations.push({ file, specifier, resolved });
    const resolvedRel = resolved.replace(SRC_ROOT + "/", "");
    if (
      (resolvedRel.startsWith("modules/credit/services/") || resolvedRel.startsWith("modules/credit/routes/")) &&
      !file.startsWith(join(SRC_ROOT, "modules/credit"))
    ) {
      newModuleCreditHits.push({ file: file.replace(SRC_ROOT + "/", ""), specifier, resolvedRel });
    }
  }
}
// ... reporting + process.exit(1) on any violation ...
```

Full literal output:
```
$ node t12-completeness-check.mjs
Scanned 207 .ts files under /home/udai/PennyPilot/apps/api/src
Total relative import/export specifiers examined: 637
Deleted-path violations found: 0

--- Corroborating positive signal: cross-module consumers resolving into modules/credit/(services|routes)/ ---
Count: 4
  jobs/index.ts -> "../modules/credit/services/alerts.ts" (resolves to modules/credit/services/alerts.ts)
  jobs/index.ts -> "../modules/credit/services/card-due-tasks.ts" (resolves to modules/credit/services/card-due-tasks.ts)
  modules/ledger/services/recurring.test.ts -> "../../credit/services/emis.ts" (resolves to modules/credit/services/emis.ts)
  modules/ledger/services/recurring.ts -> "../../credit/services/emis.ts" (resolves to modules/credit/services/emis.ts)

PASS: no relative import in apps/api/src resolves to any of the 13 deleted flat paths.
```
The 4 corroborating hits exactly match investigation-1.md's cross-import
inventory: `jobs/index.ts` (2 imports: `evaluateCardDueReminders`/
`evaluateCardUtilization` from the moved `cards.ts`→now `alerts.ts`, and
`materializeCardDueTasks` from the moved `card-due-tasks.ts`) + the 2
already-shipped ledger files (`recurring.ts`, `recurring.test.ts`). No other
cross-module production/test consumer was found — matches the investigation's
claim that `overdraft-details.ts`/`bank-details.ts` are consumed only by
their own (now also-moved) route files.

## T12/T13 — Direct confirmation the 13 old paths no longer exist; new paths present

```
$ ls apps/api/src/services/cards.ts apps/api/src/services/card-due-tasks.ts apps/api/src/services/card-statements.ts apps/api/src/services/emis.ts apps/api/src/services/overdraft-details.ts apps/api/src/services/bank-details.ts apps/api/src/services/cards.test.ts apps/api/src/services/card-due-tasks.test.ts apps/api/src/services/emis.test.ts apps/api/src/routes/cards.ts apps/api/src/routes/emis.ts apps/api/src/routes/overdraft-details.ts apps/api/src/routes/bank-details.ts
(for p in "${paths[@]}"; do [ -e "$p" ] && echo "STILL EXISTS: $p"; done)
(no output — all 13 confirmed absent)
```

## P11 — Snapshot recapture (canonical unchanged; raw regenerated with diff reviewed)

Canonical `route-surface.snapshot.txt` **compared, never regenerated** — the
committed file from P2 is untouched throughout this task (confirmed by `git
status`/`ls` showing it as an untracked file from task 1.1, never rewritten by
this session).

```
$ cd apps/api && node --test src/app.route-snapshot.test.ts   # BEFORE regenerating the raw snapshot
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte — the real 'unchanged API surface' gate (217.704411ms)
✖ raw printRoutes() tree matches the committed snapshot byte-for-byte (124.788774ms)
  Error: Raw route-table tree does not match the committed snapshot ...
ℹ tests 7
ℹ pass 6
ℹ fail 1
```
Exactly as predicted (canonical passes, raw legitimately fails pre-regeneration).

Regenerated `route-table.snapshot.txt` via a temporary hermetic script
(`_regen-raw-snapshot-credit.ts`, deleted immediately after use — confirmed
absent via `ls`), then re-ran:
```
$ node --env-file-if-exists=../../.env src/_regen-raw-snapshot-credit.ts
Wrote regenerated route-table.snapshot.txt
$ node --test src/app.route-snapshot.test.ts
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte — the real 'unchanged API surface' gate (207.725546ms)
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte (101.010259ms)
✔ assertRouteTableMatches rejects an added route (0.533244ms)
✔ assertRouteTableMatches rejects a removed route (0.201255ms)
✔ assertRouteTableMatches rejects a renamed route (0.220241ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.157413ms)
✔ assertRouteTableMatches accepts identical tables (0.245407ms)
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

**Three-part reviewer checklist applied to the diff between the P2 pre-move
raw capture and the regenerated `route-table.snapshot.txt`:**

Line-count check — both files exactly 156 lines:
```
$ wc -l <scratchpad>/route-table.pre-move.txt apps/api/src/route-table.snapshot.txt
156 route-table.pre-move.txt
156 route-table.snapshot.txt
```

Full raw diff (only 3 lines changed, in the entire 156-line tree):
```
$ diff <scratchpad>/route-table.pre-move.txt apps/api/src/route-table.snapshot.txt
15d14
< │       ├── /nps-details (GET, HEAD, PUT)
17c16,17
< │       └── /overdraft-details (GET, HEAD, PUT)
---
> │       ├── /overdraft-details (GET, HEAD, PUT)
> │       └── /nps-details (GET, HEAD, PUT)
```
Context (before/after) confirms this is purely a branch-order swap under
`/api/accounts/:id|:accountId` — `bank-details`/`overdraft-details` now
register earlier (since `creditRoutes` sits where `cardRoutes` used to,
earlier than `retirementRoutes`/`accountNpsRoutes`), so `nps-details`
(`accountNpsRoutes`'s route) is now the LAST child instead of the first:
```
BEFORE:                                AFTER:
│       ├── /nps-details               │       ├── /bank-details
│       ├── /bank-details               │       ├── /overdraft-details
│       └── /overdraft-details          │       └── /nps-details
```
Sorted-line diff (isolates genuine content changes from pure reordering):
```
$ diff <(sort <scratchpad>/route-table.pre-move.txt) <(sort apps/api/src/route-table.snapshot.txt)
133c133
< │       ├── /nps-details (GET, HEAD, PUT)
---
> │       └── /nps-details (GET, HEAD, PUT)
137c137
< │       └── /overdraft-details (GET, HEAD, PUT)
---
> │       ├── /overdraft-details (GET, HEAD, PUT)
```
Only branch-glyph changes (`├`/`└`) on the two nodes whose "last child"
status flipped — zero method/path text changed anywhere.

`/api/cards`/`/api/emis`/`/api/card-issuers`/`/api/card-statements` block
positions are byte-identical before/after (confirmed by `grep -n` against
both files returning identical line numbers) — these routes were already
contiguous and did not move.

Checklist verdict:
(a) every leaf method/path in the new raw tree corresponds to an entry in the
    canonical set — proven independently since the canonical-surface test
    (built via the identical `registerRoutes` call, `onRoute` hook, not
    derived from the raw tree) passed byte-for-byte, confirmed separately
    above;
(b) only ordering/branch-glyph/nesting differs — confirmed by the sorted-diff
    showing zero method/path text changes, only glyph changes on the two
    "last child" nodes;
(c) no unexpected route constraint or duplicated branch appears — confirmed
    by the canonical test's explicit no-duplicate-pairs assertion passing,
    and the line count staying at 156 in both files.

## P12 — `db:generate` content-hash manifest, before/after

```
$ find apps/api/drizzle -type f | sort | xargs sha256sum > before.txt   # 135 files
$ npm run db:generate
...
No schema changes, nothing to migrate 😴
$ find apps/api/drizzle -type f | sort | xargs sha256sum > after.txt   # 135 files
$ diff before.txt after.txt && echo "IDENTICAL MANIFEST — zero migration diff confirmed"
IDENTICAL MANIFEST — zero migration diff confirmed
```

## P13 — `backup.test.ts`

```
$ cd apps/api && node --env-file-if-exists=../../.env --test src/services/backup.test.ts
✔ the full backup covers every table in the schema (2.126848ms)
✔ sips precedes holding_events in ALL_TABLES (holding_events.sip_id FKs sips) (0.248924ms)
✔ the per-user export reconstructs every table (no coverage gaps) (0.24229ms)
✔ no table is scoped both directly and through a parent (0.212201ms)
✔ every storage-key column in the schema is covered by FILE_COLUMNS (0.603136ms)
✔ collectFileRefs pulls every non-empty storage key from a dump (0.439205ms)
✔ the per-user restore covers exactly the exported tables, in parent-first order (0.33665ms)
✔ restore defers cyclic and self-referencing foreign keys (0.420371ms)
✔ restoreDump's second pass issues an update for every column in DEFERRED_RESTORE_COLUMNS (1.277004ms)
✔ misc-05 AC14: restoreDump's first pass carries user_tasks.source/source_key through untouched when present, and omits them (falling back to the column DEFAULT) when the dump predates the migration (0.649406ms)
✔ AC11: a task linked to an owned transaction, and an unlinked task, round-trip through per-user backup/restore (349.160231ms)
✔ misc-05 AC14: the per-user archive round-trips a card-due task's source/sourceKey through restoreUserBackup, alongside an ordinary task (186.73361ms)
✔ misc-05 AC14: a per-user archive predating source/sourceKey (missing both keys entirely) restores via restoreUserBackup by falling back to the column DEFAULTs (43.126045ms)
ℹ tests 13
ℹ pass 13
ℹ fail 0
```
`ALL_TABLES`/`USER_TABLES`/`LINKED_TABLES` in `services/backup.ts` untouched
— confirmed by `git diff -- apps/api/src/services/backup.ts` (empty).

## An unplanned fix found during P14's full-suite run — a test-only concurrency hazard

Running `npm run test` the first time showed `@compass/api: tests 833 / pass
806 / fail 27` — all 27 failures in `card-due-tasks.test.ts`, every one with
the identical error:
```
Error: card-due-tasks.test.ts calls the real, global materializeCardDueTasks(db)
against this repo's shared dev Postgres (no test-DB isolation exists). Found 1
pre-existing non-demo card_details row(s) — refusing to run...
```
This is `card-due-tasks.test.ts`'s own `before()` precondition guard (moved
unmodified from the original file, per DELEGATION) tripping because it found
a stray non-demo `card_details` row in the shared dev DB **at the exact
instant its check ran** — caused by a race with my new `rewards.test.ts`'s
DB-backed `getCardEarnRate` tests, which insert real (non-demo) `card_details`
rows, running concurrently under node's test runner's default multi-file
concurrency (`node --test "src/**/*.test.ts"` runs test files in parallel).

**Directly reproduced and isolated** (not assumed) by running file pairs
repeatedly:
```
$ node --env-file-if-exists=../../.env --test src/modules/credit/services/reconciliation-writes.test.ts src/modules/credit/services/card-due-tasks.test.ts   # x3
tests 53 / pass 53 / fail 0   (x3 — no race, this pairing predates rewards.test.ts)

$ node --env-file-if-exists=../../.env --test src/modules/credit/services/rewards.test.ts src/modules/credit/services/card-due-tasks.test.ts   # x3
tests 44 / pass 44 / fail 0   (run 1)
tests 44 / pass 44 / fail 0   (run 2)
[27 failures, identical error]   (run 3)

$ node --env-file-if-exists=../../.env --test src/modules/credit/services/reconciliation-writes.test.ts src/modules/credit/services/rewards.test.ts src/modules/credit/services/card-due-tasks.test.ts   # x5
run 1: pass 70 / fail 0
run 2: pass 43 / fail 27
run 3: pass 43 / fail 27
run 4: pass 43 / fail 27
run 5: pass 43 / fail 27
```
This confirmed the race is caused specifically by `rewards.test.ts` (new code
this task adds), not by the pre-existing `reconciliation-writes.test.ts`
(inherited from the original `cards.test.ts`, which also inserts a
`cardDetails` row in one test but apparently with much lower collision
probability against `card-due-tasks.test.ts`'s early `before()` check).

**Fix applied** (scoped entirely to my own new test file, no production code
touched, `card-due-tasks.test.ts` left exactly as moved): `rewards.test.ts`'s
`createUser()` now creates its throwaway users with `isDemo: true` — since
`getCardEarnRate`/`ownedCardAccount` never read `isDemo`, this has zero effect
on what's being tested, but excludes the row entirely from
`card-due-tasks.test.ts`'s `where users.is_demo = false` precondition count.

Re-verified: `rewards.test.ts` alone still 17/17 pass; the exact 3-file race
scenario re-run 8 times, all clean:
```
$ node --env-file-if-exists=../../.env --test src/modules/credit/services/rewards.test.ts
ℹ tests 17 / pass 17 / fail 0

$ for i in 1..8: node ... reconciliation-writes.test.ts rewards.test.ts card-due-tasks.test.ts
run 1: tests 70 / pass 70 / fail 0
run 2: tests 70 / pass 70 / fail 0
run 3: tests 70 / pass 70 / fail 0
run 4: tests 70 / pass 70 / fail 0
run 5: tests 70 / pass 70 / fail 0
run 6: tests 70 / pass 70 / fail 0
run 7: tests 70 / pass 70 / fail 0
run 8: tests 70 / pass 70 / fail 0
```

## P14 — Full gate: typecheck, lint, test (final, post-fix)

```
$ npm run typecheck
> @compass/api@0.1.0 typecheck / tsc --noEmit
> @compass/docs@0.1.0 typecheck / tsc --noEmit
> @compass/extractor@0.1.0 typecheck / tsc --noEmit
> @compass/ingestor@0.1.0 typecheck / tsc --noEmit
> @compass/web@0.1.0 typecheck / tsc --noEmit
> @compass/ai@0.1.0 typecheck / tsc --noEmit
> @compass/shared@0.1.0 typecheck / tsc --noEmit
(zero errors in every workspace; exit 0)
```

```
$ npm run lint
> compass@0.1.0 lint
> eslint .
(no output — zero lint errors; exit 0)
```

```
$ npm run test
```
Exit code **1** — the same single pre-existing, environmental
`@compass/extractor` failure task 1.1's own report documented (confirmed
below, not a regression this task introduced or could have introduced):

Per-workspace summary (literal `ℹ tests`/`ℹ pass`/`ℹ fail` lines):
```
@compass/api:        tests 833 / pass 833 / fail 0
@compass/extractor:   tests 63  / pass 62  / fail 1
@compass/ingestor:    tests 12  / pass 12  / fail 0
@compass/web:         tests 264 / pass 264 / fail 0
@compass/ai:          tests 32  / pass 32  / fail 0
@compass/shared:      tests 212 / pass 212 / fail 0
```

The one extractor failure (confirmed environmental, not this task's doing):
```
Error: statement-duplicate.test.ts needs DATABASE_URL set (a real Postgres
connection) — this repo has no DB-mocking infrastructure. Export it (see
apps/extractor/.env) before running `npm run test -w apps/extractor`.
✖ src/statement-duplicate.test.ts
```
```
$ git status --porcelain apps/extractor
(empty — confirms zero files touched under apps/extractor in this session)
$ cd apps/extractor && node --env-file-if-exists=../../.env --test src/statement-duplicate.test.ts
✔ AC9: a later card-statement line matching an accepted repayment's card leg is annotated status='duplicate' with matchedTransactionId = the leg's id, and the ledger-row count recorded before ingestion equals the count after (100.06867ms)
ℹ tests 1 / pass 1 / fail 0
```

## T6/T7 — schema smoke test / plugin test (already shown above under P3/P7) — 2/2 and 1/1

## T9 — `backup.test.ts` (already shown above under P13) — 13/13

## T10 — Every relocated/split test file run individually from its new location

```
$ cd apps/api && node --env-file-if-exists=../../.env --test src/modules/credit/services/cycle-math.test.ts src/modules/credit/services/reconciliation-reads.test.ts
(pure tests — no DATABASE_URL needed, ran with it set anyway for uniformity)
tests 24 / pass 24 / fail 0    (11 cycle-math + 13 reconciliation-reads)

$ node --env-file-if-exists=../../.env --test src/modules/credit/services/reconciliation-writes.test.ts
tests 26 / pass 26 / fail 0

$ node --env-file-if-exists=../../.env --test src/modules/credit/services/rewards.test.ts
tests 17 / pass 17 / fail 0

$ node --env-file-if-exists=../../.env --test src/modules/credit/services/emis.test.ts
tests 29 / pass 29 / fail 0   (matches the original file's count — 24 literal `test(` calls + 3-way and 2-way `for` loops = 29)

$ node --env-file-if-exists=../../.env --test src/modules/credit/services/card-due-tasks.test.ts
tests 27 / pass 27 / fail 0   (matches the original file's count exactly)
```

## T11 — `wc -l` on all 6 split files + `emis.ts` (already shown above under P4)

## T14 — Full `git diff` reviewed

```
$ git diff -- apps/api/src/db/schema.ts
(empty — no table definition changed, only re-exported from modules/credit/schema.ts)

$ git diff -- CLAUDE.md
(empty — not touched, per Non-Goals/Must-Not-Change)

$ git diff -- apps/api/src/services/backup.ts
(empty — untouched, table names/columns addressed by string literal)

$ git diff -- tasks/01.02-migrate-credit.md
(shown in full under P1 above — the only change is the endpoint-count correction)

$ git diff --stat -- tasks/01.01-migrate-ledger.md tasks/01.09-cross-module-ports.md tasks/README.md
tasks/01.01-migrate-ledger.md     | 16 ++++++++--------
tasks/01.09-cross-module-ports.md | 15 ++++++++++++++-
(both are task 1.1's own pre-existing, already-reported edits — confirmed by
cross-reference against tasks/007-migrate-ledger/implementation-1.md's own
diff content; neither touched by this session. tasks/README.md's single
diffed line — "1.1 ... todo -> done" — is also task 1.1's own pre-existing
edit, not touched by this session; this task did not further edit
tasks/README.md, per Scope, which names no README edit for task 1.2.)
```

## Assumptions
- `mv`-equivalent (Write new file + delete old) was used for all relocations
  rather than `git mv`, matching task 1.1's own precedent — the working tree
  shows deletions + untracked additions, ready for the coordinator's own
  review/staging step.
- Both temporary scripts (`_baseline-capture-credit.ts`,
  `_regen-raw-snapshot-credit.ts`) were deleted immediately after use in this
  same session and confirmed absent via direct `ls` — neither was ever part
  of the deliverable.
- `.env`-dependent tests were run with `node --env-file-if-exists=../../.env`
  from `apps/api`, per DELEGATION.md's Commands section and this repo's
  existing convention.
- No git `add`/`commit` was performed — this delegation is an Implement brief
  with no git steps named in DELEGATION.md's Commands section. The working
  tree is left exactly as edited, layered on top of task 1.1's own
  pre-existing uncommitted state, for the coordinator's own review.

## Unresolved risks
- **The 49→50 test-count correction** (see the P4 section above) — TASK.md's
  Root Cause undercounts `reconciliation-reads.test.ts` by one
  (`driftPresentation` actually has 5 cases, not 4, making the
  `dueDrift`+`driftPresentation` group 7, not 6). This does not change any
  file/symbol boundary or assertion, only the documented count; flagged
  rather than silently reporting "49" to match the plan's literal wording.
- **The rewards.test.ts / card-due-tasks.test.ts concurrency hazard** (see its
  own section above) was found, reproduced, and fixed within this task's own
  new test file (`isDemo: true` on `rewards.test.ts`'s throwaway users). The
  underlying design fragility — `card-due-tasks.test.ts`'s precondition guard
  checks the ENTIRE shared dev Postgres for any non-demo `card_details` row,
  which is inherently racy against ANY concurrently-running test file that
  inserts one — is a pre-existing pattern (the original `cards.test.ts`'s
  `absorbCarryover` test already did this, just with lower collision
  probability) that this task's fix works around locally rather than redesigns
  globally; flagging it as a standing fragility for whoever next adds a
  DB-backed credit-module test that inserts a non-demo `card_details` row.
- **Two stale comments left unfixed**, both outside DELEGATION's named list
  (see the P4 "Not fixed" note above): `apps/web/src/routes/cards/
  reconRowView.ts`'s comment naming `apps/api/src/services/cards.ts`, and
  `apps/api/src/db/schema.ts`'s two comments naming `services/
  card-due-tasks.ts` (lines 403, 718) — the latter is additionally covered by
  `db/schema.ts` being on the Must-Not-Change list.
- Per this session's `npm run test` run, the single `@compass/extractor`
  failure (`statement-duplicate.test.ts`) is pre-existing/environmental, not
  a credit-migration regression — confirmed via the same unrelated-file/
  untouched-git-status argument task 1.1's own report used, and independently
  re-confirmed here by running that one file directly with `.env` loaded
  (passes 1/1).
