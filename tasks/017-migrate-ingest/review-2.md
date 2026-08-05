## Review outcome

Implementation structure and production behavior are consistent with the approved migration. I found no changed route handler, service algorithm, SQL predicate, ownership filter, cache key, table/column name, or queue contract.

Two acceptance gaps remain:

1. **AC7 is not genuinely tested.** The ingest plugin has only route-registration introspection; there are no ingest-specific tests for unauthenticated 401, absence of `config.public`, demo-write 403, hostile-Origin CSRF 403, or READ/WRITE rate-limit classification.
2. **The five required `ledger.mutated` route-level assertions are missing.** The emit statements survived byte-for-byte, but no route-level test proves inbox accept/repayment/transfer or import commit/rollback still emit after encapsulation.

These are verification/test-coverage blockers rather than observed runtime regressions.

## Findings

### P1 / P4 / AC7 — missing encapsulation security tests

The plugin test at [plugin.test.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/plugin.test.ts:24) only registers the plugin and calls `hasRoute()`. Its own comments explicitly say that it never injects a request or executes a handler at lines 7–16.

Consequently, it does not verify any of the concrete T6/AC7 requirements:

- unauthenticated ingest route returns 401;
- ingest routes have not acquired `config.public`;
- a demo session receives 403 for an ingest write;
- a hostile `Origin` receives CSRF 403;
- ingest GET and write requests select READ and WRITE rate-limit buckets.

The implementation should inherit these protections because `setupAuth()` and `setupSecurity()` are installed on the parent app before route registration at [app.ts](/home/udai/PennyPilot/apps/api/src/app.ts:179), and the hooks classify requests generically:

- authentication/default-private behavior: [plugins/auth.ts](/home/udai/PennyPilot/apps/api/src/plugins/auth.ts:58)
- demo-write rejection: [plugins/auth.ts](/home/udai/PennyPilot/apps/api/src/plugins/auth.ts:64)
- CSRF handling: [plugins/security.ts](/home/udai/PennyPilot/apps/api/src/plugins/security.ts:65)
- method-based READ/WRITE classification: [plugins/security.ts](/home/udai/PennyPilot/apps/api/src/plugins/security.ts:23)

No moved route sets `config.public`. Thus I found no indication of a security regression, but AC7 specifically requires separate verification rather than inference. **AC7 is not satisfied by the current test suite.**

### AC5 / Codex B6 — required route-level event assertions are absent

All five production emit sites remain intact:

- inbox accept: [routes/inbox.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/inbox.ts:56)
- repayment: [routes/inbox.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/inbox.ts:72)
- transfer: [routes/inbox.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/inbox.ts:87)
- import commit: [routes/imports.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/imports.ts:112)
- import rollback: [routes/imports.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/imports.ts:122)

However, searching all `*.test.ts` files found no ingest route test that observes these emissions. Existing event-bus and ledger route tests do not exercise these five handlers.

Therefore:

- the “Must NOT change” implementation invariant is preserved;
- AC5 is structurally preserved;
- the corrected Codex B6 requirement for five route-level assertions is not implemented.

This is a meaningful missing regression test because these emits are explicit handler responsibilities and are not covered by the route snapshot.

## P1–P6 assessment

### P1 — pass, except AC7 coverage

[plugin.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/plugin.ts:24) registers:

1. `importRoutes`
2. `inboxRoutes`
3. `mailboxRoutes`

The order is correct at lines 25–27.

[schema.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/schema.ts:26) provides exactly the requested seven tables and eight enums as named one-way re-exports from `../../db/schema.ts`.

### P2 — pass

The imports, mailboxes, and import-reconciliation services and tests were relocated correctly.

Rename-aware diffs show:

- `import-reconciliation.ts`: 100% identical
- `import-reconciliation.test.ts`: 100% identical
- `imports.ts`: import block changes only
- `imports.test.ts`: import specifier change only
- `mailboxes.ts`: import block changes only

No function bodies, SQL, constants, or public signatures changed. The odd direct cross-module import convention was preserved where applicable.

