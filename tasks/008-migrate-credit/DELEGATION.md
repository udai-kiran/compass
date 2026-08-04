# Sonnet Worker Delegation — iteration 1

## Task
008-migrate-credit (roadmap id 1.2, `tasks/01.02-migrate-credit.md`)

## Approved Plan
Full detail in `tasks/008-migrate-credit/TASK.md` (status APPROVED, revision 2 — two rounds of Codex plan review, all required corrections applied). Execute P1 through P14 from that file's Plan section, **in order**. Also read `tasks/008-migrate-credit/investigation-1.md` (the original investigation — exact line numbers, exact test-block breakdown, exact FK/cross-import lists) and `tasks/007-migrate-ledger/TASK.md` + `tasks/007-migrate-ledger/implementation-1.md` (the template this task reuses directly — same module scaffold, same two-snapshot route gate, same completeness-verification discipline).

**Read the full `TASK.md` yourself before starting, especially Root Cause.** This task is more involved than task 1.1: it's not a pure move. Two things are genuinely new:
1. `services/cards.ts` (1182 lines) must be decomposed into 6 files, and its 1068-line test file (`cards.test.ts`) must be split to match — but **not evenly across all 6**. Only 49 pre-existing test cases exist, concentrated in 3 files (`cycle-math.test.ts`: 11, `reconciliation-reads.test.ts`: 12, `reconciliation-writes.test.ts`: 26). Do **not** create empty `cards.test.ts`/`alerts.test.ts` files — there is no pre-existing test for card/issuer CRUD or alert evaluation, and that gap is accepted, not something to paper over.
2. A genuinely new reward-rate interface (`getCardEarnRate` + `earnedRewardPoints` in `rewards.ts`) must be built test-first — this is new logic, not a relocation, with precise arithmetic/validation/safe-integer semantics specified in TASK.md's Root Cause. Do not skip the safe-integer edge cases; they were the last thing two rounds of Codex review caught.

## Files and Symbols

