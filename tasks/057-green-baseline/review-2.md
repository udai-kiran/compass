## Implementation review — Task 057

Verdict: **PASS / ready to mark COMPLETE**, with one correction to AC5’s stated total. The implementation itself matches P0–P5 and AC1–AC7 in substance.

### P0 / AC1 — type-only imports and typecheck

PASS.

- `HouseholdSplit` uses `import type` at [splits.ts:5](/home/udai/common/compass/apps/api/src/modules/household/routes/splits.ts:5).
- `Settlement` uses `import type` at [settlements.ts:5](/home/udai/common/compass/apps/api/src/modules/household/routes/settlements.ts:5).
- `SharingResourceType` is included in the type-only import at [grants.ts:5](/home/udai/common/compass/apps/api/src/modules/household/services/grants.ts:5).
- The Drizzle tables are correctly value-imported because they are referenced through `typeof`:
  - [splits.ts:7](/home/udai/common/compass/apps/api/src/modules/household/routes/splits.ts:7)
  - [settlements.ts:7](/home/udai/common/compass/apps/api/src/modules/household/routes/settlements.ts:7)
- This is compatible with `verbatimModuleSyntax: true` at [tsconfig.base.json:9](/home/udai/common/compass/tsconfig.base.json:9). No newly added type is imported as a value, so there is no TS1484 risk.
- `npm run typecheck` completed all configured workspace typechecks with no diagnostics. Exit status: **0**.

The root script covers the five workspaces that declare a typecheck script: API, docs, extractor, ingestor, and web.

### AC2 / AC3 — lint, `any`, and suppressions

PASS.

- `npm run lint` exit status: **0**.
- ESLint produced no output after `eslint .`: **0 errors, 0 warnings**.
- Word-boundary search for `\bany\b` returned no occurrences in:
  - `routes/splits.ts`
  - `routes/settlements.ts`
  - `services/grants.ts`
  - `services/membership.ts`
- No newly introduced `eslint-disable`, `@ts-ignore`, or `@ts-expect-error` exists in the diff.
- No such suppression exists in any of the six touched files.

The existing `@ts-expect-error` tests printed by the EventBus suite are elsewhere and are unrelated to this change.

### AC6 — annotation-only/runtime audit

PASS. I examined every hunk of the complete `git diff`.

No runtime expression, executable statement, branch, control flow, query condition, or returned field was changed.

Specific checks:

- `toSettlement` remains the same object mapping at [settlements.ts:22](/home/udai/common/compass/apps/api/src/modules/household/routes/settlements.ts:22).
- Both required normalizations remain intact:
  - `transferTransactionId: row.transferTransactionId ?? null` at [settlements.ts:29](/home/udai/common/compass/apps/api/src/modules/household/routes/settlements.ts:29)
  - `note: row.note ?? null` at [settlements.ts:30](/home/udai/common/compass/apps/api/src/modules/household/routes/settlements.ts:30)
- `toSplitResponse`’s returned field set and order are unchanged at [splits.ts:30](/home/udai/common/compass/apps/api/src/modules/household/routes/splits.ts:30):
  `id`, `transactionId`, `householdId`, `rule`, `payerPersonId`, `createdByUserId`, `createdAt`, `updatedAt`, `shares`.
- The inner `shares.map` callback body is unchanged at [splits.ts:39](/home/udai/common/compass/apps/api/src/modules/household/routes/splits.ts:39). Only `(s: any)` became `(s)`.
- In `listGrants`, deleting `as any` changed no runtime behavior:
  - Current condition: [grants.ts:59](/home/udai/common/compass/apps/api/src/modules/household/services/grants.ts:59)
  - Type assertions are erased by TypeScript, so both versions invoke `eq(sharingGrants.resourceType, filters.resourceType)` with identical runtime arguments.
  - The surrounding conditional and SQL condition set remain unchanged at [grants.ts:57](/home/udai/common/compass/apps/api/src/modules/household/services/grants.ts:57).
