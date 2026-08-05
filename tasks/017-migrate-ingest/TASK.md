# Task: 017-migrate-ingest (roadmap 1.7)

## Status
COMPLETE (not committed). All plan items P1-P6 implemented; AC1-AC7 all proven; Codex reviewed both the
production migration (review-2) and the tests (review-3); every finding resolved (6 plan findings + 2
test-coverage gaps + the G1.2 vacuous-assertion fix); all four deviations D1-D4 correct; no unapproved
changes. Final coherent-tree independent verification (uninvolved worker): typecheck 0, lint 0, apps/api 869
(868 pass + 1 skip), ingestor 12/12, extractor known DATABASE_URL waiver, route-surface byte-identical
`a368d4eb…`, route-table pure re-nesting 283/283, `db:generate` zero diff. G1.2 strengthened per Codex
review-3 (seeds a real pending draft, drives a VALID demo accept → 403, proves the draft stays pending with
no ledger transaction) and coordinator-confirmed by direct read; 11/11 ingest route tests pass. Commit awaits
an explicit user request + a coordinator-chosen file list.
History — VERIFYING (final): test iteration 2 landed: `modules/ingest/routes/ingest.route.test.ts`, 11 tests,
all pass; coordinator read the whole file and confirmed every test is genuine (drives real requests through the
ENCAPSULATED ingestRoutes plugin, not bare routes; G2 seeds real fixtures + observes real events). G1 closes
AC7 (401/demo-403+no-write/CSRF-403/no-config.public/bucket-classification); G2 drove ALL FIVE ledger.mutated
sites to a real success+observed emit (none flagged). `bucketFor` needed no production edit (already exported
via `_test`). Full apps/api 869 (868 pass + 1 skip), typecheck 0, lint 0. Final independent verification
(different worker) + Codex review of the new tests in progress; then COMPLETE.
Prior: CODE_REVIEW → IMPLEMENTING (test-only iteration 2). Migration PRODUCTION side fully verified sound
(independent verification: all 11 items PASS incl. all four deviations D1-D4, 853→858 count reconciled
exactly, route-surface byte-identical, route-table pure re-nesting 283/283, table names unchanged, 5 emits
preserved). Codex implementation review (review-2.md) found NO runtime regression but two TEST-COVERAGE
gaps — AC7 encapsulation-security tests and AC5 route-level emit assertions — BOTH valid and BOTH my own
coordination error (see "Codex review-2 disposition"). Returned to implementation for a test-only
iteration; production files are done and must NOT change. Also: the coherent-tree lint is currently red
solely from the concurrent 1.10 file (storage.test.ts `no-useless-assignment`), fixed under 019 iteration
3 — 017's AC6 lint gate clears once that lands.
Codex plan review (review-1.md) returned 6 BLOCKING findings, all validated against source by
coordinator and all genuine (3 were errors in my plan, 3 were gaps). Every correction below is Codex's own
prescribed resolution, applied verbatim; no residual design disagreement, so no second plan-review round.

## Codex review-1 resolution (digest — do not re-read review-1.md)
- B1 reverse re-export: FIXED — `db/schema.ts` gets NO edit; one-way `modules/ingest/schema.ts` →
  `../../db/schema.ts` only (planning F2 convention). Scope + P5 corrected.
- B2 claimPending: FIXED — private to `transfer-classification.ts` (only acceptTransfer L463 + acceptRepayment
  L599 call it; acceptExtracted L362 has its own inline claim). Do NOT rewrite acceptExtracted. Shared file =
  {toDto, INBOX_COLUMNS, reload} only.
- B3 paths: FIXED — from services/: `../../../db`, `../../../lib`; ingest-owned tables via `../schema.ts`;
  siblings `../../ledger`, `../../investments`. From routes/: `../../../lib`, `../../../jobs`, `../services`.
  Typecheck is the final gate.
- B4 AC7: FIXED — added concrete T6 (401 unauth, no config.public added, demo-write 403, hostile-Origin CSRF
  403, READ/WRITE rate-limit bucket classification).
