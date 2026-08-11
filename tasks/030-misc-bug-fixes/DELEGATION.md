# Sonnet Worker Delegation — Task 030 misc bug fixes

## Task
030-misc-bug-fixes: Remove dead `survivingPartners` / `transfer_links` block from
`imports.ts` and update two stale comments (imports.ts + review-actions.ts).

## Approved Plan
- P1: Branch from `origin/main` as `fix/030-misc-bug-fixes`.
- P2: Edit `apps/api/src/modules/ingest/services/imports.ts`:
  a. Remove `transferLinks` from the db-schema import at line 13.
     KEEP `or` — it is used elsewhere in the file.
  b. Remove the dead comment block + `survivingPartners` code, lines 871-897
     (from the `// Capture transfer counterparts BEFORE the delete loop:` comment
     through the closing `}` of the `if (ids.length > 0)` block).
  c. Update the `autoLinkTransfers` comment at ~lines 928-930:
     Old: "Rebuild auto transfer links: restored rows may re-form pairs, and the
           ones dropped during reconciliation are gone. Manual links were never touched."
     New: "Corrected transactions restored during rollback may again form eligible
           ordinary pairs — rerun autoLinkTransfers to close those loops."
- P3: Edit `apps/api/src/modules/ingest/services/review-actions.ts`:
  Update the doc comment at ~lines 134-141 (Transfer-leg rule paragraph) to replace
  the stale `transfer_links` cascade description with the accurate PR-G1 description:
  Old paragraph (roughly):
    "Transfer-leg rule: restoring one leg of an `acceptTransfer` pair makes it
     an ordinary pending draft — no stored transfer pairing is resurrected
     (hard-deleting one leg already cascaded away the `transfer_links` row). If
     its partner is also orphaned and later restored, `pickTransferPairs`
     re-pairs them heuristically from `listInbox("pending")`, exactly like any
     other pending debit/credit pair, only when uniquely matchable. If the
     partner's transaction still exists, the partner stays `accepted` and the
     restored leg is reviewed alone as an ordinary draft."
  New paragraph:
    "Transfer-leg rule: restoring one leg of an `acceptTransfer` pair makes it
     an ordinary pending draft. Under PR-G1 a transfer is one merged header;
     hard-deleting that header cascades its postings and nulls both drafts'
     transaction_id — both become orphans simultaneously. Restoring one makes
     only that draft pending; the other remains an orphaned accepted draft until
     separately restored. Once both are restored, `pickTransferPairs` may re-pair
     them heuristically from `listInbox("pending")`, exactly like any other pending
     debit/credit pair, only when uniquely matchable."
- P4: Run `npm run typecheck` and `npm run lint` and report literal output + exit codes.
- P5: Run `npm run test -w apps/api` and report literal output + exit code.
- P6: `git diff --stat` to confirm only 2 files changed.

## Files and Symbols
- `apps/api/src/modules/ingest/services/imports.ts` — lines 13, 871-897, 928-930
- `apps/api/src/modules/ingest/services/review-actions.ts` — lines 134-141

## Must Not Change
- Any file outside the two listed above
- The `or` import from drizzle-orm in `imports.ts` (used elsewhere — do NOT remove)
- The `autoLinkTransfers` call itself at line 930 (keep the call, just update the comment)
- Any test files
- Any schema files

## Acceptance Criteria
- AC1: `npm run typecheck` exits 0
- AC2: `npm run lint` exits 0
- AC3: `transferLinks` not present anywhere in `imports.ts` (grep confirms 0 hits)
- AC4: `survivingPartners` not present anywhere in `imports.ts` (grep confirms 0 hits)
- AC5: `review-actions.ts` doc comment no longer contains "transfer_links" (except
  possibly in the function name `acceptTransfer` — that stays)
- AC6: `npm run test -w apps/api` exits 0
- AC7: `git diff --stat` shows exactly 2 files changed (the two production files)

## Commands
1. `git fetch origin && git checkout -b fix/030-misc-bug-fixes origin/main`
2. Edit `apps/api/src/modules/ingest/services/imports.ts` per P2 above
3. Edit `apps/api/src/modules/ingest/services/review-actions.ts` per P3 above
4. `grep -n "transferLinks\|survivingPartners\|transfer_links" apps/api/src/modules/ingest/services/imports.ts`
   (confirm 0 runtime hits — comments at line 686 referencing the concept are OK)
5. `npm run typecheck`
6. `npm run lint`
7. `npm run test -w apps/api`
8. `git diff --stat`
9. `git diff apps/api/src/modules/ingest/services/imports.ts apps/api/src/modules/ingest/services/review-actions.ts`

## Required Evidence
- Complete diff of both changed files
- Output and exit code of typecheck, lint, and test
- grep output confirming AC3/AC4/AC5
- git diff --stat output
- Any deviations from the plan
