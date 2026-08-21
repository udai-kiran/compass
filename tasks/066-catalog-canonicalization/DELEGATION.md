# Sonnet Worker Delegation — Task 9.3 (catalog canonicalization + unit normalization)

## Task
9.3 · branch `feat/shopping-core-capture` (already checked out). Implement the APPROVED plan in
[`TASK.md`](./TASK.md). Read TASK.md fully first — it is the contract. Investigation facts (verbatim
schema, signatures, match discipline) are in [`investigation-1.md`](./investigation-1.md).

## Approved Plan (P1–P6 in TASK.md) — implement exactly
- P1 `packages/shared/src/money.ts`: `unitPricePaise(pricePaise, quantityBase, unit)` and
  `convertToBaseQuantity(quantity: string, displayUnit)`. Integer/BigInt only, per the Design decisions.
- P2 `packages/shared/src/schemas/shopping.ts`: `DisplayUnitSchema`, `CreateCatalogItemSchema`,
  `UpdateCatalogItemSchema` (PUT-strict), `CatalogMatchResultSchema` (discriminated union on `status`),
  `CanonicalizeItemResponseSchema`. Export types. Re-export from `packages/shared/src/index.ts` if that
  is the barrel convention (check how existing shopping schemas are exported).
- P3 NEW `apps/api/src/modules/shopping/services/canonicalize.ts`: `matchCatalog`, catalog CRUD,
  `canonicalizeItem`. Follow the locking/ownership/error patterns in `services/lists.ts` and
  `services/ownership.ts`. Use `assertOwnedCategory` (`apps/api/src/lib/ownership.ts:49`) and `pgError`
  (`apps/api/src/lib/errors.ts:33`).
- P4 NEW `apps/api/src/modules/shopping/routes/catalog.ts`: the 7 routes (order: `/catalog/match`
  BEFORE `/catalog/:id`). Register in `apps/api/src/modules/shopping/plugin.ts`.
- P5 Regenerate BOTH route-snapshot fixtures using the SAME one-off-script method task 9.2 used — read
  `apps/api/src/**/*route*snapshot*.test.ts` (task 064's routes/lists work regenerated them; find that
  test and its fixture files), write a one-off hermetic Node script that builds the app the way the
  snapshot test does and reuses its exact enumeration to emit the fixtures, run it, INSPECT the diff
  (must be exactly the new catalog/canonicalize routes + auto `HEAD` for the new GET routes only — no
  HEAD for POST/PUT/DELETE), then DELETE the script. Do not hand-edit fixtures.
- P6 Tests: all listed in TASK.md P6 (shared money+schema deepEqual/refine-bite, hermetic route-config,
  CI-gated integration incl. the stale-match race with separate connections + sync points, ambiguous
  seeding BOTH "Atta" and "atta", demo-403 on every mutation + canonicalize). Colocate `*.test.ts` next
  to source. Follow the exact test conventions in `apps/api/src/modules/shopping/routes/lists.route.test.ts`
  and `lists.hermetic.test.ts` (env-gating pattern for DB tests, hermetic mock.module pattern if used).

## Files and Symbols
- Edit: `packages/shared/src/money.ts` (+ `money.test.ts`), `packages/shared/src/schemas/shopping.ts`
  (+ `shopping.test.ts`), `packages/shared/src/index.ts` (only if barrel re-export needed),
  `apps/api/src/modules/shopping/plugin.ts`.
- New: `apps/api/src/modules/shopping/services/canonicalize.ts` (+ `canonicalize.test.ts` if you add
  service-level hermetic tests), `apps/api/src/modules/shopping/routes/catalog.ts`
  (+ `catalog.route.test.ts`, `catalog.hermetic.test.ts`).
- Regenerate: both route-snapshot fixture files (find their exact paths from the snapshot test).

## Must Not Change
- NO migration, NO schema.ts change, NO backup.ts change (tables + coverage already exist — verified).
- Do NOT modify `services/lists.ts` behaviour (reuse it; the item-row lock in canonicalize is what
  serializes against updateItem — do not add a parent lock to updateItem).
