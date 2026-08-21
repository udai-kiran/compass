# Task 9.3 — Catalog canonicalization + unit normalization

Board task: [`tasks/09.03-catalog-canonicalization.md`](../09.03-catalog-canonicalization.md) · release 2.3.0 ·
depends 9.2 (done). Branch: `feat/shopping-core-capture`. Investigation:
[`investigation-1.md`](./investigation-1.md).

## Status
CODE COMPLETE & REVIEWED (integration suite pending CI at merge, per the 9.2 convention).
- review-3 (code): NO blocking findings — all 4 prior blocking fixes confirmed correct; unitPricePaise,
  matchCatalog, CRUD IDOR, routes, no-migration all validated. 3 non-blocking test/guard strengthenings
  applied in iteration 2 (runtime displayUnit guard + ambiguous/none no-write assertions + AC4 row-count
  proof). 1 non-blocking kept: DB-gated test throws-on-missing-env (established convention, runs in CI).
- Local gates SEEN green: typecheck 0, lint 0, shared 311/311, hermetic 5/5, route-snapshot 7/7.
  Independent verification (verification-1) confirmed schema.ts/backup.ts/lists.ts/drizzle untouched,
  regen script deleted, all 10 invariants present.
- DB-gated `catalog.route.test.ts` runs only in CI (no DATABASE_URL locally) — validated at merge.

Original plan APPROVED at review-2 (all 4 blocking resolved). Residual hygiene folded in:
`convertToBaseQuantity` asserts `Number.isSafeInteger(quantityBase)` before returning.

## Review log (digested — do not re-read review files)
- review-1 (plan): 4 BLOCKING, all accepted + folded into the plan below:
  - B1 canonicalize stale-match race — `updateItem` takes NO parent lock (lists.ts:217/222), so locking
    only `shopping_lists` doesn't serialize it. FIX: lock list row THEN item row `FOR UPDATE`; read+match
    `rawText` under the item lock.
  - B2 `convertToBaseQuantity` epsilon (1e-6) accepts fractions rounding to 0 / snaps near-integers. FIX:
    decimal-STRING input, exact integer parse, max 3 dp (kg/litre) / 0 dp (g/ml/piece), no float/epsilon.
  - B3 must bump list `updatedAt` too on successful link (parity with updateItem lists.ts:221/234).
  - B4 duplicate-name 409 must catch pg `23505` via `pgError` (lib/errors.ts:33) on create AND update,
    not a racy pre-check.
  - Non-blocking accepted: `assertOwnedCategory` exists null-safe (lib/ownership.ts:49) — use it; register
    `/catalog/match` before `/catalog/:id`; BigInt-bound check before `Number()`; zero price valid, zero
    quantity rejected; reword match analogy (mirrors matchAccount unique-wins, stricter than matchCategory
    `.find()` first-hit). Confirmed: no-migration/no-backup claim correct; unitPrice formula correct.

## Objective
Give a shopping item one canonical identity + a normalized unit so "atta 5kg" and "wheat flour 5kg"
can be compared honestly, and provide integer-only unit-price math. Concretely:
- `unitPricePaise` + display→base unit conversion in `packages/shared`, integer/BigInt only.
- Owner-scoped **catalog CRUD** (the only path that CREATES a catalog entry — user-confirmed).
- A **match** service mirroring the extractor's `matchCategory` discipline: case-insensitive exact
  `canonicalName`; a UNIQUE hit auto-links a list item, an AMBIGUOUS (2+) hit is surfaced for review
  and never auto-resolved, and no match leaves the item usable. Matching NEVER creates a catalog row.

## Root Cause
Not applicable — net-new feature on the 9.1 schema. Tables already exist; **no migration, no schema
change, no backup change** (all 8 shopping tables already in `ALL_TABLES`/`USER_TABLES`/`LINKED_TABLES`
per investigation §6).

## Scope
- **Edit** `packages/shared/src/money.ts` — add `unitPricePaise(pricePaise, quantityBase, unit)`
  (paise per reference display unit: per **kg** for `g`, per **L** for `ml`, per **piece** for `piece`)
  and `convertToBaseQuantity(quantity: string, displayUnit)` (decimal-string exact parse: kg→g,
  litre→ml, g/ml/piece passthrough; integer math, no float). Colocated `money.test.ts` example+property.
