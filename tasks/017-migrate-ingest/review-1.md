## Plan review

### BLOCKING — The planned relative paths are wrong at the new directory depth

Several concrete path rewrites in P2–P4 would not resolve.

From `modules/ingest/services/*.ts`:

- `../../../db/index.ts`, not `../../db/index.ts`
- `../../../db/schema.ts`, not `../../db/schema.ts`
- `../../../lib/*.ts`, not `../../lib/*.ts`
- `../../ledger/...` and `../../investments/...` are correct
- Ingest-owned tables should preferably come from `../schema.ts`, following the template’s module-boundary convention.

The present imports that need adjustment are visible in [imports.ts](/home/udai/PennyPilot/apps/api/src/services/imports.ts:12), [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:9), and [mailboxes.ts](/home/udai/PennyPilot/apps/api/src/services/mailboxes.ts:7). The plan’s incorrect examples are at [TASK.md](/home/udai/PennyPilot/tasks/017-migrate-ingest/TASK.md:65).

From `modules/ingest/routes/*.ts`:

- `../../../lib/errors.ts`, not `../../lib/errors.ts`
- `../../../jobs/index.ts`, not `../../jobs/index.ts`
- `../services/...` is correct.

The current source locations are [routes/imports.ts](/home/udai/PennyPilot/apps/api/src/routes/imports.ts:13) and [routes/mailboxes.ts](/home/udai/PennyPilot/apps/api/src/routes/mailboxes.ts:18). P4 does not state the exact corrected paths and the investigation explicitly proposes the wrong `../../jobs/index.ts`.

Test paths require the same care. For the moved `inbox.test.ts`, these are correct:

- `../../../db/index.ts`
- `../../../infra/db.ts`
- `../../../db/schema.ts` or `../schema.ts` for ingest-owned objects
- `../../../lib/errors.ts`
- `../../../services/periods.ts`
- `../../ledger/services/{transactions,transfers}.ts`

The existing imports are collected at [inbox.test.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.test.ts:7).

### BLOCKING — The `db/schema.ts` reverse-re-export step contradicts the reference template and would risk an ESM cycle

The plan twice says to add a “thin re-export” line to `db/schema.ts`: [TASK.md](/home/udai/PennyPilot/tasks/017-migrate-ingest/TASK.md:27) and [TASK.md](/home/udai/PennyPilot/tasks/017-migrate-ingest/TASK.md:75). That is not the established convention.

The correct arrangement is one-way:

```text
modules/ingest/schema.ts → ../../db/schema.ts
```

`db/schema.ts` must not import or re-export from `modules/ingest/schema.ts`. The planning template explicitly says the reverse direction would create a pointless cycle at [planning/schema.ts](/home/udai/PennyPilot/apps/api/src/modules/planning/schema.ts:20), and its actual named re-export is at [planning/schema.ts](/home/udai/PennyPilot/apps/api/src/modules/planning/schema.ts:24).

P1 states the correct rule at [TASK.md](/home/udai/PennyPilot/tasks/017-migrate-ingest/TASK.md:61), so Scope/P5 must be corrected to say that `db/schema.ts` receives no re-export edit. Physical definitions remain exactly where they are.

### BLOCKING — `claimPending` is not a cross-unit helper in the proposed split unless SQL is refactored

The plan claims that `claimPending` is used by ordinary accept, transfer, and repayment at [TASK.md](/home/udai/PennyPilot/tasks/017-migrate-ingest/TASK.md:39). Actual code differs:

- `acceptExtracted` performs its own guarded update and returns only `bankRef` and `occurredAtTs`: [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:362).
- `claimPending` is a separate helper at [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:417).
- It is called only by `acceptTransfer` and `acceptRepayment`: [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:463) and [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:599).

Because both consumers are assigned to `transfer-classification.ts`, `claimPending` belongs privately in that file. Making `acceptExtracted` use it would change the SQL/`RETURNING` shape and consolidate two deliberately distinct error/claim implementations. That violates the plan’s “handler bodies / SQL invariant” rule at [TASK.md](/home/udai/PennyPilot/tasks/017-migrate-ingest/TASK.md:29).

The split should therefore be:

- `inbox-shared.ts`: `toDto`, `INBOX_COLUMNS`, `reload`
- `review-queue.ts`: queue functions and private `applyHistoryCategory`
- `review-actions.ts`: state-machine functions plus private `loadOne` and `dtoFromRow`
- `transfer-classification.ts`: transfer/repayment functions plus private `claimPending`

