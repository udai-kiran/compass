# Task 9.2 Shopping Lists CRUD — Independent Verification

Date: 2026-08-21
Verifier: Claude (independent, read-only — no files modified)

---

## 1. Git status and changed files

Command: `git -C /home/udai/common/compass status --porcelain=v1`
Branch: `main`

Output:
```
 M apps/api/src/modules/shopping/plugin.ts
 M apps/api/src/route-surface.snapshot.txt
 M apps/api/src/route-table.snapshot.txt
 M packages/shared/src/schemas/shopping.test.ts
 M packages/shared/src/schemas/shopping.ts
 M tasks/09.01-shopping-schema.md
 M tasks/09.02-lists-crud.md
 M tasks/README.md
?? apps/api/src/modules/shopping/routes/lists.hermetic.test.ts
?? apps/api/src/modules/shopping/routes/lists.route.test.ts
?? apps/api/src/modules/shopping/routes/lists.ts
?? apps/api/src/modules/shopping/services/lists.ts
?? apps/api/src/modules/shopping/services/ownership.ts
?? screen-shots/
?? tasks/063-shopping-schema/investigation-crud-patterns.md
?? tasks/063-shopping-schema/verification-close-1.md
?? tasks/064-shopping-lists-crud/
```

**Expected 9.2 files (all present):**
- `packages/shared/src/schemas/shopping.ts` — M (modified)
- `packages/shared/src/schemas/shopping.test.ts` — M (modified)
- `apps/api/src/modules/shopping/services/lists.ts` — ?? (new untracked)
- `apps/api/src/modules/shopping/services/ownership.ts` — ?? (new untracked)
- `apps/api/src/modules/shopping/routes/lists.ts` — ?? (new untracked)
- `apps/api/src/modules/shopping/routes/lists.hermetic.test.ts` — ?? (new untracked)
- `apps/api/src/modules/shopping/routes/lists.route.test.ts` — ?? (new untracked)
- `apps/api/src/modules/shopping/plugin.ts` — M (modified)
- `apps/api/src/route-surface.snapshot.txt` — M (modified)
- `apps/api/src/route-table.snapshot.txt` — M (modified)

**Stray files observed (not 9.2 implementation):**
- `tasks/09.01-shopping-schema.md` — task tracking doc, not code
- `tasks/09.02-lists-crud.md` — task tracking doc, not code
- `tasks/README.md` — task index, not code
- `tasks/063-shopping-schema/investigation-crud-patterns.md` — investigation artifact
- `tasks/063-shopping-schema/verification-close-1.md` — prior verification artifact
- `tasks/064-shopping-lists-crud/` — this verification directory
- `screen-shots/` — untracked private artifact directory

**No leftover snapshot-generator script found.**
**Nothing staged** (all entries are `??` or ` M`, no `M ` or `A ` with staging prefix).

---

## 2. Route snapshot diffs

### route-surface.snapshot.txt diff (verbatim)

```diff
diff --git a/apps/api/src/route-surface.snapshot.txt b/apps/api/src/route-surface.snapshot.txt
index f306725..c6429f8 100644
--- a/apps/api/src/route-surface.snapshot.txt
+++ b/apps/api/src/route-surface.snapshot.txt
@@ -20,6 +20,8 @@ DELETE /api/merchant-rules/:id
 DELETE /api/recurring/:id
 DELETE /api/resources/:id
 DELETE /api/sharing-grants/:id
+DELETE /api/shopping/lists/:id
+DELETE /api/shopping/lists/:id/items/:itemId
 DELETE /api/sips/:id
 DELETE /api/sips/:id/installments/link/:transactionId
 DELETE /api/splits/:id
@@ -114,6 +116,8 @@ GET /api/retirement/:accountId/details
 GET /api/search
 GET /api/search/recent
 GET /api/sharing-grants
+GET /api/shopping/lists
+GET /api/shopping/lists/:id
 GET /api/shopping/units
 GET /api/sips
 GET /api/sips/:id/installment-candidates
@@ -215,6 +219,8 @@ HEAD /api/retirement/:accountId/details
 HEAD /api/search
 HEAD /api/search/recent
 HEAD /api/sharing-grants
+HEAD /api/shopping/lists
+HEAD /api/shopping/lists/:id
 HEAD /api/shopping/units
 HEAD /api/sips
 HEAD /api/sips/:id/installment-candidates
@@ -301,6 +307,8 @@ POST /api/notifications/read-all
 POST /api/recurring
 POST /api/resources
 POST /api/sharing-grants
+POST /api/shopping/lists
+POST /api/shopping/lists/:id/items
 POST /api/sips
 POST /api/sips/:id/installments
 POST /api/sips/:id/installments/link
@@ -332,4 +340,7 @@ PUT /api/notification-prefs
 PUT /api/profile
 PUT /api/projection-settings
 PUT /api/retirement/:accountId/details
+PUT /api/shopping/lists/:id
+PUT /api/shopping/lists/:id/items/:itemId
+PUT /api/shopping/lists/:id/items/reorder
 PUT /api/transactions/:id/splits
```

