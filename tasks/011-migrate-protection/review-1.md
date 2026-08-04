# Verdict: NOT IMPLEMENTATION-READY

The relocation itself is well understood, and—unlike the preceding three migrations—the high-risk cross-import inventory is complete. However, the plan weakens a literal roadmap acceptance criterion and contains a contradictory test-count gate. Those should be corrected before implementation.

## BLOCKING findings

### 1. AC2 quietly weakens the roadmap’s storage acceptance criterion

The roadmap explicitly requires policy-document and health-card upload/download to “still work against both S3 and disk storage” in [tasks/01.04-migrate-protection.md](/home/udai/PennyPilot/tasks/01.04-migrate-protection.md:15).

The plan instead treats import preservation, route presence, `Storage` signatures, and typechecking as proof, while explicitly declining any backend run in [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:322). That proves structural continuity, not that either backend works, much less both.

This matters because the two implementations have materially different code paths:

- Disk uses filesystem operations in [storage.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.ts:38).
- S3 uses AWS SDK commands in [storage.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.ts:67).
- Backend selection happens at runtime in [storage.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.ts:111).
- Insurance actually calls `put`, `get`, and `delete` in [insurance.ts](/home/udai/PennyPilot/apps/api/src/services/insurance.ts:158), [insurance.ts](/home/udai/PennyPilot/apps/api/src/services/insurance.ts:183), and [insurance.ts](/home/udai/PennyPilot/apps/api/src/services/insurance.ts:199), with corresponding health-card operations beginning at [insurance.ts](/home/udai/PennyPilot/apps/api/src/services/insurance.ts:222).

Concrete correction: add a backend contract/integration gate covering policy-document and health-card upload/download with disk and an S3-compatible test backend such as MinIO. If repository infrastructure cannot support that in this task, revise the roadmap criterion explicitly before marking task 1.4 done; do not claim the current AC2 satisfies it.

### 2. AC5 contains an impossible/contradictory test-count expectation

The plan says the API suite should have a “net +3 test count,” then immediately enumerates:

- 1 schema smoke test
- 1 plugin test
- 2 demo-403 tests

That is four new `test(...)` cases, not three: [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:333).

Concrete correction: change the expected delta to `+4` and the expected API baseline from 837 to 841, unless one of the described tests is deliberately combined or removed. The exact baseline should be re-measured immediately before implementation because the relevant working tree is uncommitted.

## NON-BLOCKING precision findings

### 1. Raw route-table snapshot is expected to remain unchanged

The plan says `route-table.snapshot.txt` will change because of plugin nesting and lists it as a modified file in [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:211) and [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:269).

That prediction is wrong for this migration. `printRoutes()` represents the URL radix tree, not Fastify encapsulation boundaries. The two current registrations are already adjacent and in the same retirement-then-insurance order in [app.ts](/home/udai/PennyPilot/apps/api/src/app.ts:122). I independently registered the current two route plugins both directly and through an in-memory wrapper plugin; `printRoutes({ commonPrefix: false })` was byte-identical.

This differs from credit and investments, whose raw trees changed because previously interleaved registrations were reordered, as their plugin comments explain in [credit/plugin.ts](/home/udai/PennyPilot/apps/api/src/modules/credit/plugin.ts:13) and [investments/plugin.ts](/home/udai/PennyPilot/apps/api/src/modules/investments/plugin.ts:13).

Concrete correction: retain a compare/check step, but state that no raw snapshot diff is expected. Do not list `route-table.snapshot.txt` as necessarily modified. If regeneration writes identical bytes, the empty diff is the correct result.

### 2. “54 occurrences” means matching lines, not identifier occurrences

The six-file inventory is complete, but the terminology/count is imprecise.

Independent counts are:

| File | Matching lines | Identifier tokens |
|---|---:|---:|
| `db/schema.ts` | 5 | 5 |
| `services/insurance.ts` | 31 | 40 |
| `services/retirement.ts` | 7 | 7 |
| `services/demo.ts` | 4 | 4 |
| `services/goals.ts` | 4 | 5 |
| `modules/ledger/services/accounts.ts` | 3 | 4 |
| Total | 54 | 65 |

Thus “54 occurrences” in [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:132) is wrong if occurrence means regex matches; it is exactly 54 matching source lines. The claimed six files and three external consumers are correct.

Concrete correction: say “54 matching lines across exactly six files” or “65 identifier occurrences across exactly six files.”

### 3. Canonical surface preservation is gated, not logically guaranteed by restructuring

The plan says the canonical surface “cannot change” in [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:217). Preserving the same handler bodies and paths should preserve it, but the restructure itself does not guarantee that; an implementation omission or typo could change it.

The canonical test is the actual guarantee: it records every `onRoute` method/path pair, detects duplicates, sorts them, and compares exact bytes in [app.route-snapshot.test.ts](/home/udai/PennyPilot/apps/api/src/app.route-snapshot.test.ts:80). Its own documentation correctly says the snapshot proves method/path identity only—not schemas, hooks, handlers, limits, or response behavior—in [app.route-snapshot.test.ts](/home/udai/PennyPilot/apps/api/src/app.route-snapshot.test.ts:17).

Concrete correction: replace “cannot change” with “must not change and is enforced by the canonical snapshot.”

### 4. The import-count prose understates the ledger-service edges

The operative rewrite list is complete, but the surrounding prose says “Three imports already point at `modules/ledger/services/*`.” There are four import statements:

- Route → attachments: [routes/insurance.ts](/home/udai/PennyPilot/apps/api/src/routes/insurance.ts:12)
- Service → attachments: [services/insurance.ts](/home/udai/PennyPilot/apps/api/src/services/insurance.ts:19)
- Service → transactions: [services/insurance.ts](/home/udai/PennyPilot/apps/api/src/services/insurance.ts:20)
- Service → resources: [services/insurance.ts](/home/udai/PennyPilot/apps/api/src/services/insurance.ts:21)

This does not create an implementation gap because all four appear in the depth-adjustment list.

### 5. The test fixture is not needed for the 403 guard itself

Creating a PPF account is a reasonable no-mutation fixture, but it is not needed to reach the demo rejection. The global `onRequest` hook rejects `PUT` before validation and handler execution in [auth.ts](/home/udai/PennyPilot/apps/api/src/plugins/auth.ts:43). `PUT` is explicitly mutating in [auth.ts](/home/udai/PennyPilot/apps/api/src/plugins/auth.ts:16).

If the hook regressed, the handler would then call `ownedRetirementAccount` before parsing or writing, at [retirement.ts](/home/udai/PennyPilot/apps/api/src/services/retirement.ts:50). Therefore the PPF fixture is useful to ensure a regressed request could progress to the intended write, and should be retained; the plan should simply describe it as strengthening the mutation assertion rather than as necessary to obtain the 403.

### 6. The plan is slightly over-engineered for this domain

For four small moves, the plan asks for a schema smoke test, plugin completeness test, two DB/Redis-backed demo tests, two snapshots, import-resolution scripting, Drizzle hash manifests, backup testing, and a full-diff evidence paste. Most of this is established migration discipline and defensible given prior failures. The unnecessary parts are:

- Assuming and regenerating a raw snapshot known to remain unchanged.
- The extensive prose insisting that a missing `storage` decoration is desirable.
- Repeated line-count/count-manifest claims where direct compile/test/diff gates already prove the relevant property.

The core migration scope itself is not over-expanded.

## Independently confirmed as RIGHT

### 1. Endpoint inventory — CONFIRMED

Exactly 14 explicit endpoints exist: 12 insurance and 2 retirement. No method or path is missing or misstated.

Insurance:

- `GET /api/insurance/policies` — [insurance.ts](/home/udai/PennyPilot/apps/api/src/routes/insurance.ts:33)
- `POST /api/insurance/policies` — [insurance.ts](/home/udai/PennyPilot/apps/api/src/routes/insurance.ts:39)
- `PUT /api/insurance/policies/:id` — [insurance.ts](/home/udai/PennyPilot/apps/api/src/routes/insurance.ts:45)
- `DELETE /api/insurance/policies/:id` — [insurance.ts](/home/udai/PennyPilot/apps/api/src/routes/insurance.ts:57)
- `POST /api/insurance/policies/:id/document` — [insurance.ts](/home/udai/PennyPilot/apps/api/src/routes/insurance.ts:69)
- `GET /api/insurance/policies/:id/document` — [insurance.ts](/home/udai/PennyPilot/apps/api/src/routes/insurance.ts:82)
- `DELETE /api/insurance/policies/:id/document` — [insurance.ts](/home/udai/PennyPilot/apps/api/src/routes/insurance.ts:96)
- `POST /api/insurance/policies/:id/health-cards` — [insurance.ts](/home/udai/PennyPilot/apps/api/src/routes/insurance.ts:106)
- `GET /api/insurance/health-cards/:cardId` — [insurance.ts](/home/udai/PennyPilot/apps/api/src/routes/insurance.ts:123)
- `DELETE /api/insurance/policies/:id/health-cards/:cardId` — [insurance.ts](/home/udai/PennyPilot/apps/api/src/routes/insurance.ts:137)
- `GET /api/insurance/policies/:id/premiums` — [insurance.ts](/home/udai/PennyPilot/apps/api/src/routes/insurance.ts:149)
- `POST /api/insurance/policies/:id/premiums` — [insurance.ts](/home/udai/PennyPilot/apps/api/src/routes/insurance.ts:155)

Retirement:

- `GET /api/retirement/:accountId/details` — [retirement.ts](/home/udai/PennyPilot/apps/api/src/routes/retirement.ts:12)
- `PUT /api/retirement/:accountId/details` — [retirement.ts](/home/udai/PennyPilot/apps/api/src/routes/retirement.ts:18)

The five automatic `HEAD` routes in the canonical snapshot are consistent with the five distinct GET paths.

### 2. Schema bindings — CONFIRMED

The protection-owned list is exactly three tables and four enums:

- `retirementDetails` — [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:951)
- `insuranceKind` — [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:997)
- `vehicleKind` — [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:998)
- `healthType` — [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:999)
- `premiumFrequency` — [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:1007)
- `insurancePolicies` — [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:1023)
- `insuranceHealthCards` — [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:1083)

Walking the surrounding schema definitions shows adjacent `bankDetails` and `bankAccountSubtype` are credit-owned, while `overdraftDetails` is also credit-owned. No additional protection enum or table was found. This matches the ownership approach used by the credit and investments schema barrels.

### 3. Cross-import completeness — CONFIRMED, including the high-risk claim

The plan is right on the claim class that blocked the prior migrations.

Exactly two production imports enter the protection domain from outside it, both in `app.ts`:

- Retirement route import — [app.ts](/home/udai/PennyPilot/apps/api/src/app.ts:31)
- Insurance route import — [app.ts](/home/udai/PennyPilot/apps/api/src/app.ts:32)

The only other real imports among the four files are their two in-domain route-to-service edges:

- [routes/insurance.ts](/home/udai/PennyPilot/apps/api/src/routes/insurance.ts:13)
- [routes/retirement.ts](/home/udai/PennyPilot/apps/api/src/routes/retirement.ts:5)

I searched `apps/api/src`, `apps/ingestor`, `apps/extractor`, and `packages` for the full old relative target paths and target basenames, covering multiline static imports, `import type`, re-exports, and dynamic-import syntax. No additional importer exists at any relative depth.

The shared package’s `./schemas/insurance.ts` re-export in [packages/shared/src/index.ts](/home/udai/PennyPilot/packages/shared/src/index.ts:12) is a different file and not a protection production-file importer.