Alternatively, keep `claimPending` exported from the shared file but do not claim it is cross-unit and do not rewrite `acceptExtracted`; that is needlessly broad internal surface, however.

### BLOCKING — AC7 is stated but has no executable verification scope

The roadmap-wide requirement says each module migration must separately verify auth, `config.public`, demo-write protection, and CSRF/rate-limit classification; see [tasks/README.md](/home/udai/PennyPilot/tasks/README.md:263). The plan repeats that requirement at [TASK.md](/home/udai/PennyPilot/tasks/017-migrate-ingest/TASK.md:88), but P1–P6 and T1–T5 contain no corresponding test or explicit inspection procedure.

The route snapshots cannot satisfy it. Their own documentation says they do not cover handler identity, schemas, auth/security hooks, body limits, or response behavior: [app.route-snapshot.test.ts](/home/udai/PennyPilot/apps/api/src/app.route-snapshot.test.ts:17).

Add focused acceptance verification covering at least:

- An unauthenticated ingest route returns 401.
- Ingest routes retain private metadata—none gains `config.public: true`.
- A demo session’s representative ingest write returns 403 before mutation.
- A mutating ingest request with a hostile `Origin` receives the CSRF 403.
- Representative GET and mutating ingest routes classify into READ and WRITE rate-limit buckets.

The underlying policies are method/config based at [auth.ts](/home/udai/PennyPilot/apps/api/src/plugins/auth.ts:36) and [security.ts](/home/udai/PennyPilot/apps/api/src/plugins/security.ts:22), and the root hooks are installed before route registration at [app.ts](/home/udai/PennyPilot/apps/api/src/app.ts:174). That makes preservation likely, but the explicit roadmap requirement says it must be verified, not inferred.

### BLOCKING — Snapshot instructions conflict and could mask a real route-surface regression

P6 correctly says only `route-table.snapshot.txt` should be regenerated and the canonical surface must remain identical: [TASK.md](/home/udai/PennyPilot/tasks/017-migrate-ingest/TASK.md:78). T1 then says to regenerate both snapshots: [TASK.md](/home/udai/PennyPilot/tasks/017-migrate-ingest/TASK.md:91).

Do not regenerate `route-surface.snapshot.txt`. It is a fixed baseline and the test explicitly says it “is never regenerated” across module migrations: [app.route-snapshot.test.ts](/home/udai/PennyPilot/apps/api/src/app.route-snapshot.test.ts:22). T1 should instead say:

- Generate the actual canonical surface into temporary/output-only comparison data and prove it is byte-identical to the committed snapshot.
- Regenerate only `route-table.snapshot.txt`, inspect and justify its nesting/order diff.

### BLOCKING — Event preservation criteria are incomplete

The actual routes emit `ledger.mutated` from five ingest mutations:

- Inbox accept: [routes/inbox.ts](/home/udai/PennyPilot/apps/api/src/routes/inbox.ts:63)
- Repayment: [routes/inbox.ts](/home/udai/PennyPilot/apps/api/src/routes/inbox.ts:79)
- Transfer: [routes/inbox.ts](/home/udai/PennyPilot/apps/api/src/routes/inbox.ts:94)
- Import commit: [routes/imports.ts](/home/udai/PennyPilot/apps/api/src/routes/imports.ts:110)
- Import rollback: [routes/imports.ts](/home/udai/PennyPilot/apps/api/src/routes/imports.ts:120)

The prose says these handler bodies should remain unchanged, but AC5 checks only ordinary inbox acceptance at [TASK.md](/home/udai/PennyPilot/tasks/017-migrate-ingest/TASK.md:86). For a zero-behavior-change split, acceptance criteria should explicitly cover all five emit sites, ideally with route-level spies/assertions. A route snapshot cannot detect a dropped emit.

## Split assessment

### NON-BLOCKING — The remaining helper assignments are correct

Apart from `claimPending`, the proposed assignments match actual use:

- `toDto` is needed by queue reads, shared `reload`, and actions-local `dtoFromRow`: [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:33), [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:113), [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:309), [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:334).
- `INBOX_COLUMNS` is needed by queue reads and `reload`: [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:80), [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:108), [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:304).
- `reload` is used by both review actions and transfer classification: [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:409), [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:518), [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:696), [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:803).
- `loadOne` is only used by `unmatchDuplicate`: [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:293), [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:797).
- `dtoFromRow` is used only by `restoreOrphan` and `rejectExtracted`, both in review actions: [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:322), [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:741), [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:784).
- `applyHistoryCategory` belongs privately in `review-queue.ts`: [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:116), [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:243).

