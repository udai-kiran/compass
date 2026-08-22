## High

- **F6b is incomplete: confirm can still abort on a mixed-unit receipt when an existing pantry row has a different unit.** The selection logic considers only `catalogItems.unit`: when that is null, it chooses the first aggregate and calls `replenishPantry` ([receipt-confirm.ts](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-confirm.ts:213), [receipt-confirm.ts](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-confirm.ts:225)). But `replenishPantry` independently rejects a unit different from the existing pantry row ([pantry-management.ts](/work/personal/compass/apps/api/src/modules/shopping/services/pantry-management.ts:84)). For example, a catalog item with `unit=null`, an existing `g` pantry row, and receipt aggregates in `ml` and `g` can select `ml`, throw 400, and roll back the entire confirm—including observations and the ledger transaction. The “first aggregate” is not stable either: `confirmedLines` has no `orderBy` ([receipt-confirm.ts](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-confirm.ts:93)). This directly contradicts Iteration 7’s “never call `replenishPantry` with a unit that will 400.” The coordinator’s assumption that this is merely a pre-existing pantry issue is incorrect because F6b explicitly requires confirm not to abort. **Status: incomplete/still broken for existing-pantry state.**

## Medium

- **The new F6b path has no effective regression test, which allowed the remaining rollback case through verification.** `receipt-confirm.test.ts` never imports or invokes `confirmReceipt`; its aggregation test reproduces the old catalog-only grouping in local test code ([receipt-confirm.test.ts](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-confirm.test.ts:80)). It tests neither mixed-unit aggregation, catalog-unit selection, existing-pantry compatibility, nor insertion of all observations. Consequently, the focused “24/24” result provides no evidence for F6b. A focused pure selection test or service-level seam is sufficient; a full integration suite is not required.

## Low

- **F5b is fixed in code but has no direct schema regression cases.** `UpdateReceiptLineSchema` correctly accepts both absent, requires both keys together, and rejects null/non-null mismatches ([shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:1052)). `CreateReceiptLineSchema` retains its pairing refinement ([shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:1037)). However, the shared schema suite contains no tests for either receipt-line schema, so the 351 passing shared tests do not exercise the four load-bearing F5b cases. **Status: fixed, with a narrow missing regression test.**

- **The F9 claim sequence is duplicated across all three handlers.** The same no-op locking update and 404/409 distinction appears independently in POST, PUT, and DELETE ([receipts.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:357), [receipts.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:428), [receipts.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:506)). It is currently correct, but a shared helper would reduce future drift between three security-sensitive paths. This is maintainability-only, not a blocker.

## Must-fix status

| Item | Status | Evidence |
|---|---|---|
| **F4b delete race** | **Fixed** | Ownership/existence read is followed by `DELETE WHERE id AND userId AND status != 'confirmed' RETURNING`; zero rows returns 409 ([receipts.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:312)). PostgreSQL rechecks the predicate after lock waits, so confirm winning the race prevents deletion. |
| **F9 line CRUD race** | **Fixed** | All three mutations run in one transaction, begin with a locking non-confirmed claim, use `tx` for ownership/write/recompute/load, and roll back on failure ([receipts.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:357)). `recomputeTotal` uses the supplied transaction handle and guards its receipt update with `status != 'confirmed'` ([receipts.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:110)). |
| **F5b nullable pairing** | **Fixed** | Omitted counterpart and both null/non-null mismatches are rejected; create pairing remains intact. |
| **F6b mixed-unit confirm** | **Incomplete** | All `(catalogItemId, unit)` aggregates are inserted and pantry is called at most once per catalog item, but existing pantry-unit compatibility is ignored and selection is nondeterministic when catalog unit is null. |

## Previously accepted Review-6 items

- **F1 fixed:** `cartDraftId` comes from `file.fields`, is UUID-validated, and ownership-checked before persistence ([receipts.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:199)).
- **F2 fixed:** reconciliation persistence is transactional; every line update has a non-confirmed `EXISTS` guard, and the final receipt update is conditional with a 409 rollback path ([receipt-reconcile.ts](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-reconcile.ts:303)).
- **F3 fixed:** POST and PUT line routes retain catalog ownership checks inside their transactions.
- **F7 fixed:** schema header states 12 resident tables and 8 enums ([schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:1)).
- **F8 fixed:** synthetic observations use the catalog canonical name when the catalog row is found ([receipt-confirm.ts](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-confirm.ts:161)).
- Registration and backup coverage are present, including `receipt_lines` linkage and `receipts.stored_path`.
- `pantry-management.ts` has no Git diff and retains its unit-mismatch 400 behavior as required.

## Verification

The current tree passes:

- `npm run typecheck`
- `npm run lint`
- Shared tests: **351/351**
- Focused receipt tests: **24/24**

Those passes do not change the F6b verdict because the focused confirm tests do not execute the production confirm service. No files were modified.