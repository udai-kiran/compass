# Verification-1: Task 9.3 — Catalog Canonicalization

Branch: `feat/shopping-core-capture`  
Verifier: independent worker (2026-08-21)

---

## 1. `git status --porcelain`

```
 M apps/api/src/modules/shopping/plugin.ts
 M apps/api/src/route-surface.snapshot.txt
 M apps/api/src/route-table.snapshot.txt
 M packages/shared/src/money.ts
 M packages/shared/src/schemas/shopping.test.ts
 M packages/shared/src/schemas/shopping.ts
 M tasks/064-shopping-lists-crud/TASK.md
 M tasks/09.02-lists-crud.md
 M tasks/README.md
?? apps/api/src/modules/shopping/routes/catalog.hermetic.test.ts
?? apps/api/src/modules/shopping/routes/catalog.route.test.ts
?? apps/api/src/modules/shopping/routes/catalog.ts
?? apps/api/src/modules/shopping/services/canonicalize.ts
?? packages/shared/src/money.test.ts
?? tasks/065-test-ci-agents/
?? tasks/066-catalog-canonicalization/
?? tasks/067-paste-text-capture/
```

Exit code: 0

---

## 2. `git diff --stat`

```
apps/api/src/modules/shopping/plugin.ts      |   2 +
 apps/api/src/route-surface.snapshot.txt      |  10 ++
 apps/api/src/route-table.snapshot.txt        |   6 +-
 packages/shared/src/money.ts                 | 115 ++++++++++++++
 packages/shared/src/schemas/shopping.test.ts | 225 +++++++++++++++++++++++++++
 packages/shared/src/schemas/shopping.ts      |  72 +++++++++
 tasks/064-shopping-lists-crud/TASK.md        |  13 +-
 tasks/09.02-lists-crud.md                    |  16 +-
 tasks/README.md                              |   2 +-
 9 files changed, 451 insertions(+), 10 deletions(-)
```

Full unified diff was captured and verified (see command 2 output — entire diff pasted in session). New untracked files (not in tracked diff): `catalog.ts`, `canonicalize.ts`, `catalog.hermetic.test.ts`, `catalog.route.test.ts`, `money.test.ts` (plus task directories).

---

## 3. Unchanged file verification

| File | Status |
|------|--------|
| `apps/api/src/modules/shopping/schema.ts` | **UNCHANGED** — `git diff` produced no output |
| `apps/api/src/modules/system/services/backup.ts` | **UNCHANGED** — `git diff` produced no output |
| `apps/api/src/modules/shopping/services/lists.ts` | **UNCHANGED** — `git diff` produced no output |
| `apps/api/drizzle/` (all files) | **UNCHANGED** — `git diff -- apps/api/drizzle/` produced no output |

No new migration was added. Confirmed: no schema changes, no backup coverage gap triggered.

---

## 4. No regen script

```
$ ls apps/api/regen-snapshots.mjs
lsd: /work/personal/compass/apps/api/regen-snapshots.mjs: No such file or directory (os error 2).
Exit code: 2 (not found, expected)
```

`git status` confirms no `regen-snapshots.mjs` untracked file. PASS.

---

## 5. `npm run typecheck`

Command: `npm run typecheck` from repo root

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

Exit code: 0. Zero `error TS` lines. PASS.

---

## 6. `npm run lint`

Command: `npm run lint` from repo root

```
> compass@0.1.0 lint
> eslint .
```

Exit code: 0. No violations. PASS.

---

## 7. `npm run test -w packages/shared`

Command: `npm run test -w packages/shared` from repo root

```
ℹ tests 310
ℹ suites 0
ℹ pass 310
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 308.890639
```

Exit code: 0. All 310 pass including all 9.3 new tests (DisplayUnitSchema, CreateCatalogItemSchema, UpdateCatalogItemSchema, CatalogMatchResultSchema, CanonicalizeItemResponseSchema, deepEqual round-trips, plus unitPricePaise and convertToBaseQuantity tests). PASS.