- Do NOT mark any route `public`; do NOT add anything to the demo write allowlist.
- `.ts` extensions on all relative imports. Money stays integer paise. All queries `user_id`-scoped.
- Do NOT commit, stage, push, or touch git. Do NOT edit files outside the list above.

## Acceptance Criteria
AC1–AC8 in TASK.md. In particular: unitPricePaise integer/BigInt with MAX_SAFE_INTEGER bound;
convertToBaseQuantity exact decimal-string (no float/epsilon); unique auto-links + ambiguous no-write;
never creates a catalog entry outside POST /catalog; duplicate name → 409; category ownership on
create+update; demo-safe; both snapshots regenerated with an exact diff.

## Commands (run from repo root; paste literal output + exit codes)
1. `npm run typecheck`  → exit 0, zero `error TS`.
2. `npm run lint`       → exit 0.
3. `npm run test -w packages/shared`  → shared tests green (paste counts).
4. `node --test apps/api/src/modules/shopping/routes/catalog.hermetic.test.ts` (and any other new
   hermetic files) → paste counts. DB-gated integration files will report their literal skip reason
   locally (no DATABASE_URL) — paste that reason; they run in CI.
5. Run the route-snapshot test (the exact command; e.g. `node --test <path-to-snapshot-test>`) → pass;
   paste the fixture diff you inspected (git diff of the two fixture files) and confirm it is exactly
   the new routes + auto HEAD for new GETs.
6. `git status --porcelain` → report every changed/new file (do NOT stage or commit).

## Required Evidence
- Files changed + full unified diff of each source file (not fixtures — for fixtures, the git diff).
- The exact commands and their literal stdout/stderr, pass/fail/skip counts, exit codes.
- The regeneration script you wrote and confirmation you deleted it.
- The literal skip reason printed by the DB-gated integration tests locally.
- Any deviation from the plan or blocker — stop and report rather than guessing.

If the brief contradicts the code or an assumption proves wrong (e.g. `pgError`/`assertOwnedCategory`
signatures differ, or the snapshot test's enumeration cannot be reused), STOP and report — do not
improvise a different design.

---

## Iteration 2 (post code-review-3 — 3 non-blocking fixes; no design change)

Codex review-3 had NO blocking findings. Apply these three test/guard strengthenings only. Do NOT
change any behaviour of the shipped services/routes beyond adding the runtime guard in fix #1.

1. **Runtime guard in `convertToBaseQuantity`** (`packages/shared/src/money.ts`): add a runtime check
   that `displayUnit` is one of `"kg"|"g"|"litre"|"ml"|"piece"`, throwing `RangeError` otherwise
   (mirror the style of `unitPricePaise`'s unit guard). Add a `money.test.ts` case asserting an invalid
   unit throws.
2. **Strengthen ambiguous/none no-write assertions** in
   `apps/api/src/modules/shopping/routes/catalog.route.test.ts`:
   - `none` case: additionally assert the parent LIST `updatedAt` is unchanged (not just the item's).
   - `ambiguous` case: additionally assert the item's `updatedAt` AND the parent list's `updatedAt` are
     unchanged (currently only `catalogItemId === null` is checked).
   Capture each row's `updatedAt` before the canonicalize call and compare after.
3. **Prove AC4 "never creates"**: in the same integration test file, in the match and canonicalize
   tests, assert the `catalog_items` row count for the user is identical before and after calling
   `GET /catalog/match` and `POST …/canonicalize` (for matched, ambiguous, AND none cases).

These integration assertions run in CI (DB-gated); the money guard + its test run locally.

Commands (paste literal output + exit codes): `npm run typecheck`; `npm run lint`;
`npm run test -w packages/shared`; `node --experimental-test-module-mocks --test
apps/api/src/modules/shopping/routes/catalog.hermetic.test.ts`; `git status --porcelain`. Do NOT commit.
Append your report to a NEW file `tasks/066-catalog-canonicalization/implementation-2.md` (do not
overwrite implementation-1.md). Reply with a ≤15-line digest + that path.
