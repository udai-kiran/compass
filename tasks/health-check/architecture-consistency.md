# Architecture Consistency Check
Date: 2026-08-14

Source of claims: `ROADMAP.md:29` and `ROADMAP.md:95`, `tasks/TDD.md:8`,
`tasks/00.03-module-scaffold-and-route-gate.md:12`.

---

## 1. Table count — claimed "49 tables"

**Commands run:**
```
grep -c 'pgTable(' apps/api/src/db/schema.ts apps/api/src/db/shared/*.ts \
  apps/api/src/db/core-schema.ts apps/api/src/modules/*/schema.ts

grep 'pgTable(' apps/api/src/db/shared/*.ts apps/api/src/db/core-schema.ts \
  apps/api/src/modules/*/schema.ts | wc -l
```

**Raw grep -c output (per file):**
```
apps/api/src/db/schema.ts:1              ← comment only (barrel declares "ZERO inline pgTable()")
apps/api/src/db/shared/hubs.ts:2
apps/api/src/db/shared/ledger.ts:2
apps/api/src/db/shared/recurring.ts:1
apps/api/src/db/shared/foundation.ts:4
apps/api/src/db/shared/spines.ts:4
apps/api/src/db/core-schema.ts:1
apps/api/src/modules/automation/schema.ts:3
apps/api/src/modules/credit/schema.ts:8
apps/api/src/modules/ingest/schema.ts:6
apps/api/src/modules/investments/schema.ts:7
apps/api/src/modules/ledger/schema.ts:5
apps/api/src/modules/planning/schema.ts:6
apps/api/src/modules/protection/schema.ts:3
apps/api/src/modules/system/schema.ts:6
```

**Second command (excluding barrel):** 58

**Interpretation:** The 58 raw hits are inflated because module `schema.ts` files
re-export shared tables (each re-export line also contains `pgTable` from the
original import path). The decomposition test (`apps/api/src/db/schema.decomposition.test.ts`)
uses `Object.is` identity to deduplicate, and asserts:

```
assert.equal(tables.length, 49, ...)   // line 133 — excludes `users`
assert.ok(isPgTable(barrel.users), ...) // line 137 — users checked separately
```

**Actual unique table count: 50** (49 non-`users` tables + `users` from
`core-schema.ts`). The ROADMAP claim of "49 tables" omits `users`, undercounting
by 1.

---

## 2. API routes — claimed "155 API routes across 39 route modules"

**Commands run:**
```
grep -rn 'app\.(get|post|put|patch|delete)(' apps/api/src/modules/*/routes/*.ts | wc -l
grep -rn 'r\.(get|post|put|patch|delete)(' apps/api/src/modules/*/routes/*.ts | wc -l
grep -rn '\.(get|post|put|patch|delete)(' apps/api/src/modules/*/routes/*.ts \
  | grep -v '\.test\.ts' | grep -v '^\s*//' | wc -l
grep -c 'GET|POST|PUT|PATCH|DELETE' apps/api/src/route-surface.snapshot.txt
```

**Results:**
- `app.METHOD(` pattern: 10
- `r.METHOD(` pattern: 192
- Combined, non-test, non-comment: 204
- `route-surface.snapshot.txt` (committed ground truth): **202 routes** in 284 lines

**Actual route count: 202.** The ROADMAP/task-board claim of 155 is outdated
by approximately 47 routes. New routes were added after the snapshot claim was
written (the snapshot file itself is the live truth — it is byte-compared by the
route snapshot test).

---

## 3. Domain modules — claimed "8 domain modules"

**Command:**
```
ls -d apps/api/src/modules/*/
```

**Output:**
```
apps/api/src/modules/automation/
apps/api/src/modules/credit/
apps/api/src/modules/ingest/
apps/api/src/modules/investments/
apps/api/src/modules/ledger/
apps/api/src/modules/planning/
apps/api/src/modules/protection/
apps/api/src/modules/system/
```

**Actual: 8 modules. Claim is accurate.**

---

## 4. Route modules — claimed "39 route modules"

**Commands:**
```
find apps/api/src/modules/ -name '*.ts' -path '*/routes/*' | wc -l          → 49
find apps/api/src/modules/ -name '*.ts' -path '*/routes/*' \
  | grep -v '\.test\.ts' | wc -l                                             → 40
```

The 49 includes 9 `*.route.test.ts` files colocated in routes/. Actual
non-test route files: **40**. Claimed: 39. Off by 1 (one route file was added
after the claim was written).

---

## 5. Test files — claimed "88 test files"

**Command:**
```
find . -name '*.test.ts' -not -path '*/node_modules/*' | wc -l
```

**Result: 133**

The ROADMAP (`ROADMAP.md:29`) and `tasks/TDD.md:8` both claim 88 test files.
Actual: **133**. Off by 45 — significantly stale (45 new test files added since
the count was recorded).

---

## 6. Web pages — claimed "31 web pages"

**Command:**
```
find apps/web/src/routes/ -name '*.tsx' | wc -l
```

**Result: 44 total .tsx files**

Breakdown by kind:
- Files ending `Page.tsx`: 30 (full navigable pages)
- `Login.tsx`, `Signup.tsx`: 2 (standalone auth pages — not Page.tsx suffix)
- Panels (`*Panel.tsx`, `GeneralPanels.tsx`): 7
- Other components (Drawer, Modal, Picker, Stub, etc.): 5

**Actual navigable page components (Page.tsx + Login + Signup): 32.**
Claim of 31 is off by 1.

---

## 7. Module plugin registration in app.ts

**File read:** `apps/api/src/app.ts`

All 8 modules are imported and registered in `registerRoutes()` (lines 140–149):

```typescript
await app.register(systemRoutes);       // modules/system/plugin.ts
await app.register(ledgerRoutes);       // modules/ledger/plugin.ts
await app.register(ingestRoutes);       // modules/ingest/plugin.ts
await app.register(planningRoutes);     // modules/planning/plugin.ts
await app.register(investmentsRoutes);  // modules/investments/plugin.ts
await app.register(creditRoutes);       // modules/credit/plugin.ts
await app.register(protectionRoutes);   // modules/protection/plugin.ts
await app.register(automationRoutes);   // modules/automation/plugin.ts
```

**All 8 modules confirmed registered. Claim is accurate.**

---

## 8. Schema decomposition test

**File:** `apps/api/src/db/schema.decomposition.test.ts`

**Exists: yes.** Test header (line 3):
> "verifies that the `db/schema.ts` barrel is a pure re-export barrel with no
> inline definitions, that every table/enum is `Object.is`-identical to its
> defining file, and that the export set is exactly 49 tables + 39 enums (plus
> `users` from core) with no duplicates."

Assertion at line 133: `assert.equal(tables.length, 49, ...)`
Assertion at line 134: `assert.equal(enums.length, 39, ...)`
Separate check at line 137 for `users`.

The test cross-references all 8 module schema namespaces and all 5 shared layers.

---

## Summary table

| Claim | Actual | Status |
|---|---|---|
| 49 tables | 50 (49 non-`users` + `users`) | Off by 1 (users not counted) |
| 155 API routes | 202 (per route-surface.snapshot.txt) | Off by 47 — stale |
| 8 domain modules | 8 | Accurate |
| 39 route modules | 40 non-test route files | Off by 1 |
| 88 test files | 133 (excl. node_modules) | Off by 45 — stale |
| 31 web pages | 32 (Page.tsx + Login + Signup) | Off by 1 |
| All 8 modules registered | Confirmed in app.ts | Accurate |
| Decomposition test asserts 49 | Yes, line 133 | Accurate |