The two prose references are correctly classified as harmless comments:

- [db/schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:332)
- [holding-details.ts](/home/udai/PennyPilot/apps/api/src/modules/investments/services/holding-details.ts:3)

### 4. Import rewrite list — CONFIRMED complete

For destination `modules/protection/services/`:

- `../db/index.ts` → `../../../db/index.ts`
- `../lib/errors.ts` → `../../../lib/errors.ts`
- `../lib/storage.ts` → `../../../lib/storage.ts`
- `../modules/ledger/services/...` → `../../ledger/services/...`
- Protection-owned tables → `../schema.ts`
- Ledger-owned tables (`transactions`, `accounts`) → `../../../db/schema.ts`

For destination `modules/protection/routes/`:

- `../lib/errors.ts` → `../../../lib/errors.ts`
- `../modules/ledger/services/attachments.ts` → `../../ledger/services/attachments.ts`
- `../services/<name>.ts` remains `../services/<name>.ts`

The two mixed table imports requiring splits are exactly:

- [services/insurance.ts](/home/udai/PennyPilot/apps/api/src/services/insurance.ts:16)
- [services/retirement.ts](/home/udai/PennyPilot/apps/api/src/services/retirement.ts:5)

No import in any of the four files is omitted, and every proposed destination resolves correctly.

### 5. Table-import convention — CONFIRMED

Across production and test files under `modules/ledger`, `modules/credit`, `modules/investments`, and `modules/planning`:

- A module imports its own tables from `../schema.ts`.
- Non-owned tables come from `../../../db/schema.ts`.
- No module imports tables through another module’s `schema.ts`.

Representative evidence:

- Credit: [bank-details.ts](/home/udai/PennyPilot/apps/api/src/modules/credit/services/bank-details.ts:5)
- Investments: [account-nps.ts](/home/udai/PennyPilot/apps/api/src/modules/investments/services/account-nps.ts:5)
- Ledger: [recurring.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:9)
- Planning: [projection-settings.ts](/home/udai/PennyPilot/apps/api/src/modules/planning/services/projection-settings.ts:5)

No counterexample was found.

### 6. Cross-module consumers — CONFIRMED except occurrence terminology

Exactly three production files outside the protection domain consume these table bindings:

- Demo seeding imports/inserts `retirementDetails` and `insurancePolicies`: [demo.ts](/home/udai/PennyPilot/apps/api/src/services/demo.ts:19), [demo.ts](/home/udai/PennyPilot/apps/api/src/services/demo.ts:139), [demo.ts](/home/udai/PennyPilot/apps/api/src/services/demo.ts:225)
- Goals reads `retirementDetails.annualRateBps`: [goals.ts](/home/udai/PennyPilot/apps/api/src/services/goals.ts:12), [goals.ts](/home/udai/PennyPilot/apps/api/src/services/goals.ts:263)
- Ledger accounts clears retirement-specific fields: [accounts.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:11), [accounts.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:455)

Leaving all three untouched is safe because definitions remain in and exported from `db/schema.ts`; protection adds only a named re-export. There is no runtime object duplication.

### 7. Demo-403 design — CONFIRMED

- `POST` and `PUT` are both in `MUTATING_METHODS`: [auth.ts](/home/udai/PennyPilot/apps/api/src/plugins/auth.ts:16).
- Demo rejection happens in the root `onRequest` hook before handlers: [auth.ts](/home/udai/PennyPilot/apps/api/src/plugins/auth.ts:43).
- Neither path is the sole allowlisted logout path: [auth.ts](/home/udai/PennyPilot/apps/api/src/plugins/auth.ts:18).
- `app.storage` is referenced only in insurance handler bodies, e.g. [insurance.ts](/home/udai/PennyPilot/apps/api/src/routes/insurance.ts:61), and nowhere during plugin registration.
- Insurance’s registration-time work is limited to creating a type provider and declaring routes: [insurance.ts](/home/udai/PennyPilot/apps/api/src/routes/insurance.ts:30).
- One PPF account is sufficient if the PUT handler unexpectedly executes; ownership/type checking precedes input parsing and insertion: [retirement.ts](/home/udai/PennyPilot/apps/api/src/services/retirement.ts:20), [retirement.ts](/home/udai/PennyPilot/apps/api/src/services/retirement.ts:50).
- A whole-module plugin works in the hermetic harness because nested Fastify plugins inherit the auth hook and require no DB/storage operation during registration.
- The proposed no-storage decoration matches existing hermetic plugin-test practice in [credit/plugin.test.ts](/home/udai/PennyPilot/apps/api/src/modules/credit/plugin.test.ts:7).