- B5 snapshots: FIXED — T1 never regenerates route-surface; compares actual surface byte-identical to the
  committed baseline; regenerates only route-table and justifies its diff.
- B6 events: FIXED — AC5 now covers all 5 emit sites (inbox accept/repayment/transfer, import commit/rollback)
  with route-level assertions.
- Non-blocking applied: route imports = 9 (not 8); T4 verifies queue payload shapes not just names; smoke
  test asserts SQL names + db.query accessors, documenting only importRows lacks one. inbox.test.ts unsplit —
  Codex concurred.

## Objective
Move the ingest domain (routes imports/inbox/mailboxes + their services and tests) into
`apps/api/src/modules/ingest/`, following the 1.1–1.6 module template (`plugin.ts`, thin-re-export
`schema.ts`, `routes/`, `services/`, `schema.smoke.test.ts`, `plugin.test.ts`). **No runtime behaviour
change**: URLs, handler bodies, SQL, table/column names all invariant. The one substantive refactor is
splitting the 804-line `services/inbox.ts` into three units. External `apps/ingestor` + `apps/extractor`
raw SQL must keep working unchanged.

## Root Cause
Not a defect — roadmap task 1.7, seventh of eight Phase-1 module migrations (1.1–1.6 done).

## Scope
- New: `apps/api/src/modules/ingest/` (plugin.ts, schema.ts, routes/, services/, tests).
- Move routes: `routes/{imports,inbox,mailboxes}.ts` → `modules/ingest/routes/`.
- Move services: `services/{imports,inbox,mailboxes,import-reconciliation}.ts` (+ colocated tests) →
  `modules/ingest/services/`, with `inbox.ts` split (below).
- Tables (thin re-export only; physical decomposition deferred to 1.9): imports, import_rows,
  import_presets, mailbox_accounts, mailbox_credentials, email_ingestions, extracted_transactions.
- Edit `app.ts`: replace the 3 flat route registrations with one `ingestRoutes` plugin registration,
  preserving relative order.
- Add thin re-export in `db/schema.ts` per the convention (barrel must NOT `export *` back — see F2 in 1.5).

## Must NOT change
- Any table name or column name (breaks apps/ingestor + apps/extractor raw SQL).
- The `email.extract` / `ingestor.run` BullMQ queue contracts.
- Any (method, URL) — route-surface snapshot must be byte-identical.
- Handler bodies / SQL / cache keys. The `ledger.mutated` emit on inbox accept/repayment/transfer stays.
- Cross-module imports stay direct (path-adjusted only); replacing them with ports is 1.9's job. Do NOT
  "fix" the odd `isUniqueViolation` import from `modules/investments/services/sip-lifecycle.ts`.

## inbox.ts split design (coordinator decision — for Codex review)
804-line `services/inbox.ts` → four files under `modules/ingest/services/`:
- **`inbox-shared.ts`** (cross-unit helpers): `toDto`, `INBOX_COLUMNS`, `reload`, `claimPending`. These
  are the only helpers used by ≥2 of the three units; a dedicated file avoids an actions↔classification
  import web and any cycle. (`claimPending` is the atomic pending→accepted claim used by accept +
  transfer + repayment; `reload` rebuilds the DTO post-mutate for the same three.)
- **`review-queue.ts`** (review-queue CRUD + prefill): `listInbox`, `listOrphanedAccepts`, `countPending`,
  `pickTransferPairs`, `historyKey`, `pickHistoryCategories`; private `applyHistoryCategory`.
- **`review-actions.ts`** (state machine): `acceptExtracted`, `restoreOrphan`, `rejectExtracted`,
  `unmatchDuplicate`; private `loadOne`, `dtoFromRow` (single-consumer, stay local).
- **`transfer-classification.ts`** (transfer/repayment classification): `acceptTransfer`,
  `RepaymentCandidateSelection`, `selectRepaymentCandidate`, `acceptRepayment`.
