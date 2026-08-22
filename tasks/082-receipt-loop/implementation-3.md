# Implementation Report — Task 082 F2 Completeness Fix (Iteration 5)

## Files Changed

- `apps/api/src/modules/shopping/services/receipt-reconcile.ts` — only file changed

## Implementation Details

### Problem addressed

The previous iteration had a half-complete F2 fix:
- The final `receipts` UPDATE had `WHERE status != 'confirmed' RETURNING` + 409 on 0 rows.
- But `receiptLines` UPDATE statements had only `id`/`receiptId` predicates — no confirmed-status guard.
- `reconcileReceipt()` was not transactional, so a confirm racing between the first line write and
  the final receipt UPDATE could leave line matchStatus/matchedDraftItemId rewritten on a confirmed
  receipt. The later 409 did not undo those line writes.

### Changes made

**1. Import line (line 20):** Added `exists` to the drizzle-orm import. Changed `DbOrTx` to `Db`
   in the db/index.ts import.

```diff
-import { and, eq, inArray, ne } from "drizzle-orm";
-import type { DbOrTx } from "../../../db/index.ts";
+import { and, eq, exists, inArray, ne } from "drizzle-orm";
+import type { Db } from "../../../db/index.ts";
```

**2. Function signature (line ~231):** Changed `db: DbOrTx` to `db: Db`.

```diff
-export async function reconcileReceipt(
-  db: DbOrTx,
+export async function reconcileReceipt(
+  db: Db,
```

Rationale: `reconcileReceipt` must own its transaction and is only ever called from the route with
`app.db` (which is `Db`), never inside an existing transaction. This matches the existing pattern
in `generateDraft` and `canonicalizeItem` which both take `db: Db` and open `db.transaction(...)`.

**3. Persist section:** Wrapped the entire persist block (all `receiptLines` UPDATEs + the final
`receipts` UPDATE) in `db.transaction(async (tx) => { ... })`.

Inside the transaction:
- Built a drizzle `exists()` subquery (`notConfirmedGuard`) that is `true` only when the receipt's
  current status is not `'confirmed'`:
  ```typescript
  const notConfirmedGuard = exists(
    tx.select({ id: receipts.id }).from(receipts).where(
      and(eq(receipts.id, receiptId), eq(receipts.userId, userId), ne(receipts.status, "confirmed")),
    ),
  );
  ```
- Added `notConfirmedGuard` as an additional WHERE condition on every `receiptLines` UPDATE
  (matched, price_diff, extra, ambiguous). This prevents any line write from landing if the
  receipt was confirmed after the initial status read.
- Added `.returning({ id: receiptLines.id })` to every `receiptLines` UPDATE. After each update,
  if `rows.length === 0` (i.e. the update was blocked because the receipt is now confirmed),
  throws `HttpError(409, "Receipt was confirmed while reconciling")`.
- The final `receipts` UPDATE retains its existing `ne(receipts.status, "confirmed")` predicate and
  `.returning()` + 409 check.

Any thrown 409 inside `db.transaction()` causes Drizzle to roll back the entire transaction,
undoing any partial line writes.

The load section (reading receipt, lines, draft items) and response-building section (re-reading
lines after commit) remain outside the transaction — no change to their logic.

## Complete diff (key sections — file is untracked, no git diff)

The file was created as part of task 082 and is untracked in git. The full before/after sections:

### Before (persist section, lines ~301–346):
```typescript
const now = new Date();

// Persist match results to receipt_lines.

// Update matched lines.
for (const match of result.matched) {
  await db
    .update(receiptLines)
    .set({ matchStatus: "matched", matchedDraftItemId: match.draftItemId })
    .where(and(eq(receiptLines.id, match.receiptLineId), eq(receiptLines.receiptId, receiptId)));
}

// Update price_diff lines.
for (const match of result.priceDiffs) {
  await db
    .update(receiptLines)
    .set({ matchStatus: "price_diff", matchedDraftItemId: match.draftItemId })
    .where(and(eq(receiptLines.id, match.receiptLineId), eq(receiptLines.receiptId, receiptId)));
}

// Update extra lines.
if (result.extra.length > 0) {
  await db
    .update(receiptLines)
    .set({ matchStatus: "extra", matchedDraftItemId: null })
    .where(and(inArray(receiptLines.id, result.extra), eq(receiptLines.receiptId, receiptId)));
}

// Update ambiguous lines.
if (result.ambiguous.length > 0) {
  await db
    .update(receiptLines)
    .set({ matchStatus: "ambiguous", matchedDraftItemId: null })
    .where(and(inArray(receiptLines.id, result.ambiguous), eq(receiptLines.receiptId, receiptId)));
}

// Update receipt status → reconciled (conditional: fail if confirmed concurrently).
const updateResult = await db
  .update(receipts)
  .set({ status: "reconciled", reconciledAt: now })
  .where(and(eq(receipts.id, receiptId), eq(receipts.userId, userId), ne(receipts.status, "confirmed")))
  .returning({ id: receipts.id });

if (updateResult.length === 0) {
  throw new HttpError(409, "Receipt was confirmed while reconciling");
}
```