**New files:**
- `apps/api/src/modules/credit/schema.ts` — thin re-export of 8 tables + 2 enums (`cardNetwork`, `bankAccountSubtype`) from `../../db/schema.ts` — verify this exact list against the current file yourself before writing it
- `apps/api/src/modules/credit/schema.smoke.test.ts` — object-identity test (8 tables + 2 enums)
- `apps/api/src/modules/credit/plugin.ts` — `creditRoutes(app)`, registers cards/emis/overdraft-details/bank-details route plugins, no prefix
- `apps/api/src/modules/credit/plugin.test.ts` — one uniquely-attributable route per each of the 4 route files, via route-lookup only (never `app.inject()`)
- `apps/api/src/modules/credit/services/cycle-math.ts` (~125 lines — date/cycle math split from `cards.ts`)
- `apps/api/src/modules/credit/services/cards.ts` (~430 lines — CRUD + activity/holder read-models, **exports `ownedCardAccount`** — do not leave it private, that was a plan defect Codex specifically caught and required fixed)
- `apps/api/src/modules/credit/services/alerts.ts` (~60 lines — `evaluateCardDueReminders`, `evaluateCardUtilization`)
- `apps/api/src/modules/credit/services/rewards.ts` (~80-120 lines — `listRewards`/`addRewardEntry`/`deleteRewardEntry` moved + new `getCardEarnRate`/`earnedRewardPoints`)
- `apps/api/src/modules/credit/services/reconciliation-reads.ts` (~180 lines — must export `toReconciliationDto` and `ledgerDuesAtDates`, both private today)
- `apps/api/src/modules/credit/services/reconciliation-writes.ts` (~265 lines — `recomputeReconciliation`, `absorbCarryover`)
- `apps/api/src/modules/credit/services/{card-due-tasks,card-statements,emis,overdraft-details,bank-details}.ts` — moved as-is (no split)
- New test files: `cycle-math.test.ts`, `reconciliation-reads.test.ts`, `reconciliation-writes.test.ts` (all 3 derived mechanically from `cards.test.ts`'s 49 test blocks, zero assertion changes), `rewards.test.ts` (entirely new, test-first `getCardEarnRate`/`earnedRewardPoints` cases)
- `apps/api/src/modules/credit/routes/{cards,emis,overdraft-details,bank-details}.ts` — moved, `routes/cards.ts` now imports from 4 different sibling service files

**Modified files:**
- `apps/api/src/app.ts` — 4 registrations collapse to 1 (`creditRoutes`)
- `apps/api/src/route-table.snapshot.txt` — regenerated (expected — see Root Cause on why registration order changes here)
- `apps/api/src/modules/ledger/services/recurring.ts` and `recurring.test.ts` — import path for `emis.ts` functions repointed to `modules/credit/services/emis.ts`
- ~10-15 other cross-module files per `investigation-1.md` §7/§8 (both directions)
- `tasks/01.02-migrate-credit.md` — fix "12 endpoints" to 15

**Deleted files (13):** `services/cards.ts`, `services/card-due-tasks.ts`, `services/card-statements.ts`, `services/emis.ts`, `services/overdraft-details.ts`, `services/bank-details.ts`; `services/cards.test.ts`, `services/card-due-tasks.test.ts`, `services/emis.test.ts`; `routes/cards.ts`, `routes/emis.ts`, `routes/overdraft-details.ts`, `routes/bank-details.ts`.

## Required Changes
Follow TASK.md's Plan (P1-P14) exactly. Non-negotiable details, all justified in Root Cause:

1. **Test-file split is NOT even 6-way.** Read `services/cards.test.ts`'s 49 top-level test blocks yourself and place each in the file that owns the function under test: 11 → `cycle-math.test.ts`, 12 → `reconciliation-reads.test.ts` (pure, no DB needed — verify this yourself, don't assume), 26 → `reconciliation-writes.test.ts` (DB-backed, inherits the entire existing DB harness — pool/fixtures/teardown — since it's the only new file that needs one). Zero assertion changes anywhere. Cross-seam tests (e.g. an `absorbCarryover` test that also calls `getCardActivity` or `listReconciliations`) stay as ONE test block with cross-file imports — do not split a test case in half. Produce an explicit mapping of all 49 old test names to their new file as evidence, not just totals.
2. **New required exports** (currently private, must become exported for the split to compile): `ownedCardAccount` (in `cards.ts`), `toReconciliationDto` and `ledgerDuesAtDates` (in `reconciliation-reads.ts`). `dueDrift` and `summarizeStatementLines` are already exported — no change needed there beyond the file move. Document these three as internal cross-file exports in a code comment, not public API.
3. **Split imports for mixed-table files**: check every moved file's actual import block for tables from both this module and elsewhere (`accounts`/`recurringTemplates` from ledger, `emailIngestions` from ingest) — confirmed cases include `cards.ts` (mixed with `accounts`/`transactions`/`alertLedger`/`extractedTransactions`), `emis.ts` (mixed with `accounts`/`recurringTemplates`/`transactions`), `overdraft-details.ts`/`bank-details.ts` (mixed with `accounts`), `card-due-tasks.ts` (mixed with `userTasks`/`alertLedger`/`users`) — do not assume this list is exhaustive, check every file.
4. **Reverse-direction fix in already-shipped ledger files**: `modules/ledger/services/recurring.ts` imports `lockAccountPair`/`stepAmortization` from the flat `services/emis.ts`; `modules/ledger/services/recurring.test.ts` imports `createEmi`/`listEmiInstallments`/`upsertEmiDetails` from the same flat path. Both need their import path updated to `modules/credit/services/emis.ts` once `emis.ts` moves — this is an edit to already-merged ledger-module files, not just this task's own new files.
5. **The new reward-rate interface** (test-first, per `tasks/TDD.md`): `getCardEarnRate(db, userId, accountId): Promise<number | null>` (DB-backed lookup, verifies account ownership + that it's a credit card, returns the `card_details.earn_rate_per_100` integer or `null` if no row exists) and `earnedRewardPoints(spendPaise: number, earnRatePer100: number): number` (pure calculator: `Math.floor(spendPaise * earnRatePer100 / 10_000)`). Both reject invalid input by throwing, never silently coercing: negative `spendPaise`, negative `earnRatePer100`, non-integer inputs, and — the precise rule from Root Cause — any input or their **product** that fails `Number.isSafeInteger` (check the product's safety before dividing by 10,000). Write the full test list from TASK.md's Root Cause BEFORE the implementation, including a case where each input is individually a safe integer but their product is not. Document the "simplified base-rate estimate" scope limitation in the function's own doc comment (not a task-filename reference).
6. **Stale comments must be fixed** (not an assertion change): `card-due-tasks.ts`'s doc comment citing `cards.ts:526-530`/`cards.ts:525` by line number; `cards.test.ts`'s comments naming `cards.ts` directly; the ledger `recurring.ts`/`recurring.test.ts` comments generically referencing `services/emis.ts`.
7. **Route-snapshot handling**: same two-gate pattern as task 1.1 — capture the canonical `route-surface.snapshot.txt` baseline (already committed, re-verify it matches the current app) and the raw `route-table.snapshot.txt` baseline BEFORE any edit. After the move, the canonical snapshot must be byte-identical (never regenerated, only compared against); the raw snapshot IS expected to change (registration order shifts since `bankDetailsRoutes`/`overdraftDetailsRoutes` move earlier relative to `retirementRoutes`/`accountNpsRoutes`/`insuranceRoutes`) — regenerate it and apply the same three-part reviewer checklist task 1.1 used (leaf content matches canonical set; only ordering/grouping/glyphs/nesting differ; no unexpected constraint or duplicated branch).
8. **`~500 lines` is not a universal ceiling** — only `cards.ts`'s decomposition is required to hit it. Do not split `emis.ts` (493 lines, cohesive, not asked for) or `routes/cards.ts` (215 lines).
9. **Job-wiring verification**: after the move, confirm by direct read of `jobs/index.ts` that all three call sites still resolve: `evaluateCardDueReminders` in the `system` worker's `"cards.remind"` handler; `materializeCardDueTasks` in that same handler AND in the boot catch-up path; `evaluateCardUtilization` in the per-user `alertsWorker`. A passing test suite alone is not sufficient evidence for this — read the actual import/call lines.
10. **Completeness verification is NOT a basename grep** (same rule as task 1.1): use clean `typecheck` + direct file-existence confirmation (all 13 old paths gone) + a source-aware import-resolution script that resolves every relative import specifier and checks against the 13 deleted paths (reuse/adapt the script pattern from task 1.1's `implementation-1.md`).

## Must Not Change
- No URL, HTTP method, handler body, response shape, or status code for any of the 23 credit endpoints — pure relocation (except the 2 genuinely new `rewards.ts` functions, which are new code, not existing behavior).
- `apps/api/src/db/schema.ts` — no table definition changes (only re-exported).
- `apps/api/src/services/backup.ts` — untouched (tables addressed by string literal, no import-path dependency).
- `CLAUDE.md` — explicitly not touched by this task (a separate, already-flagged decision point).
- No Fastify route prefix added anywhere.
- The pre-existing `saveCardStatement` reliability issue (stores to object storage before the DB insert, so a failed insert can orphan storage) — do not fix it, just don't make it worse.
- `services/cards.ts`'s `recomputeReconciliation` reading `extractedTransactions` directly — leave as pre-existing cross-module direct access, documented not fixed.
- Do not touch any file under `tasks/` other than `tasks/01.02-migrate-credit.md` and this task's own `tasks/008-migrate-credit/` folder.

## Acceptance Criteria
AC1–AC10 exactly as written in `tasks/008-migrate-credit/TASK.md`'s "Acceptance Criteria" section — read them there, do not paraphrase from memory.

## Commands
Run from repo root unless noted; DB-backed commands need `.env` loaded (from `apps/api`, use `node --env-file-if-exists=../../.env --test ...`).

1. `npm run typecheck` (root) — after schema creation, after the cards.ts split, after route moves, and at the end
2. `npm run lint` (root)
3. From `apps/api`: `node --test src/modules/credit/schema.smoke.test.ts`
4. From `apps/api`: `node --test src/app.route-snapshot.test.ts` (both canonical and raw-tree assertions)
5. From `apps/api`: `node --test src/modules/credit/plugin.test.ts`
6. From `apps/api`: `node --env-file-if-exists=../../.env --test src/services/backup.test.ts`
7. From `apps/api`: run each new/moved test file individually — `cycle-math.test.ts`, `reconciliation-reads.test.ts`, `reconciliation-writes.test.ts`, `rewards.test.ts`, `card-due-tasks.test.ts`, `emis.test.ts`
8. `wc -l` on all 6 files from the `cards.ts` split, plus `emis.ts`
9. `npm run db:generate` (root) — with before/after content-hash manifest of `apps/api/drizzle/`
10. `npm run test` (root, all workspaces) — full suite
11. Your source-aware import-resolution check (per Required Change 10)

## Required Evidence
- Full list of files changed (created/modified/deleted), matching the lists above exactly — flag any deviation.
- Complete diffs (or full new-file contents for new files).
- Every command's literal output and exit code — no paraphrasing.
- The explicit 49-test-name-to-new-file mapping (not just counts).
- The route-surface/route-table snapshot comparison evidence (canonical unchanged; raw diff explained per the three-part checklist).
- The `wc -l` counts for all 6 split files.
- The content-hash manifest diff for `apps/api/drizzle/`.
- The full output of your source-aware import-resolution completeness check.
- Direct confirmation (`ls`/equivalent) that all 13 old paths no longer exist.
- Any point where you deviated from the plan, and why — call it out explicitly.