- Import edges (must be acyclic): review-queue → inbox-shared; review-actions → inbox-shared;
  transfer-classification → inbox-shared. `pickTransferPairs` stays in review-queue (its only consumer is
  `listInbox`), so no cross-unit edge for it. Verify no ES-module cycle among the four.
- The route `routes/inbox.ts` re-points its 8 service imports to whichever unit now exports each function;
  handler bodies otherwise unchanged. Public signatures of all 9 exported functions preserved.
- **`inbox.test.ts` stays a single file**, moved to `modules/ingest/services/inbox.test.ts`, imports
  re-pointed to the unit files. NOT split: it is 1767 lines of concurrency/atomicity characterization
  tests (two-connection contention, guarded-UPDATE races) with shared fixtures; splitting forces fixture
  extraction and risks silently altering coverage during a no-behaviour-change migration. Test-file
  decomposition is a defensible follow-up, out of scope for 1.7. (Flagged for Codex.)

## Plan (finalized against investigation-1)
- P1: scaffold `modules/ingest/` — `plugin.ts` (`ingestRoutes`) registering importRoutes, inboxRoutes,
  mailboxRoutes in that order; thin `schema.ts` re-exporting all 7 tables + 8 enums (importStatus,
  mailboxProvider, mailboxStatus, emailClass, emailIngestStatus, extractedTxnStatus, txnDirection,
  extractedTxnIntent), with the standard comment that `db/schema.ts` does NOT `export *` back.
- P2: move `imports.ts`, `mailboxes.ts`, `import-reconciliation.ts` (+ imports.test.ts,
  import-reconciliation.test.ts) into `modules/ingest/services/`; path-adjust every import
  (`../db/schema.ts`→`../../db/schema.ts`, `../modules/ledger/...`→`../../ledger/...`, `../lib/...`→
  `../../lib/...`, `./import-reconciliation.ts` stays intra-module). Preserve the multipart `app.post`
  special-case in the imports route verbatim.
- P3: split `inbox.ts` into `inbox-shared.ts` + review-queue/review-actions/transfer-classification per the
  design above; move `inbox.test.ts` whole with re-pointed imports (incl. `../../../services/periods.ts`).
- P4: move the 3 route files into `modules/ingest/routes/`; re-point service imports to the new units and
  `enqueueIngestorRun` to the jobs layer; in `app.ts` replace the three flat registrations (positions 4,
  13, 14) with one `await app.register(ingestRoutes)` at position 4.
- P5: add the `db/schema.ts` thin re-export line per convention; add `schema.smoke.test.ts` (object
  identity for 7 tables + 8 enums; skip `db.query` check for `import_rows` — it has no relation accessor)
  and `plugin.test.ts` (one representative route per file) from the module template.
- P6: regenerate `route-table.snapshot.txt` only (route-surface must be byte-identical); regenerate no
  migrations.

## Acceptance Criteria (from tasks/01.07-migrate-ingest.md)
- AC1: Route snapshot (surface + table) unchanged; no migration diff; `backup.test.ts` green.
- AC2: `inbox.ts` split into review-queue, state-machine, and classification units.
- AC3: `apps/ingestor` and `apps/extractor` still typecheck and their tests still pass.
- AC4: `email.extract` / `ingestor.run` queue contracts untouched.
- AC5: Accepting an inbox draft still emits `ledger.mutated`.
- AC6: typecheck + lint + test green (all workspaces).
- AC7 (roadmap note): auth requirement, `config.public`, demo-write 403, CSRF/rate-limit classification
  each separately verified to survive plugin encapsulation — not assumed from the route snapshot alone.

## Verification (independent worker, read-only)
- T1: regenerate route-surface + route-table snapshots; assert no diff.
- T2: `db:generate` produces no new migration; content-hash manifest of drizzle/ unchanged.
- T3: full `npm run typecheck`, `npm run lint`, `npm run test` — literal output + exit codes.
- T4: grep-prove apps/ingestor + apps/extractor SQL references unchanged table/column names; run their tests.
- T5: schema.smoke.test object-identity for the 7 ingest tables.

