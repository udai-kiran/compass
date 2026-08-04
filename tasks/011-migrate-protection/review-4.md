# Implementation review — Task 1.4

## Final verdict: SHIP

No blocking defects found. The production change is a genuine relocation, not a rewrite. All four moved files differ from `git HEAD` only in import declarations, all imports resolve with explicit `.ts` extensions, route identity is preserved, schema definitions and migrations are untouched, and the new tests provide meaningful regression coverage.

## 1. Correctness and regressions

### Relocation integrity — met

Direct comparisons against `git HEAD` show:

- `apps/api/src/services/insurance.ts` → `apps/api/src/modules/protection/services/insurance.ts`
  - Only imports changed at new lines 15–22.
- `apps/api/src/services/retirement.ts` → `apps/api/src/modules/protection/services/retirement.ts`
  - Only imports changed at new lines 4–7.
- `apps/api/src/routes/insurance.ts` → `apps/api/src/modules/protection/routes/insurance.ts`
  - Only imports changed at new lines 11–12.
- `apps/api/src/routes/retirement.ts` → `apps/api/src/modules/protection/routes/retirement.ts`
  - Byte-identical to `HEAD`.

There are no changes to:

- handler bodies
- methods or paths
- status codes
- Zod schemas
- service control flow
- SQL predicates
- error paths
- storage behavior

This satisfies AC9.

### User scoping — preserved

Because all service bodies are unchanged from `HEAD`, no query gained or lost a `userId` predicate.

Representative checks:

- Policy ownership: [insurance.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/insurance.ts:71)
- Policy listing is user-scoped: [insurance.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/insurance.ts:79)
- Policy updates retain both ID and user ID predicates: [insurance.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/insurance.ts:128)
- Health-card reads remain user-scoped: [insurance.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/insurance.ts:253)
- Premium transaction lookup remains user-scoped: [insurance.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/insurance.ts:289)
- Retirement account ownership checks both account ID and user ID: [retirement.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/retirement.ts:21)
- Retirement details lookup checks both account ID and user ID: [retirement.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/retirement.ts:36)
- Retirement writes retain `{ accountId, userId }`: [retirement.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/retirement.ts:65)

No data-leak-class regression was introduced.

## 2. Import correctness

### Explicit `.ts` extensions — met

Every rewritten relative import carries an explicit `.ts` extension, as required by the Node 24 native-TypeScript runtime.

A source-aware filesystem resolution check found no broken relative imports in the new protection module.

### Split imports — correct

Insurance service:

- Protection-owned `insuranceHealthCards` and `insurancePolicies` come from `../schema.ts`: [insurance.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/insurance.ts:16)
- Ledger-owned `transactions` comes from `../../../db/schema.ts`: [insurance.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/insurance.ts:17)

Retirement service:

- Protection-owned `retirementDetails` comes from `../schema.ts`: [retirement.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/retirement.ts:5)
- Ledger-owned `accounts` comes from `../../../db/schema.ts`: [retirement.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/retirement.ts:6)

No moved file imports a non-owned table from another module’s `schema.ts`.

### Depth changes — correct

The rewritten targets resolve correctly:

- DB imports: `../../../db/index.ts`
- Shared schema imports: `../../../db/schema.ts`
- Errors/storage: `../../../lib/*.ts`
- Ledger services: `../../ledger/services/*.ts`
- Route-to-service imports remain `../services/*.ts`

No stale import resolves to one of the four deleted flat paths.

## 3. Schema safety

### Thin named re-export — met

[modules/protection/schema.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/schema.ts:25) exports exactly these seven bindings:

1. `retirementDetails`
2. `insuranceKind`
3. `vehicleKind`
4. `healthType`
5. `premiumFrequency`
6. `insurancePolicies`
7. `insuranceHealthCards`

It contains no `pgTable()` or `pgEnum()` definition.

There is no reverse `export *` from `db/schema.ts` to the protection schema.

### Existing definitions and migrations — untouched

- `apps/api/src/db/schema.ts` has no working-tree diff.
- `apps/api/drizzle/**` has no working-tree changes or newly generated migration.
- None of the existing `pgTable()` or `pgEnum()` definitions was altered.

### Identity smoke test — meaningful

[schema.smoke.test.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/schema.smoke.test.ts:20) covers all three tables, and the second test at line 30 covers all four enums.