### NON-BLOCKING — `pickTransferPairs` does not create a module cycle

`pickTransferPairs` is called only by `listInbox`: [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:117). Its other appearances are tests and comments. Keeping it in `review-queue.ts` creates no edge from review actions or transfer classification.

Both `pickTransferPairs` and repayment classification need `TRANSFER_WINDOW_DAYS`, but each can import it directly from the ledger transfer service. Current uses are at [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:164) and [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:637). There is no need for `review-queue.ts` and `transfer-classification.ts` to import one another.

With `claimPending` private to classification, the internal graph is straightforward and acyclic:

```text
review-queue ───────────────→ inbox-shared
review-actions ─────────────→ inbox-shared
transfer-classification ────→ inbox-shared

all three may independently import ledger/investments services
```

### NON-BLOCKING — The plan miscounts route imports and understates the public exported surface

The inbox route imports nine service functions, not eight: [routes/inbox.ts](/home/udai/PennyPilot/apps/api/src/routes/inbox.ts:12). The plan says “8 service imports” and then “all 9 exported functions” at [TASK.md](/home/udai/PennyPilot/tasks/017-migrate-ingest/TASK.md:52).

Also, the current service exports more than those nine route-facing functions: `pickTransferPairs`, `historyKey`, `pickHistoryCategories`, `RepaymentCandidateSelection`, and `selectRepaymentCandidate` are exported for tests/other consumers. Examples are [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:156), [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:195), [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:205), and [inbox.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:522). The split assignments do preserve them, so this is documentation correction rather than a design blocker.

## Runtime and route behavior

### NON-BLOCKING — Collapsing the registrations changes registration structure and order, but no concrete runtime behavior is presently apparent

The current order is imports at position 4, with inbox and mailboxes last: [app.ts](/home/udai/PennyPilot/apps/api/src/app.ts:126). The proposed plugin registers imports, inbox, then mailboxes contiguously at position 4. Thus inbox/mailboxes genuinely move earlier relative to planning, notification, investments, credit, protection, backup, automation, and profile.

That will change the raw `printRoutes()` tree and ordering, so regeneration of `route-table.snapshot.txt` is expected. The canonical method/path surface must remain unchanged.

No conflicting method/path was identified, and all relevant root hooks/decorations are installed before `registerRoutes`: [app.ts](/home/udai/PennyPilot/apps/api/src/app.ts:174), [app.ts](/home/udai/PennyPilot/apps/api/src/app.ts:223). Parent Fastify decorations and hooks are inherited by child plugins, so moving these routes under `ingestRoutes` should not itself change `app.db`, `app.config`, `app.eventBus`, session, multipart, compression, auth, CSRF, or rate limiting. This still needs the AC7 verification described above.

### NON-BLOCKING — Multipart behavior is safe if the route body remains literal

`POST /api/imports` deliberately uses `app.post`, manually parses the query, and consumes `req.file()`: [routes/imports.ts](/home/udai/PennyPilot/apps/api/src/routes/imports.ts:41). Multipart is registered before application routes at [app.ts](/home/udai/PennyPilot/apps/api/src/app.ts:223), so the nested plugin inherits it. Keeping the handler literal preserves behavior.

## Raw SQL consumers and schema

### NON-BLOCKING — No table or column rename is inherent in the proposed thin re-export

The seven physical table declarations remain in `db/schema.ts`, including:

- Imports: [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:471), [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:493), [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:526)
- Mailboxes: [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:1541), [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:1571)
- Email ingestion: [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:1610)
- Extracted transactions: [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:1659)

A one-way module `schema.ts` named re-export does not change generated SQL names or object identity. No migration should be generated.

The raw consumers make the constraint concrete:

