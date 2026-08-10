# Task 2.1 — REVISED strategy: dual-write incremental (supersedes the atomic SP1 approach)

## Status
APPROVED FOR PR-A ONLY (dual-write iteration 3 — review-7 verdict APPROVED-FOR-PR-A; both PR-A-gating blockers confirmed RESOLVED against real code). PR-A is the first buildable, green, RELEASABLE increment. PR-A…PR-F are now on `main` (through commit 4f4e964).

**PR-G is SUPERSEDED by [PLAN-pr-g.md](PLAN-pr-g.md) — and so is this plan's data-preservation premise.** The deferred plan-review pass ran to APPROVED-FOR-G1A over four Codex iterations, then the **2026-08-10 user decision** (prod data disposable; 2.0.0 ships breaking with no upgrade path) deleted most of it. That decision restores the policy already recorded in `tasks/02.01-postings-model.md:22` — *"there is no backfill, no dual-write and no shadow period"* — and `tasks/03.02-release-2-0-0.md:12`.

**This document's dual-write strategy contradicted that recorded policy.** It was adopted for a sound reason (the atomic cutover yields no green, reviewable, mergeable intermediate) but carried an unstated assumption that live data must survive. PR-A…PR-F are shipped, green and NOT reverted — they delivered the postings table, its builders and postings-derived readers in reviewable increments. What is dropped is the transitional scaffolding they carried: the four-bullet G1–G4 sketch at lines 59-63, the Clearing account, the collapse migration, the parity gate and the maintenance windows. PR-G is now two ordinary PRs: **PR-G1 (postings-native, single shape) and PR-G2 (drop the legacy columns)**.

## Why this supersedes the atomic plan
The approved atomic cutover (TASK.md SP1) yields NO green/mergeable intermediate — proven twice. The project ships continuously and needs commit→PR→merge→release CADENCE. This revision keeps legacy single-entry as the source of truth, adds `postings` as a parallel DUAL-WRITTEN representation, converts readers module-by-module (each PR green + releasable), then flips and drops legacy last. SP0 (pure `postings.ts` helpers + `SafePaiseSchema`) is already on `main` and reused. The atomic WIP branch `feat/postings-model-sp1` (which DROPS columns) is ABANDONED; dual-write starts fresh from `main`; its additive migration KEEPS every legacy column.

## Core: ROW-LOCAL dual-write via system accounts (incl. a transitional Clearing account)
Every legacy transaction row maps to its OWN zero-sum posting set hanging off that row's `transaction_id`, so postings never change row cardinality and consistency is LOCAL + per-row testable. System accounts (per user, `system_kind`, DB-internal `"system"` type narrowed at every public boundary per D17): `Expenses`, `Income`, `Opening`, **`Clearing`** (Q4: 4th kind is TRANSITIONAL — used only while transfers remain 2 legacy rows; retired at the PR-G collapse; the enum value may remain reserved afterward).

Mapping (legacy row → its postings; all zero-sum):
- **Ordinary** (account A, signed `amount`, cat C, necessity N): `[A: amount] + [Expenses|Income: -amount, cat=C, nec=N]` (Expenses if amount<0 else Income).
- **Split** (row + N `transaction_splits`): `[A: amount] + one [Expenses|Income: -split_i, cat_i, nec_i, note_i]` per split. `transaction_splits` stays source of truth during dual-write; postings mirror it.
- **Transfer LEG** (each of 2 legacy rows + `transfer_links`): out `[A: -X] + [Clearing: +X]`; in `[B: +X] + [Clearing: -X]`. Each leg balances alone; Clearing nets 0 across the pair.
- **Opening row** (bank/cash `is_opening` row): `[A: amount] + [Opening: -amount]`.
- **Opening COLUMN** (`accounts.opening_balance_paise`, no row): **NO postings during dual-write** (blocker 1 / Q3). Balance readers keep the column as an explicit addend through PR-F. PR-G synthesizes a canonical Opening transaction dated at the **ACCOUNT-CREATION date** (`accounts.created_at`, converted to the canonical UTC ledger date) — NOT day-before-earliest-activity, which would change earlier as-of balances and erase openings for no-activity accounts (review-7 blocker 3) — and drops the column atomically. This mapping line and G2 (below) MUST agree on account-creation date.

