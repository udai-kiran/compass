## High severity

### Blocking — confirmed receipts remain mutable through concurrent line CRUD

The F2 reconcile race is fixed, but the broader confirmed-state invariant is not.

Each manual line route performs a status read followed by an unconditional write in separate statements:

- Add: [receipts.ts:335](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:335), then insert at [receipts.ts:360](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:360).
- Edit: [receipts.ts:388](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:388), then update at [receipts.ts:428](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:428).
- Delete: [receipts.ts:450](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:450), then delete at [receipts.ts:468](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:468).
- All subsequently overwrite `receipts.totalPaise` unconditionally at [receipts.ts:125](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:125).

If one of these handlers reads `reconciled`, then confirmation claims and commits the receipt at [receipt-confirm.ts:53](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-confirm.ts:53), the stale line request can still alter or delete a confirmed line and overwrite the confirmed receipt total. The ledger transaction remains based on the earlier line values, so the receipt can cease to reconcile with its ledger posting.

The line mutation and total recomputation are also not one transaction. A failure between them leaves a changed line and stale total.

Required coverage is absent: there is no `receipt-lines.test.ts`, despite P7 explicitly requiring line CRUD, confirmed-status, pairing, and cross-user tests.

### Blocking — F4’s delete guard has the same lost-race problem

The route reads status at [receipts.ts:302](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:302), rejects confirmed at line 307, then deletes with no status predicate at [receipts.ts:312](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:312).

A concurrent confirmation can commit after the read but before the delete. The delete then removes a confirmed receipt and its lines while leaving the already-created ledger transaction and synthetic shopping list behind. F4 is therefore present only as a non-concurrent guard; “confirmed receipts cannot be deleted” is not fully enforced.

The delete should be an atomic conditional claim/delete such as `DELETE ... WHERE status != 'confirmed' RETURNING`, with zero rows distinguished between not-found and conflict.

### Blocking — F6 cannot succeed for the edge case it was intended to support

The composite aggregation key is present at [receipt-confirm.ts:133](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-confirm.ts:133), and separate synthetic rows are prepared at lines 175–185. However, confirmation subsequently calls `replenishPantry` once per `(catalogItemId, unit)` at [receipt-confirm.ts:188](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-confirm.ts:188).

Pantry has one row per `(userId, catalogItemId)` and explicitly rejects a different second unit at [pantry-management.ts:84](/work/personal/compass/apps/api/src/modules/shopping/services/pantry-management.ts:84). If the catalog itself declares a unit, the mismatching aggregate is rejected even earlier at line 80.

Consequently, same catalog item + `g` and `ml` does not commit two shopping-list observations: confirmation throws and the outer transaction rolls everything back. F6 is syntactically implemented but not end-to-end complete.

The existing test is especially misleading: [receipt-confirm.test.ts:80](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-confirm.test.ts:80) still groups only by `catalogItemId`, reproduces separate test-only logic, and never calls `confirmReceipt`.

## Medium severity

### Blocking — F5 still permits values that violate the database pairing constraint

The refinement at [shopping.ts:1052](/work/personal/compass/packages/shared/src/schemas/shopping.ts:1052) checks only whether both properties are present:

```ts
(d.quantityBase !== undefined) === (d.unit !== undefined)
```

It accepts both of these invalid updates:

```ts
{ quantityBase: 1, unit: null }
{ quantityBase: null, unit: "g" }
```

Both violate `receipt_lines_quantity_unit_paired` at [schema.ts:443](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:443) and become database errors rather than contract-level 400 responses. I confirmed both currently return `success: true` from `UpdateReceiptLineSchema.safeParse`.

F5 therefore handles “field omitted” but not the actual nullable pairing invariant. It is incomplete.

### Blocking for task completion — most required behavior is untested

The current receipt tests do not support the verification reports’ confidence:

- [receipt-confirm.test.ts:16](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-confirm.test.ts:16) defines local copies of production arithmetic and aggregation. It never imports or invokes `confirmReceipt`, despite its comments referring to a mock DB.
- Its aggregation test at line 80 tests the pre-F6 catalog-only key.
- No test exercises account/category ownership, atomic claim behavior, ledger creation, canonical-name insertion, pantry writes, cart transition, or rollback.
- [receipt-reconcile.test.ts:4](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-reconcile.test.ts:4) intentionally tests only the pure matcher. Nothing exercises the transaction, confirmed-status `EXISTS` predicates, 409 behavior, or rollback.
- There are no tests for `receipt-parse.ts`.
- There are no receipt route tests for multipart F1, catalog ownership F3, delete F4, or manual CRUD.
- There is no shared-schema test for F5.
- There is no real test for F6 or F8.

This violates TASK P7 and the repository TDD rule that every unchecked acceptance criterion must have a test. AC1, AC3–AC10 are not adequately demonstrated by the current receipt-specific suite.

### OCR output validation can leave partially persisted parse state

`purchaseDate` is accepted as any string at [receipt-parse.ts:133](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-parse.ts:133), then written directly into a PostgreSQL `date` at [receipt-parse.ts:344](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-parse.ts:344). A model result such as `"yesterday"` passes Zod and can cause a database error.

Because receipt lines are inserted first at [receipt-parse.ts:337](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-parse.ts:337) and the receipt update is not in the same transaction, the request can fail after lines have committed, leaving a partially updated receipt.