### P3 / AC2 — pass

The old 804-line inbox service is split according to the corrected design:

- queue and prefill operations: [review-queue.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/review-queue.ts:19)
- state-machine operations: [review-actions.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/review-actions.ts:63)
- transfer and repayment classification: [transfer-classification.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:56)
- common DTO/read helpers: [inbox-shared.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/inbox-shared.ts:18)

I compared the 21 moved declarations against `git show HEAD:apps/api/src/services/inbox.ts`. Their bodies are byte-identical. The only necessary declaration-level differences are exports used across the newly separated files and adjusted imports.

Mapping is correct:

- `review-queue.ts`: `listInbox`, `listOrphanedAccepts`, `pickTransferPairs`, `historyKey`, `pickHistoryCategories`, private `applyHistoryCategory`, `countPending`
- `review-actions.ts`: `acceptExtracted`, `restoreOrphan`, `rejectExtracted`, `unmatchDuplicate`, private `loadOne` and `dtoFromRow`
- `transfer-classification.ts`: `acceptTransfer`, `RepaymentCandidateSelection`, `selectRepaymentCandidate`, `acceptRepayment`, private `claimPending`
- `inbox-shared.ts`: `toDto`, `INBOX_COLUMNS`, `reload`

The former public inbox signatures are preserved.

The import graph is acyclic:

- queue → shared
- actions → shared
- classification → shared
- shared has no dependency on the other three units

There are no queue↔actions↔classification imports.

`inbox.test.ts` remains one file. Its rename-aware diff contains import repoints only.

### Codex B2 — pass

`claimPending` is private and non-exported at [transfer-classification.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:23). Its only callers are:

- `acceptTransfer`: line 69
- `acceptRepayment`: line 205

`acceptExtracted` retains its original inline pending claim at [review-actions.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/review-actions.ts:71). It was not rewritten to call `claimPending`.

Keeping `claimPending` in classification rather than shared is the better corrected placement because both callers reside in the same unit.

### P4 — pass

[app.ts](/home/udai/PennyPilot/apps/api/src/app.ts:137) contains exactly one `app.register(ingestRoutes)`, at the former `importRoutes` position.

The old inbox/mailbox imports and registrations are absent. The module plugin contains the only three internal route registrations.

Moved route diffs contain import changes only:

- imports route: `HttpError` path
- inbox route: service imports split across three units
- mailboxes route: jobs path

No handler body, method, URL, status code, Zod schema, or event emission changed.

### P5 — pass under B1/D1 correction

`apps/api/src/db/schema.ts` has no diff and contains no `modules/ingest` reference or reverse `export *`.

This is correct despite stale contradictory wording in P5 and DELEGATION. The authoritative B1 resolution and D1 disposition correctly require:

```text
modules/ingest/schema.ts → db/schema.ts
```

with no reverse edge.

The TASK itself should eventually have its stale P5 sentence corrected, but that documentation inconsistency is not an implementation defect.

### P6 / AC1 route artifacts — pass

`route-surface.snapshot.txt` is byte-identical to HEAD. Both copies have SHA-256:

```text
a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122
```

The route-table diff is pure re-nesting/order movement: the existing inbox subtree moved ahead of the insights/insurance subtree. No method or path was added, removed, or renamed.

No migration file or schema diff is present. I did not run the migration generator because this was a strictly read-only review and that command can write generated files.

## AC1–AC7 assessment

| Criterion | Result | Evidence |
|---|---|---|
| AC1: snapshots, no migration, backup test | Partial | Surface identical; route table pure re-nesting; schema/migration tree unchanged. `backup.test.ts` could not run without `DATABASE_URL`. |
| AC2: inbox split | Pass | Correct queue/actions/classification/shared mapping and acyclic imports. |
| AC3: ingestor/extractor | Partial/pass with known waiver | All-workspace typecheck passed; ingestor 12/12 passed; extractor 62 tests passed and its DB-backed file failed only because `DATABASE_URL` is absent. |
| AC4: queue contracts | Pass | No diff in API jobs, ingestor, or extractor; queue code and payloads untouched. |
| AC5: event emission | Partial | All five emits intact, but required route-level assertions are missing. |
| AC6: all checks green | Not established | Typecheck passed. Root lint is red because of unrelated untracked `apps/api/src/lib/storage.test.ts:157`. Full API/DB tests cannot run without `DATABASE_URL`. |
| AC7: security behavior | Not satisfied as verification | Implementation appears preserved, but the five required ingest-specific tests are absent. |