### route-table.snapshot.txt diff (verbatim)

```diff
diff --git a/apps/api/src/route-table.snapshot.txt b/apps/api/src/route-table.snapshot.txt
index 463e9df..30d3f2a 100644
--- a/apps/api/src/route-table.snapshot.txt
+++ b/apps/api/src/route-table.snapshot.txt
@@ -119,6 +119,11 @@
 ├── /api/sharing-grants (POST, GET, HEAD)
 │   └── /:id (DELETE)
 ├── /api/shopping/units (GET, HEAD)
+├── /api/shopping/lists (GET, HEAD, POST)
+│   └── /:id (GET, HEAD, PUT, DELETE)
+│       └── /items (POST)
+│           ├── /reorder (PUT)
+│           └── /:itemId (PUT, DELETE)
 ├── /api/splits/:id (GET, HEAD, PATCH, DELETE)
 ├── /api/user-tasks (GET, HEAD, POST)
 │   └── /:id (GET, HEAD, PATCH, DELETE)
```

**Verification of route-surface.snapshot.txt additions:**
- 2 × DELETE: `DELETE /api/shopping/lists/:id`, `DELETE /api/shopping/lists/:id/items/:itemId`
- 2 × GET: `GET /api/shopping/lists`, `GET /api/shopping/lists/:id`
- 2 × HEAD (auto, only for the 2 GET routes): `HEAD /api/shopping/lists`, `HEAD /api/shopping/lists/:id`
- 2 × POST: `POST /api/shopping/lists`, `POST /api/shopping/lists/:id/items`
- 3 × PUT: `PUT /api/shopping/lists/:id`, `PUT /api/shopping/lists/:id/items/:itemId`, `PUT /api/shopping/lists/:id/items/reorder`

Total new entries: 11 lines (9 unique method+path routes + 2 auto-HEAD). No HEAD added for POST/PUT/DELETE. No other routes changed.

---

## 3. Test results

### npm run typecheck
```
EXIT:0
All 6 workspaces pass tsc --noEmit with no errors.
```

### npm run lint
```
EXIT:0
No ESLint errors.
```

### npm run test -w packages/shared
```
ℹ tests 247
ℹ suites 0
ℹ pass 247
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
EXIT:0
```
Includes new shopping schema tests (CreateShoppingListSchema, UpdateShoppingListSchema, CreateShoppingListItemSchema, etc.) — all passing.

### node --test apps/api/src/modules/shopping/**/*.test.ts
Command run: `node --test apps/api/src/modules/shopping/services/lists.test.ts apps/api/src/modules/shopping/routes/lists.hermetic.test.ts apps/api/src/modules/shopping/routes/lists.route.test.ts`

NOTE: `services/lists.test.ts` does not exist (the brief assumed it would; it is absent — there is no unit test file for the service layer, only the hermetic + route integration tests).

Result:
```
ℹ tests 2
ℹ fail 2
EXIT:1
```

Failure 1 — lists.hermetic.test.ts — `TypeError: mock.module is not a function`
This is because the file was invoked WITHOUT `--experimental-test-module-mocks`. When run correctly via `npm run test -w apps/api` (which sets that flag), it passes:
```
✔ all shopping-list mutation routes are not marked public (142ms)
✔ all nine expected shopping-list routes are registered (5ms)
ℹ pass 2 / fail 0
EXIT:0
```