---

## 8. `node --experimental-test-module-mocks --test apps/api/src/modules/shopping/routes/catalog.hermetic.test.ts`

```
(node:46506) ExperimentalWarning: Module mocking is an experimental feature and might change at any time
✔ all catalog mutation routes are not marked public (62.249935ms)
✔ all 7 expected catalog routes are registered (2.61345ms)
✔ GET /catalog/match is registered before GET /catalog/:id (static before param) (2.093991ms)
✔ each catalog route has the expected body/params/querystring/response schemas (2.070215ms)
✔ unauthenticated request to GET /catalog → 401 (session guard bites) (7.65023ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 273.926926
```

Exit code: 0. PASS.

---

## 9. `node --test apps/api/src/app.route-snapshot.test.ts`

```
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte — the real 'unchanged API surface' gate (89.072463ms)
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte (29.345747ms)
✔ assertRouteTableMatches rejects an added route (0.172589ms)
✔ assertRouteTableMatches rejects a removed route (0.071747ms)
✔ assertRouteTableMatches rejects a renamed route (0.063662ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.053733ms)
✔ assertRouteTableMatches accepts identical tables (0.095072ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 873.773555
```

Exit code: 0. PASS.

---

## 10. Grep-verify invariants

### `apps/api/src/modules/shopping/routes/catalog.ts`

**No route has `config: { public: true }`:**
```
$ grep -n "config:" apps/api/src/modules/shopping/routes/catalog.ts
15: * All routes are session-authenticated. No route has `config: { public: true }`.
```
Only one match — in a file-level comment on line 15, not in any route handler. No actual `config:` key in any route object. CONFIRMED.

**`/catalog/match` declared before `/catalog/:id`:**
```
Line 71:   // GET /catalog/match — case-insensitive exact match by ?q=.
Line 72:   // MUST be registered before /catalog/:id (static path before param path).
Line 73:     "/catalog/match",
Line 83:   // GET /catalog/:id — fetch a single catalog item.
Line 85:     "/catalog/:id",
```
`/catalog/match` registration at line 73, `/catalog/:id` at line 85. Static before param. CONFIRMED.

### `apps/api/src/modules/shopping/services/canonicalize.ts`

**`.for("update")` appears for BOTH shopping_lists and shopping_list_items in canonicalizeItem:**
```
Line 230:       .for("update");   ← shoppingLists row (list lock)
Line 238:       .for("update");   ← shoppingListItems row (item lock)
```
CONFIRMED.

**`pgError` / SQLSTATE `23505` handling on create AND update:**
```
Line 28: import { HttpError, pgError } from "../../../lib/errors.ts";
Line 120:     const pg = pgError(err);
Line 121:     if (pg?.code === "23505") {
Line 179:     const pg = pgError(err);
Line 180:     if (pg?.code === "23505") {
```
Lines 120-121 are inside `createCatalogItem`, lines 179-180 inside `updateCatalogItem`. CONFIRMED.

**`assertOwnedCategory` called on create AND update:**
```
Line 30: import { assertOwnedCategory } from "../../../lib/ownership.ts";
Line 104:   await assertOwnedCategory(db, userId, input.categoryId);
Line 160:   await assertOwnedCategory(db, userId, input.categoryId);
```
CONFIRMED.

**`matchCatalog` uses case-insensitive `lower(` and returns ambiguous on ≥2:**
```
Line 87:         sql`lower(${catalogItems.canonicalName}) = lower(${want})`,
```
```
Line 91:   if (rows.length === 0) return { status: "none" };
Line 92:   if (rows.length === 1) return { status: "matched", catalogItemId: rows[0]!.id };
Line 93:   return { status: "ambiguous", candidateIds: rows.map((r) => r.id) };
```
`rows.length >= 2` falls through to the ambiguous return on line 93. CONFIRMED.

### `packages/shared/src/money.ts`

