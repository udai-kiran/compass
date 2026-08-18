## Implementation review — NOT READY TO MARK COMPLETE

### Blocking findings

1. **AC4a is not implemented: both hermetic tests are test theatre.**

   Neither file registers the real route plugin or invokes the real handler/service boundary. They re-declare substitute routes that return already schema-valid fixtures:

   - [planning-analysis.hermetic.test.ts:88](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts:88) explicitly abandons the real plugin; replacement handlers are at lines 109–130.
   - [revolving-debt.hermetic.test.ts:62](/home/udai/common/compass/apps/api/src/modules/credit/routes/revolving-debt.hermetic.test.ts:62) does the same; its substitute handler is at lines 68–72.

   The comments claiming “real route plugin” are false. These tests only prove Fastify’s real serializer accepts pre-normalized fixtures—the Task 058 failure mode specifically prohibited. They would not catch incorrect route wiring, wrong service invocation, an over-strict schema rejecting actual service output, or handler changes.

2. **Required service documentation is absent.**

   AC5 and DELEGATION require owner-only/sharing limitations in both route and service doc comments. Route comments exist, but the service comments were not updated:

   - [income-surplus.ts:117](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:117)
   - [data-completeness.ts:159](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:159)
   - [revolving-debt.ts:87](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:87)

   None mentions owner-only scope, omitted shared data, `withSharing`, or task 061.

3. **The AC4b tests do not exercise either documented serializer risk.**

   Even with PostgreSQL/Redis available, the integration tests only create fresh users with empty data:

   - [planning-analysis.route.test.ts:84](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:84)
   - [planning-analysis.route.test.ts:138](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:138)
   - [revolving-debt.route.test.ts:84](/home/udai/common/compass/apps/api/src/modules/credit/routes/revolving-debt.route.test.ts:84)

   They insert no statement reconciliation with a real `period`, nor any monetary value near/above `Number.MAX_SAFE_INTEGER`. Consequently, running these green would still not establish that non-empty real service output serializes.

   **The real-Postgres serializer risk is genuinely still open.** The current environment cannot run AC4b, and the authored AC4b coverage would not close the two specific risks anyway.

### Other findings

4. **The cross-user tests do not meaningfully prove isolation.**

   Both users are fresh and empty, so identical empty responses would pass even if ownership filtering were broken:

   - [planning-analysis.route.test.ts:107](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:107)
   - [revolving-debt.route.test.ts:109](/home/udai/common/compass/apps/api/src/modules/credit/routes/revolving-debt.route.test.ts:109)

   The production code does pass `req.session!.userId`, but these tests do not independently verify leakage prevention.

5. **The `today` test and documentation misdescribe the mechanism.**

   The real data-completeness route defines no `querystring` schema at all; therefore Zod is not stripping `today`. The handler simply ignores all query parameters by omitting the third service argument at [planning-analysis.ts:47](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.ts:47).

   The tests only prove `?today=` returns 200, not that it was stripped rather than accepted-and-ignored:

   - [planning-analysis.hermetic.test.ts:268](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts:268)
   - [planning-analysis.route.test.ts:161](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:161)

   The endpoint correctly does not honour `today`, but the stated Zod explanation is inaccurate.

6. **Plugin comments now make factually false legacy claims.**

   They describe the new endpoints as “same URLs,” “pure relocation,” and no canonical surface change, although Task 059 adds URLs:

   - [planning/plugin.ts:18](/home/udai/common/compass/apps/api/src/modules/planning/plugin.ts:18)
   - [credit/plugin.ts:14](/home/udai/common/compass/apps/api/src/modules/credit/plugin.ts:14)

### Test evidence — literal root result

`npm run test`:

- **Exit code: 1**
- **Total: 1399**
- **Pass: 1370**
- **Fail: 28**
- **Skip: 1**

Per workspace:

| Workspace | Total | Pass | Fail | Skip |
|---|---:|---:|---:|---:|
| `@compass/api` | 799 | 771 | 27 | 1 |
| `@compass/extractor` | 74 | 73 | 1 | 0 |
| `@compass/ingestor` | 12 | 12 | 0 | 0 |
| `@compass/web` | 270 | 270 | 0 | 0 |
| `@compass/ai` | 32 | 32 | 0 | 0 |
| `@compass/shared` | 212 | 212 | 0 | 0 |

Against the pre-059 baseline `1386 / 1359 / 26 / 1`, the delta is exactly:

- 11 new passing hermetic tests
- 2 new deliberately failing AC4b files
- no previously passing test became failing

Therefore, **no genuine new regression was found**.

Failure classification:

**(i) Pre-existing environment-gated — 26 files**