- Ingestor reads `mailbox_accounts`/`mailbox_credentials`: [apps/ingestor/src/db.ts](/home/udai/PennyPilot/apps/ingestor/src/db.ts:46)
- It inserts `email_ingestions`: [apps/ingestor/src/db.ts](/home/udai/PennyPilot/apps/ingestor/src/db.ts:86)
- It updates mailbox watermark/error columns: [apps/ingestor/src/db.ts](/home/udai/PennyPilot/apps/ingestor/src/db.ts:110)
- Extractor reads and updates `email_ingestions`: [apps/extractor/src/db.ts](/home/udai/PennyPilot/apps/extractor/src/db.ts:34), [apps/extractor/src/db.ts](/home/udai/PennyPilot/apps/extractor/src/db.ts:164)
- It inserts `extracted_transactions` with the current column set: [apps/extractor/src/db.ts](/home/udai/PennyPilot/apps/extractor/src/db.ts:295)

Therefore the consumers are not at risk from relocation itself. The risk appears only if P5 is implemented as a reverse barrel edit or anyone physically moves/renames schema definitions, both of which should be excluded.

### NON-BLOCKING — Queue contracts are correctly identified and need no source change

The queue constants remain in shared code:

- `EXTRACT_QUEUE = "email.extract"`: [email.ts](/home/udai/PennyPilot/packages/shared/src/schemas/email.ts:191)
- `INGESTOR_QUEUE = "ingestor.run"`: [email.ts](/home/udai/PennyPilot/packages/shared/src/schemas/email.ts:194)

Moving `mailboxRoutes` and changing only its relative import to the existing jobs layer does not alter those contracts. Verification should compare both queue names and job payload shapes, not merely grep the two strings.

## Tests and scope

### NON-BLOCKING — Keeping `inbox.test.ts` unsplit is acceptable and should not block task 1.7

The current file uses a shared database fixture/import setup and exercises functions across all three proposed units; its combined imports are visible at [inbox.test.ts](/home/udai/PennyPilot/apps/api/src/services/inbox.test.ts:22). Splitting it during a no-behavior-change migration would require either duplicating fixtures or introducing a new test-helper abstraction, increasing the chance of altering concurrency setup or cleanup semantics.

The roadmap requires the production service to split into queue, state-machine, and classification units at [01.07-migrate-ingest.md](/home/udai/PennyPilot/tasks/01.07-migrate-ingest.md:18). It does not require one test file per production file. Existing module directories also contain test files whose names do not mechanically mirror one service file, so this is not a binding repository convention.

Keeping a single moved `inbox.test.ts` is therefore a reasonable migration-safety choice. Its imports must be divided among the three production modules, and all existing tests must remain textually/semantically intact.

### NON-BLOCKING — Schema smoke-test acceptance should include SQL names and all available query accessors

P5 proposes object identity and omitting `db.query.importRows`, which is reasonable if no relation accessor exists. The reference smoke test also verifies actual SQL table names and real `createDb()` query accessors: [planning/schema.smoke.test.ts](/home/udai/PennyPilot/apps/api/src/modules/planning/schema.smoke.test.ts:26), [planning/schema.smoke.test.ts](/home/udai/PennyPilot/apps/api/src/modules/planning/schema.smoke.test.ts:50).

The ingest smoke test should therefore assert:

- Exact object identity for seven tables and eight enums.
- Exact SQL table names for all seven tables.
- `db.query` presence for every ingest table that has an accessor.
- Explicitly document the absence of only `importRows`, rather than skipping the entire accessor test.

### NON-BLOCKING — No new mailbox service unit test is required solely because the file moves

`mailboxes.ts` currently has no colocated test. A pure relocation does not require inventing broad service coverage. The plugin registration test plus AC7 route-policy verification provides proportionate migration coverage. Existing imports/mailbox/inbox behavior must otherwise remain unchanged.

## Required plan corrections before implementation

1. Remove every instruction to add a reverse re-export in `db/schema.ts`.
2. Correct all new relative paths, especially `../../../db`, `../../../lib`, `../../../jobs`, and test infrastructure paths.
3. Keep `claimPending` private in `transfer-classification.ts`; do not rewrite `acceptExtracted` to use it.
4. Add concrete AC7 verification for auth/private metadata/demo/CSRF/rate-limit behavior.
5. Never regenerate `route-surface.snapshot.txt`; compare against it unchanged.
6. Expand event acceptance coverage to all five existing `ledger.mutated` emit sites.
7. Correct the inbox route import count and clarify that all existing exported test utilities/types remain available from their assigned new files.

With those corrections, the four-file production split is sound, acyclic, and capable of remaining a pure relocation/file decomposition with no SQL, schema, queue, route-surface, or runtime behavior change.