## Deployment / backfill protocol (blocker 2 — required, expand-migrate-contract)
1. Additive schema migration (postings + system_kind incl. `clearing` + `"system"` type + unique partial index), KEEP all legacy columns.
2. Deploy the dual-writing binary (writers emit legacy AS TODAY + mirrored postings, in the same DB tx).
3. Idempotent FULL-SHAPE reconciliation run AFTER the new binary is live: for EVERY applicable transaction, rebuild-and-compare its EXPECTED posting shape (not merely rows lacking postings) — this repairs BOTH missing postings (old-binary inserts) AND stale/wrong-shaped postings (old-binary updates, link changes, rollbacks during the deploy window). Repeat until it is a no-op.
   - Deploy model: this app is self-hosted SINGLE-INSTANCE and deploys by restart (`COMPASS_VERSION` bump + `make update`), NOT a rolling/zero-downtime rollout. The additive migration + backfill + full-shape reconciliation run as a startup/maintenance step BEFORE the new binary serves traffic, so there is no concurrent old-binary-writing window in the normal path; the full-shape reconciliation is the belt-and-suspenders guard if one ever occurs.
4. GATE: assert "every applicable transaction has its expected posting shape" (the per-transaction invariant below) before ANY reader is converted.
Only after the gate passes do PR-B onward convert readers.

## Per-transaction characterization invariant (blocker 5 — the real safety net)
For EVERY transaction (test over seeded + generated data), assert its postings exactly reproduce its legacy shape:
- active ordinary: exactly one real posting == legacy (account, amount) + one correct Expenses/Income counter (cat/nec).
- split: real leg == parent amount; counters reproduce every split amount/category/note/necessity.
- linked transfer leg: real leg == legacy row; exactly one opposite Clearing leg.
- opening row: real leg == legacy amount + Opening counter. (column-based openings have NO postings during dual-write — asserted absent.)
- soft-deleted rows: postings retained but EXCLUDED via parent `transactions.deleted_at IS NULL` (soft delete only toggles the flag).
- no applicable transaction missing postings; none with duplicate/unexpected postings.
Real-account balance/report parity (postings vs legacy) is an ADDITIONAL end-to-end check, computed real-accounts-only, joined to non-deleted parents, same date cutoff, column-opening added explicitly, bigint-safe — NOT the primary invariant (account totals hide equal-and-opposite errors).

## Writer conversions for PR-A (dual-write must cover the full mutation graph)
All in the SAME outer DB transaction as the legacy write; `replacePostings`/`postEntry` refactored to accept an OUTER tx handle + `userId`, verifying transaction/real-account/system-account/category all belong to that user (blocker/scoping note):
- createTransaction; updateTransaction (lock+read the COMPLETE resulting legacy shape, rebuild postings in the same outer tx — account/amount/category/necessity can all change via the spread update); softDelete/bulk delete (no posting delete; readers exclude via deleted_at); bulk restore (refresh category-bearing counters on restore); bulk recategorize (update matching Expenses/Income counters, never Clearing/Opening).
- setSplits (replace postings inside the same callback; use BigInt safe-sum, D12; D15 split-amount policy: reject/explicit allocation, never silent rescale).
- transfers: manual link, auto-link, unlink, auto-link INVALIDATION (import-reconciliation edit), hard-delete of either leg (rebuild/clear the counterpart's Clearing postings so it isn't falsely transfer-excluded), import rollback restoration — explicit atomic posting transitions each (blocker 3). Link/unlink of a SPLIT transaction restores split shape, not a blind ordinary pair.
- categories.ts merge (posting-affecting: update parent AND split-derived counter postings) — explicitly named.
- import commit bulk insert + import reconciliation amount change + rollback (both directions rebuild postings); recurring materialization incl. EMI as TWO independent posting families (source=expense, principal=neither; D21 — never mistaken for a transfer); review-actions/insurance/epf writers; account opening insert/update/soft-delete (all 3 paths); reconciliation drift (opening column only during dual-write — Q3 defers synthetic-opening dual-source to PR-G; preserve account-first lock order); demo/seed.
- Header-only helper (`updateTransactionHeader`) for merchant/sip/reconciledStatementId — must NOT touch postings (D18).