## Non-Goals
- Physical schema relocation of ingest tables (1.9).
- Replacing cross-module imports with ports (1.9).
- Any Phase-2 postings/transfer_links change.

## Dependencies
- 1.1 (done). Sequenced before 1.8 (shares app.ts + db/schema.ts edits).

## Implementation deviations (iteration 1) — coordinator disposition
The worker flagged four deviations and did NOT unilaterally redesign. Coordinator review:
- **D1 (db/schema.ts NOT edited) — SIGNED OFF; my delegation was wrong.** The DELEGATION top-level said
  "add ONE thin re-export line to db/schema.ts," which contradicted TASK.md's own authoritative Codex-B1
  resolution ("db/schema.ts gets NO edit; one-way modules/ingest/schema.ts → ../../db/schema.ts only").
  Verified myself: `grep` over `db/schema.ts` finds NO `modules/ingest`, no `export *`, no module
  reference — consistent with all six prior migrations and the post-1.5 state (planning's `export *` was
  removed by 1.5). db/schema.ts must stay untouched; the module's schema.ts re-exports one-way FROM it.
  The worker followed the correct convention.
- **D2 (3 inbound consumers repointed: routes/auth.ts, modules/automation/routes/ai.ts,
  modules/credit/routes/cards.ts) — SIGNED OFF; my delegation omitted them.** All three import
  `mailboxSecret` from the moved `services/mailboxes.ts`; the move breaks their paths, so a single-line
  specifier update in each is mechanically necessary or typecheck fails. Verified the three new specifiers
  resolve correctly to `modules/ingest/services/mailboxes.ts` (exported at :22). Minimal, import-line-only,
  no logic. Verifier to confirm each diff is exactly one line.
- **D3 (`historyKey` ` ` separator) — PENDING verifier.** The worker's first Write transiently turned
  the intended 6-char ` ` escape text into a literal NUL byte, says it caught and fixed it. Verifier
  must prove the final `review-queue.ts` contains the literal ` ` text byte-identical to the original
  `services/inbox.ts` (od/hexdump the line), and the inbox split's 21/21 byte-identity holds.
- **D4 (schema.smoke.test includes `db.query.importRows`) — ACCEPTED as a strengthening, PENDING verifier
  confirmation.** DELEGATION said skip `importRows` (Codex review-1 non-blocking note claimed it lacks a
  relation accessor). The worker empirically found `db.query.importRows` DOES exist and `services/imports.ts`
  calls `db.query.importRows.findMany`, so it asserted all 7. If true, more complete = fine. Verifier must
  confirm `db.query.importRows` exists on a constructed Drizzle instance and the smoke test passes.