- **Edit** `packages/shared/src/schemas/shopping.ts` — add `DisplayUnitSchema`
  (`["kg","g","litre","ml","piece"]`), `CreateCatalogItemSchema`, `UpdateCatalogItemSchema` (PUT-strict,
  every field required incl. nullables, same both-or-neither pairing refine as `CatalogItemSchema`),
  `CatalogMatchResultSchema` (discriminated union on `status`), and `CanonicalizeItemResponseSchema`.
  Export types via `z.input`/`z.infer`. Add `deepEqual` expected-object tests per convention.
- **New** `apps/api/src/modules/shopping/services/canonicalize.ts` — `matchCatalog`, catalog CRUD
  (`createCatalogItem`/`listCatalogItems`/`getCatalogItem`/`updateCatalogItem`/`deleteCatalogItem`),
  and `canonicalizeItem` (see Plan). All take `(db: Db, userId, …)`, owner-scoped.
- **New** `apps/api/src/modules/shopping/routes/catalog.ts` — routes under the `/api/shopping` prefix.
  Register in `plugin.ts` alongside `shoppingListRoutes`/`shoppingUnitRoutes`.
- **Regenerate** both route-snapshot fixtures by the same script-and-delete method 9.2 used (P5);
  the diff must be EXACTLY the new catalog/canonicalize routes + auto `HEAD` for new GET routes only.
- **Tests**: shared (money + schemas), hermetic route-config, CI-gated integration.

## Dependencies
- 9.2 (done). Reuses `services/lists.ts` locking pattern and `services/ownership.ts` guards.

## Design decisions
- **`unitPricePaise(pricePaise, quantityBase, unit)`** — returns paise per reference unit:
  `ref = unit === "piece" ? 1 : 1000`; result = round-half-up of `pricePaise * ref / quantityBase`,
  computed in **BigInt** (`(2·pricePaise·ref + quantityBase) / (2·quantityBase)`). Before returning,
  assert the BigInt result `<= BigInt(Number.MAX_SAFE_INTEGER)` and only then `Number(result)` (never
  `Number()` first — that loses precision on oversized results). Guards: `pricePaise` a safe integer
  `>= 0` (**zero price is valid**), `quantityBase` a safe integer `> 0` (**zero/negative rejected**),
  `unit ∈ {g,ml,piece}`, else `RangeError`. Examples: ₹100 (10000 p) / 5000 g → `10000·1000/5000 = 2000`
  p = ₹20/kg ✓; ₹100 / 2000 ml → `5000` p = ₹50/L ✓; ₹100 / 6 pieces → `10000/6 = 1666.67 → 1667` p ✓.
  Pure helper; catalog_items carries no price (price arrives in 10.1) — AC1 is met by helper + tests.
- **`convertToBaseQuantity(quantity: string, displayUnit)`** — `{ quantityBase, unit }` by EXACT
  decimal-string parsing, no float, no epsilon (review-1 B2). Map: kg→("g", 3 max dp), litre→("ml",
  3 max dp), g→("g", 0 dp), ml→("ml", 0 dp), piece→("piece", 0 dp). Parse `quantity` as
  `^\d+(\.\d+)?$` (non-negative). Reject if fractional digits exceed the unit's max dp (so "0.0001 kg"
  and any fractional piece/g/ml → `RangeError` — a fractional base unit is not representable). Compute
  `quantityBase` in integer arithmetic: `intPart * 1000 + fracDigitsPaddedTo3` for kg/litre, `intPart`
  for g/ml/piece. E.g. "1.5" kg → 1500 g; "0.25" litre → 250 ml; "6" piece → 6. Assert the computed
  `quantityBase` is `Number.isSafeInteger` before returning (reject oversized strings). Groundwork for 9.4.
