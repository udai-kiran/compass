All verification is complete. Here's the summary:

---

## Summary

### Files created (4 new)
- `apps/api/src/modules/system/plugin.ts` — exports `systemRoutes` Fastify plugin registering health→auth→notifications→backup→profile in that order
- `apps/api/src/modules/system/schema.ts` — thin re-export of 6 tables (users from `core-schema.ts`, the rest from `db/schema.ts`) and 2 enums
- `apps/api/src/modules/system/schema.smoke.test.ts` — 4 tests: object identity for 6 tables + 2 enums, users resolves through core-schema, SQL table names, db.query accessors
- `apps/api/src/modules/system/plugin.test.ts` — 1 test: 5 representative routes registered via `hasRoute()`

### Files moved (14 with git mv, preserving history)
- **Routes (5):** `routes/{health,auth,profile,notifications,backup}.ts` → `modules/system/routes/`
- **Services (9):** `services/{health,auth,session,profile,prefs,notifications,backup,restore-user,demo}.ts` → `modules/system/services/`
- **Tests (3):** `services/{profile,backup,demo}.test.ts` → `modules/system/services/`

### Files edited (import paths only, no logic)
- **app.ts** — collapsed 5 route imports + 5 register calls into 1 `systemRoutes` plugin import + 1 register at position 1
- **plugins/auth.ts** — session import `../services/session.ts` → `../modules/system/services/session.ts`
- **jobs/index.ts** — 3 imports (notifications, backup, prefs) routed to `../modules/system/services/`
- **db/restore.ts** — `ALL_TABLES` from `../services/backup.ts` → `../modules/system/services/backup.ts`
- **8 route-test files** — `createSession`/`destroySession` import from `../../../services/session.ts` → `../../../modules/system/services/session.ts`
- **3 module services** — `modules/credit/services/alerts.ts`, `modules/planning/services/{bills,goals}.ts` — notifications/prefs imports to `../../system/services/`
- **2 flat services** — `services/{autopilot,anomaly}.ts` — notifications/prefs imports to `../modules/system/services/`

### Verification results
- **`npm run typecheck`** — clean exit, 0 errors across all 7 workspaces
- **`npm run test -w apps/api`** — **872 pass, 1 fail, 1 skip**
  - The 1 failure: `route-table.snapshot.txt` byte-for-byte check — **expected** because 5 scattered registrations collapsed into 1 plugin block necessarily re-nests the printRoutes tree. Route-surface (method, path) snapshot is unchanged (✅ passes).
  - The 1 skip: DB-backed test needing `DATABASE_URL` (pre-existing)
  - All 4 new tests (schema.smoke × 3, plugin.test × 1) ✅
  - All moved tests (profile × 13, backup × 9, demo × 4) ✅

### Confirmed NOT done
- ❌ `system.route.test.ts` — not created (iteration 2)
- ❌ `route-table.snapshot.txt` / `route-surface.snapshot.txt` — not regenerated
- ❌ `db:generate` — not run
- ❌ `db/core-schema.ts` — not touched
- ❌ No handler body, SQL, table/column name, cache key, route method/URL, or `config.public` declaration changed
