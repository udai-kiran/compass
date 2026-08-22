# Worker Delegation

## Task
082 — Receipt OCR → Cart Reconcile → Ledger

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: spans schema design, cross-module service integration (ledger, shopping, ingest patterns), AI vision pattern replication, state machine enforcement, and backup/restore interaction. Multiple subtle invariants (atomic claim, learner aggregation, unit normalization, storage lifecycle).

## Approved Plan
Full plan in tasks/082-receipt-loop/TASK.md. Key steps:
- P1: Schema + migration (receipts, receipt_lines, 2 enums)
- P2: Shared Zod schemas in packages/shared
- P3: Receipt parse service (AI vision)
- P4: Reconciliation engine (pure)
- P5: Confirm service (ledger + pantry + rates)
- P6: Routes
- P7: Tests
- P8: Registration + backup + snapshots

## Files and Symbols
See TASK.md Scope section for complete file list.

## Required Changes
All changes specified in TASK.md Plan section P1-P8.

## Must Not Change
- apps/api/src/modules/ingest/ (no inbox pipeline modifications)
- apps/api/src/modules/ledger/services/transactions.ts (consume only, don't modify)
- apps/web/ (backend only)

## Acceptance Criteria
AC1-AC11 from TASK.md

## Commands
1. `npm run db:generate` (after schema changes)
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test -w apps/api`
5. `npm run test -w packages/shared`

## Required Evidence
- files changed
- complete diff
- commands and literal output
- exit codes
- plan deviations or blockers

---

## Iteration 2 — Independent Verification

## Worker
`codex-worker`

## Routing Reason
Verification is deterministic: run typecheck, lint, test. Pass/fail criteria defined. Read-only.

## Approved Plan
- V1: `npm run typecheck` — exit 0
- V2: `npm run lint` — exit 0 or document pre-existing failures
- V3: `npm run test -w apps/api` — pass/fail/skip counts, separate pre-existing from new
- V4: `npm run test -w packages/shared` — exit 0
- V5: `git diff --stat HEAD` — file list
- V6: Check schema.decomposition.test.ts expected table count (should be 72)
- V7: Check shopping/schema.ts header comment (should say 12 tables + 10 enums)

## Must Not Change
Everything — read-only verification.

## Commands
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -w apps/api`
4. `npm run test -w packages/shared`
5. `git diff --stat HEAD`
6. `grep -n 'expectedTableCount\|tables.length' apps/api/src/app.test.ts apps/api/src/schema.decomposition.test.ts 2>/dev/null || true`
7. `head -5 apps/api/src/modules/shopping/schema.ts`

## Required Evidence
- exact commands and literal output
- exit codes
- pass/fail/skip counts
- modified file list
- schema table count check
- header comment check

---

## Iteration 3 — Codex Review-6 Fix Pass

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: multipart field reading requires understanding Fastify's multipart API; reconciliation race fix needs correct SQL conditional update pattern; catalog ownership check requires finding the right cross-module pattern; unit-safe aggregation needs design decision.

## Approved Plan (fixes F1-F8 from review-6)

### F1: cartDraftId multipart field reading
File: `apps/api/src/modules/shopping/routes/receipts.ts` (line ~190)
- Change `(req.body as Record<string, unknown> | undefined)?.cartDraftId` to reading from `file.fields`
- After `const file = await req.file(...)`, access `file.fields.cartDraftId` (Fastify multipart returns `MultipartFields`)
- The field value is a `MultipartValue` object with `.value` property containing the string
- Add UUID validation: check if the value is a valid UUID string before passing
- Add ownership check: if cartDraftId provided, call `assertOwnedDraft(app.db, userId, cartDraftId)` before passing to service
- Import `assertOwnedDraft` from `../services/ownership.ts`

### F2: Reconciliation race condition
File: `apps/api/src/modules/shopping/services/receipt-reconcile.ts` (line ~337)
- Change the final status update from unconditional `UPDATE receipts SET status='reconciled'` to:
  `UPDATE receipts SET status='reconciled', reconciledAt=now() WHERE id=$1 AND userId=$2 AND status != 'confirmed' RETURNING id`
- Check 0 rows → throw HttpError(409, "Receipt was confirmed while reconciling")
- Similarly update the individual receiptLines updates to include a subquery check that the receipt is not confirmed, OR wrap the entire reconcileReceipt in a transaction

### F3: catalogItemId ownership on line CRUD
File: `apps/api/src/modules/shopping/routes/receipts.ts` (POST /receipts/:id/lines and PUT lines)
- When `body.catalogItemId` is provided (not null/undefined), validate it belongs to the current user
- Use: `const catItem = await app.db.query.catalogItems.findFirst({ where: and(eq(catalogItems.id, body.catalogItemId), eq(catalogItems.userId, userId)), columns: { id: true } }); if (!catItem) throw new HttpError(404, "Catalog item not found");`
- Import `catalogItems` from `../schema.ts`

### F4: Confirmed receipt deletion guard
File: `apps/api/src/modules/shopping/routes/receipts.ts` (DELETE /receipts/:id, line ~278)
- After loading the receipt, add: `if (receipt.status === 'confirmed') throw new HttpError(409, "Cannot delete a confirmed receipt");`
- Need to add `status` to the columns query: `columns: { id: true, storedPath: true, status: true }`

### F5: UpdateReceiptLineSchema qty/unit pairing
File: `packages/shared/src/schemas/shopping.ts` (UpdateReceiptLineSchema)
- Add a Zod `.refine()` to the schema: if quantityBase is provided, unit must also be provided, and vice versa
- Pattern: `.refine(d => (d.quantityBase !== undefined) === (d.unit !== undefined), { message: "quantityBase and unit must be provided together" })`
- But since this is partial update, the real constraint is: if either is present, both must be present in the update payload

### F6: Unit-safe aggregation in confirm
File: `apps/api/src/modules/shopping/services/receipt-confirm.ts` (line ~142)
- Change the aggregation key from just `catalogItemId` to `${catalogItemId}:${unit}`
- This means lines with the same catalogItemId but different units produce separate shopping_list_items
- Update `AggregatedItem` type key and map key accordingly

### F7: Schema header
File: `apps/api/src/modules/shopping/schema.ts` (line 1-2)
- Change "11 resident tables + 8 resident enums" to "12 resident tables + 8 resident enums"

### F8: rawText → canonicalName
File: `apps/api/src/modules/shopping/services/receipt-confirm.ts` (line ~149-154)
- When creating the AggregatedItem, look up the catalog item's canonicalName
- Load catalog items by the aggregate's catalogItemIds, build a name map
- Use the canonicalName for rawText in the shopping_list_items insert

## Files and Symbols
- `apps/api/src/modules/shopping/routes/receipts.ts` — F1, F3, F4
- `apps/api/src/modules/shopping/services/receipt-reconcile.ts` — F2
- `apps/api/src/modules/shopping/services/receipt-confirm.ts` — F6, F8
- `apps/api/src/modules/shopping/schema.ts` — F7
- `packages/shared/src/schemas/shopping.ts` — F5

## Must Not Change
- apps/web/ (no frontend changes)
- apps/api/src/modules/shopping/services/receipt-parse.ts (no changes needed)
- Test files (existing tests should still pass)
- Migration files

## Acceptance Criteria
- F1: cartDraftId read from multipart fields, UUID-validated, ownership-checked
- F2: Reconciliation cannot revert a confirmed receipt to reconciled
- F3: Manual line CRUD rejects catalog items not owned by user
- F4: DELETE /receipts/:id rejects confirmed receipts with 409
- F5: UpdateReceiptLineSchema rejects qty without unit and vice versa
- F6: Lines with same catalogItemId but different units produce separate shopping_list_items
- F7: Schema header says "12 resident tables + 8 resident enums"
- F8: Synthetic shopping_list_items use catalog canonicalName for rawText
- All existing tests still pass (`npm run typecheck`, `npm run lint`, `npm run test -w apps/api`, `npm run test -w packages/shared`)

## Commands
1. Make changes per plan
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test -w apps/api`
5. `npm run test -w packages/shared`

## Required Evidence
- files changed
- complete diff
- commands and literal output
- exit codes
- plan deviations or blockers

---

## Iteration 4 — Independent Verification of Review-6 Fixes

## Worker
`codex-worker`

## Routing Reason
Verification is deterministic: collect git status/diff, re-run typecheck/lint/tests, confirm each F1–F8 change exists in the current code. Read-only.

## Approved Plan
- V1: `git status --short` and `git diff --stat HEAD` — file list
- V2: Confirm F1–F8 in current source (do not trust the implementation report)
- V3: `npm run typecheck` — exit 0
- V4: `npm run lint` — exit 0 or document pre-existing failures
- V5: `npm run test -w apps/api` — pass/fail/skip counts, separate pre-existing from new
- V6: `npm run test -w packages/shared` — exit 0
- V7: Note whether F2 also protected receiptLines updates or wrapped reconcileReceipt in a transaction (plan required one of those)

## Must Not Change
Everything — read-only verification.

## Commands
1. `git status --short`
2. `git diff --stat HEAD`
3. `npm run typecheck`
4. `npm run lint`
5. `npm run test -w apps/api`
6. `npm run test -w packages/shared`

## Required Evidence
- exact commands and literal output
- exit codes
- pass/fail/skip counts
- modified and untracked files
- per-finding present/absent for F1–F8
- F2 completeness note

---

## Iteration 5 — Close remaining F2 race window

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: remaining F2 work is a concurrency/invariant fix. Line updates still write without a confirmed-status predicate, and `reconcileReceipt()` is not transactional. Need a correct SQL/transaction pattern that cannot mutate lines after confirmation.

## Approved Plan
The Iteration 3 F2 requirement was only half-implemented. The final receipt UPDATE is now conditional (`status != 'confirmed'` + RETURNING + 409). That is not sufficient:

- `reconcileReceipt()` still does independent `receiptLines` updates with only `id`/`receiptId` predicates (no confirmed-status check).
- The reconcile route calls `reconcileReceipt(app.db, ...)` — it is NOT wrapped in a transaction.
- If confirm commits after the initial status read and before the final receipt UPDATE, line matchStatus/matchedDraftItemId can still be rewritten on a confirmed receipt. The later 409 does not undo those line writes.

Required change in `apps/api/src/modules/shopping/services/receipt-reconcile.ts`:

1. Wrap the persist section (line updates + receipt status update) in one `db.transaction(...)` if `db` supports it. If `DbOrTx` may already be a transaction, use a single transaction when `db.transaction` exists; otherwise keep the existing handle and still apply the SQL guards below.
2. Every `receiptLines` UPDATE must also exclude confirmed receipts, e.g. add a subquery/predicate equivalent to:
   `AND EXISTS (SELECT 1 FROM receipts WHERE id = receiptId AND user_id = userId AND status != 'confirmed')`
   Use drizzle `exists`/`ne` consistently with this file. Do not use a raw unchecked SQL string if a drizzle predicate is available.
3. Keep the existing receipt UPDATE `WHERE status != 'confirmed' RETURNING` + 409 on 0 rows.
4. If any line write or the final receipt UPDATE affects 0 rows because the receipt is now confirmed, throw `HttpError(409, "Receipt was confirmed while reconciling")` and do not leave a half-applied persist. The transaction must roll back.

Do not change parse, confirm, routes (except if a transaction wrapper on the route is clearly better and still keeps service ownership), tests unless a tiny unit-level adjustment is required, web, or migrations.

## Files and Symbols
- `apps/api/src/modules/shopping/services/receipt-reconcile.ts` — `reconcileReceipt`, receiptLines updates, receipts status update
- Inspect `DbOrTx` usage in nearby shopping services for the existing transaction pattern

## Must Not Change
- apps/web/
- receipt-parse.ts
- receipt-confirm.ts
- schema / migrations
- packages/shared

## Acceptance Criteria
- Confirmed receipts cannot have receipt_lines rewritten by a concurrent reconcile
- Confirmed receipts cannot be reverted to reconciled
- A lost race throws 409 and rolls back partial line writes
- Existing receipt-reconcile unit tests still pass
- typecheck + lint remain green

## Commands
1. Make the F2 completeness fix
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test -w apps/api`

## Required Evidence
- files changed
- complete diff
- commands and literal output
- exit codes
- plan deviations or blockers

---

## Iteration 6 — Independent Verification of F2 Completeness

## Worker
`codex-worker`

## Routing Reason
Verification is deterministic: inspect the persist transaction and confirmed-status predicates, re-run typecheck/lint/focused tests. Read-only.

## Approved Plan
- V1: Confirm `reconcileReceipt` persist is inside `db.transaction`
- V2: Confirm every receiptLines UPDATE has a not-confirmed EXISTS/predicate
- V3: Confirm receipt UPDATE still uses `status != confirmed` RETURNING + 409
- V4: Confirm lost-race throws 409 inside the transaction
- V5: `npm run typecheck`, `npm run lint`
- V6: `node --test` on receipt-reconcile.test.ts and receipt-confirm.test.ts
- V7: `npm run test -w apps/api` — document pre-existing DB failures

## Must Not Change
Everything — read-only verification.

## Commands
1. `git status --short`
2. `npm run typecheck`
3. `npm run lint`
4. `node --test apps/api/src/modules/shopping/services/receipt-reconcile.test.ts`
5. `node --test apps/api/src/modules/shopping/services/receipt-confirm.test.ts`
6. `npm run test -w apps/api`

## Required Evidence
- exact commands and literal output
- exit codes
- pass/fail/skip counts
- per-check present/absent with file:line citations

---

## Iteration 7 — Review-7 F4b / F5b / F6b / F9 fix

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: F9 needs a transactional claim pattern across three line-CRUD routes plus total recomputation; F6b needs a correct pantry-vs-observation split that preserves mixed-unit shopping_list_items without aborting confirm.

## Approved Plan

### F4b: Atomic confirmed-delete guard
File: `apps/api/src/modules/shopping/routes/receipts.ts` DELETE `/receipts/:id`

Replace read-then-unconditional-delete with:
1. Load storedPath + existence with ownership (`id` + `userId`). If missing → 404.
2. `DELETE FROM receipts WHERE id = :id AND userId = :userId AND status != 'confirmed' RETURNING id, storedPath`
3. 0 rows after the row existed → 409 `"Cannot delete a confirmed receipt"`
4. On success, best-effort `storage.delete(storedPath)` as today.

Do not delete a confirmed receipt even if confirm commits between the existence read and the DELETE.

### F9: Line CRUD cannot mutate a confirmed receipt
File: same `receipts.ts` POST/PUT/DELETE `/receipts/:id/lines...` and `recomputeTotal`

1. Wrap each line mutation + total recompute in `app.db.transaction`.
2. At the start of the transaction, claim the receipt:
   `UPDATE receipts SET updatedAt? / or a no-op column if no updatedAt / otherwise just SELECT FOR UPDATE via UPDATE ... WHERE id AND userId AND status != 'confirmed' RETURNING id`
   If receipts has no convenient bump column, use `UPDATE ... SET totalPaise = totalPaise` or another existing column only if safe; prefer a status-preserving claim that still takes a row lock. Inspect the receipts table first.
3. 0 rows → if receipt missing/not owned 404; if confirmed 409 `"Cannot modify a confirmed receipt"`.
4. Every subsequent line INSERT/UPDATE/DELETE must include an EXISTS/predicate that the parent receipt is still not confirmed (same pattern as reconcile F2), OR rely on the held row lock from the claim UPDATE inside the same transaction. Prefer the claim lock + do the writes in that same tx.
5. Move `recomputeTotal` onto the transaction handle (`tx`, not `app.db`) and include `AND status != 'confirmed'` on its receipts UPDATE. 0 rows → 409 and rollback.
6. Keep F3 ownership checks.

### F5b: Nullable qty/unit pairing
File: `packages/shared/src/schemas/shopping.ts` `UpdateReceiptLineSchema`

Keep “both provided or both omitted”. ADD: if both provided, they must be both null or both non-null:
`(d.quantityBase === null) === (d.unit === null)` when both keys are present.

Reject `{quantityBase:1, unit:null}` and `{quantityBase:null, unit:"g"}`.

CreateReceiptLineSchema already pairs via both-null; do not break it.

### F6b: Mixed-unit confirm must not abort
File: `apps/api/src/modules/shopping/services/receipt-confirm.ts`

Keep F6 separate `shopping_list_items` keyed by `${catalogItemId}:${unit}`.
Do NOT call `replenishPantry` for every aggregate when that would unit-mismatch.

After building `aggregatedItems` (and F8 canonical names):
1. Group aggregates by `catalogItemId`.
2. Load catalog unit for those ids (already loading catalog for F8 — reuse that lookup; include `unit` in the columns).
3. For each catalogItemId, choose at most one pantry replenishment:
   - If catalog.unit is set, replenish only the aggregate whose unit matches catalog.unit (sum that unit only).
   - If catalog.unit is null, replenish the first aggregate for that catalogItemId (stable: first seen).
4. Still insert ALL aggregates as shopping_list_items (rate-learning observations).
5. Never call replenishPantry with a unit that will 400. Confirm must succeed and create the ledger tx.

Do not change pantry-management.ts.

## Must Not Change
- apps/web/
- receipt-parse.ts
- receipt-reconcile.ts (F2 is done)
- migrations
- shopping service files other than receipt-confirm.ts

## Acceptance Criteria
- Confirmed receipts cannot be deleted, including vs concurrent confirm
- Confirmed receipts cannot have lines added/edited/deleted, including vs concurrent confirm; totalPaise cannot be overwritten after confirm
- UpdateReceiptLineSchema rejects omitted counterpart AND null/non-null mismatch
- Mixed-unit same catalogItemId confirm creates separate shopping_list_items and does not throw from pantry
- typecheck + lint green; existing receipt unit tests still pass

## Commands
1. Implement
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test -w packages/shared`
5. `node --test apps/api/src/modules/shopping/services/receipt-reconcile.test.ts apps/api/src/modules/shopping/services/receipt-confirm.test.ts`

## Required Evidence
- files changed
- complete diff
- commands and literal output
- exit codes
- plan deviations or blockers

---

## Iteration 8 — Independent verification of Review-7 fixes

## Worker
`codex-worker`

## Routing Reason
Low-thinking: deterministic present/absent checks against current source plus defined typecheck/lint/test commands. Read-only. Must not implement.

## Approved Plan
Verify Implementation-4 against TASK.md Review-7 and DELEGATION Iteration 7. Do not treat implementation-4.md as ground truth — read the files.

### V1 F4b — DELETE `/receipts/:id`
- Existence/ownership read first → 404 if missing.
- Atomic `DELETE ... WHERE id AND userId AND status != 'confirmed' RETURNING`.
- 0 rows after existence → 409, not a silent miss and not an unguarded delete.

### V2 F9 — POST/PUT/DELETE lines + recomputeTotal
- Each of the three handlers is inside `app.db.transaction`.
- Claim UPDATE at start: `status != 'confirmed'` + RETURNING; 0 rows → 404 vs 409.
- Line insert/update/delete and `recomputeTotal` / `loadReceiptWithLines` use `tx`, not `app.db`.
- `recomputeTotal(db, receiptId)` updates with `ne(status,'confirmed')` + RETURNING; 0 rows → 409.
- F3 catalog ownership still present on POST/PUT.

### V3 F5b — UpdateReceiptLineSchema
- Both absent OK; both present must be both-null or both-non-null; one-sided omitted fails.
- `{quantityBase:1, unit:null}` and `{quantityBase:null, unit:"g"}` fail.
- CreateReceiptLineSchema pairing unchanged.

### V4 F6b — confirm pantry selection
- Aggregation still keyed by `${catalogItemId}:${unit}`.
- ALL aggregates inserted as shopping_list_items.
- `replenishPantry` called at most once per catalogItemId.
- Catalog unit match preferred; catalog.unit null → first aggregate; no matching catalog unit → skip pantry, do not throw.
- pantry-management.ts unchanged.

### V5 Commands
Run the listed commands. Record literal output, pass/fail/skip, exit codes. Do not skip a command because the implementer already ran it.

### V6 Scope
Confirm no unapproved files changed (web, receipt-parse, receipt-reconcile, migrations, pantry-management).

## Must Not Change
Everything — read-only verification.

## Commands
1. `git status --short`
2. `git diff --stat HEAD`
3. `npm run typecheck`
4. `npm run lint`
5. `npm run test -w packages/shared`
6. `node --test apps/api/src/modules/shopping/services/receipt-reconcile.test.ts apps/api/src/modules/shopping/services/receipt-confirm.test.ts`
7. `npm run test -w apps/api`

## Required Evidence
- exact commands and literal output
- exit codes
- pass/fail/skip counts
- per-check present/absent with file:line citations
- skipped commands, if any

---

## Iteration 9 — F6c plan (Review-8)

## Worker
plan review via `codex-reviewer` (no implementation yet)

## Routing Reason
Design defect: F6b’s “catalog unit else first aggregate” still violates “never call replenishPantry with a unit that will 400” when an existing pantry row has a unit. Need plan approval before code.

## Approved Plan
See TASK.md **F6c Plan**. Summary:
- Pure `choosePantryReplenishment(items, catalogUnit, pantryUnit)` — compatible iff matches catalog (if set) AND pantry (if set); else skip.
- Batch-load pantry units; order confirmed lines by position.
- Insert all unit-keyed shopping_list_items; replenish only the chosen item.
- Unit-test the real exported chooser, including the pantry-`g` + receipt-`ml`/`g` abort case.
- Do not modify pantry-management.ts, receipt-parse.ts, receipts.ts, or web.

## Must Not Change
- pantry-management.ts
- receipt-parse.ts
- receipt-reconcile.ts
- routes/receipts.ts
- apps/web/
- migrations

---

## Iteration 10 — F6c plan revision (Review-9)

## Worker
plan review via `codex-reviewer` (no implementation yet)

## Routing Reason
Review-9 rejected F6c: mixed-unit observations can teach the wrong habit unit when catalog.unit is null. Need approval of the amended plan (chooser + learner target unit) before code.

## Approved Plan
See TASK.md **F6c Plan (Review-9 amendments folded)**.

## Must Not Change
- pantry-management.ts
- receipt-parse.ts
- receipt-reconcile.ts
- routes/receipts.ts
- apps/web/
- migrations
- consumption-rate math/blend (only target-unit resolution)

---

## Iteration 11 — Implement F6c (Review-10 approved)

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: pantry vs catalog vs learner unit selection, user-scoped lookups, and a consumption-rate target-unit change that must not alter rate math. Not a mechanical patch.

## Approved Plan
Implement TASK.md **F6c Plan (Review-9 amendments folded)** exactly. Review-10 APPROVE. No design deviations.

P1. Export `choosePantryReplenishment(items, catalogUnit, pantryUnit)` from `receipt-confirm.ts`.
P2. User-scoped catalog + pantry batch lookups. Missing owned catalog → skip replenish (do not treat as catalogUnit null).
P3. Confirmed lines `orderBy (position, id)`.
P4. Insert ALL unit-keyed shopping_list_items; replenish only when chooser returns an item.
P5. Export `resolveLearningUnit(catalogUnit, pantryUnit)` from `consumption-rate.ts`. `learnConsumptionRate`: if catalog unit null, read pantry unit and pass resolver into `computeConsumptionRate`. Do not change blend/outlier/rate math.
P6. Tests import the real functions. Delete the false local catalog-only aggregation test. Add the listed chooser + resolver cases.

## Files and Symbols
- `apps/api/src/modules/shopping/services/receipt-confirm.ts` — `choosePantryReplenishment`, catalog/pantry lookups, line order, replenish loop
- `apps/api/src/modules/shopping/services/receipt-confirm.test.ts`
- `apps/api/src/modules/shopping/services/consumption-rate.ts` — `resolveLearningUnit`, `learnConsumptionRate` targetUnit
- `apps/api/src/modules/shopping/services/consumption-rate.test.ts`

## Required Changes
Exactly P1–P6 above.

## Must Not Change
- pantry-management.ts
- receipt-parse.ts
- receipt-reconcile.ts
- routes/receipts.ts
- apps/web/
- migrations
- consumption-rate blend/outlier/rate formulas

## Acceptance Criteria
- Catalog null + pantry g + receipt ml then g → replenish g, never 400 from unit mismatch on that path
- Catalog g + pantry ml → skip pantry, confirm continues
- Missing owned catalog row → skip pantry
- Mixed-unit shopping_list_items still all inserted
- learnConsumptionRate uses catalog unit else pantry unit else most-frequent
- Real-function unit tests cover the TASK.md P6 cases
- typecheck + lint green; focused receipt + consumption-rate tests pass

## Commands
1. Implement
2. `npm run typecheck`
3. `npm run lint`
4. `node --test apps/api/src/modules/shopping/services/receipt-confirm.test.ts apps/api/src/modules/shopping/services/consumption-rate.test.ts`

## Required Evidence
- files changed
- complete diff
- commands and literal output
- exit codes
- plan deviations or blockers

---

## Iteration 12 — Independent verification of F6c

## Worker
`codex-worker`

## Routing Reason
Low-thinking: deterministic present/absent checks plus defined commands. Read-only.

## Approved Plan
Verify Implementation-5 against TASK.md F6c Plan and DELEGATION Iteration 11. Do not treat implementation-5.md as ground truth.

### V1 choosePantryReplenishment
Exported from receipt-confirm.ts. Compatibility and preference order match P1.

### V2 Lookups
Catalog and pantry batch queries both include userId. Missing owned catalog → skip replenish (continue), not chooser(null).

### V3 Order
Confirmed lines `orderBy (position, id)`.

### V4 Inserts vs replenish
ALL unit-keyed shopping_list_items inserted. replenishPantry only when chooser returns an item.

### V5 resolveLearningUnit
Exported. learnConsumptionRate reads pantry unit only when catalog unit is null; passes resolver into computeConsumptionRate. Blend/outlier/rate math unchanged. pantry-management.ts unchanged.

### V6 Tests
Real functions imported. False local aggregation test gone. P6 chooser + resolver cases present.

### V7 Commands
Run all listed commands. Record literal output, counts, exit codes.

## Must Not Change
Everything — read-only.

## Commands
1. `git status --short`
2. `git diff --stat HEAD -- apps/api/src/modules/shopping/services/receipt-confirm.ts apps/api/src/modules/shopping/services/receipt-confirm.test.ts apps/api/src/modules/shopping/services/consumption-rate.ts apps/api/src/modules/shopping/services/consumption-rate.test.ts apps/api/src/modules/shopping/services/pantry-management.ts`
3. `npm run typecheck`
4. `npm run lint`
5. `node --test apps/api/src/modules/shopping/services/receipt-confirm.test.ts apps/api/src/modules/shopping/services/consumption-rate.test.ts`

## Required Evidence
- exact commands and literal output
- exit codes
- pass/fail/skip counts
- per-check present/absent with file:line citations

---

## Iteration 13 — Pre-commit status (read-only)

## Worker
`codex-worker`

## Routing Reason
Low-thinking: collect git status/diff/log so the coordinator can choose an explicit commit file list. Read-only. No staging.

## Approved Plan
Write `tasks/082-receipt-loop/commit-status-1.md`. Do not stage or commit.

## Must Not Change
Everything except the report file.

---

## Iteration 14 — Commit 082/083 only

## Worker
`codex-worker`

## Routing Reason
Low-thinking: explicit file list, branch, stage those paths only, commit. Mechanical git.

## Approved Plan
User requested a commit of 082 and 083 review-fix work. We are on `main` — create branch first, then commit. Do not push.

1. If `AGENTS.md` or `tasks/075-reward-aware-checkout/*` are staged, unstage them only:
   `git restore --staged -- AGENTS.md tasks/075-reward-aware-checkout/TASK.md tasks/075-reward-aware-checkout/review-3.md`
   Do not delete or modify their contents.
2. Create branch `feat/082-083-receipt-cart-review` from current HEAD.
3. Stage ONLY the coordinator's explicit file list below. Never `git add -A` or `git add .`. Never stage `AGENTS.md`, `tasks/075-*`, `tasks/065`–`081`, `tasks/084`–`086`, PDFs, images, or `data/`.
4. Commit with the message below via HEREDOC.
5. Write `tasks/082-receipt-loop/commit-1.md` with commands, literal output, commit hash, and `git status --short` after.

## Explicit file list (stage these and nothing else)

082 implementation:
- apps/api/drizzle/0011_puzzling_sister_grimm.sql
- apps/api/drizzle/meta/0011_snapshot.json
- apps/api/drizzle/meta/_journal.json
- apps/api/src/db/schema.decomposition.test.ts
- apps/api/src/db/schema.ts
- apps/api/src/modules/shopping/plugin.ts
- apps/api/src/modules/shopping/schema.ts
- apps/api/src/modules/shopping/services/consumption-rate.ts
- apps/api/src/modules/shopping/services/consumption-rate.test.ts
- apps/api/src/modules/system/services/backup.ts
- apps/api/src/route-surface.snapshot.txt
- apps/api/src/route-table.snapshot.txt
- packages/shared/src/schemas/shopping.ts
- apps/api/src/modules/shopping/routes/receipts.ts
- apps/api/src/modules/shopping/services/receipt-confirm.ts
- apps/api/src/modules/shopping/services/receipt-confirm.test.ts
- apps/api/src/modules/shopping/services/receipt-parse.ts
- apps/api/src/modules/shopping/services/receipt-reconcile.ts
- apps/api/src/modules/shopping/services/receipt-reconcile.test.ts

083 implementation:
- apps/api/src/modules/shopping/routes/cart-drafts.ts
- apps/api/src/modules/shopping/routes/cart-drafts.hermetic.test.ts
- apps/web/src/layouts/AppLayout.tsx
- apps/web/src/lib/shopping-queries.ts
- apps/web/src/routes/shopping/CartPage.tsx
- apps/web/src/routes/shopping/cart-view.ts
- apps/web/src/routes/shopping/cart-view.test.ts

Task docs:
- tasks/CHECKPOINT.md
- tasks/082-receipt-loop/DELEGATION.md
- tasks/082-receipt-loop/TASK.md
- tasks/082-receipt-loop/implementation-1.md
- tasks/082-receipt-loop/implementation-2.md
- tasks/082-receipt-loop/implementation-3.md
- tasks/082-receipt-loop/implementation-4.md
- tasks/082-receipt-loop/implementation-5.md
- tasks/082-receipt-loop/investigation-1.md
- tasks/082-receipt-loop/investigation-ledger.md
- tasks/082-receipt-loop/investigation-prd.md
- tasks/082-receipt-loop/review-1.md
- tasks/082-receipt-loop/review-4.md
- tasks/082-receipt-loop/review-5.md
- tasks/082-receipt-loop/review-6.md
- tasks/082-receipt-loop/review-7.md
- tasks/082-receipt-loop/review-8.md
- tasks/082-receipt-loop/review-9.md
- tasks/082-receipt-loop/review-10.md
- tasks/082-receipt-loop/review-11.md
- tasks/082-receipt-loop/verification-1.md
- tasks/082-receipt-loop/verification-2.md
- tasks/082-receipt-loop/verification-3.md
- tasks/082-receipt-loop/verification-4.md
- tasks/082-receipt-loop/verification-5.md
- tasks/082-receipt-loop/commit-status-1.md
- tasks/083-cart-review-ui/DELEGATION.md
- tasks/083-cart-review-ui/TASK.md
- tasks/083-cart-review-ui/fix-1.md
- tasks/083-cart-review-ui/implementation-1.md
- tasks/083-cart-review-ui/implementation-2.md
- tasks/083-cart-review-ui/implementation-3.md
- tasks/083-cart-review-ui/implementation-4.md
- tasks/083-cart-review-ui/review-1.md
- tasks/083-cart-review-ui/review-2.md
- tasks/083-cart-review-ui/review-3.md
- tasks/083-cart-review-ui/review-4.md
- tasks/083-cart-review-ui/review-5.md
- tasks/083-cart-review-ui/review-6.md
- tasks/083-cart-review-ui/review-7.md
- tasks/083-cart-review-ui/verification-1.md
- tasks/083-cart-review-ui/verification-2.md
- tasks/083-cart-review-ui/verification-3.md

If `tasks/082-receipt-loop/commit-status-1.md` is missing, skip that one path only. After writing `commit-1.md`, do not amend to include it.

## Commit message
```
feat(shopping): receipt loop and cart review UI (tasks 082-083)

Close the shopping loop: receipt OCR → reconcile → confirm to ledger,
with confirmed-receipt races, qty/unit pairing, and mixed-unit pantry
selection. Add the cart review screen (accept/abandon, guards, source
groups) and the review-fix pass.

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Must Not Change
- File contents of any implementation file
- Do not push
- Do not stage anything not on the list

## Commands
1. Unstage unrelated files if staged
2. `git checkout -b feat/082-083-receipt-cart-review`
3. `git add -- <explicit paths>`
4. `git commit` with HEREDOC
5. `git status --short` and `git log -1 --format=full`

## Required Evidence
- exact commands and literal output
- commit hash
- staged vs leftover files
