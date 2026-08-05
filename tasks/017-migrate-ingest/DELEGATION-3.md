# Sonnet Worker Delegation — 017 / roadmap 1.7 — ITERATION 3 (test-fix, G1.2 only)

## Context
Codex review-3 found ONE valid Moderate finding in the iteration-2 test file: G1.2's "no-write" assertion is
vacuous. The demo-403 is genuine, but the test posts a RANDOM nonexistent draft/account to a fresh user and
asserts `extracted_transactions` stays 0 — which proves nothing, because `acceptExtracted` MUTATES an
existing pending draft (pending→accepted, sets `transactionId`) and inserts into the ledger `transactions`
table; it does NOT insert an `extracted_transactions` row, and with a nonexistent draft there's nothing to
mutate (the handler would 404 even without the demo guard). This iteration strengthens G1.2 ONLY.

## File you may edit
- EDIT ONLY `apps/api/src/modules/ingest/routes/ingest.route.test.ts`, and ONLY the `G1.2` test (the one at
  ~line 274, "a demo session's POST /api/inbox/:id/accept is rejected 403, and no extracted_transactions
  row is written"). Do NOT touch any other test, helper, or the harness (beyond what G1.2 needs), and NO
  production file.

## Required change (implements Codex review-3's prescription verbatim)
Rewrite G1.2 so it proves an OTHERWISE-SUCCESSFUL mutation was blocked by the demo guard:
1. Create the user, then create a REAL `demo: true` session for that user.
2. Seed a real account (`createAccount`), ingestion (`createIngestion`), and a real PENDING draft
   (`createDraft`) for that user — the same helpers G2.1 uses.
3. Precondition asserts: the seeded draft row is `status: "pending"` with `transactionId` null, AND there is
   no ledger `transactions` row for this user.
4. POST `/api/inbox/${draftId}/accept` as the demo session with a VALID body `acceptBody(accountId)` (real
   draftId + accountId — a request that WOULD succeed for a non-demo user).
5. Assert `res.statusCode === 403`.
6. Postcondition asserts (the meaningful no-mutation proof): re-query the draft by id and assert it is STILL
   `status: "pending"` with `transactionId` null, AND assert there is still no `transactions` row for the
   user. (Query `extractedTransactions` by `eq(extractedTransactions.id, draftId)` for the draft, and
   `transactions` by `eq(transactions.userId, userId)` for the ledger.)
7. Register `t.after` cleanup (destroySession + cleanupUser) — and, per Codex's minor note, register it
   immediately after creating the user/fixtures so a mid-setup failure still cleans up.

Keep the test title accurate (it may mention the draft stays pending and no ledger row is written). `transactions` and `extractedTransactions` are already imported in this file; reuse existing helpers.

## Must NOT change
- No production file. No other test. No harness change beyond G1.2's needs. Do not weaken any other
  assertion. Keep the file lint-clean and typecheck-clean.

## Commands (capture literal output + exit codes)
1. `node --env-file-if-exists=../../.env --test src/modules/ingest/routes/ingest.route.test.ts` from
   `apps/api` — all tests PASS incl. the strengthened G1.2; show counts (expect 11 pass).
2. `npm run test -w apps/api` — report counts + exit code (still 869 total / 868 pass / 1 skip; the count
   doesn't change since G1.2 is edited, not added).
3. `npm run typecheck` (root) — exit 0.
4. `npm run lint` (root) — exit 0.

## Required Evidence
- `git status --short` (only `ingest.route.test.ts` changed) + the complete diff of the G1.2 change.
- each command's exact invocation, literal output, counts, exit codes.
- explicitly confirm the strengthened G1.2 now: drives a VALID accept as a demo user, gets 403, and proves
  the draft stayed pending (transactionId null) with no ledger transaction written.
- any blocker reported literally. Do NOT commit.
