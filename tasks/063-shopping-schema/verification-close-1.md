# Verification Close-1: Task 9.1 Shopping Schema Ground-Truth

Date: 2026-08-21

## 1. Repo state

**Branch:** main

**`git status --porcelain=v1` output:**
```
?? screen-shots/
```
No tracked-file modifications; only an untracked `screen-shots/` directory.

## 2. Recent log (`git log --oneline -8`)

```
0398eb7 Merge pull request #198 from udai-kiran/feat/shopping-schema
e1c9734 feat(shopping): shopping schema + shared contracts (task 9.1)
c8b2d46 Merge pull request #197 from udai-kiran/feat/ai-vision-support
1a90ce5 feat(ai): vision support in packages/ai (task 8.1)
40e584f Merge pull request #196 from udai-kiran/fix/ci-green
16978f9 fix(deps): force deepmerge-ts 8.0.1 to clear a high-severity advisory
4ee61b0 fix(ci): green the test suite — stale legacy-column tests + test isolation
5f2f6bb feat(planning): v2.2.0 goal-based planning release
```

## 3. Task 9.1 shopping module files

**`apps/api/src/modules/shopping/` (recursive, files only):**
```
apps/api/src/modules/shopping/plugin.ts
apps/api/src/modules/shopping/routes/units.route.test.ts
apps/api/src/modules/shopping/routes/units.ts
apps/api/src/modules/shopping/schema.smoke.test.ts
apps/api/src/modules/shopping/schema.ts
apps/api/src/modules/shopping/services/pantry.test.ts
apps/api/src/modules/shopping/services/pantry.ts
apps/api/src/modules/shopping/services/units.test.ts
apps/api/src/modules/shopping/services/units.ts
```

**Named file existence checks:**
- `packages/shared/src/schemas/shopping.ts` — EXISTS
- `apps/web/src/lib/shopping-queries.ts` — EXISTS
- `apps/api/drizzle/0005_late_centennial.sql` — EXISTS

## 4. PR #198 state

```json
{
  "baseRefName": "main",
  "mergeCommit": {"oid": "0398eb7607958b18ae2ac57884538731996bfbce"},
  "mergedAt": "2026-08-21T02:56:06Z",
  "state": "MERGED",
  "title": "feat(shopping): shopping schema + shared contracts (task 9.1)"
}
```

PR #198 is MERGED into main. Merge commit matches the HEAD of the log above.

## 5. Local checks

### 5a. `npm run -s typecheck`

Command: `npm run -s typecheck`
Exit code: **0**
Output: (no output — clean)

### 5b. `npm run -s lint`

Command: `npm run -s lint`
Exit code: **0**
Output: (no output — clean)

### 5c. `node --test apps/api/src/modules/shopping/**/*.test.ts`

Note: `node --test apps/api/src/modules/shopping/` (directory form) fails with `MODULE_NOT_FOUND` — node --test does not accept a bare directory argument without a glob. Correct invocation uses the glob form.

Command: `node --test apps/api/src/modules/shopping/**/*.test.ts`
Exit code: **0**

Output:
```
✔ GET /api/shopping/units returns 200 and a schema-valid body with all three units (142.637072ms)
✔ GET /units (unprefixed) returns 404 — prefix is actually applied (5.568ms)
✔ GET /api/shopping/units does not opt out of authentication (config.public is not true) (4.275324ms)
✔ all 8 shopping tables resolve to the expected Postgres names (1.590808ms)
✔ every _paise column across all 8 tables has columnType PgBigInt53 (0.516409ms)
✔ shopping_list_items has no user_id column; the other 7 tables all have user_id (0.247518ms)
✔ shoppingListStatus has exactly ['active', 'archived'] (0.957309ms)
✔ shoppingListItemStatus has exactly ['pending', 'bought', 'dropped'] (0.236108ms)
✔ normalizedUnit has exactly ['g', 'ml', 'piece'] (0.18019ms)
✔ priceSourceKind has exactly ['quick_commerce', 'ecommerce', 'local_store', 'manual'] (0.21487ms)
✔ cartDraftStatus has exactly ['draft', 'ordered', 'abandoned'] (0.187515ms)
✔ habit_profiles has a unit column (no quantity-bearing table is missing its unit) (0.207306ms)
✔ every table carrying a quantity or consumption column also has a unit column (0.576515ms)
✔ catalog_items has exactly the expected CHECK constraints (0.766007ms)
✔ shopping_list_items has exactly the expected CHECK constraints (0.321167ms)
✔ price_observations has exactly the expected CHECK constraints (0.293519ms)
✔ pantry_items has exactly the expected CHECK constraints (0.322512ms)
✔ cart_drafts has exactly the expected CHECK constraints (0.541136ms)
✔ habit_profiles has exactly the expected CHECK constraints (0.302199ms)
✔ shopping_lists has exactly zero CHECK constraints (0.203744ms)
✔ price_sources has exactly zero CHECK constraints (0.21715ms)
✔ pantryItemsForUser generates SQL targeting pantry_items filtered by user_id (4.951375ms)
✔ habitProfilesForUser generates SQL targeting habit_profiles filtered by user_id (0.634401ms)
✔ pantryItemsForUser SQL does not reference sharing_grants (owner-only scoping, not sharing-aware) (0.476502ms)
✔ habitProfilesForUser SQL does not reference sharing_grants (owner-only scoping, not sharing-aware) (0.412842ms)
✔ NORMALIZED_UNITS and normalizedUnit enum are in sync (1.773113ms)
✔ every entry in NORMALIZED_UNITS parses against NormalizedUnitInfoSchema (1.726196ms)
✔ each kind appears exactly once — one base unit per measurement kind (0.277485ms)
ℹ tests 28
ℹ suites 0
ℹ pass 28
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 912.977762
```

All 28 tests pass. None required DATABASE_URL (all tests are hermetic — smoke tests use Drizzle schema introspection, service tests use in-process SQL generation, route test uses mock.module()).

### 5d. `npm run -s test -w packages/shared`

Command: `npm run -s test -w packages/shared`
Exit code: **0**

Counts:
```
ℹ tests 230
ℹ suites 0
ℹ pass 230
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 418.817313
```

All 230 tests pass, including the shopping-schema-specific tests visible in the output:
- `NormalizedUnitSchema accepts g, ml, piece and rejects kg and litre`
- `PriceObservationSchema rejects a fractional pricePaise`
- `CatalogItemSchema rejects an empty canonicalName and accepts brand/categoryId as null`
- `ShoppingListItemSchema rejects an empty rawText and rejects a negative position`
- `ShoppingUnitsResponseSchema parses valid entry and rejects an empty label`
- `CartDraftSchema accepts totalPaise 0 and rejects totalPaise 12.5`
- etc.

## 6. Node version

```
v24.18.0
```

Local Node is v24.18.0. CI pins Node major 24 (`engines.node: >=24` in root `package.json`). The local version matches the CI constraint exactly (both are Node 24).

## Summary

| Check | Result |
|---|---|
| Branch | main |
| Working tree clean | Yes (only untracked screen-shots/) |
| PR #198 merged | Yes, 2026-08-21T02:56:06Z |
| Shopping module files (9 files) | All present |
| `packages/shared/src/schemas/shopping.ts` | Present |
| `apps/web/src/lib/shopping-queries.ts` | Present |
| `apps/api/drizzle/0005_late_centennial.sql` | Present |
| typecheck | Exit 0, clean |
| lint | Exit 0, clean |
| Shopping module tests (28) | Exit 0, 28/28 pass |
| packages/shared tests (230) | Exit 0, 230/230 pass |
| Node version | v24.18.0 (matches CI >=24) |
