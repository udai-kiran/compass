# Sonnet Worker / backend-engineer Delegation — 018-migrate-system

## Task
1.8 migrate-system — move the system domain into `apps/api/src/modules/system/`. NO behaviour change.

## Iteration 1 (this delegation): production migration + template tests ONLY
Deliver the file moves, path rewrites, app.ts consolidation, all inbound consumer edits, the module
scaffold (plugin.ts, schema.ts), and the two TEMPLATE tests (schema.smoke.test.ts, plugin.test.ts).
DO NOT write `system.route.test.ts` in this iteration — that is iteration 2 (separately delegated) to keep
this migration diff byte-reviewable.

## Approved plan
See tasks/018-migrate-system/TASK.md P1-P7 and "Must NOT change". The plan is APPROVED post Codex review-1.

## Files to CREATE (modules/system/)
- `plugin.ts` — export `systemRoutes` (Fastify plugin, `async (app) => {…}` like modules/ingest/plugin.ts)
  registering healthRoutes, authRoutes, notificationRoutes, backupRoutes, profileRoutes IN THAT ORDER.
- `schema.ts` — thin re-export: `export { users } from "../../db/core-schema.ts";` and
  `export { userProfiles, familyMembers, notifications, alertLedger, notificationPrefs,
  familyRelationship, educationStage } from "../../db/schema.ts";` — plus the standard header comment
  (copy the shape from modules/ingest/schema.ts) noting db/schema.ts does NOT `export *` back. Do NOT
  re-export budgetAlerts or categories.
- `schema.smoke.test.ts` — from the ingest template: (1) object-identity that each re-export IS the same
  object as db/schema.ts (users: same object as db/core-schema.ts); (2) each table's physical SQL name
  (users→"users", userProfiles→"user_profiles", familyMembers→"family_members",
  notifications→"notifications", alertLedger→"alert_ledger", notificationPrefs→"notification_prefs");
  (3) db.query relation accessor exists for each table that HAS one — probe empirically on a constructed
  Db, do NOT assume (mirror how ingest handled importRows); document any table lacking an accessor.
- `plugin.test.ts` — one representative route per moved file asserted present via hasRoute() after
  registering systemRoutes (copy modules/ingest/plugin.test.ts shape).

## Files to MOVE (git mv semantics — preserve history; content edits = import paths ONLY)
Routes → `modules/system/routes/`: health.ts, auth.ts, profile.ts, notifications.ts, backup.ts
Services → `modules/system/services/`: health.ts, auth.ts, session.ts, profile.ts (+profile.test.ts),
prefs.ts, notifications.ts, backup.ts (+backup.test.ts), restore-user.ts, demo.ts (+demo.test.ts)

## Path rewrites (EXACT — from investigation-1 §2; typecheck is the final arbiter)
Depth change: src/routes/ and src/services/ → src/modules/system/{routes,services}/ (2 levels deeper).
- `../db/…` → `../../../db/…`; `../lib/…` → `../../../lib/…`; `../config.ts` → `../../../config.ts`;
  `../infra/…` → `../../../infra/…`; `../repositories/…` → `../../../repositories/…`;
  `../build-info.ts` → `../../../build-info.ts`; `../db/restore.ts` → `../../../db/restore.ts`;
  `../plugins/…` → `../../../plugins/…`.
- Cross-module `../modules/x/…` → `../../x/…` (KEEP direct — do NOT convert to ports):
  auth.ts→`../../ledger/services/categories.ts`; demo.ts→`../../ledger/services/categories.ts`;
  notifications.ts→`../../planning/services/budgets.ts`; routes/auth.ts→`../../automation/services/ai-settings.ts`
  + `../../ingest/services/mailboxes.ts`.
- 1.9-deferred FLAT services stay in services/ — paths LENGTHEN: prefs.ts `./balances.ts`→
  `../../../services/balances.ts`, `./ownership.ts`→`../../../services/ownership.ts`;
  notifications.ts `./periods.ts`→`../../../services/periods.ts`.
- Intra-module: a ROUTE importing its service uses `../services/x.ts`; a SERVICE importing a sibling
  service stays `./x.ts` (e.g. prefs.ts `./notifications.ts`, restore-user.ts `./backup.ts`,
  autopilot stays flat so N/A). Route→service examples: routes/notifications.ts →
  `../services/notifications.ts` + `../services/prefs.ts`; routes/backup.ts → `../services/backup.ts` +
  `../services/restore-user.ts`; routes/auth.ts → `../services/{auth,session,demo}.ts`; routes/health.ts →
  `../services/health.ts`; routes/profile.ts → `../services/profile.ts`.