- `apps/api/src/app.test.ts`
- `apps/api/src/modules/automation/routes/automation.route.test.ts`
- `apps/api/src/modules/credit/services/card-due-tasks.test.ts`
- `apps/api/src/modules/credit/services/emis.test.ts`
- `apps/api/src/modules/credit/services/reconciliation-writes.test.ts`
- `apps/api/src/modules/credit/services/rewards.test.ts`
- `apps/api/src/modules/ingest/routes/ingest.route.test.ts`
- `apps/api/src/modules/ingest/services/inbox.test.ts`
- `apps/api/src/modules/investments/routes/networth.route.test.ts`
- `apps/api/src/modules/investments/services/sip-installments.test.ts`
- `apps/api/src/modules/ledger/routes/ledger-events.route.test.ts`
- `apps/api/src/modules/ledger/routes/user-tasks.route.test.ts`
- `apps/api/src/modules/ledger/services/epf-contributions.test.ts`
- `apps/api/src/modules/ledger/services/postings-balance-parity.test.ts`
- `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts`
- `apps/api/src/modules/ledger/services/reconcile-postings.test.ts`
- `apps/api/src/modules/ledger/services/recurring.test.ts`
- `apps/api/src/modules/ledger/services/user-tasks.test.ts`
- `apps/api/src/modules/planning/routes/planning.route.test.ts`
- `apps/api/src/modules/planning/routes/projection-settings.route.test.ts`
- `apps/api/src/modules/planning/services/postings-planning-parity.test.ts`
- `apps/api/src/modules/planning/services/projection-settings.test.ts`
- `apps/api/src/modules/protection/routes/protection.route.test.ts`
- `apps/api/src/modules/system/routes/system.route.test.ts`
- `apps/api/src/modules/system/services/backup.test.ts`
- `apps/extractor/src/statement-duplicate.test.ts`

**(ii) New AC4b files failing by design — 2 files**

- `apps/api/src/modules/planning/routes/planning-analysis.route.test.ts`
- `apps/api/src/modules/credit/routes/revolving-debt.route.test.ts`

Both failed at module load because `DATABASE_URL` was absent.

**(iii) Genuine new regressions**

- None.

The implementer’s claimed root “baseline 212 tests” and exit 0 is false; 212 is only `@compass/shared`.

### Snapshots

- `route-surface.snapshot.txt`: exactly **319 lines**, final byte is newline.
- HEAD version: **313 lines**.
- Diff: exactly six additions and no removals/other edits:

  - `GET /api/credit/revolving-debt`
  - `GET /api/planning/data-completeness`
  - `GET /api/planning/income-surplus`
  - corresponding three `HEAD` routes

- `route-table.snapshot.txt`: minimal three-line addition, with no gratuitous reordering.
- `app.route-snapshot.test.ts`: **7/7 pass, exit 0**, including both byte-exact comparisons.
- Registration order is correct:

  - Planning after projection settings: [planning/plugin.ts:39](/home/udai/common/compass/apps/api/src/modules/planning/plugin.ts:39)
  - Revolving debt after overdraft details: [credit/plugin.ts:28](/home/udai/common/compass/apps/api/src/modules/credit/plugin.ts:28)
  - Within planning, income-surplus precedes data-completeness: [planning-analysis.ts:33](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.ts:33)

### Plugin enumeration

Both pass genuinely:

- Planning changed 8→9 and asserts the new income-surplus route at [planning/plugin.test.ts:28](/home/udai/common/compass/apps/api/src/modules/planning/plugin.test.ts:28).
- Credit changed 4→5 and asserts revolving-debt at [credit/plugin.test.ts:23](/home/udai/common/compass/apps/api/src/modules/credit/plugin.test.ts:23).
- Focused result: **2/2 pass, exit 0**.
- No assertion was removed or weakened.

### Routes and validation

The production handlers are thin and respect layering:

- Income surplus: one service invocation/return at [planning-analysis.ts:43](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.ts:43)
- Data completeness: one service invocation/return at [planning-analysis.ts:59](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.ts:59)
- Revolving debt: one service invocation/return at [revolving-debt.ts:33](/home/udai/common/compass/apps/api/src/modules/credit/routes/revolving-debt.ts:33)

No DB query or branching logic exists in either route file.

Income-surplus correctly uses `querystring` and exactly:

`z.coerce.number().int().min(1).max(120).default(12)`

at [planning-analysis.ts:37](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.ts:37).

Tests exist for omitted/default, coerced string, `0`, `121`, fractional, and non-numeric inputs at [planning-analysis.hermetic.test.ts:154](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts:154), but because they duplicate the route definition, they do not protect the real route from divergence.

### Documentation

Route comments accurately state owner-only semantics and task 061 deferral:

- [planning-analysis.ts:12](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.ts:12)
- [revolving-debt.ts:9](/home/udai/common/compass/apps/api/src/modules/credit/routes/revolving-debt.ts:9)

Both residual 500 risks are explicitly documented:

- [planning-analysis.ts:22](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.ts:22)
- [revolving-debt.ts:19](/home/udai/common/compass/apps/api/src/modules/credit/routes/revolving-debt.ts:19)

Those warnings are appropriately cautious and do not claim the risks are closed. The missing service comments remain an AC5 failure.

### Scope and hygiene

- No existing route file was modified.
- No Task 059 service implementation was modified.
- No shared response schema was authored by Task 059.
- The only new local Zod schema is the required query-parameter schema.
- `withSharing` was not added or invoked.
- The pre-existing Task 057/058 dirty files remain present and unreverted.
- `screen-shots/` remains untracked.
- Nothing is staged.
- Nothing was committed; HEAD remains `b829d87`.
- No `as any`, `@ts-ignore`, `@ts-expect-error`, or `eslint-disable` was introduced in the six new files.
- All three new routes are GETs.
- `npm run lint`: **exit 0**, no errors or warnings.
- `npm run typecheck`: **exit 0** across all workspaces.

### Verdict

Task 059 should not be marked COMPLETE until the hermetic tests register the actual route plugins with controlled service substitution, and the required service comments are added. The AC4b fixtures should also exercise non-empty real rows—including valid statement periods and boundary monetary values—before claiming that real-Postgres serialization risk is closed.