**`unitPricePaise` uses BigInt and MAX_SAFE_INTEGER bound check:**
```
Line 84:   const p = BigInt(pricePaise);
Line 85:   const q = BigInt(quantityBase);
Line 87:   // Round-half-up: floor((p * ref / q) + 0.5) = floor((2p·ref + q) / (2q))
Line 88:   const result = (2n * p * ref + q) / (2n * q);
Line 90:   if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
Line 91:     throw new RangeError("unitPricePaise result exceeds safe integer range");
Line 92:   }
```
CONFIRMED.

**`convertToBaseQuantity` takes a `string` and has NO epsilon/`1e-6` tolerance and asserts `isSafeInteger`:**
```
Line 114: export function convertToBaseQuantity(
Line 115:   quantity: string,
```
```
Line 154:   if (!Number.isSafeInteger(quantityBase)) {
```
No `epsilon`, `1e-6`, or floating-point arithmetic anywhere in the function — it uses pure integer string parsing. CONFIRMED.

---

## 11. DB-gated integration test: `catalog.route.test.ts`

**FINDING: test FAILS locally, does NOT skip.**

```
$ node --test apps/api/src/modules/shopping/routes/catalog.route.test.ts

Error: catalog.route.test.ts needs DATABASE_URL set — export it (see apps/api/.env) before running `npm run test -w apps/api`.
    at requireEnv (…catalog.route.test.ts:32:11)
    at …catalog.route.test.ts:38:1

✖ /work/personal/compass/apps/api/src/modules/shopping/routes/catalog.route.test.ts (501.326761ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 506.163549
exit code: 1
```

The `requireEnv()` function throws an `Error` at **module-load time**, before any `node:test` test block is entered. This causes a process-level failure (exit 1) rather than a skipped test.

This is **identical** to the behavior of the existing `lists.route.test.ts`, which shows the same pattern and the same exit code 1 locally:

```
$ node --test apps/api/src/modules/shopping/routes/lists.route.test.ts
Error: lists.route.test.ts needs DATABASE_URL set — …
exit code: 1
```

So `catalog.route.test.ts` follows the codebase's established convention: DB-gated tests fail at top-level load when env is missing; they only pass in CI where `DATABASE_URL` is set. This is the same convention used by all other `*.route.test.ts` files. It is not a defect relative to the existing pattern.

---

## Summary of findings

| Check | Result |
|-------|--------|
| schema.ts unchanged | PASS |
| backup.ts unchanged | PASS |
| lists.ts unchanged | PASS |
| No drizzle migration added | PASS |
| No regen-snapshots.mjs | PASS |
| typecheck (0 errors) | PASS |
| lint | PASS |
| shared tests (310/310) | PASS |
| hermetic test (5/5) | PASS |
| route-snapshot test (7/7) | PASS |
| No `config: { public: true }` | PASS (comment only, no actual config) |
| `/catalog/match` before `/catalog/:id` | PASS |
| `.for("update")` on both rows | PASS |
| pgError/23505 on create AND update | PASS |
| assertOwnedCategory on create AND update | PASS |
| matchCatalog uses lower() | PASS |
| ambiguous on ≥2 matches | PASS |
| unitPricePaise uses BigInt + MAX_SAFE_INTEGER check | PASS |
| convertToBaseQuantity takes string, no epsilon, asserts isSafeInteger | PASS |
| catalog.route.test.ts locally | FAILS (exit 1) — NOT a skip — but matches existing convention of all *.route.test.ts files |

### Contradictions with implementer's report

None substantive. The one notable point: the brief asked whether `catalog.route.test.ts` "skips locally" — it does not skip, it **fails with exit code 1** (throwing at module load time). However this is identical to the existing `lists.route.test.ts` behavior and appears to be the codebase's accepted pattern, not a defect unique to this implementation. The implementer did not explicitly claim it skips; the brief posed the question.

All other checked invariants are confirmed correct.