### After (persist section, lines ~301–412):
```typescript
const now = new Date();

// Persist match results atomically. Wrapping in a transaction ensures that
// a concurrent confirm cannot leave a half-applied reconcile visible: if the
// race is lost the entire block rolls back.
await db.transaction(async (tx) => {
  // Subquery guard: every receiptLines UPDATE includes this EXISTS predicate
  // so writes are silently skipped if the receipt was confirmed in the window
  // between the initial status read and the first persist write.
  const notConfirmedGuard = exists(
    tx
      .select({ id: receipts.id })
      .from(receipts)
      .where(
        and(
          eq(receipts.id, receiptId),
          eq(receipts.userId, userId),
          ne(receipts.status, "confirmed"),
        ),
      ),
  );

  // Update matched lines.
  for (const match of result.matched) {
    const rows = await tx
      .update(receiptLines)
      .set({ matchStatus: "matched", matchedDraftItemId: match.draftItemId })
      .where(
        and(
          eq(receiptLines.id, match.receiptLineId),
          eq(receiptLines.receiptId, receiptId),
          notConfirmedGuard,
        ),
      )
      .returning({ id: receiptLines.id });
    if (rows.length === 0) {
      throw new HttpError(409, "Receipt was confirmed while reconciling");
    }
  }

  // Update price_diff lines.
  for (const match of result.priceDiffs) {
    const rows = await tx
      .update(receiptLines)
      .set({ matchStatus: "price_diff", matchedDraftItemId: match.draftItemId })
      .where(
        and(
          eq(receiptLines.id, match.receiptLineId),
          eq(receiptLines.receiptId, receiptId),
          notConfirmedGuard,
        ),
      )
      .returning({ id: receiptLines.id });
    if (rows.length === 0) {
      throw new HttpError(409, "Receipt was confirmed while reconciling");
    }
  }

  // Update extra lines.
  if (result.extra.length > 0) {
    const rows = await tx
      .update(receiptLines)
      .set({ matchStatus: "extra", matchedDraftItemId: null })
      .where(
        and(
          inArray(receiptLines.id, result.extra),
          eq(receiptLines.receiptId, receiptId),
          notConfirmedGuard,
        ),
      )
      .returning({ id: receiptLines.id });
    if (rows.length === 0) {
      throw new HttpError(409, "Receipt was confirmed while reconciling");
    }
  }

  // Update ambiguous lines.
  if (result.ambiguous.length > 0) {
    const rows = await tx
      .update(receiptLines)
      .set({ matchStatus: "ambiguous", matchedDraftItemId: null })
      .where(
        and(
          inArray(receiptLines.id, result.ambiguous),
          eq(receiptLines.receiptId, receiptId),
          notConfirmedGuard,
        ),
      )
      .returning({ id: receiptLines.id });
    if (rows.length === 0) {
      throw new HttpError(409, "Receipt was confirmed while reconciling");
    }
  }

  // Update receipt status → reconciled (conditional: fail if confirmed concurrently).
  // This is the authoritative race-condition check: if 0 rows → receipt was confirmed.
  const updateResult = await tx
    .update(receipts)
    .set({ status: "reconciled", reconciledAt: now })
    .where(
      and(
        eq(receipts.id, receiptId),
        eq(receipts.userId, userId),
        ne(receipts.status, "confirmed"),
      ),
    )
    .returning({ id: receipts.id });

  if (updateResult.length === 0) {
    throw new HttpError(409, "Receipt was confirmed while reconciling");
  }
});
```