Similarly, `lineTotal` is only `z.number()` at line 129 and non-integer paise are silently floored at lines 322–325. That contradicts the integer-paise contract and can understate a ledger amount.

### Reconciled receipts can be edited without invalidating reconciliation

Manual line changes are allowed for both `parsed` and `reconciled` receipts, but add/edit/delete never reset the receipt to `parsed`, clear stale `matchedDraftItemId` values, or require re-reconciliation. See the status checks and writes at [receipts.ts:335](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:335), [receipts.ts:388](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:388), and [receipts.ts:450](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:450).

A user can therefore reconcile, materially change lines, and immediately confirm using stale match classifications. This does not necessarily corrupt the ledger total, which is recomputed from selected lines, but it breaks the advertised receipt-to-cart reconciliation state.

## Low severity

### Storage deletion is best-effort with no recovery path

After deleting the database row, storage failure is swallowed at [receipts.ts:316](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:316). A transient storage failure permanently leaves an unreferenced receipt image, with no row remaining from which to retry deletion. This is a privacy and storage-lifecycle risk, although the route does at least attempt the required cleanup.

### Route handlers own substantial persistence behavior

Manual line CRUD, position allocation, normalization, total recomputation, and state checks all live directly in [receipts.ts:125](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:125) and lines 323–473. This conflicts with the project convention that routes validate/delegate while services own domain behavior and persistence. It also contributes to the missing transaction boundaries and duplicated logic.

### Schema documentation is internally stale

Although F7’s headline count is correct at [schema.ts:2](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:2), the cross-owner FK comment still says there are exactly eight and that no write paths exist at [schema.ts:20](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:20). Receipt-to-draft and receipt-line-to-catalog links now add further ownership-sensitive relationships and active write paths.

The `missing` match-status comment says it is stored on a synthetic line at [schema.ts:356](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:356), but reconciliation only returns missing draft IDs and never creates such lines.

### Confirm aggregation is more complex than necessary

[receipt-confirm.ts:136](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-confirm.ts:136) carries OCR-derived `rawText` through aggregation, then performs a second pass and mutates every aggregate at lines 161–174. Because confirmed catalog-linked observations require canonical names, canonical names could be loaded and used directly. The two adjacent `aggregatedItems.length > 0` blocks add indirection and helped obscure the F6/pantry incompatibility.

## F1–F8 disposition

| Item | Status | Assessment |
|---|---|---|
| F1 | Implemented, untested | Reads `file.fields.cartDraftId` after consuming the stream, validates with `z.uuid()`, and calls `assertOwnedDraft` at [receipts.ts:190](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:190). No route test covers valid, malformed, cross-owner, field ordering, or duplicate fields. |
| F2 | Implemented, including Iteration-5 completeness | Persist work is inside `db.transaction` at [receipt-reconcile.ts:303](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-reconcile.ts:303). Every matched/price-diff/extra/ambiguous line update includes the not-confirmed `EXISTS` predicate at lines 310–393. The final receipt update has `status != confirmed`, `RETURNING`, and 409 at lines 395–411. All throws occur inside the transaction, so a lost race rolls back prior line writes. No integration/concurrency test proves it. |
| F3 | Implemented, untested | POST and PUT validate non-null catalog IDs through `assertOwnedCatalogItem` at [receipts.ts:353](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:353) and [receipts.ts:408](/work/personal/compass/apps/api/src/modules/shopping/routes/receipts.ts:408). DELETE accepts no catalog ID. |
| F4 | Partially implemented; blocking | A direct request against an already-confirmed receipt gets 409, but the read-then-delete race can still delete a concurrently confirmed receipt. |
| F5 | Not fully implemented; blocking | Rejects omitted counterparts but accepts null/non-null mismatches that violate the DB constraint. |
| F6 | Not functionally complete; blocking | Composite grouping exists, but the required different-unit case fails during pantry replenishment and rolls back the separate observations. |
| F7 | Implemented | Header correctly says “12 resident tables + 8 resident enums” at [schema.ts:2](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:2). |
| F8 | Implemented, untested | Catalog canonical names are loaded and assigned before synthetic rows are inserted at [receipt-confirm.ts:161](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-confirm.ts:161). No test proves the committed row uses `canonicalName`. |

## Incorrect verification assumptions

- `verification-2.md` marked F5 complete after checking only property presence; it missed the nullable mismatch demonstrated above.
- It marked F6 complete by inspecting the map key without following the aggregates through `replenishPantry`.
- Its statement that the old reconciliation implementation was wrapped by the caller was incorrect; the route calls `reconcileReceipt(app.db, ...)`. Iteration 5 subsequently added the transaction inside the service.
- `verification-3.md` is correct about the narrow F2 transaction and rollback mechanism, but “no remaining race window” is too broad: confirmed-state races remain in manual line CRUD and receipt deletion.
- Both reports treat copied pure helper tests as confirmation-service coverage even though those tests never call the service.

## Verification performed

Read-only checks passed:

- API typecheck
- Shared-package typecheck
- Lint over the reviewed files
- Receipt reconcile and confirm test files: 24/24 passing

Those green checks do not cover the blocking behavioral gaps above. Overall verdict: **not ready to complete task 082**. F2 completeness is correctly implemented, but F4, F5, and F6 are not complete, and confirmed-receipt immutability remains vulnerable through the manual mutation routes.