## Schema and deviation review

### D1 — `db/schema.ts` untouched: correct

Signed deviation is correct. A reverse export would introduce the forbidden dependency direction and contradict the established thin-schema convention. Current implementation is one-way and acyclic.

### D2 — three inbound consumer repoints: correct

Each consumer has exactly one deleted and one added import line, with no other change:

- [routes/auth.ts](/home/udai/PennyPilot/apps/api/src/routes/auth.ts:21)
- [automation/routes/ai.ts](/home/udai/PennyPilot/apps/api/src/modules/automation/routes/ai.ts:20)
- [credit/routes/cards.ts](/home/udai/PennyPilot/apps/api/src/modules/credit/routes/cards.ts:34)

All three resolve to the moved `mailboxSecret` export. These repoints are necessary compatibility edits, not scope expansion.

### D3 — `historyKey` escape: correct

[review-queue.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/review-queue.ts:113) contains the literal source text `\u0000`.

The bytes on that line include:

```text
92,117,48,48,48,48
```

which are backslash, `u`, `0`, `0`, `0`, `0`. There is no embedded NUL byte. The function body matches HEAD.

### D4 — `db.query.importRows`: correct strengthening

[schema.smoke.test.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/schema.smoke.test.ts:60) constructs a real Drizzle database object using a non-connecting pool stub and checks all seven accessors, including `db.query.importRows`.

The test passes. Including `importRows` is correct because production code actually relies on its relational-query accessor, as documented at lines 79–80. The earlier assumption that it lacked an accessor was incorrect.

The smoke test is genuine:

- strict table object identity: lines 36–47
- exact SQL table names: lines 45–46
- strict enum identity: lines 50–57
- runtime `db.query` accessor checks for all seven tables: lines 60–87

The plugin test is also genuine `hasRoute()` introspection, but deliberately narrow; it should not be mistaken for AC7 or event-emission coverage.

## Compatibility and behavior review

No table or column definitions changed. The raw SQL consumers in `apps/ingestor` and `apps/extractor` still reference the same physical names, including:

- `mailbox_accounts`
- `mailbox_credentials`
- `email_ingestions`
- `extracted_transactions`

No queue-related file changed, so `email.extract` and `ingestor.run` names and payload shapes are unaffected.

Direct cross-module imports remain direct. The required `isUniqueViolation` dependency is preserved at [transfer-classification.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:7).

No runtime behavioral regression was identified in the production diff.

## Verification results

Commands run read-only:

- `npm run typecheck`: exit 0 across API, docs, extractor, ingestor, web, AI, and shared workspaces.
- `npm run lint`: exit 1 solely because unrelated untracked [storage.test.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:157) has a `no-useless-assignment` error.
- New ingest plugin/schema tests: 4/4 passed.
- Ingestor tests: 12/12 passed.
- Extractor tests: 62 passed; DB-backed `statement-duplicate.test.ts` could not start without `DATABASE_URL`, matching the documented pre-existing packaging waiver.
- `backup.test.ts`: could not start without `DATABASE_URL`.

## Final disposition

The migration implementation itself is sound and matches P1–P6 after applying the authoritative B1/B2 corrections. Both signed deviations and both pending deviations are correct.

Approval should remain conditional on adding the promised ingest route-level verification for:

- AC7’s five security/encapsulation cases; and
- all five `ledger.mutated` handler sites.

Full AC1/AC6 green evidence also still requires the configured database test environment, while the current lint result is blocked by an unrelated untracked test file rather than this migration.