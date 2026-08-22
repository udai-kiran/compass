# Task 083 — Verification Report (Iteration 5, Review-5 F7/F8)

**Date:** 2026-08-22  
**Scope:** Independent read-only verification of F7 (atomic edit guard) and F8 (quantity editor state/validation)

## Repository Status

```
Modified:  apps/api/src/modules/shopping/routes/cart-drafts.ts
Modified:  apps/web/src/routes/shopping/CartPage.tsx
Untracked: apps/api/src/modules/shopping/routes/cart-drafts.hermetic.test.ts
Untracked: apps/web/src/routes/shopping/cart-view.ts
Untracked: apps/web/src/routes/shopping/cart-view.test.ts
```

Git diff shows 16 files changed, 1347 insertions(+), 20 deletions (-) total across shopping module, schema, queries, layout, and new files.

## Command Execution & Exit Codes

### 1. npm run typecheck
```
Exit code: 0
Result: All 7 workspaces passed (api, web, docs, extractor, ingestor, ai, shared)
```

### 2. npm run lint
```
Exit code: 0
Result: No errors
```

### 3. npm run test -w apps/web
```
Exit code: 0
Result: 342 pass, 0 fail, 0 skipped
Duration: 698.36ms
```

### 4. Hermetic cart-drafts tests
```
Command: cd apps/api && node --experimental-test-module-mocks --test src/modules/shopping/routes/cart-drafts.hermetic.test.ts
Exit code: 0
Result: 9 pass, 0 fail, 0 skipped
Duration: 559.10ms

Tests:
  ✓ POST /drafts/:id/accept with status=draft → 200
  ✓ POST /drafts/:id/accept with status=abandoned → 409
  ✓ POST /drafts/:id/accept with status=ordered → 409
  ✓ PUT /drafts/:id/items/:itemId with status=ordered → 400
  ✓ PUT /drafts/:id/items/:itemId with status=abandoned → 400
  ✓ PUT /drafts/:id/items/:itemId claims a draft atomically before editing
  ✓ DELETE /drafts/:id with status=ordered → 409
  ✓ DELETE /drafts/:id with status=abandoned → 409 (cannot abandon already-abandoned)
  ✓ DELETE /drafts/:id with status=draft → 204
```

### 5. npm run build -w apps/web
```
Exit code: 0
Result: Built successfully in 178ms
Output: CartPage-BIhFuR6r.js 14.25 kB (gzip 4.25 kB)
```

---

## F7 Verification: Atomic Edit-Status Guard

### Required: PUT `/drafts/:id/items/:itemId` claims draft with UPDATE ... WHERE status='draft' RETURNING at transaction start; 0 rows → 400

**File:** `apps/api/src/modules/shopping/routes/cart-drafts.ts` lines 88–156

**Finding:** PASS

**Evidence:**
- **Line 99:** `return app.db.transaction(async (tx) => {`
- **Lines 103–113:** Claim operation at transaction start:
  ```typescript
  const claimed = await tx
    .update(cartDrafts)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(cartDrafts.id, req.params.id),
        eq(cartDrafts.userId, userId),
        eq(cartDrafts.status, "draft"),  // ← Status guard
      ),
    )
    .returning({ id: cartDrafts.id });  // ← Atomic check
  if (claimed.length === 0) {
    throw new HttpError(400, "Only draft-status carts can be edited");  // ← 400 on fail
  }
  ```
- **Lines 117–153:** Item loading and update proceed only after claim succeeds
- **No status read before claim:** No findFirst on cartDrafts.status before the UPDATE
- **No missing WHERE predicate:** Item update (line 123) and total recalc (line 150) execute only within locked transaction

### Hermetic Test Coverage

File: `apps/api/src/modules/shopping/routes/cart-drafts.hermetic.test.ts` lines 200–210

**Test:** `PUT /drafts/:id/items/:itemId claims a draft atomically before editing`

