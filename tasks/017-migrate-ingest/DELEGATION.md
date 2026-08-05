# Sonnet Worker Delegation — 017 / roadmap 1.7 (migrate ingest module)

## Task
1.7 — move the ingest domain into `apps/api/src/modules/ingest/`, following the 1.1–1.6 module template,
including splitting the 804-line `services/inbox.ts` into four units. Iteration 1.

**Read `tasks/017-migrate-ingest/TASK.md` in full first** — its Plan (P1–P6), the "inbox.ts split design",
the "Codex review-1 resolution" digest, and "Must NOT change" are the authoritative brief. This file pins
the concrete facts and the required evidence. Where this file and TASK.md agree, follow them; if you find a
genuine conflict or a path that does not resolve, STOP and report it — do not improvise a redesign.

## Approved Plan (TASK.md P1–P6)
Scaffold `modules/ingest/` (plugin.ts, thin schema.ts, routes/, services/, schema.smoke.test.ts,
plugin.test.ts) → move imports/mailboxes/import-reconciliation services (+tests) → split inbox.ts →
move the 3 route files → add the `db/schema.ts` thin re-export line → regenerate route-table snapshot only.
No runtime behaviour change: URLs, handler bodies, SQL, table/column names all invariant.

## Files and Symbols (verified)
### app.ts (exact current state — do not guess)
- Imports at lines 22 (`importRoutes`), 31 (`inboxRoutes`), 32 (`mailboxRoutes`).
- Registrations at lines 130 (`importRoutes`), 139 (`inboxRoutes`), 140 (`mailboxRoutes`).
- Replace those 3 imports with one `import { ingestRoutes } from "./modules/ingest/plugin.ts";` and the 3
  `app.register` calls with a SINGLE `await app.register(ingestRoutes);` at the position `importRoutes`
  occupies today (line 130). Delete the inbox/mailbox import+register lines. Preserve every other
  registration's order and position.

### inbox.ts export → target unit mapping (verified by reading the file)
Split `services/inbox.ts` into four files under `modules/ingest/services/`:
- **inbox-shared.ts** — `toDto`, `INBOX_COLUMNS`, `reload`, `claimPending` (the only helpers used by ≥2
  units). `claimPending` is PRIVATE to transfer-classification per Codex B2 — see below.
- **review-queue.ts** — `listInbox` (102), `listOrphanedAccepts` (133), `pickTransferPairs` (156),
  `historyKey` (195), `pickHistoryCategories` (205), `countPending` (285); private `applyHistoryCategory`.
- **review-actions.ts** — `acceptExtracted` (354), `restoreOrphan` (721), `rejectExtracted` (758),
  `unmatchDuplicate` (792); private `loadOne`, `dtoFromRow` (single-consumer, stay local).
- **transfer-classification.ts** — `acceptTransfer` (450), `RepaymentCandidateSelection` type (522),
  `selectRepaymentCandidate` (536), `acceptRepayment` (587).
- Import edges MUST be acyclic: review-queue → inbox-shared; review-actions → inbox-shared;
  transfer-classification → inbox-shared. `pickTransferPairs` stays in review-queue. Verify NO ES-module
  cycle among the four (a `node --check`/import smoke or typecheck will surface a cycle-by-use, but also
  reason about it structurally).

### Codex B2 — claimPending (do NOT get this wrong)
`claimPending` is the atomic pending→accepted claim used ONLY by `acceptTransfer` (L463 in the current
file) and `acceptRepayment` (L599) — both in transfer-classification. `acceptExtracted` (L362) has its
OWN inline claim and does NOT call the shared helper. So: **do NOT rewrite `acceptExtracted`'s inline
claim to use `claimPending`.** Shared-file (`inbox-shared.ts`) content is exactly `{toDto, INBOX_COLUMNS,
reload}` plus `claimPending`. (TASK.md lists claimPending in inbox-shared because it is used by two
units — transfer + repayment both live in transfer-classification, so if both its callers end up in that
one unit you MAY keep it there instead; either placement is fine as long as it is imported, not
duplicated, and no cycle results. Do not duplicate the body.)

### Module template (follow modules/credit/ exactly)
- `plugin.ts`: `export async function ingestRoutes(app)` registering `importRoutes, inboxRoutes,
  mailboxRoutes` in THAT order (matches current app.ts relative order).
- `schema.ts`: thin named re-export from `../../db/schema.ts` of all 7 tables + 8 enums (importStatus,
  mailboxProvider, mailboxStatus, emailClass, emailIngestStatus, extractedTxnStatus, txnDirection,
  extractedTxnIntent), with the standard comment that `db/schema.ts` does NOT `export *` back.