### 8. Registration order and canonical snapshot — CONFIRMED with raw-snapshot correction

Current order is retirement, then insurance, after credit and before insights: [app.ts](/home/udai/PennyPilot/apps/api/src/app.ts:122). Preserving that order inside `protectionRoutes` and placing the module call at the current retirement position is correct.

The canonical surface snapshot must remain byte-identical. It checks exact method/path pairs and duplicates in [app.route-snapshot.test.ts](/home/udai/PennyPilot/apps/api/src/app.route-snapshot.test.ts:80).

The raw tree prediction is the only wrong part: it should remain unchanged, not necessarily change.

### 9. Extractor test waiver — CONFIRMED real and unrelated

The packaging gap is real:

- Extractor test script lacks env-file loading: [apps/extractor/package.json](/home/udai/PennyPilot/apps/extractor/package.json:9)
- API test script includes it: [apps/api/package.json](/home/udai/PennyPilot/apps/api/package.json:14)
- The extractor test throws immediately when `DATABASE_URL` is absent: [statement-duplicate.test.ts](/home/udai/PennyPilot/apps/extractor/src/statement-duplicate.test.ts:27)
- The pool is constructed at module scope using that guard: [statement-duplicate.test.ts](/home/udai/PennyPilot/apps/extractor/src/statement-duplicate.test.ts:39)

That failure is structurally unrelated to moving API protection files. The waiver is acceptable only if the implementation re-runs the root suite and verifies this remains the sole failure, as the plan requires.

### 10. Other dependency/risk checks — CONFIRMED no missing migration work

- Web uses all relevant endpoints, including both retirement routes and the insurance CRUD/upload/download/premium surfaces: [account-detail-queries.ts](/home/udai/PennyPilot/apps/web/src/lib/account-detail-queries.ts:45), [insurance-queries.ts](/home/udai/PennyPilot/apps/web/src/lib/insurance-queries.ts:17), and [InsurancePage.tsx](/home/udai/PennyPilot/apps/web/src/routes/insurance/InsurancePage.tsx:274). Because URLs and schemas remain unchanged, no web edit is required.
- `db/bootstrap.ts` and `db/seed.ts` contain no protection binding or table-name dependency.
- `packages/shared` supplies schemas but imports none of the moved API files; no shared-package edit is required.
- Raw SQL references occur in historical Drizzle migrations, restore/backup infrastructure, and extractor tests—not as imports of relocated files.
- `restore-user.ts` uses string table names and generic SQL, so relocation is irrelevant: [restore-user.ts](/home/udai/PennyPilot/apps/api/src/services/restore-user.ts:14), [restore-user.ts](/home/udai/PennyPilot/apps/api/src/services/restore-user.ts:28).
- Backup already covers all three tables and both storage-key columns: [backup.ts](/home/udai/PennyPilot/apps/api/src/services/backup.ts:35), [backup.ts](/home/udai/PennyPilot/apps/api/src/services/backup.ts:150).
- No schema definition changes are planned, so no Drizzle migration should be generated. A zero-diff generation check is appropriate.
- Historical migration SQL and metadata must remain untouched.
- No job or scheduler imports either moved service.

Once AC2 is made faithful to the roadmap and AC5’s arithmetic is corrected, the implementation plan is otherwise ready.