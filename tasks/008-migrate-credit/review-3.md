# Implementation Review — Task 008: Migrate Credit

## Verdict

**Acceptance-ready. No blocking code defect or plan-conformance gap found.**

The current implementation correctly realizes the approved revision-2 plan. I verified the actual working tree rather than relying on the implementation report. AC1–AC10 and every Required Change/Must Not Change item in `DELEGATION.md` are satisfied.

The approved plan contains one factual error: the original `cards.test.ts` had **50**, not 49, top-level test blocks. The implementation correctly preserves all 50 as 11 cycle-math tests, 13 reconciliation-read tests, and 26 reconciliation-write tests. This is documentation drift in the approved plan, not an implementation defect.

## Findings

No blocking, high-, medium-, or low-severity implementation findings.

### 1. Credit schema boundary — pass

`apps/api/src/modules/credit/schema.ts` is genuinely a thin named re-export:

- Eight tables:
  - `cardDetails`
  - `cardIssuerSettings`
  - `cardStatements`
  - `bankDetails`
  - `overdraftDetails`
  - `rewardEntries`
  - `statementReconciliations`
  - `emiDetails`
- Exactly two owned enums:
  - `cardNetwork`
  - `bankAccountSubtype`

There are no physical `pgTable()` or `pgEnum()` calls in this file.

`apps/api/src/db/schema.ts` has no import or `export *` back to `modules/credit`, so the move introduces no schema barrel cycle. Its tracked contents are unchanged.

`schema.smoke.test.ts` checks object identity for all eight table objects and both enum objects. The test passed.

### 2. Internal cross-file exports — pass

All three functions that had to become exported for the service decomposition are exported:

- `ownedCardAccount` from `cards.ts`
- `toReconciliationDto` from `reconciliation-reads.ts`
- `ledgerDuesAtDates` from `reconciliation-reads.ts`

Each has a nearby doc comment explicitly characterizing the export as an internal cross-file implementation seam rather than a public HTTP/package API commitment.

The actual call graph is correct:

- `reconciliation-writes.ts` imports `ownedCardAccount`.
- It also imports `toReconciliationDto`, `ledgerDuesAtDates`, `dueDrift`, and `summarizeStatementLines` from `reconciliation-reads.ts`.
- The dependencies remain one-directional; no circular service import was introduced.

### 3. Reward-rate interface and arithmetic safety — pass

`rewards.ts` contains both required interfaces:

- `getCardEarnRate(db, userId, accountId)`
- `earnedRewardPoints(spendPaise, earnRatePer100)`

`getCardEarnRate` first calls `ownedCardAccount`, thereby enforcing:

- 404 for a missing or foreign account
- 400 for a non-credit-card account

It then scopes the `card_details` lookup by both `accountId` and `userId`, returns the stored integer rate, returns `null` when no details row exists, and preserves a genuinely stored zero as `0`.

`earnedRewardPoints` implements:

```text
floor(spendPaise × earnRatePer100 / 10,000)
```

Its rejection order and semantics are correct:

- Rejects negative spend.
- Rejects negative rate.
- Checks `Number.isSafeInteger(spendPaise)`.
- Checks `Number.isSafeInteger(earnRatePer100)`.
- Computes the product.
- Checks `Number.isSafeInteger(product)` before division.
- Only then divides and floors.

Because `Number.isSafeInteger` rejects non-integers, the implementation also correctly covers the separately stated integer requirement.

The test suite includes the critical product-overflow case where both inputs are individually safe:

- `spendPaise = 200_000_000_000`
- `earnRatePer100 = 100_000_000`

The test explicitly verifies that each operand is safe, the product is unsafe, and the function throws an HTTP 400 error.

The documentation describes the sign convention, exact formula, validation behavior, and simplified base-rate limitation, including the omitted category rules, caps, bonuses, valuation, and expiry behavior.

### 4. Test decomposition and original count — pass, with approved-plan correction

The original test file is recoverable from Git history. `HEAD:apps/api/src/services/cards.test.ts` contains **50** top-level `test(...)` blocks.

The current relocated counts are:

| Test file | Count |
|---|---:|
| `cycle-math.test.ts` | 11 |
| `reconciliation-reads.test.ts` | 13 |
| `reconciliation-writes.test.ts` | 26 |
| **Total relocated** | **50** |

The original and current sorted test-name sets match exactly: no original test name was dropped or duplicated.