- Passes with status='draft' → 200 (line 209)
- Fails with status='ordered' → 400 (line 185)
- Fails with status='abandoned' → 400 (line 197)
- The fake db.query.cartDrafts.findFirst throws an error if called (line 100–102), proving the edit route does NOT read status first

---

## F8 Verification: Quantity Editor State & Validation

### Required: useEffect syncs qty/unit from props; invalid input restores pair without mutation; F6 null behavior preserved; remove sends persisted values

**File:** `apps/web/src/routes/shopping/CartPage.tsx` lines 425–521

**Finding:** PASS

### 1. useEffect Resyncs from Props

**Lines 450–453:**
```typescript
useEffect(() => {
  setQty(String(item.quantityBase ?? ""));
  setUnit(item.unit ?? "");
}, [item.quantityBase, item.unit]);
```

Resets local state whenever item props change from upstream mutations (e.g., concurrent edits, undo, etc.).

**Status:** PASS

### 2. Invalid Quantity Detection

**Lines 466–469:**
```typescript
function validQuantity(): number | null {
  const parsed = Number(qty);
  return qty.trim() !== "" && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
```

Rejects:
- Empty (after trim) ✓
- Non-numeric ✓
- Non-integer (e.g., `1.5` fails Number.isInteger) ✓
- Zero or negative (parsed ≤ 0) ✓

**Status:** PASS

### 3. Invalid Input Restores & Does Not Persist

**Lines 471–476:**
```typescript
function handleQtyBlur() {
  const newQty = validQuantity();
  if (newQty === null) {
    restorePersistedQuantity();  // ← Restore, do not mutate
    return;
  }
  // ... only mutate if valid
}
```

**Lines 486–492 (unit change also guards):**
```typescript
function handleUnitChange(e: React.ChangeEvent<HTMLSelectElement>) {
  const newUnit = e.target.value as "g" | "ml" | "piece";
  setUnit(newUnit);
  const newQty = validQuantity();
  if (newQty === null) {
    restorePersistedQuantity();  // ← Restore and return without mutation
    return;
  }
  // ... only mutate if valid
}
```

**Status:** PASS

### 4. Persisted Pair Restoration

**Lines 461–464:**
```typescript
function restorePersistedQuantity() {
  setQty(String(item.quantityBase ?? ""));
  setUnit(item.unit ?? "");
}
```

Restores to the last persisted pair from the item prop (including nulls).

**Status:** PASS

### 5. F6 Null-Quantity Behavior Preserved

**Lines 605–616:**
```typescript
{!item.isRemoved && item.quantityBase === null && (
  <div className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
    <span>Qty not set</span>
    <button
      onClick={handleSetQuantity}
      disabled={isDemo || busy}
      className="text-brand-600 hover:underline disabled:opacity-40"
    >
      Edit
    </button>
  </div>
)}
```

When qty is null, shows "Qty not set" + "Edit" button.

**Lines 513–521 (handleSetQuantity):**
```typescript
function handleSetQuantity() {
  setQty("1");
  setUnit("piece");
  updateItem.mutate({
    draftId,
    itemId: item.id,
    body: { quantityBase: 1, unit: "piece", isRemoved: item.isRemoved },
  });
}
```

Edit button sets both qty and unit together (1/"piece") and persists atomically.

**Status:** PASS (F6 preserved)

### 6. Remove/Undo Sends Persisted Values Including Nulls

**Lines 501–511 (handleToggleRemove):**
```typescript
function handleToggleRemove() {
  updateItem.mutate({
    draftId,
    itemId: item.id,
    body: {
      quantityBase: item.quantityBase,    // ← Persisted (may be null)
      unit: item.unit,                    // ← Persisted (may be null)
      isRemoved: !item.isRemoved,
    },
  });
}
```

Remove/undo always sends the persisted quantityBase and unit, preserving nulls.

**Status:** PASS

---

## F3 Regression Check: Accept/Abandon Still Atomic

### Accept Route (`POST /drafts/:id/accept`)

**File:** `apps/api/src/modules/shopping/routes/cart-drafts.ts` lines 64–86

