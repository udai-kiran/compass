## Review findings

### 1. P1 diagnoses the wrong desynchronization

The manifest declaration is correct: [`apps/api/package.json:33`](/home/udai/common/compass/apps/api/package.json:33) includes `fast-check: "^4.9.0"`.

However, contrary to [`TASK.md:18`](/home/udai/common/compass/tasks/057-green-baseline/TASK.md:18), `fast-check` is already fully represented in the current lockfile:

- Workspace dependency: [`package-lock.json:46`](/home/udai/common/compass/package-lock.json:46)
- Resolved package entry for version 4.9.0: [`package-lock.json:13431`](/home/udai/common/compass/package-lock.json:13431)

It is absent from both `node_modules/fast-check` and `apps/api/node_modules/fast-check`, and `npm ls fast-check --all` reports an empty tree. The actual current defect is therefore:

> `package.json` and `package-lock.json` agree, but the installed `node_modules` tree is stale/incomplete.

The historical attribution is also wrong. Commit `b829d87` removed 499 lockfile lines, but `fast-check` is present both before and after that commit. It was not pruned by that commit.

Running `npm install` should install the missing package, but because the lockfile already contains the correct resolution, it need not change `package-lock.json`. This conflicts with:

- P1’s “re-sync the lockfile” wording at [`TASK.md:56`](/home/udai/common/compass/tasks/057-green-baseline/TASK.md:56)
- Scope’s promised lockfile change at [`TASK.md:44`](/home/udai/common/compass/tasks/057-green-baseline/TASK.md:44)
- T4’s expectation that `package-lock.json` changes at [`TASK.md:93`](/home/udai/common/compass/tasks/057-green-baseline/TASK.md:93)
- AC7’s “only `package-lock.json` changes” at [`TASK.md:86`](/home/udai/common/compass/tasks/057-green-baseline/TASK.md:86)

The plan should explicitly allow no tracked dependency-file change.

### 2. The TS7006 errors are genuinely cascading errors

The API inherits `strict: true` from [`tsconfig.base.json:7`](/home/udai/common/compass/tsconfig.base.json:7) through [`apps/api/tsconfig.json:2`](/home/udai/common/compass/apps/api/tsconfig.json:2), so `noImplicitAny` is enabled.

Nevertheless, the callback parameters at:

- [`postings.test.ts:61`](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.test.ts:61)
- [`postings.test.ts:373`](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.test.ts:373)
- [`postings.test.ts:399`](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.test.ts:399)
- [`postings.test.ts:432`](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.test.ts:432)
- [`postings.test.ts:459`](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.test.ts:459)

are contextually typed by `fc.property` when `fast-check` resolves. Their parameter types follow from the preceding arbitraries: strings, numbers, booleans, arrays, and the inferred record shape. They do not independently require explicit annotations.

Thus P1 is sufficient to remove all 18 typecheck errors, but for installed-tree repair—not lockfile repair.

### 3. P2 is type-compatible

The proposed input types match the actual service contracts:

- `createSplit` explicitly returns `typeof splits.$inferSelect` at [`splits.ts:28`](/home/udai/common/compass/apps/api/src/modules/household/services/splits.ts:28).
- `getSplit` explicitly returns a full split row and full share rows at [`splits.ts:99`](/home/udai/common/compass/apps/api/src/modules/household/services/splits.ts:99).
- `updateSplit` returns those same full-row types at [`splits.ts:110`](/home/udai/common/compass/apps/api/src/modules/household/services/splits.ts:110).

The mapper’s fields at [`routes/splits.ts:25`](/home/udai/common/compass/apps/api/src/modules/household/routes/splits.ts:25) satisfy `HouseholdSplit`:

- Drizzle timestamps at [`schema.ts:121`](/home/udai/common/compass/apps/api/src/modules/household/schema.ts:121) and [`schema.ts:136`](/home/udai/common/compass/apps/api/src/modules/household/schema.ts:136) infer as `Date`.
- `z.coerce.date()` has `Date` as its output type at [`household.ts:85`](/home/udai/common/compass/packages/shared/src/schemas/household.ts:85) and [`household.ts:96`](/home/udai/common/compass/packages/shared/src/schemas/household.ts:96).
- `sharePaise` uses `bigint(..., { mode: "number" })` at [`schema.ts:135`](/home/udai/common/compass/apps/api/src/modules/household/schema.ts:135), so its inferred TypeScript type is `number`, matching [`household.ts:84`](/home/udai/common/compass/packages/shared/src/schemas/household.ts:84).

One implementation caveat is missing from the plan: with `verbatimModuleSyntax: true` at [`tsconfig.base.json:9`](/home/udai/common/compass/tsconfig.base.json:9), `HouseholdSplit` must be imported with `import type`. A normal value import would produce TS1484.

### 4. P3 is type-compatible

Both settlement services return full rows:

- `createSettlement`: [`settlements.ts:14`](/home/udai/common/compass/apps/api/src/modules/household/services/settlements.ts:14)
- `listSettlements`: [`settlements.ts:33`](/home/udai/common/compass/apps/api/src/modules/household/services/settlements.ts:33)

The mapper at [`routes/settlements.ts:21`](/home/udai/common/compass/apps/api/src/modules/household/routes/settlements.ts:21) satisfies `Settlement`:

- `amountPaise` is a TypeScript `number` because the column uses `{ mode: "number" }` at [`schema.ts:154`](/home/udai/common/compass/apps/api/src/modules/household/schema.ts:154).
- Zod’s `.int().positive()` constraint at [`household.ts:128`](/home/udai/common/compass/packages/shared/src/schemas/household.ts:128) does not create a narrower branded TypeScript type; its inferred type remains `number`.
- `createdAt` is `Date` on both sides.
- The `?? null` conversions correctly satisfy the nullable shared fields.

As with P2, `Settlement` must be a type-only import under `verbatimModuleSyntax`.

### 5. P4 compiles and has no runtime behavior change

`SharingResourceType` exactly matches the Drizzle enum values declared at [`schema.ts:71`](/home/udai/common/compass/apps/api/src/modules/household/schema.ts:71).

There is only one caller of `listGrants`: [`routes/sharing.ts:52`](/home/udai/common/compass/apps/api/src/modules/household/routes/sharing.ts:52). Its `req.query.resourceType` comes from `SharingResourceTypeSchema.optional()` at [`routes/sharing.ts:12`](/home/udai/common/compass/apps/api/src/modules/household/routes/sharing.ts:12), not from a plain `string`. It remains compatible after tightening the signature.

No other caller passes a plain string.

P4 is type erasure only. It neither introduces runtime validation nor changes the SQL condition. The route already rejects values outside the enum through its Zod query schema. Therefore AC6 is true for P4.

The plan calls this a “widen” at [`TASK.md:67`](/home/udai/common/compass/tasks/057-green-baseline/TASK.md:67), but it is actually a narrowing from arbitrary `string` to the enum union.

### 6. Current lint scope is complete

Running the full root lint command reproduces exactly 10 errors and zero warnings:

- Four in [`routes/splits.ts:25`](/home/udai/common/compass/apps/api/src/modules/household/routes/splits.ts:25) and [`routes/splits.ts:35`](/home/udai/common/compass/apps/api/src/modules/household/routes/splits.ts:35)
- Two in [`routes/settlements.ts:21`](/home/udai/common/compass/apps/api/src/modules/household/routes/settlements.ts:21)
- One in [`services/grants.ts:59`](/home/udai/common/compass/apps/api/src/modules/household/services/grants.ts:59)
- Unused `gt` at [`membership.ts:1`](/home/udai/common/compass/apps/api/src/modules/household/services/membership.ts:1)
- Unused `IncomeSurplusComputation` at [`income-surplus.test.ts:6`](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.test.ts:6)
- Unused `AcceptInviteSchema` at [`household-queries.ts:4`](/home/udai/common/compass/apps/web/src/lib/household-queries.ts:4)

Those imports are genuinely unreferenced. There are no additional lint or typecheck errors currently omitted from the six-source-file scope.

### 7. AC5’s failure count is wrong

The current test totals are exactly 1,312:

| Workspace | Tests | Pass | Fail |
|---|---:|---:|---:|
| API | 712 | 685 | 26 |
| Extractor | 74 | 73 | 1 |
| Ingestor | 12 | 12 | 0 |
| Web | 270 | 270 | 0 |
| AI | 32 | 32 | 0 |
| Shared | 212 | 212 | 0 |
| Total | 1,312 | 1,285 | 27 |

But one of the 27 failures is `postings.test.ts` failing to load because `fast-check` is absent. It is not `DATABASE_URL`-gated.

If P1 works and that file passes, the expected baseline becomes:

> 1,312 total, 1,286 passing, 26 failing.

The remaining 26 consist of 25 API test-file failures plus the extractor database-gated failure; the extractor test explicitly throws when `DATABASE_URL` is absent at [`statement-duplicate.test.ts:32`](/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:32).

Therefore these claims are incorrect:

- “27 remaining failures” at [`TASK.md:82`](/home/udai/common/compass/tasks/057-green-baseline/TASK.md:82)
- “27 `DATABASE_URL`-gated test failures” at [`TASK.md:99`](/home/udai/common/compass/tasks/057-green-baseline/TASK.md:99)

Treating the database-dependent failures as out of scope is defensible for a typecheck/lint baseline task, but the expected count must be corrected to 26 after `fast-check` is installed.

### 8. Verification gaps and contradictions

T1 and T2 are sufficient for the stated green-baseline objective. T3 is checkable, but its expected failure count must be corrected.

AC6 is not actually verified. A source diff can show that mapper bodies were not intentionally changed, but it does not prove byte-identical JSON output. There are no household route tests covering splits, settlements, or sharing. If byte-identical route output is a real acceptance requirement, add focused mapper or route serialization tests before and after the annotations.

T5 is poorly specified. The literal pattern `any` will match unrelated identifiers such as `findMany` at [`membership.ts:139`](/home/udai/common/compass/apps/api/src/modules/household/services/membership.ts:139), so “expect no matches” is false. Use a word-boundary pattern such as `\bany\b`, and check suppression directives separately.

Finally, AC7 is ambiguously worded: “only `package-lock.json` changes” contradicts the six planned source edits. It presumably means “among package/dependency files, only `package-lock.json` may change,” but even that allowance is unnecessary because the lockfile is already correct.

## Verdict

The source-code fixes P2–P5 are sound and should compile if shared types are imported with `import type`. The service-row assumptions are correct, and the six source files cover all current lint errors.

The plan needs revision before implementation because P1’s root-cause history and expected lockfile mutation are wrong, AC5’s post-fix failure count should be 26 rather than 27, AC7 is contradictory, T5 produces a false positive, and AC6 lacks a verification method.