## Baseline correction
The DELEGATION cited an apps/api baseline of 848 (task 1.5's final count). The worker measured the true
HEAD baseline via a clean `git worktree --detach HEAD` at **853** (848 pre-dated the 1.6 automation merge,
which added tests). 853 + 4 new (3 schema-smoke + 1 plugin) + 1 unrelated 019 storage skip = **858**.
Independent verifier reproduced this: detached-worktree baseline **853/853**, current **858** (857 pass +
1 storage skip), arithmetic exact. CONFIRMED.

## Codex review-2 disposition (implementation review of iteration 1)
Codex confirmed the migration is sound: no changed handler/SQL/ownership filter/cache key/table name/queue
contract; inbox split 21/21 byte-identical; db/schema.ts untouched; all four deviations correct. It raised
TWO acceptance gaps, BOTH test-coverage, BOTH valid, BOTH my coordination error:
- **G1 (AC7 not genuinely tested) — VALID, ACCEPTED.** plugin.test.ts is `hasRoute()` introspection only;
  there is no ingest test for 401-unauth, `config.public` absence, demo-write 403, hostile-Origin CSRF
  403, or READ/WRITE rate-limit classification. The batch charter (BATCH-phase1-close.md) requires each
  1.x task to separately verify these survive plugin encapsulation, and my review-1 digest recorded B4 as
  "added concrete T6" — but I never wrote T6 into the Plan/Verification/AC body, so the worker (following
  P1-P6) correctly didn't add it. My propagation error.
- **G2 (AC5's 5 route-level emit assertions absent) — VALID, ACCEPTED.** The 5 `app.eventBus.emit(
  "ledger.mutated", …)` sites are byte-identical (verified), but no runtime test proves they still fire
  after encapsulation. My review-1 digest recorded B6 as "AC5 now covers all 5 emit sites with route-level
  assertions" — again never propagated into the plan body.
- Both are "verification/test-coverage blockers, not runtime regressions" (Codex's own framing), matched by
  the independent verifier. Fix = test-only iteration 2; no production file changes.

## Codex review-3 disposition (review of iteration-2 tests)
Codex confirmed the tests are genuine through the real encapsulated plugin boundary: **G2/AC5 fully and
genuinely closed for all 5 emit sites** (each would fail if its emit were removed — no spies/fabrication);
G1.1/1.1b (401), G1.3 (CSRF-403 via a non-demo session, so it can't pass on auth/demo), G1.4 (config.public
absence via onRoute over all 3 route files), G1.5 (real exported bucketFor) all genuine; no production change
smuggled in. ONE valid Moderate finding:
- **G1.2's no-write assertion is VACUOUS — VALID, ACCEPTED → test-fix iteration 3.** The demo-403 itself is
  genuine, but the test posts a RANDOM nonexistent draft/account to a fresh user and asserts
  `extracted_transactions` stays 0. Confirmed against code: `acceptExtracted` MUTATES an existing pending
  draft (pending→accepted, sets transactionId) and inserts into the ledger `transactions` table — it does
  NOT insert an `extracted_transactions` row, and with a nonexistent draft there is nothing to mutate. So
  0→0 proves nothing about a prevented write (even without the guard the handler would 404). Unlike the
  planning precedent, whose route CREATES the asserted row. FIX: seed a real account + ingestion + pending
  draft for the demo user, POST a VALID accept, assert 403, then assert the draft is still `pending` with
  `transactionId` null AND no ledger `transactions` row exists for the user — proving an otherwise-successful
  mutation was blocked. Test-only, G1.2 only.
- Minor (non-blocking, matches precedent): G2 registers `t.after` cleanup after fixture construction, so a
  setup failure before registration could leak fixtures. Same as the planning harness; optional to tighten
  for the G1.2 test being edited, not required elsewhere.

## Verification (test iteration 2) — added, closing G1/G2
- T6 (AC7): a new `modules/ingest/routes/ingest.route.test.ts` on the `planning.route.test.ts`
  `buildTestApp()` harness (real PG+Redis, setupAuth+setupSecurity, register the whole `ingestRoutes`
  plugin, NOT buildApp/startJobs) asserting on encapsulated ingest routes: (a) unauthenticated write → 401;
  (b) demo session write → 403 AND no row written; (c) hostile `Origin` on a write → CSRF 403; (d) no
  ingest route carries `config.public` (introspection over the registered routes); (e) READ/WRITE bucket
  classification for a GET vs a POST ingest path via the security plugin's `bucketFor` (test it directly if
  exportable; else assert method-based classification through an injected request path).
- T7 (AC5/G2): at least one route-level test that drives a REAL successful ingest mutation through the
  encapsulated `ingestRoutes` plugin and asserts `ledger.mutated` was emitted on `app.eventBus` (proves
  the emit survives encapsulation — the specific B6 risk the byte-identity proof cannot show). Attempt all
  five sites (inbox accept/repayment/transfer, import commit/rollback) with minimal real fixtures; for any
  site whose success path needs disproportionate domain fixtures, the implementer must FLAG it with a
  written justification for coordinator reassessment and still assert the emit line's presence — never fake
  a success. The 5 emit lines' byte-identical presence is already proven by verification; T7 adds the
  runtime encapsulation-survival proof.