The discrepancy is specifically the one disclosed by the implementer: `driftPresentation` has five cases, making reconciliation reads 13 and the total 50. The implementation follows the actual source rather than silently dropping a test to agree with the erroneous 49-test plan count.

The split honestly reflects existing coverage:

- There is no fabricated `cards.test.ts`.
- There is no fabricated `alerts.test.ts`.
- `rewards.test.ts` is non-empty and contains genuinely new reward-interface tests.
- Only cycle math and the two reconciliation seams received relocated tests.

### 5. Test concurrency fix — pass

The concurrency mitigation is real and correctly scoped.

Only the helper in the new `rewards.test.ts` inserts its throwaway users with:

```ts
isDemo: true
```

Neither production `rewards.ts` nor production `cards.ts` reads `users.isDemo` as part of `getCardEarnRate` or `ownedCardAccount`. The tests therefore still exercise actual account ownership, account type, and `card_details` lookup behavior.

The existing `card-due-tasks.test.ts` precondition still counts non-demo `card_details` rows globally. It was not weakened or bypassed. Production card-due materialization was not changed for this fix.

The new reward tests still cover:

- Stored nonzero rate
- Missing `card_details` row
- Stored zero rate
- Missing account
- Another user’s account
- Non-credit-card account

Thus the demo flag affects only exclusion from an unrelated global batch-test guard and does not reduce test validity.

### 6. Module and route registration — pass

`registerRoutes()` in `app.ts` imports and registers one `creditRoutes` plugin. The former four direct credit registrations are absent.

`modules/credit/plugin.ts` registers all four route groups without a prefix:

- cards
- EMIs
- bank details
- overdraft details

`plugin.test.ts` uses Fastify route lookup rather than handler injection and checks one attributable route from each route file. It passed.

There is no new route prefix, and the four moved route files retain their existing paths, methods, schemas, handlers, response codes, and response shapes aside from necessary service import decomposition.

### 7. Authentication and security inheritance — pass

The plugin restructuring does not move credit routes outside the existing security boundary.

In `buildApp()`:

1. `setupAuth(app)` installs the root authentication/demo-write hook.
2. `setupSecurity(app)` installs the root CSRF, rate-limit, and response-security hooks.
3. `registerRoutes(app)` subsequently registers `creditRoutes`.

Fastify’s nested credit plugin therefore inherits the same root hooks as the former separately registered route plugins. No credit route opts out as public, and no prefix or separate Fastify scope bypass was introduced.

### 8. Route snapshots — pass

The live route-snapshot tests passed:

- Canonical method/path surface matches `route-surface.snapshot.txt` byte-for-byte.
- Raw `printRoutes()` output matches the regenerated `route-table.snapshot.txt` byte-for-byte.
- The negative snapshot helper tests also passed.

The credit-specific pre-move scratch capture is no longer present, so its historical three-line diff cannot be reconstructed directly from a tracked file. The current repository’s `git diff` also includes the preceding uncommitted ledger migration, so that combined diff is not a valid credit-only comparison.

However, the recorded credit-specific pre/post comparison is consistent with the actual registration change and current raw tree:

```text
Before:
nps-details
bank-details
overdraft-details

After:
bank-details
overdraft-details
nps-details
```

Only sibling order and the corresponding `├`/`└` glyphs change. The method/path content remains:

- `GET, HEAD, PUT` for bank details
- `GET, HEAD, PUT` for overdraft details
- `GET, HEAD, PUT` for NPS details

The independent canonical gate proves there is no added, removed, renamed, or method-changed route. The observed raw-tree change is therefore exactly the expected branch reordering.

### 9. Job wiring — pass

All required imports and call sites are present in `jobs/index.ts`:

- `evaluateCardDueReminders` comes from `modules/credit/services/alerts.ts`.
- `evaluateCardUtilization` comes from `modules/credit/services/alerts.ts`.
- `materializeCardDueTasks` comes from `modules/credit/services/card-due-tasks.ts`.

All specified calls remain wired:

- `cards.remind` calls `evaluateCardDueReminders`.
- The same handler independently calls `materializeCardDueTasks`.
- The per-user `alertsWorker` calls `evaluateCardUtilization`.
- Boot catch-up calls `materializeCardDueTasks`.

The separate try/catch behavior in the scheduled handler and boot path remains intact.

### 10. Cross-module import completeness — pass

The 13 obsolete flat files are absent.

No current relative import found in `apps/api/src` targets the removed service or route locations.