- The remaining hunks only remove unused imports:
  - `gt` at [membership.ts:1](/home/udai/common/compass/apps/api/src/modules/household/services/membership.ts:1)
  - `IncomeSurplusComputation` from [income-surplus.test.ts:3](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.test.ts:3)
  - `AcceptInviteSchema` from [household-queries.ts:3](/home/udai/common/compass/apps/web/src/lib/household-queries.ts:3)

The added Drizzle table import specifiers support `typeof` annotations as prescribed by the approved plan; they do not alter any function body or runtime operation.

### P4 — `listGrants` and caller

PASS.

- `listGrants` now accepts `SharingResourceType`, not `string`, at [grants.ts:55](/home/udai/common/compass/apps/api/src/modules/household/services/grants.ts:55).
- Its caller’s query is validated by `SharingResourceTypeSchema.optional()` at [sharing.ts:12](/home/udai/common/compass/apps/api/src/modules/household/routes/sharing.ts:12).
- The sole call remains compatible at [sharing.ts:52](/home/udai/common/compass/apps/api/src/modules/household/routes/sharing.ts:52).
- `routes/sharing.ts` was not modified.
- The successful API typecheck independently confirms caller compatibility.

### AC7 — dependency files

PASS.

`git diff -- package-lock.json ':(glob)**/package.json'` returned no output.

Therefore:

- `package-lock.json` is genuinely unchanged.
- Every `package.json` is unchanged.
- `fast-check@4.9.0` resolves successfully through the API workspace.
- Both `node_modules/fast-check` and `node_modules/pure-rand` exist.

The current install state matches P1. A diff cannot prove which command materialized it, but it proves the required result without dependency-file mutation.

### `postings.test.ts`

PASS.

- [postings.test.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.test.ts) is absent from both the staged and unstaged diff.
- Its `fast-check` import remains unchanged at [postings.test.ts:3](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.test.ts:3).
- A targeted execution completed successfully:
  - **24 tests**
  - **24 pass**
  - **0 fail**
  - **0 skipped**
  - Exit status **0**
- All five named fast-check property tests executed and passed, including those beginning at lines 55, 366, 392, 416, and 453.

### AC5 — test count reconciliation

The approved plan’s literal “1312 total stays unchanged” wording was wrong. The implementation does not hide a regression.

Current full-suite results:

| Workspace | Tests | Pass | Fail | Skipped |
|---|---:|---:|---:|---:|
| API | 735 | 709 | 25 | 1 |
| Extractor | 74 | 73 | 1 | 0 |
| Ingestor | 12 | 12 | 0 | 0 |
| Web | 270 | 270 | 0 | 0 |
| AI | 32 | 32 | 0 | 0 |
| Shared | 212 | 212 | 0 | 0 |
| **Total** | **1335** | **1308** | **26** | **1** |

`npm run test` exits **1**, solely because the 26 environment-gated files fail to load without `DATABASE_URL`.

The arithmetic reconciles exactly, but the implementer’s description needs one nuance:

- `postings.test.ts` contains **24**, not 23, tests.
- Previously its failure to load was counted as **one failed file-level test**.
- Replacing that one failure with 24 passing tests increases the total by **23**.
- `1312 + 24 - 1 = 1335`.
- Correspondingly, passes rise by 24 and failures fall by one:
  - 1284 pass → 1308 pass
  - 27 fail → 26 fail
  - skipped remains 1

Thus the +23 total is fully explained. There is no newly skipped test. The one current skip is the existing opt-in storage contract test.

### Remaining failing files

All 26 are explicitly `DATABASE_URL`-gated. No non-database-gated failure occurred.

API failures and their guards:

- [app.test.ts:31](/home/udai/common/compass/apps/api/src/app.test.ts:31)
- [automation.route.test.ts:42](/home/udai/common/compass/apps/api/src/modules/automation/routes/automation.route.test.ts:42)
- [card-due-tasks.test.ts:30](/home/udai/common/compass/apps/api/src/modules/credit/services/card-due-tasks.test.ts:30)
- [emis.test.ts:230](/home/udai/common/compass/apps/api/src/modules/credit/services/emis.test.ts:230)
- [reconciliation-writes.test.ts:25](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.test.ts:25)
- [rewards.test.ts:98](/home/udai/common/compass/apps/api/src/modules/credit/services/rewards.test.ts:98)
- [ingest.route.test.ts:60](/home/udai/common/compass/apps/api/src/modules/ingest/routes/ingest.route.test.ts:60)
- [inbox.test.ts:152](/home/udai/common/compass/apps/api/src/modules/ingest/services/inbox.test.ts:152)
- [networth.route.test.ts:39](/home/udai/common/compass/apps/api/src/modules/investments/routes/networth.route.test.ts:39)
- [sip-installments.test.ts:175](/home/udai/common/compass/apps/api/src/modules/investments/services/sip-installments.test.ts:175)
- [ledger-events.route.test.ts:48](/home/udai/common/compass/apps/api/src/modules/ledger/routes/ledger-events.route.test.ts:48)
- [user-tasks.route.test.ts:55](/home/udai/common/compass/apps/api/src/modules/ledger/routes/user-tasks.route.test.ts:55)
- [epf-contributions.test.ts:25](/home/udai/common/compass/apps/api/src/modules/ledger/services/epf-contributions.test.ts:25)
- [postings-balance-parity.test.ts:34](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings-balance-parity.test.ts:34)
- [postings-pr-e-parity.test.ts:47](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:47)
- [reconcile-postings.test.ts:14](/home/udai/common/compass/apps/api/src/modules/ledger/services/reconcile-postings.test.ts:14)
- [recurring.test.ts:38](/home/udai/common/compass/apps/api/src/modules/ledger/services/recurring.test.ts:38)
- [user-tasks.test.ts:27](/home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.test.ts:27)
- [planning.route.test.ts:42](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning.route.test.ts:42)
- [projection-settings.route.test.ts:40](/home/udai/common/compass/apps/api/src/modules/planning/routes/projection-settings.route.test.ts:40)
- [postings-planning-parity.test.ts:22](/home/udai/common/compass/apps/api/src/modules/planning/services/postings-planning-parity.test.ts:22)
- [projection-settings.test.ts:17](/home/udai/common/compass/apps/api/src/modules/planning/services/projection-settings.test.ts:17)
- [protection.route.test.ts:49](/home/udai/common/compass/apps/api/src/modules/protection/routes/protection.route.test.ts:49)
- [system.route.test.ts:48](/home/udai/common/compass/apps/api/src/modules/system/routes/system.route.test.ts:48)
- [backup.test.ts:338](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:338)

Extractor failure:

- [statement-duplicate.test.ts:32](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:32)

Each cited location either calls `requireEnv("DATABASE_URL")` or reads `process.env.DATABASE_URL` and immediately throws when absent.

### Scope and repository state

PASS for implementation scope.

Exactly six tracked files are modified:

1. `apps/api/src/modules/household/routes/settlements.ts`
2. `apps/api/src/modules/household/routes/splits.ts`
3. `apps/api/src/modules/household/services/grants.ts`
4. `apps/api/src/modules/household/services/membership.ts`
5. `apps/api/src/modules/planning/services/income-surplus.test.ts`
6. `apps/web/src/lib/household-queries.ts`

- No changes are staged.
- The six implementation changes are unstaged relative to `HEAD`.
- No implementation change has been committed.
- `screen-shots/` remains untracked and unstaged.
- `tasks/057-green-baseline/` and `tasks/058-planning-api/` are also untracked directories, but they are not part of the tracked implementation diff.
- `git diff --check` reports no whitespace errors.

### Final assessment

All P0–P5 implementation requirements are satisfied. AC1–AC4, AC6, and AC7 pass directly. AC5’s invariant passes, while its fixed “1312” total was an erroneous plan assumption: the correct current result is **1335 total, 1308 pass, 26 fail, 1 skipped**, with every failure explicitly database-gated.

Nothing in the implementation should block marking Task 057 **COMPLETE**.