## Commands and Literal Output

### 1. `npm run typecheck`

```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit

> @compass/docs@0.1.0 typecheck
> tsc --noEmit

> @compass/extractor@0.1.0 typecheck
> tsc --noEmit

> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit

> @compass/web@0.1.0 typecheck
> tsc --noEmit

> @compass/ai@0.1.0 typecheck
> tsc --noEmit

> @compass/shared@0.1.0 typecheck
> tsc --noEmit
```

Exit code: 0

### 2. `npm run lint`

```
> compass@0.1.0 lint
> eslint .
```

Exit code: 0

### 3. `npm run test -w apps/api`

Exit code: 1 (pre-existing DB-backed test failures, no new failures)

Receipt-specific unit tests run directly:

```
node --test apps/api/src/modules/shopping/services/receipt-reconcile.test.ts
✔ reconcile: empty receipt and empty draft → all empty (0.920675ms)
✔ reconcile: empty receipt, non-empty draft → all missing (0.16789ms)
✔ reconcile: non-empty receipt, empty draft → all extra (0.219237ms)
✔ reconcile: exact catalogItemId match — 1:1 (0.135138ms)
✔ reconcile: exact match with price diff → goes to priceDiffs (0.100581ms)
✔ reconcile: fuzzy name match with clear winner (0.198458ms)
✔ reconcile: fuzzy match — typo within 30% threshold (0.107725ms)
✔ reconcile: fuzzy match beyond threshold → extra + missing (0.120871ms)
✔ reconcile: ambiguous fuzzy match → ambiguous status (0.156288ms)
✔ reconcile: one-to-one constraint — same catalogItem only matched once (0.167188ms)
✔ reconcile: null price → priceDiffPaise is null (no diff computed) (0.09433ms)
✔ normalizeForMatch: lowercases, trims, collapses whitespace (0.064674ms)
✔ reconcile: multiple exact matches — each paired one-to-one (0.075655ms)
ℹ tests 13
ℹ pass 13
ℹ fail 0
ℹ duration_ms 370.790303
```

Exit code: 0

```
node --test apps/api/src/modules/shopping/services/receipt-confirm.test.ts
✔ computeTotalPaise: sums line prices correctly (0.459085ms)
[... 10 more passing tests ...]
ℹ tests 11
ℹ pass 11
ℹ fail 0
ℹ duration_ms 62.108634
```

Exit code: 0

Full test suite: 953 passing tests. Failing test files (33) all require `DATABASE_URL`
(pre-existing — `app.test.ts`, all route integration tests, all DB-backed service tests).
These failures are identical to pre-change state.

## Acceptance Criteria Check

- Confirmed receipts cannot have receipt_lines rewritten by a concurrent reconcile: YES —
  `notConfirmedGuard` EXISTS subquery on every `receiptLines` UPDATE prevents writes.
- Confirmed receipts cannot be reverted to reconciled: YES — final receipts UPDATE retains
  `ne(receipts.status, "confirmed")` with RETURNING + 409.
- A lost race throws 409 and rolls back partial line writes: YES — any 409 thrown inside
  `db.transaction()` causes Drizzle to roll back.
- Existing receipt-reconcile unit tests still pass: YES — 13/13 pass.
- typecheck + lint remain green: YES — both exit 0.

## Assumptions

- `reconcileReceipt` is only ever called from the route with `app.db` (a `Db`, not a transaction
  handle). Confirmed by inspecting `routes/receipts.ts` line 231: `reconcileReceipt(app.db, ...)`.
  Changing `DbOrTx` → `Db` is safe.
- Drizzle ORM's `exists(subquery)` function (confirmed exported from drizzle-orm) accepts a
  `tx.select(...)` subquery created inside the transaction callback. The select is a SQL builder
  that does not execute immediately; it generates SQL inline into the UPDATE WHERE clause.
- Pre-existing DB-backed test failures are not introduced by this change.

## Unresolved Risks

None introduced by this change. The `unmatched` lines from a previous reconcile run are not
explicitly reset on re-reconcile (i.e., if a line was previously `matched` and is now `extra`,
the extra loop will overwrite it correctly, but a line that was `ambiguous` in a previous run and
is now matched will be updated correctly too). This is pre-existing behavior out of scope.