## Also in PR-A (correctness must ship with the new tables)
- Restore compatibility (blocker 4 / D19): fresh-account guard ignores `system_kind IS NOT NULL`; seeded system accounts retained/regenerated (not deleted by the reverse-order loop); build old→new system-account id map by `system_kind`; rewrite each restored posting's `account_id`; never insert archived system accounts as ordinary; JSON archive round-trips postings. **OLD archives (legacy transactions but NO postings): UNSUPPORTED — restore detects the missing `postings` rows and fails with a clear error ("Archive predates the postings model — restore is not supported; re-export from the current version"). No synthesis of postings from legacy columns/transfer_links/is_opening/splits (user decision: old backups need not restore to the new system). NEWER archives' posting shapes are VALIDATED (rebuild-and-compare), not blindly trusted.** (CSV projection can wait to PR-F; JSON backup/restore correctness cannot.)
- `postings` in `ALL_TABLES` (after accounts AND transactions) + `LINKED_TABLES` (not USER_TABLES); schema-coverage + export-gap tests enforce all three collections.
- `"system"` narrowed (`system_kind IS NULL`) at every generic account boundary NOW (listAccounts, accountBalancesAtDate cast) — not deferred.
- system accounts excluded from generic account queries + guarded (edit/delete/archive + rejected through the simple transaction API); unique partial index `(user_id, system_kind)`.

## Conversion sequence (each = one green, mergeable, RELEASABLE PR)
- **PR-A:** additive migration + 4 system accounts + backfill/catch-up protocol + FULL dual-write writer graph + per-transaction invariant + restore compat + narrowing. NO reader changed; DTO unchanged (served from legacy). Green + releasable.
- **PR-B:** balance readers (`balances.ts`, `accounts.ts` listAccounts/accountBalancesAtDate, `average-balance.ts`) → postings + explicit column-opening addend; parity-verified.
- **PR-C:** `lib/periods.ts` income/expense/spend/necessity → postings: exclude any transaction having a Clearing posting (= transfer) and any having an Opening posting (= opening); liability-inflow from real posting joined to `accounts.type` (D4); expense = every negative real posting; split spend = positive Expenses postings; `count(distinct transaction_id)` (D6).
- **PR-D:** planning readers (dashboard/reports/insights/cashflow/goals/bills) — EACH consumer + its parity test in the SAME PR (fix: prefs large-txn alert D20 ships WITH prefs, one real posting per txn → split=1/transfer=0).
- **PR-E:** credit (cards/emis/reconciliation-reads) + investments (sip-installments/networth) + automation + ingest readers + user-tasks + prefs + insurance readers; transaction-level consumers select exactly one real posting, exclude transfer/opening.
- **PR-F:** extractor `apps/extractor/src/db.ts` → postings; backup CSV derives from postings.
- **PR-G (flip + net deletion + collapse) — STAGED, not one PR (review-6 blocker 4).** The flip/contract is deployed as an expand→migrate→gate→contract sequence, safe under the restart-based single-instance deploy (a maintenance window is natural here):
  - **G1 (expand, additive, green):** postings-native readers + finalized shared `Transaction`/`Account` DTOs + web changes, while legacy columns/`transfer_links` STILL EXIST (dual-write continues). Backward-compatible; releasable.
  - **G2 (data migration, maintenance window):** stop writes; idempotently COLLAPSE transfers to one header + two real postings (Q1 — roadmap 2.2/D1; D16 identity/attachment-remap, contained since all readers are already on postings); synthesize canonical Opening transactions for `opening_balance_paise` accounts dated at **ACCOUNT-CREATION date** (review-6 blocker 3 — NOT day-before-earliest-activity, which changes earlier as-of balances / erases openings for no-activity accounts).
  - **G3 (verification gate):** per-transaction invariant + full parity green on the migrated data before proceeding.
  - **G4 (contract migration):** stop dual-writing legacy; drop `transaction_splits`, `is_opening`, `accounts.opening_balance_paise`, `transactions.{accountId,amountPaise,categoryId,necessity}`, `transfer_links`; retire Clearing creation (enum value may remain reserved).