- **`matchCatalog(db, userId, rawText)`** — mirrors `matchAccount`'s "only a unique hit wins" discipline
  (extract.ts:252), STRICTER than `matchCategory`'s `.find()` first-hit (extract.ts:293): `want =
  rawText.trim()`; empty → `{status:"none"}`. Owner-scoped case-insensitive exact match
  (`lower(canonical_name) = lower($want)`). 1 hit → `{status:"matched", catalogItemId}`; **≥2 hits →
  `{status:"ambiguous", candidateIds}` (never auto-resolved)**; 0 → `{status:"none"}`. The
  `(user_id, canonical_name)` unique index is raw/case-SENSITIVE (schema.ts:101 — no `lower()`/`citext`),
  so "Atta" and "atta" can coexist and a case-insensitive lookup genuinely returns 2+ rows — the
  ambiguity path is real (investigation-1.md §4 was wrong to call it always unique-or-zero). Never
  fuzzy-matches, never creates.
- **`canonicalizeItem(db, userId, listId, itemId)`** — one tx. Acquire locks in a DEADLOCK-SAFE order
  matching add/delete/reorder: `SELECT … FOR UPDATE` the owning `shopping_lists` row FIRST, then
  `SELECT … FOR UPDATE` the `shopping_list_items` row (both id AND listId, owner-scoped). Reading and
  matching `rawText` under the item-row lock closes the stale-match race vs a concurrent `updateItem`
  UPDATE (review-1 B1). Then `matchCatalog(item.rawText)`: on `matched` → set `catalogItemId`, bump the
  item's `updatedAt` AND the parent list's `updatedAt` (parity with updateItem, review-1 B3), return
  `{ item, match }`. On `ambiguous`/`none` → **NO write, no bump**, return `{ item (unchanged), match }`.
  Realizes AC2 (unique auto-links), AC3 (unmatched stays usable), AC4 (never invents an entry).
- **Catalog CRUD is owner-scoped & IDOR-safe** (9.1 schema-header prerequisite): every mutation checks
  ownership via `assertOwnedCatalogItem`; `categoryId` (when non-null) is validated via the existing
  null-safe `assertOwnedCategory` (lib/ownership.ts:49) on BOTH create and update — the schema flags
  `catalog_items.category_id` as an unenforced cross-owner FK (schema.ts:20). Duplicate `canonicalName`
  is caught by wrapping the INSERT/UPDATE and translating pg error `23505` on the unique index via
  `pgError` (lib/errors.ts:33) to `HttpError(409)` on BOTH create and update — no racy pre-check.
  Cross-owner / missing ids → `HttpError(404)`, no write. All error messages indistinguishable, no leak.
- **PUT-strict updates** exactly like `UpdateShoppingListItemSchema`: every logical field required
  including nullables; omitting one is a 400, never preserve-on-omission. Create MAY default optionals.
- **Demo safety is automatic** (auth chokepoint). Add nothing to the demo allowlist; mark no route
  `public`. Prove by integration requests through the real auth hook with a demo session, plus a
  route-config test asserting `config.public !== true` and unauth → 401.
- **Routes** (relative to `/api/shopping`): `POST /catalog`, `GET /catalog`, `GET /catalog/match`
  (read-only, `?q=`), `GET /catalog/:id`, `PUT /catalog/:id`, `DELETE /catalog/:id`,
  `POST /lists/:listId/items/:itemId/canonicalize`. **Register the static `GET /catalog/match` BEFORE
  the param `GET /catalog/:id`** (convention from lists.ts:128, avoids the static path being shadowed).
  `withTypeProvider<ZodTypeProvider>()`, Zod body/params/query/response from `@compass/shared`,
  `req.session!.userId`. No route `public`.
- **No web pages** (that is 12.x). Shared contracts + API only.

## Plan
- P1: `packages/shared/src/money.ts` — add `unitPricePaise` (BigInt, MAX_SAFE_INTEGER bound check) +
  `convertToBaseQuantity` (decimal-string exact parse). `money.test.ts`: example tests (₹/kg, ₹/L,
  ₹/piece, exact-half rounding, mixed units, **zero price valid**, result > MAX_SAFE_INTEGER throws),
  property tests (result never negative; `unitPricePaise` non-increasing in quantityBase), guard tests
  (zero/negative quantityBase → RangeError; convert: excess-dp / fractional-base / tiny-positive-that-
  would-round-to-0 → RangeError; "1.5" kg→1500, "0.25" L→250, "6" piece→6 exact).
- P2: `packages/shared/src/schemas/shopping.ts` — add `DisplayUnitSchema`, `CreateCatalogItemSchema`,
  `UpdateCatalogItemSchema`, `CatalogMatchResultSchema`, `CanonicalizeItemResponseSchema` + `deepEqual`
  expected-object tests; pairing/limit refinements bite (one-sided quantity/unit → error).
- P3: `services/canonicalize.ts` — `matchCatalog`, catalog CRUD (owner-scoped; `assertOwnedCategory`
  for categoryId on create+update; duplicate-name via `pgError` 23505 → 409 on both), `canonicalizeItem`
  (list-then-item `FOR UPDATE` tx, auto-link on unique only, bump item+list updatedAt on link). Reuse
  `assertOwnedCatalogItem`/`assertOwnedList`/`assertOwnedListItem` and `pgError` (lib/errors.ts).
- P4: `routes/catalog.ts` — the 7 routes above; register in `plugin.ts`. No route `public`.
- P5: Regenerate BOTH snapshot fixtures via a one-off hermetic script that reuses the snapshot test's
  own enumeration (as 9.2's P5 did), run it, inspect the diff (exactly the new routes + auto `HEAD` for
  new GETs), then DELETE the script.
- P6: Tests — shared (P1/P2); hermetic route-config (every mutation route not `public`, unauth→401,
  each route's method/path/schemas present); CI-gated integration: catalog CRUD round-trip; owner
  IDOR 404 (catalog `:id` and item `:itemId` by id+listId); category-ownership 404 on create AND update
  (incl. null categoryId allowed); duplicate canonicalName → 409 on create AND update; PUT omitted-field
  → 400; match unique / ambiguous (seed BOTH "Atta" and "atta") / none; `canonicalizeItem` auto-links on
  unique and bumps item+list updatedAt, NO-write + no bump on ambiguous & none (item unchanged, still
  usable); stale-match race — a concurrent updateItem changing rawText is serialized by the item lock
  (separate connections + sync points, as 9.2's concurrency tests did); `GET /catalog/match` not
  shadowed by `/:id`; demo 403 on every catalog mutation AND canonicalize via the real auth hook;
  unauth → 401.

## Acceptance Criteria
- AC1: `unitPricePaise` computes ₹/kg and ₹/L (and ₹/piece) correctly across mixed base units, in
  integer/BigInt math with deterministic round-half-up; guards reject invalid input. Proven by tests.
- AC2: A unique catalog match auto-links (`catalogItemId` set) via `canonicalizeItem`; a ≥2 match is
  returned as `ambiguous` with candidate ids and performs NO write; never auto-resolved.
- AC3: An unmatched item (`none`) remains usable — `canonicalizeItem` leaves `rawText`/item intact and
  writes nothing; a raw-text-only item continues to persist and function (9.2 behaviour preserved).
- AC4: Canonicalization NEVER creates a catalog entry. The only create path is `POST /catalog`
  (user-confirmed). `matchCatalog`/`canonicalizeItem` never insert into `catalog_items`.
- AC5: Every client FK is ownership-checked (catalog `:id`, item `:itemId` by BOTH id+listId, body
  `categoryId`); cross-owner/missing → indistinguishable 404, no write. Duplicate canonicalName → 409.
- AC6: Demo session rejected on every shopping mutation (real auth hook); no route `public`; unauth→401.
- AC7: Both route-snapshot fixtures regenerated by reusing the snapshot enumeration; diff is exactly the
  new routes + auto `HEAD` for new GET routes only.
- AC8: `npm run typecheck`, `npm run lint` exit 0; shared + hermetic tests pass; DB-gated integration
  passes under CI. (Locally the DB-gated file THROWS a literal `needs DATABASE_URL` reason at load —
  the established `lists.route.test.ts` convention — rather than emitting a node:test skip; it runs in
  CI. Kept deliberately, matching 9.2's disposition of the same point.)

## Verification
- T1: `run-gates` (or `npm run typecheck`/`lint`/`test`) — typecheck 0, lint 0.
- T2: shared money + shopping schema tests pass; `packages/shared` green.
- T3: hermetic route-config tests pass; DB-gated integration reports literal skip reason locally.
- T4: route-snapshot test passes; fixture diff inspected = exactly the new routes.
- T5: "does the test bite" drill for the ambiguous-match no-write path and the unitPricePaise rounding.
- T6: CI (via `ci-validator` / `check-ci -g canonicalize`) confirms the integration suite executed.

## Non-Goals
- Price observations / actual ₹/kg display on items (10.1), AI text/photo capture (9.4/9.5), web (12.x).
- Fuzzy/semantic matching — exact case-insensitive only, mirroring the extractor.
- Any migration/schema/backup change — tables and coverage already exist from 9.1.