**Lines 70–83:**
```typescript
const result = await app.db
  .update(cartDrafts)
  .set({ status: "ordered", updatedAt: new Date() })
  .where(
    and(
      eq(cartDrafts.id, req.params.id),
      eq(cartDrafts.userId, userId),
      eq(cartDrafts.status, "draft"),  // ← Guarded with WHERE status='draft'
    ),
  )
  .returning({ id: cartDrafts.id });
if (result.length === 0) {
  throw new HttpError(409, "Only draft-status carts can be accepted");
}
```

**Status:** PASS — Accept uses conditional UPDATE with status='draft'

### Abandon Route (`DELETE /drafts/:id`)

**File:** `apps/api/src/modules/shopping/routes/cart-drafts.ts` lines 158–180

**Lines 164–177:**
```typescript
const result = await app.db
  .update(cartDrafts)
  .set({ status: "abandoned", updatedAt: new Date() })
  .where(
    and(
      eq(cartDrafts.id, req.params.id),
      eq(cartDrafts.userId, userId),
      eq(cartDrafts.status, "draft"),  // ← Guarded with WHERE status='draft'
    ),
  )
  .returning({ id: cartDrafts.id });
if (result.length === 0) {
  throw new HttpError(409, "Only draft-status carts can be abandoned");
}
```

**Status:** PASS — Abandon uses conditional UPDATE with status='draft'

### Hermetic Test Verification

Lines 138–172 (accept tests): Accept works when draft, fails with 409 when abandoned or ordered.  
Lines 214–245 (abandon tests): Abandon works when draft, fails with 409 when already abandoned or ordered.

**Status:** PASS — No regression, both remain atomic

---

## Summary

| Check | Status | Evidence |
|-------|--------|----------|
| **F7: Atomic edit-status guard** | PASS | UPDATE cartDrafts WHERE status='draft' RETURNING at tx start (lines 103–113); 0 rows → 400 |
| **F7: No findFirst status read before claim** | PASS | No cartDrafts.findFirst call before claim; hermetic test confirms by throwing on such call |
| **F7: Item loads/updates inside locked tx** | PASS | All subsequent operations (lines 117–153) occur after successful claim |
| **F8: useEffect syncs qty/unit from props** | PASS | Lines 450–453 reset state on item.quantityBase/item.unit change |
| **F8: Invalid qty rejected & restores** | PASS | validQuantity() at lines 466–469 checks for empty/non-int/≤0; restorePersistedQuantity() called on null (lines 474, 491) |
| **F8: No mutation on invalid input** | PASS | updateItem.mutate() called only when newQty !== null (lines 479, 494) |
| **F8: Prop updates overwrite local state** | PASS | useEffect dependency array includes both item.quantityBase and item.unit |
| **F6 preserved: null qty shows "Qty not set" + Edit → 1/piece** | PASS | Lines 605–616 and 513–521 |
| **F6 preserved: Edit writes both qty and unit together** | PASS | handleSetQuantity() (lines 513–521) sets both to 1/"piece" atomically |
| **Remove/undo sends persisted pair including nulls** | PASS | handleToggleRemove() (lines 501–510) sends item.quantityBase and item.unit as-is |
| **F3 not regressed: Accept remains atomic** | PASS | WHERE status='draft' + 0 rows → 409 (lines 70–83) |
| **F3 not regressed: Abandon remains atomic** | PASS | WHERE status='draft' + 0 rows → 409 (lines 164–177) |

### Test Results Summary

| Test | Pass | Fail | Result |
|------|------|------|--------|
| typecheck | 7 ws | 0 | ✓ exit 0 |
| lint | — | 0 | ✓ exit 0 |
| npm run test -w apps/web | 342 | 0 | ✓ exit 0 |
| Hermetic cart-drafts | 9 | 0 | ✓ exit 0 |
| npm run build -w apps/web | — | 0 | ✓ exit 0 |

---

## Verdict: PASS

All required checks present and passing. F7 and F8 implemented correctly. No regressions on F3. Typecheck, lint, tests, and build all succeed.