Both loops use `assert.strictEqual`, at lines 22 and 32, proving object identity rather than structural equality.

## 4. Plugin and route identity

### Plugin ordering — met

[plugin.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/plugin.ts:20) registers:

1. `retirementRoutes` at line 21
2. `insuranceRoutes` at line 22

No prefix is supplied.

### Application position — met

[app.ts](/home/udai/PennyPilot/apps/api/src/app.ts:130) registers:

- `creditRoutes` at line 130
- `protectionRoutes` at line 131
- `insightRoutes` at line 132

This is exactly the old protection registration position.

### Endpoint preservation — met

All 14 explicit endpoints remain:

- 12 insurance endpoints in [insurance.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/routes/insurance.ts:30)
- 2 retirement endpoints in [retirement.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/routes/retirement.ts:9)

The committed canonical snapshot contains all 14 methods and paths, plus the expected five automatic `HEAD` routes.

Snapshot hashes are byte-identical to `HEAD`:

- `route-surface.snapshot.txt`: `a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122`
- `route-table.snapshot.txt`: `7800feb971c2e570040a299addf207960a0866f2a7feb377c4a2cf84bf4255c8`

Neither snapshot has a working-tree diff.

## 5. Test quality

### Demo-write tests — substantive, not theatre

[protection.route.test.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/routes/protection.route.test.ts:103) tests insurance:

- Creates a real user and demo session.
- Confirms the precondition of zero policy rows at lines 111–115.
- Injects the correct registered URL, `POST /api/insurance/policies`, at lines 117–122.
- Asserts `403` at line 123.
- Re-queries `insurance_policies` using the user ID and asserts no row at lines 125–129.

The retirement test begins at line 132:

- Creates a real user and demo session.
- Inserts the required PPF account fixture at lines 144–147.
- Confirms no retirement row exists at lines 149–153.
- Injects the correct registered URL at lines 155–160.
- Asserts `403` at line 161.
- Re-queries `retirement_details` and asserts no row at lines 163–167.

These tests would fail if demo-write protection regressed:

- A missing or invalid session would produce `401`, not the asserted `403`.
- An unregistered non-hook-protected route would not satisfy the expected behavior.
- If the demo guard stopped rejecting the valid retirement request, the PPF fixture allows execution to reach the write.
- If the insurance handler were reached, the absent `storage` decoration or validation/handler result would cause a non-403 failure.
- Both mutation assertions execute after the status assertion and query the actual tables.

The route literals are independently backed by the plugin introspection test and frozen route snapshot, so the tests are not relying on unverified URLs.

### Deliberate absence of storage stub — correct

The test app decorates only:

- `config`
- `pg`
- `db`
- `redis`

See [protection.route.test.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/routes/protection.route.test.ts:53). There is no `decorate("storage", ...)`.

That omission strengthens the failure mode as intended.

### Plugin test — correct scope

[plugin.test.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/plugin.test.ts:23):

- Registers the complete `protectionRoutes` plugin.
- Uses `app.hasRoute()` at line 36.
- Checks one route from each internal registration.
- Never invokes `app.inject()`.

The only textual occurrence of `app.inject()` is in a comment explicitly saying it is not used.

### Schema smoke test — correct strength

As noted above, it uses `assert.strictEqual` for all seven bindings. It would fail if the module accidentally created duplicate Drizzle objects.

## 6. Plan conformance

### P1–P12

| Plan item | Result | Evidence |
|---|---|---|
| P1 baseline snapshots/test count | Unprovable from final code alone | Implementation evidence records 837 tests and pre-change snapshot hashes. Current hashes match `HEAD`. |
| P2 schema and smoke tests | Met | Exact seven-binding re-export; two identity tests. |
| P3 move services | Met | Both services relocated; exact diffs contain imports only. |
| P4 move routes | Met | Both routes relocated; one import-only diff and one byte-identical file. |
| P5 plugin and app update | Met | Correct order, no prefix, correct application position and plugin test. |
| P6 remove flat paths | Met | All four old paths are absent and appear as deletions. |
| P7 route identity | Met | Both snapshot files are byte-identical to `HEAD`; route snapshot test reportedly passed. |
| P8 demo-write tests | Met | Two real injection tests, each asserting 403 and no mutation. |
| P9 `db:generate`/hash process | Unprovable from code alone | No migration diff exists; implementation report records identical 139-file manifests. |
| P10 backup test | Met by recorded verification | `backup.ts` is untouched; implementation report records the unmodified test passing. |
| P11 full gate and diff review | Met with documented existing waiver | Typecheck/lint/API tests passed; root test’s only failure was the pre-existing extractor environment issue. Exact moved-file diff is clean. |
| P12 roadmap changes/status sequencing | Met in final tree; sequencing unprovable from code alone | All four roadmap edits exist, and implementation evidence says status was flipped last. |