- `db/schema.ts` gets a NEW thin re-export line for the ingest module per convention — but per Codex B1,
  `db/schema.ts` receives NO other edit and there is NO reverse `export *` from the module. (Match how the
  other modules appear in db/schema.ts — a one-directional re-export line only.)
- `schema.smoke.test.ts`: object identity for 7 tables + 8 enums, plus `db.query.<table>` accessor checks;
  document that `import_rows` has NO relation accessor (skip only that one).
- `plugin.test.ts`: one representative route per route file via `hasRoute()`/introspection.

### Path-adjustment rule (Codex B3)
- From `modules/ingest/services/`: core db → `../../../db`, lib → `../../../lib`; ingest-owned tables via
  `../schema.ts`; sibling modules `../../ledger`, `../../investments`; intra-module `./x.ts`;
  `../../../services/periods.ts` for the flat period util.
- From `modules/ingest/routes/`: lib → `../../../lib`, jobs → `../../../jobs`, services → `../services`.
- Preserve the multipart `app.post` special-case in the imports route verbatim.
- `enqueueIngestorRun` re-points to the jobs layer.
- **Typecheck is the final path gate** — a wrong specifier must surface as a typecheck error, not be
  papered over.

## Required Changes
Execute TASK.md P1 → P6 in order. New files under `modules/ingest/`, moved files with path-adjusted
imports only, the four-way inbox split, app.ts single-registration swap, db/schema.ts thin re-export,
smoke+plugin tests, and regenerate `route-table.snapshot.txt` ONLY.

## Must NOT Change
- Any table or column NAME (breaks `apps/ingestor` + `apps/extractor` raw SQL).
- The `email.extract` / `ingestor.run` BullMQ queue contracts.
- Any (method, URL) — `route-surface.snapshot.txt` MUST stay byte-identical (compare, never regenerate it).
- Handler bodies / SQL / cache keys. The `ledger.mutated` emit on inbox accept/repayment/transfer stays.
- Public signatures of every exported inbox function.
- Cross-module imports stay DIRECT (path-adjusted only). Do NOT replace them with ports (1.9's job). Do
  NOT "fix" the `isUniqueViolation` import from `modules/investments/services/sip-lifecycle.ts`.
- Do NOT rewrite `acceptExtracted`'s inline claim (B2 above).
- Do NOT split `inbox.test.ts` — move it whole to `modules/ingest/services/inbox.test.ts` with re-pointed
  imports (incl. `../../../services/periods.ts`).
- Do NOT generate any DB migration.

## Acceptance Criteria (TASK.md AC1–AC7)
AC1 snapshots+no-migration-diff+backup.test green; AC2 inbox split into review-queue/state-machine/
classification units; AC3 ingestor+extractor still typecheck and pass; AC4 queue contracts untouched;
AC5 inbox accept still emits `ledger.mutated`; AC6 typecheck+lint+test green all workspaces; AC7
auth/config.public/demo-403/CSRF/rate-limit survive encapsulation.

## Commands (run and capture literal output + exit codes)
1. `npm run typecheck` (root, all workspaces) — exit 0.
2. `npm run lint` (root) — exit 0.
3. `npm run test -w apps/api` — capture pass/fail counts + exit code (note baseline was 848; new smoke +
   plugin tests raise it — reconcile the delta, do not round).
4. `npm run test -w apps/ingestor` and `npm run test -w apps/extractor` — capture literal output (the
   extractor DATABASE_URL packaging gap is a known pre-existing waiver; any OTHER failure is real).
5. `npm run db:generate` — expect "No schema changes, nothing to migrate"; confirm no new file in
   `apps/api/drizzle/`.
6. Compare `apps/api/src/route-surface.snapshot.txt` to git HEAD — MUST be byte-identical (show the
   `git diff --stat` / sha256). Regenerate `route-table.snapshot.txt` and show its diff is pure re-nesting
   (no added/removed/renamed method+path).
7. `grep -rn` in `apps/ingestor` + `apps/extractor` for the ingest table names — show they are unchanged.

## Required Evidence
- full `git status --short` (all moved/new/modified files) + a note that git detected the moves as renames.
- complete diff, readable per file (moved production files must be import-line-only where claimed).
- every command's exact invocation, literal output, counts, and exit code.
- explicit confirmation: route-surface byte-identical; no migration generated; ingestor/extractor tests
  status; the four inbox units and their acyclic import edges; the single app.ts ingest registration.
- any plan deviation, unresolved import specifier, or blocker reported literally — a material design
  change returns to the coordinator, it is NOT applied unilaterally.
