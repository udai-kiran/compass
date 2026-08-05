## Summary

### Deliverable A: `apps/api/src/modules/system/routes/system.route.test.ts`

Created a full buildTestApp() harness (real PG+Redis via loadConfig, trustProxy:true, both zod compilers, config/pg/db/redis decorations, stub storage, setupAuth + setupSecurity, registers the whole systemRoutes plugin, onClose cleans up pg+redis). Imports users from `../../../db/core-schema.ts`. All 7 T6 assertions pass:

- **T6(a)** — GET /api/profile with no cookie → 401
- **T6(b)** — onRoute introspection: exactly {GET /health, GET /api/auth/bootstrap, POST /api/auth/demo, POST /api/auth/register, POST /api/auth/login} are public (filtering out auto-generated HEAD variants), all other system routes are not
- **T6(c)** — demo session PUT /api/profile → 403, seeded user_profiles row unchanged; precondition test proves the same valid body succeeds for a non-demo session
- **T6(d)** — non-demo authenticated session POSTing with hostile Origin → 403 CSRF
- **T6(e)** — bucketFor from `_test` (exported) correctly classifies: `/api/auth/login|register|password` → AUTH, system reads → READ, system writes → WRITE
- **T6(f)** — all 6 unconditional security headers present on a real system-route response
- **T6(g)** — real unauthenticated GET /health → 200 with expected body

### Deliverable B: `apps/api/src/route-table.snapshot.txt`

Regenerated from `app.printRoutes({ commonPrefix: false })` on a hermetic Fastify instance (both zod compilers + registerRoutes + ready, no env/DB). Now matches the post-1.8 registration tree (system routes collapsed into one plugin at position 1). The previously-failing "raw printRoutes() tree matches the committed snapshot" test now passes.

### Verification

- **`npm run typecheck`** — 0 errors (all 7 workspaces)
- **`npm run test -w apps/api`** — **881 pass, 0 fail, 1 skip** (previously 872 pass + 1 fail). The route-table snapshot test and all 10 system.route.test.ts tests pass. The canonical route-surface snapshot test still passes.
- **No iteration-1 production file was changed** — only the new test file (untracked) and route-table.snapshot.txt (already modified by iteration 1, overwritten with correct content).
- **`bucketFor` was importable** via `export const _test` from `plugins/security.ts`.