### AC1–AC10

| Acceptance criterion | Result |
|---|---|
| AC1 snapshots, migrations, backup | Met. Both snapshots match `HEAD`; no Drizzle change; backup files untouched and recorded test green. |
| AC2 structural storage seam and 1.10 gate | Met. Seven `app.storage` route uses and seven `Storage` service signatures remain; all four roadmap changes exist. |
| AC3 typecheck and lint | Met by recorded verification: both exit 0. |
| AC4 schema safety | Met. Exact named re-export, no cycle, seven strict identity checks. |
| AC5 API tests 837→842 | Met by recorded verification: 842/842, exactly +5. |
| AC6 import completeness | Met. All rewritten imports resolve and no deleted flat path is referenced. |
| AC7 plugin completeness | Met. `hasRoute()` checks both registrations without handler execution. |
| AC8 demo-mode protection | Met. Both 403s and both no-mutation assertions are present and non-vacuous. |
| AC9 move, not rewrite | Met. Exact `HEAD` comparisons contain import-line changes only. |
| AC10 boundary convention | Met. Owned and non-owned tables are imported from the prescribed locations. |

## 7. Roadmap edits

All four required edits are present:

1. [01.04-migrate-protection.md](/home/udai/PennyPilot/tasks/01.04-migrate-protection.md:6)
   - Status is `done`.
   - Line 16 now states the structural `Storage` guarantee and points to task 1.10.

2. [01.10-storage-backend-contract-tests.md](/home/udai/PennyPilot/tasks/01.10-storage-backend-contract-tests.md:1)
   - Correct frontmatter, including `depends: [1.4]`.
   - Contains all five concrete acceptance criteria at lines 15–19.
   - It is substantive, not a placeholder.

3. [tasks/README.md](/home/udai/PennyPilot/tasks/README.md:106)
   - Contains the 1.10 row immediately after 1.9.

4. [01.09-cross-module-ports.md](/home/udai/PennyPilot/tasks/01.09-cross-module-ports.md:7)
   - Literally contains:
     `depends: [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10]`

The Phase 1 closure gate is therefore enforceable.

## 8. Unapproved changes

### Protected production files

No unapproved edit was found in any required-untouched production file:

- `apps/api/src/services/demo.ts`
- `apps/api/src/services/goals.ts`
- `apps/api/src/modules/ledger/services/accounts.ts`
- `apps/api/src/services/backup.ts`
- `apps/api/src/services/restore-user.ts`
- `apps/api/src/jobs/index.ts`
- `apps/api/src/db/schema.ts`
- `apps/api/src/route-surface.snapshot.txt`
- `apps/api/src/route-table.snapshot.txt`
- `apps/api/drizzle/**`

### Known implementation-report scope slip

`tasks/011-migrate-protection/implementation-1.md` exists outside the backend agent’s stated `apps/api/src/**` scope. It was subsequently overwritten by the verifying worker as described.

This affected no production file and is non-blocking.

### Other workspace noise

The working tree contains numerous unrelated untracked task directories and a pre-existing modification to `tasks/011-migrate-protection/TASK.md`. They are outside this implementation’s production scope and are not evidence of a protection-module code regression. They should not be accidentally included if the eventual commit is intended to contain only Task 1.4.

## Non-blocking nits

- The new schema and plugin files contain unusually long explanatory comments. They do not affect runtime behavior or correctness.
- The final tree cannot independently prove that P1 occurred before implementation, that the status flip happened last, or that `db:generate` was actually executed. The implementation report supplies that process evidence, while the resulting hashes and clean migration tree are consistent with it.
- `tasks/01.04-migrate-protection.md` is marked `done` while its Markdown acceptance checkboxes remain unchecked. This matches the existing roadmap style but is mildly inconsistent presentation-wise.

No blocking defect exists. **SHIP.**