The reverse ledger dependencies are correctly repointed:

- `modules/ledger/services/recurring.ts` imports `lockAccountPair` and `stepAmortization` from `../../credit/services/emis.ts`.
- `modules/ledger/services/recurring.test.ts` imports `createEmi`, `listEmiInstallments`, and `upsertEmiDetails` from the same new credit module.

I also inspected more than the requested six edited cross-boundary/mixed-ownership sites, including:

- `app.ts`
- `jobs/index.ts`
- ledger `recurring.ts`
- ledger `recurring.test.ts`
- credit `routes/cards.ts`
- credit `routes/emis.ts`
- credit `routes/bank-details.ts`
- credit `routes/overdraft-details.ts`
- `card-statements.ts` consuming ledger attachments
- `bank-details.ts` consuming ledger account services
- `cards.ts` consuming ledger-owned schema objects
- `emis.ts` consuming ledger-owned tables
- reconciliation writes consuming ingest- and ledger-owned tables

Credit-owned tables consistently come through `../schema.ts`, while mixed-domain tables continue to come from `db/schema.ts` or the appropriate migrated module.

### 11. Service moves and size constraints — pass

All eleven files under `modules/credit/services` were inspected. The six-way decomposition is coherent and under the requested approximate ceiling:

| Split service | Lines |
|---|---:|
| `cycle-math.ts` | 129 |
| `cards.ts` | 382 |
| `alerts.ts` | 66 |
| `rewards.ts` | 103 |
| `reconciliation-reads.ts` | 262 |
| `reconciliation-writes.ts` | 342 |

`emis.ts` remains unsplit at 494 lines, as required.

The five moved service files retain their intended responsibilities and only have relocation/import/comment adjustments relevant to the move. The known object-storage-before-database-insert behavior in `saveCardStatement` remains unchanged, as explicitly required.

The existing direct access to `extractedTransactions` in reconciliation writes also remains intact and documented rather than being architecturally changed in this task.

### 12. Required untouched files and roadmap correction — pass

Tracked diffs confirm these files are unchanged:

- `apps/api/src/db/schema.ts`
- `apps/api/src/services/backup.ts`
- `CLAUDE.md`

`db/schema.ts` does not re-export the credit module.

`tasks/01.02-migrate-credit.md` has the intended endpoint correction:

- cards: 15 endpoints
- all four credit route groups: 23 endpoints total

No unrelated change to that roadmap file was found.

### 13. Verification results

The current working tree passed:

- Root `npm run typecheck`
- Root `npm run lint`
- Credit schema smoke test
- Credit plugin registration test
- Canonical and raw route snapshot tests
- All relocated split tests
- All new rewards tests

Targeted test result:

```text
67 tests
67 passed
0 failed
```

This consisted of:

- 11 cycle-math tests
- 13 reconciliation-read tests
- 26 reconciliation-write tests
- 17 reward tests

The database-backed tests passed against the configured test environment, including ownership isolation, safe-integer rejection, reconciliation behavior, and the new reward lookup cases.

## Acceptance Criteria Assessment

| AC | Result | Basis |
|---|---|---|
| AC1 | Pass | Canonical snapshot test byte-identical; raw snapshot matches current app; credit-only change is expected sibling order |
| AC2 | Pass | Credit schema is only a re-export; `db/schema.ts` and physical definitions are unchanged; implementation evidence records an unchanged generated-schema hash manifest |
| AC3 | Pass | `backup.ts` is unchanged; no import dependency was introduced |
| AC4 | Pass | Six requested service seams exist; largest is 382 lines |
| AC5 | Pass | All scheduled-handler, alerts-worker, and boot catch-up imports/calls verified directly |
| AC6 | Pass | Both reward interfaces exist, are documented, validate precisely, and have complete tests including product overflow |
| AC7 | Pass with count correction | Typecheck/lint/tests pass; all actual 50 original tests preserved as 11/13/26 |
| AC8 | Pass | Thin schema re-export, no reverse barrel, runtime identity tests pass |
| AC9 | Pass | All old paths absent; imports resolve to new locations, including both ledger EMI consumers |
| AC10 | Pass | Plugin registers all four route files; route-lookup completeness test passes |

## Final Assessment

The implementation is **acceptance-ready**. The only discrepancy is the approved plan’s stale 49-test accounting; the code correctly preserves the actual 50-test source suite and documents why. No regression, security bypass, missing required test, convention violation, or blocking plan-conformance defect was found.