- System-owned tables MAY import via `../schema.ts` OR `../../../db/schema.ts` (either resolves; prefer
  `../schema.ts` for system tables). Non-system tables MUST stay `../../../db/schema.ts`:
  demo.ts's ~18 non-user tables; notifications.ts's budgetAlerts + categories; anomaly/autopilot stay flat.
- test files moved (profile/backup/demo .test.ts): same depth rules; `./backup.ts`/`./restore-user.ts`
  stay `./…` (same folder), `../db/…`→`../../../db/…`, `../lib/…`→`../../../lib/…`, `../infra/…`→
  `../../../infra/…`.

## app.ts edit (P4)
- Remove the 5 individual imports (lines 19,20,23,27,30: healthRoutes, authRoutes, notificationRoutes,
  backupRoutes, profileRoutes) and add `import { systemRoutes } from "./modules/system/plugin.ts";`.
- In registerRoutes(): replace the 5 register calls with ONE `await app.register(systemRoutes);` at
  position 1 (where healthRoutes was, line 134). Remove the other 4 register calls. Keep every remaining
  registration in its current relative order.
- Add a doc-comment paragraph for 1.8 mirroring the existing 1.7 paragraph (5 scattered registrations
  collapsed into one plugin → printRoutes tree re-nests, (method,path) surface unchanged).

## Inbound consumer edits (P5 — import-line ONLY, no logic; EXACT list)
(a) `plugins/auth.ts:3` session → `../modules/system/services/session.ts`.
(b) 8 route-test files' session import → `../../../modules/system/services/session.ts`:
    modules/{planning/routes/planning.route.test.ts, ingest/routes/ingest.route.test.ts,
    planning/routes/projection-settings.route.test.ts, protection/routes/protection.route.test.ts,
    ledger/routes/user-tasks.route.test.ts, ledger/routes/ledger-events.route.test.ts,
    investments/routes/networth.route.test.ts, automation/routes/automation.route.test.ts}.
(c) `jobs/index.ts:4,16,17` → notifications/backup/prefs at `../modules/system/services/…`.
(d) `db/restore.ts:4` ALL_TABLES → `../modules/system/services/backup.ts`.
(e) `modules/credit/services/alerts.ts:5`, `modules/planning/services/bills.ts:7,8`,
    `modules/planning/services/goals.ts:43,45` → `../../system/services/{notifications,prefs}.ts`.
(f) `services/autopilot.ts:9,10` and `services/anomaly.ts:6,7` (createNotification/prefEnabled/listPrefs)
    → `../modules/system/services/{notifications,prefs}.ts`.