Failure 2 — lists.route.test.ts — literal error:
```
Error: lists.route.test.ts needs DATABASE_URL set — export it (see apps/api/.env) before running `npm run test -w apps/api`.
    at requireEnv (file:///home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.route.test.ts:32:11)
    at file:///home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.route.test.ts:38:1
```
This is the expected DB-gating throw at module load — DATABASE_URL is unset in the verification environment. This is the only failure and is the established convention (see section 4).

### node --test apps/api/src/app.route-snapshot.test.ts
```
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte (226ms)
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte (95ms)
✔ assertRouteTableMatches rejects an added route (0.6ms)
✔ assertRouteTableMatches rejects a removed route (0.2ms)
✔ assertRouteTableMatches rejects a renamed route (0.2ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.2ms)
✔ assertRouteTableMatches accepts identical tables (0.4ms)
ℹ tests 7
ℹ pass 7
ℹ fail 0
EXIT:0
```

---

## 4. DB-gating convention comparison

### apps/api/src/modules/protection/routes/protection.route.test.ts (exemplar)
Lines 30, 39–51:
```
// Needs a real Postgres + Redis connection (DATABASE_URL, REDIS_URL, ...
function requireEnv(name: string): string {
  // ...
    throw new Error(
      `...`
    );
  }
}
requireEnv("DATABASE_URL");
requireEnv("REDIS_URL");
requireEnv("SESSION_SECRET");
```

### apps/api/src/modules/shopping/routes/lists.route.test.ts (new test)
Lines 29, 38–40:
```
function requireEnv(name: string): string {
  // ...
    throw new Error(
      `lists.route.test.ts needs DATABASE_URL set — ...`
    );
}
requireEnv("DATABASE_URL");
requireEnv("REDIS_URL");
requireEnv("SESSION_SECRET");
```

**Verdict:** The pattern is identical — same function name `requireEnv`, same throw-at-module-load behavior, same three env vars checked. The failure in section 3 is the established convention, not a defect.

---

## 5. No-migration / no-backup / no-auth-change checks

### Drizzle migrations
`ls apps/api/drizzle/*.sql` returns 5 files (0001–0005), all pre-existing.
`git diff HEAD -- apps/api/drizzle/` → no output (no new migration files).

### backup.ts
`git diff HEAD -- apps/api/src/modules/system/services/backup.ts` → no output (no changes).

### auth.ts DEMO_WRITE_ALLOWLIST
`git diff HEAD -- apps/api/src/plugins/auth.ts` → no output (no changes).

### config.public on new routes
`grep -rn "config\.public\|public: true" apps/api/src/modules/shopping/` — no match in lists.ts. The comment in lists.ts line 15 explicitly states: "none of these do" (set `config: { public: true }`). The hermetic test also asserts this programmatically.

---

## 6. Node version

```
v24.18.0
```

---

## Summary of findings (facts only)

| Check | Result |
|---|---|
| Git branch | main |
| Only expected files changed | Yes — plus task markdown docs and prior verification artifacts (no code stray files) |
| Nothing staged | Confirmed |
| No snapshot-generator script leftover | Confirmed |
| route-surface.snapshot.txt: 9 new routes + 2 auto-HEAD for GET only | Confirmed |
| route-table.snapshot.txt: 5 new lines under /api/shopping/lists | Confirmed |
| typecheck | PASS (exit 0) |
| lint | PASS (exit 0) |
| packages/shared tests | 247/247 PASS |
| lists.hermetic.test.ts (with --experimental-test-module-mocks) | 2/2 PASS |
| lists.route.test.ts | THROWS at module load — DATABASE_URL unset — expected convention |
| app.route-snapshot.test.ts | 7/7 PASS |
| No new drizzle migration | Confirmed |
| No change to backup.ts | Confirmed |
| No change to auth.ts | Confirmed |
| No new route sets config.public true | Confirmed |
| services/lists.test.ts | DOES NOT EXIST — brief assumed it would; not present |
| Node version | v24.18.0 |