Each PR: `SafePaiseSchema` on the money fields it touches + SQL aggregates range-checked before `Number(...)` (not only HTTP boundaries); `buildTransferLegs` uses `Number.isSafeInteger` (D12); route snapshot unchanged (until PR-G); the per-transaction invariant + parity stay green; releasable.

## Q1–Q4 rulings (from review-5)
- Q1: 2-row+Clearing is TRANSITIONAL ONLY; COLLAPSE to one row at PR-G (roadmap 2.2 + D1). A permanent 2-row model would need explicit product sign-off; not taken.
- Q2: `transfer_links` stays the authoritative legacy marker during dual-write (Clearing mirrors its lifecycle); RETIRED at the PR-G collapse.
- Q3: reader special-case `opening_balance_paise` until PR-F; synthesize Opening rows + drop column atomically at PR-G.
- Q4: accept Clearing as transitional infrastructure; stop creating after collapse; enum value may remain reserved.

## Acceptance (AC1–AC8 reached incrementally; green at EVERY PR)
Postings + BigInt zero-sum + property test (SP0 done); balance/income/expense from postings (PR-B/C); system accounts seeded+guarded (PR-A); category/necessity on posting; integer paise + range-checked aggregates; ALL_TABLES/USER_TABLES/LINKED_TABLES parity (PR-A); typecheck+lint+test green at every PR; legacy fully removed by PR-G.

## Non-goals
DB invariant trigger (2.6); public multi-leg API (2.5); postings-native UI (2.7).

## Review log
- review-5 (Codex, dual-write plan): direction viable; 5 BLOCKERS — opening double-count, deployment write-gap, transfer-link lifecycle, PR-A restore, per-transaction invariant; + full mutation-path list + scoping/security notes + Q1–Q4 rulings. All folded into iteration 2.
- review-6 (Codex, dual-write plan): core VALIDATED (row-local Clearing dual-write, per-transaction invariant, PR-A/B/C incl. opening-column handling all confirmed correct); 3/5 prior blockers RESOLVED, 2 PARTIAL; 4 remaining, all deployment/edge-case with precise fixes: (1) full-shape reconciliation for stale postings + maintenance-window deploy; (2) PR-A restore synthesizes postings for old archives; (3) PR-G opening synth at account-creation date; (4) PR-G split into G1–G4 staged deploy. All four folded into iteration 3.
- review-7 (Codex, iteration-3 re-review): VERDICT **APPROVED-FOR-PR-A**. Blocker 1 (full-shape reconciliation) RESOLVED — confirmed against transactions.ts update-spread + imports.ts reconcile/auto-link/rollback; deploy premise supported by compose one-shot-migration + restart model. Blocker 2 (old-archive restore synthesis) RESOLVED — synthesis-before-commit + newer-archive rebuild-and-compare closes the restore-user.ts skip-absent-table hole; idempotent under the partial unique index if restore uses upsert/select-existing (not 4 unconditional inserts). Blocker 3 (PR-G opening date) PARTIAL — G2 correct but line 17 contradicted it (NOW FIXED here to account-creation date). Blocker 4 (G1–G4 staging) NOT-RESOLVED — G2 collapse is not an independently deployable steady state while G1 legacy dual-writers persist; needs a compatibility/flip boundary or indivisible G2→G4 maintenance deployment + a distinct post-collapse invariant for G3 (deferred to a pre-PR-G plan-review pass). NO new PR-A blocker. Lead-validated (read review-7 + cross-checked cited code): PR-A is safe to build subject to the mandatory mutation-graph / reconciliation / restore / tenant-scope / invariant tests Codex enumerated (folded into DELEGATION.md). PR-G staging stays OPEN.
- **USER DECISION (2026-08-09):** Old archives (produced before PR-A, containing no `postings` rows) need not be restorable to the post-PR-A system. Restore will detect the absence of postings and fail with a clear error. This removes the synthesis-from-legacy-columns requirement from PR-A restore scope. Recorded in "Also in PR-A" above.