## Must NOT change
- Any handler body, SQL, table/column name, cache key, route method/URL, config.public declaration,
  demo allowlist, CSRF/rate-limit logic. `plugins/{auth,security}.ts` STAY at src/plugins/ and app-level
  (only auth.ts's ONE session import specifier changes). `db/core-schema.ts` untouched. db/schema.ts
  gains NO reference to modules/system (it already `export {users}` — leave as-is).
- Do NOT write system.route.test.ts (iteration 2). Do NOT regenerate snapshots or run db:generate (that's
  the verifier's job). Do NOT convert any cross-module import to a port.

## Acceptance for iteration 1
- `npm run typecheck` clean (this is the real proof every path rewrite resolved).
- No handler/SQL/table-name change (diff is moves + import lines + new scaffold only).
- route-surface baseline unchanged (verifier proves separately).

## Commands (run and capture literal output + exit codes)
1. `npm run typecheck`
2. `npm run test -w apps/api 2>&1 | tail -40` (moved suites + smoke/plugin tests; report pass/skip counts)

## Required evidence
- `git status` + full `git diff` (staged+unstaged) + list of new untracked files.
- The two commands' exact invocation, literal output, pass/skip counts, exit codes.
- Any path that did NOT resolve as the map predicted (and how you fixed it) — flag, do not silently redesign.
- Explicit confirmation you did NOT create system.route.test.ts and did NOT touch snapshots/migrations.

## Iteration 2 (THIS delegation — iteration 1 verified byte-clean)
Two deliverables ONLY. Do NOT touch any iteration-1 production file (routes/services/app.ts/consumers
are frozen and verified). Do NOT convert any import to a port.

### Deliverable A — `apps/api/src/modules/system/routes/system.route.test.ts`
Build it on the SAME `buildTestApp()` harness pattern as
`apps/api/src/modules/ingest/routes/ingest.route.test.ts` and
`apps/api/src/modules/planning/routes/planning.route.test.ts` (real PG+Redis via loadConfig, bare
Fastify with trustProxy:true, setValidatorCompiler/setSerializerCompiler, decorate config/pg/db/redis,
setupAuth + setupSecurity, register the WHOLE `systemRoutes` plugin, onClose closes pg+redis). Import
`users` from `../../../db/core-schema.ts`. Additions vs the ingest harness: decorate `app.storage` with a
stub (same shape ingest's backup test used) because backup routes reference it; register
`@fastify/multipart` ONLY if a test injects a file; NO eventBus decoration (no system route emits
ledger.mutated). Assert T6(a)-(g) from TASK.md Verification:
- (a) an authenticated-only system route (e.g. GET /api/profile) with NO session cookie → 401 through the
  encapsulated plugin. (Do NOT register a foreign module — the cross-module "every module" clause of AC2
  rests on the other modules' existing route tests, which already pass.)
- (b) onRoute-introspect config.public over the registered systemRoutes: assert EXACTLY these are public
  {GET /health, GET /api/auth/bootstrap, GET /api/auth/demo, POST /api/auth/register, POST /api/auth/login}
  and every OTHER system route is NOT public. (Verify the exact methods against the moved route files.)
- (c) DEMO chokepoint: create a real DEMO session (isDemo user), seed real state, drive a GENUINE
  otherwise-valid mutating system route (prefer PUT /api/profile or PUT /api/notification-prefs — pick one
  whose success path is cheap), assert → 403 AND assert the seeded row is UNCHANGED afterward (prove a
  prevented write, not a 404 in disguise; record the successful-path precondition so a malformed body
  can't make it vacuous — this is the explicit 1.7 G1.2 lesson).
- (d) CSRF: a NON-demo authenticated session POSTing with a hostile Origin header → 403 (so it can't pass
  by auth/demo failure). Use a state-changing system route.
- (e) rate-limit bucket classification: assert bucketFor('/api/auth/login')==='AUTH' (and register/password),
  and a system read/other-write → READ/WRITE. Import the exported bucketFor from plugins/security.ts if
  exported; if it is NOT exported, FLAG that in your log and assert bucket behaviour via injected requests
  instead — do NOT add a new export to security.ts.
- (f) security headers: a real response from any encapsulated system route carries all 6 unconditional
  headers: X-Content-Type-Options=nosniff, X-Frame-Options=DENY, Referrer-Policy=no-referrer,
  Cross-Origin-Opener-Policy=same-origin, X-DNS-Prefetch-Control=off,
  Content-Security-Policy="default-src 'none'; frame-ancestors 'none'".
- (g) a REAL unauthenticated GET /health → 200 with expected body, proving the auth hook honours
  config.public across the encapsulation boundary.
Every assertion must be genuine — no spies faking success, no assertion that passes without the guard.

### Deliverable B — regenerate `apps/api/src/route-table.snapshot.txt`
The 1.8 registration collapse re-nests the printRoutes tree, so the committed snapshot is stale and its
test fails. Regenerate it to reflect the CURRENT tree: capture exactly `app.printRoutes({ commonPrefix:
false })` from a hermetic Fastify instance built the way `app.route-snapshot.test.ts` builds it
(setValidatorCompiler/setSerializerCompiler + registerRoutes + ready — NO env/DB), and write that output
byte-for-byte to `apps/api/src/route-table.snapshot.txt` (no extra trailing newline beyond printRoutes'
own). Then run `npm run test -w apps/api` and CONFIRM the previously-failing
"raw printRoutes() tree matches the committed snapshot" test now PASSES and the canonical route-SURFACE
test STILL passes. Do NOT touch route-surface.snapshot.txt.

### Must NOT change (iteration 2)
No iteration-1 production file; no route-surface.snapshot.txt; no db:generate; no source logic. Only the
new test file and route-table.snapshot.txt.

### Commands (capture literal output + exit codes)
1. `npm run typecheck`
2. `npm run test -w apps/api 2>&1 | tail -60` (expect FULL green now: route-table test passes,
   system.route.test.ts passes; report pass/skip counts)

### Required evidence
- Full `git diff` of route-table.snapshot.txt + the new test file contents.
- The two commands' literal output, pass/skip counts, exit codes.
- Confirmation the route-table AND route-surface tests both pass; confirmation no iteration-1 file changed.
- Whether bucketFor was importable (T6e) — flag if you had to assert via injection.
