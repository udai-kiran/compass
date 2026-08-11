# Task: Misc bug fixes — F5 dead transfer_links block + stale comments

## Status
COMPLETE — review-2.md clean (no blocking findings). Committed to fix/030-misc-bug-fixes,
PR created, squash-merged to main, tagged v2.8.2. CI gate (AC7) via CI check on PR.

## Objective
Remove dead runtime code and update two stale comments left over from the PR-G1
dual-write retirement. No functional behaviour change; code hygiene only.

## Root Cause

### F5 — dead `survivingPartners` block in `imports.ts`
`rollbackImport` at lines 871-897 queries `transfer_links` to find "surviving
partner" transactions that would be orphaned after a delete. Under the OLD model,
a transfer was two transaction headers joined by a `transfer_links` row; deleting
one leg cascaded the link row and left the other leg dangling.

Under PR-G1: a transfer is ONE transaction header with TWO real postings. Deleting
that single header removes all postings atomically via CASCADE — no surviving
partner is possible. Additionally, `transfer_links` is NEVER populated post-PR-G1
(confirmed by `reconcile-postings.ts` boot check), so the query always returns 0
rows. The `survivingPartners` set is built but **never read** anywhere in the
function — it is fully dead code.

Also: the `transferLinks` name in the db-schema import at line 13 becomes unused
after the block is removed.

### Stale doc comments
Two places still describe the old `transfer_links` mechanics:

1. `imports.ts` lines 871-874 — comment says "hard-deleting a transaction cascades
   its transfer_links rows" (inapplicable; the table is empty and the concept is gone).

2. `review-actions.ts` line 136 — doc comment says "hard-deleting one leg already
   cascaded away the `transfer_links` row" (factually wrong under PR-G1).

`legacy-projection.ts` was reviewed and its header comment is accurate (already
says "PR-G1 makes postings the authority for reads AND writes"; PR-G2 note correct).

## Scope

### Production files (2)
- `apps/api/src/modules/ingest/services/imports.ts`
  - Remove `transferLinks` from the db-schema import (line 13). NOTE: `or` must
    stay (it is used elsewhere in the file — do NOT remove it).
  - Remove the dead comment + `survivingPartners` block (lines 871-897).
  - REQUIRED (not optional): update the `autoLinkTransfers` comment at lines 928-930.
    Current text: "Rebuild auto transfer links: restored rows may re-form pairs, and
    the ones dropped during reconciliation are gone. Manual links were never touched."
    — the "Manual links were never touched" part describes the retired link-row model.
    Replace with: "Corrected transactions restored during rollback may again form
    eligible ordinary pairs — rerun autoLinkTransfers to close those loops."
- `apps/api/src/modules/ingest/services/review-actions.ts`
  - Update the doc comment around line 134-141 to remove the `transfer_links`
    cascade reference. The accurate PR-G1 description is:
    "Transfer-leg rule: restoring one leg of an `acceptTransfer` pair makes it an
    ordinary pending draft. Under PR-G1 a transfer is one merged header; hard-deleting
    that header cascades its postings and nulls both drafts' transaction_id — both
    become orphans simultaneously. Restoring one makes only that draft pending; the
    other remains an orphaned accepted draft until separately restored. Once both are
    restored, `pickTransferPairs` may re-pair them heuristically, exactly like any
    other pending debit/credit pair, only when uniquely matchable."

## Dependencies
- Depends on task 027 + 028 (COMPLETE); main is at v2.8.1.
- New branch from `origin/main`.

## Plan
- P1: Codex plan review of this TASK.md against the actual file content.
- P2: Worker implements both file changes on a new branch.
- P3: Verification worker reads diff, runs typecheck + lint.
- P4: Codex implementation review.
- P5: Commit + push + PR + squash-merge + tag v2.8.2.

## Acceptance Criteria
- AC1: `npm run typecheck` exits 0.
- AC2: `npm run lint` exits 0.
- AC3: `transferLinks` is NOT imported in `imports.ts` (removed from line 13).
- AC4: Lines 871-897 of `imports.ts` (the `survivingPartners` block) are removed;
  no `transfer_links` runtime query remains in `imports.ts`.
- AC5: `review-actions.ts` doc comment no longer says "cascaded away the
  `transfer_links` row"; it accurately describes the postings-model behaviour.
- AC6: No file outside the Scope list is modified.
- AC7: `npm run test -w apps/api` exits 0 (all API tests pass).

## Verification
- T1: Read both modified files directly; confirm changes match scope.
- T2: `npm run typecheck` and `npm run lint` literal output + exit code.
- T3: `npm run test -w apps/api` literal output + exit code.
- T4: `git diff --stat` shows only 2 production files changed.

## Non-Goals
- `legacy-projection.ts` doc comment: Codex review-1 notes that its exclusivity
  claim ("the ONLY module permitted to write legacy transaction columns") is
  pre-existing inaccurate — `imports.ts` still writes `transactions.amountPaise`
  directly around line 660. That discrepancy predates this task and is a separate
  tracked issue; no change to `legacy-projection.ts` here.
- Any database schema change
- Any test changes (these are runtime-code and comment fixes only)
- F9 from task 028 (already resolved by PR-G1 postings-authority update)
