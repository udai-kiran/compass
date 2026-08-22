## High

None.

## Medium

None.

## Low

- Formatting convention violation: Prettier reports all four F6c files as needing formatting:

  - [receipt-confirm.ts](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-confirm.ts)
  - [receipt-confirm.test.ts](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-confirm.test.ts)
  - [consumption-rate.ts](/work/personal/compass/apps/api/src/modules/shopping/services/consumption-rate.ts)
  - [consumption-rate.test.ts](/work/personal/compass/apps/api/src/modules/shopping/services/consumption-rate.test.ts)

  This is non-functional but violates the contributor guide’s formatting requirement.

- The acknowledged coverage residual remains: real chooser/resolver tests do not exercise `confirmReceipt`’s database wiring. In particular, no test directly proves that all mixed-unit observations are inserted while only one compatible aggregate reaches `replenishPantry`, or that missing owned catalog rows skip replenishment. This is non-blocking under the explicitly accepted “no full confirm integration suite” residual.

## F6c assessment

**F6c is fixed.**

- **P1:** `choosePantryReplenishment` implements both catalog and pantry compatibility constraints, correct precedence, conflict skipping, stable first-compatible fallback, and returns the original aggregate.
- **P2:** Catalog and pantry batch lookups are both scoped by `userId`. Pantry lookup is limited to owned catalog IDs, and a missing owned catalog row skips replenishment.
- **P3:** Confirmed lines use `orderBy(position, id)`.
- **P4:** Aggregation remains keyed by `catalogItemId:unit`; every aggregate is inserted into `shopping_list_items`. Only the chooser-selected aggregate is replenished.
- **P5:** `resolveLearningUnit` uses catalog → pantry → null precedence. `learnConsumptionRate` performs a user-scoped pantry fallback when catalog unit is null. The rate, outlier, and blending calculations are unchanged.
- **P6:** Tests import the real chooser and resolver and cover every listed case. The false local catalog-only aggregation test is gone.

For a stable database state, I found no remaining mixed-unit-specific 400/abort path. Catalog/pantry conflicts or absent compatible aggregates now skip replenishment. The unchanged `replenishPantry` mismatch checks remain, but the chooser prevents those calls from receiving a statically incompatible unit. Concurrent catalog/pantry mutation remains the declared out-of-scope exception.

## Regression and security spot-check

Previously fixed items remain present:

- **F4b:** Delete uses an atomic user-scoped `DELETE … status != confirmed RETURNING`.
- **F5b:** `UpdateReceiptLineSchema` rejects omitted counterparts and null/non-null mismatches.
- **F9:** Line create/update/delete use user-scoped transactional receipt claims before mutation and guarded total recomputation.
- **F1:** Multipart `cartDraftId` is read from `file.fields`, UUID-validated, and ownership-checked.
- **F2:** Reconciliation persistence is transactional, with confirmed-status guards on line and receipt updates.
- **F3:** Manual line create/update validates catalog ownership.
- **F7:** Shopping schema header says 12 tables and 8 enums.
- **F8:** Synthetic observation `rawText` is replaced with the owned catalog’s canonical name.

All reviewed F6c catalog, pantry, receipt, account, category, cart-draft, observation, and habit operations retain appropriate `userId` scoping. I found no material unnecessary complexity or security regression.

Verification performed:

- Focused tests: **33/33 passed**
- API typecheck: **passed**
- Repository ESLint: **passed**
- Prettier check: **failed for the four files listed above**

## Verdict

**APPROVE.** The remaining items are low-severity formatting and accepted test-coverage residuals; no functional F6c fix is required.