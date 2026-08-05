# Task 1.8 — Migrate system domain — Investigation 1

Date: 2026-08-05  
Reference branch: main (post-1.7 ingest landing, uncommitted)

---

## 1. File inventory

### Route files

| File | Exported plugin symbol |
|------|----------------------|
| `apps/api/src/routes/health.ts` | `healthRoutes` |
| `apps/api/src/routes/auth.ts` | `authRoutes` |
| `apps/api/src/routes/profile.ts` | `profileRoutes` |
| `apps/api/src/routes/notifications.ts` | `notificationRoutes` |
| `apps/api/src/routes/backup.ts` | `backupRoutes` |

### System service files (per BATCH plan lines 26–31)

All nine services exist. Colocated `*.test.ts` status:

| Service file | Exists | Colocated test | Test file |
|---|---|---|---|
| `apps/api/src/services/auth.ts` | yes | **no** | — |
| `apps/api/src/services/session.ts` | yes | **no** | — |
| `apps/api/src/services/profile.ts` | yes | **yes** | `services/profile.test.ts` |
| `apps/api/src/services/prefs.ts` | yes | **no** | — |
| `apps/api/src/services/notifications.ts` | yes | **no** | — |
| `apps/api/src/services/backup.ts` | yes | **yes** | `services/backup.test.ts` |
| `apps/api/src/services/restore-user.ts` | yes | **no** | — |
| `apps/api/src/services/demo.ts` | yes | **yes** | `services/demo.test.ts` |
| `apps/api/src/services/health.ts` | yes | **no** | — |

---

## 2. Import edges (outbound) — path rewrite map

For each file, the `→` column gives the target under the new
`modules/system/` layout (depth changes from `src/routes/` or
`src/services/` to `src/modules/system/routes/` or
`src/modules/system/services/`).

### Route files

**`routes/health.ts`** (→ `modules/system/routes/health.ts`)

| Current import | Resolves to | New relative path |
|---|---|---|
| `"../services/health.ts"` | `services/health.ts` | `"../services/health.ts"` (unchanged — same module) |
| `"@compass/shared"` | external | unchanged |

**`routes/auth.ts`** (→ `modules/system/routes/auth.ts`)

| Current import | Resolves to | New relative path |
|---|---|---|
| `"../lib/errors.ts"` | `lib/errors.ts` | `"../../../lib/errors.ts"` |
| `"../services/auth.ts"` | `services/auth.ts` | `"../services/auth.ts"` |
| `"../services/session.ts"` | `services/session.ts` | `"../services/session.ts"` |
| `"../services/demo.ts"` | `services/demo.ts` | `"../services/demo.ts"` |
| `"../repositories/users.ts"` | `repositories/users.ts` | `"../../../repositories/users.ts"` |
| `"../plugins/auth.ts"` | `plugins/auth.ts` | `"../../../plugins/auth.ts"` |
| `"../modules/automation/services/ai-settings.ts"` | automation module | `"../../automation/services/ai-settings.ts"` |
| `"../modules/ingest/services/mailboxes.ts"` | ingest module | `"../../ingest/services/mailboxes.ts"` |
| `"@compass/shared"` | external | unchanged |

Cross-module edges in `authRoutes`: imports `ai-settings.ts` from
`modules/automation` (for `/api/capabilities`) and `mailboxes.ts` from
`modules/ingest` (for `mailboxSecret`). Both stay as direct imports per
the 1.9-deferral rule; path rewrite only shortens the `../modules/` prefix
to `../../`.

**`routes/profile.ts`** (→ `modules/system/routes/profile.ts`)

| Current import | Resolves to | New relative path |
|---|---|---|
| `"../services/profile.ts"` | `services/profile.ts` | `"../services/profile.ts"` |
| `"@compass/shared"` | external | unchanged |

**`routes/notifications.ts`** (→ `modules/system/routes/notifications.ts`)

| Current import | Resolves to | New relative path |
|---|---|---|
| `"../services/notifications.ts"` | `services/notifications.ts` | `"../services/notifications.ts"` |
| `"../services/prefs.ts"` | `services/prefs.ts` | `"../services/prefs.ts"` |
| `"@compass/shared"` | external | unchanged |

**`routes/backup.ts`** (→ `modules/system/routes/backup.ts`)

| Current import | Resolves to | New relative path |
|---|---|---|
| `"../lib/crypto-backup.ts"` | `lib/crypto-backup.ts` | `"../../../lib/crypto-backup.ts"` |
| `"../lib/errors.ts"` | `lib/errors.ts` | `"../../../lib/errors.ts"` |
| `"../services/backup.ts"` | `services/backup.ts` | `"../services/backup.ts"` |
| `"../services/restore-user.ts"` | `services/restore-user.ts` | `"../services/restore-user.ts"` |
| `"@compass/shared"` | external | unchanged |
| Node built-ins (`node:fs`, `node:os`, `node:path`, `node:crypto`, `node:stream/promises`) | unchanged |

### System service files

**`services/auth.ts`** (→ `modules/system/services/auth.ts`)

| Current import | Resolves to | New relative path |
|---|---|---|
| `"../db/index.ts"` | `db/index.ts` | `"../../../db/index.ts"` |
| `"../db/schema.ts"` (`users`) | `db/schema.ts` | `"../../../db/schema.ts"` OR `"../schema.ts"` (prefer module schema) |
| `"../lib/errors.ts"` | `lib/errors.ts` | `"../../../lib/errors.ts"` |
| `"../repositories/users.ts"` | `repositories/users.ts` | `"../../../repositories/users.ts"` |
| `"../modules/ledger/services/categories.ts"` | ledger module | `"../../ledger/services/categories.ts"` |
| `"argon2"` | external pkg | unchanged |
| `"@compass/shared"` | external | unchanged |

Cross-module edge: `auth.ts` calls `seedDefaultCategories` from `modules/ledger/services/categories.ts`. Stays as direct cross-module import (1.9 deferral).

**`services/session.ts`** (→ `modules/system/services/session.ts`)

| Current import | Resolves to | New relative path |
|---|---|---|
| `"ioredis"` | external pkg | unchanged |
| Node built-in `"node:crypto"` | unchanged |

No relative imports. Clean leaf; no path rewrites needed.

**`services/health.ts`** (→ `modules/system/services/health.ts`)

| Current import | Resolves to | New relative path |
|---|---|---|
| `"../infra/db.ts"` | `infra/db.ts` | `"../../../infra/db.ts"` |
| `"../infra/redis.ts"` | `infra/redis.ts` | `"../../../infra/redis.ts"` |
| `"../build-info.ts"` | `build-info.ts` | `"../../../build-info.ts"` |
| `"@compass/shared"` | external | unchanged |
| `"pg"` | external pkg | unchanged |
| `"ioredis"` | external pkg | unchanged |

**`services/profile.ts`** (→ `modules/system/services/profile.ts`)

| Current import | Resolves to | New relative path |
|---|---|---|
| `"../db/index.ts"` | `db/index.ts` | `"../../../db/index.ts"` |
| `"../db/schema.ts"` (`familyMembers`, `userProfiles`) | `db/schema.ts` | `"../../../db/schema.ts"` OR `"../schema.ts"` |
| `"../lib/errors.ts"` | `lib/errors.ts` | `"../../../lib/errors.ts"` |
| `"@compass/shared"` | external | unchanged |

**`services/prefs.ts`** (→ `modules/system/services/prefs.ts`)

| Current import | Resolves to | New relative path |
|---|---|---|
| `"../db/index.ts"` | `db/index.ts` | `"../../../db/index.ts"` |
| `"../db/schema.ts"` (`alertLedger`, `notificationPrefs`) | `db/schema.ts` | `"../../../db/schema.ts"` OR `"../schema.ts"` |
| `"./balances.ts"` | `services/balances.ts` | **deferred to 1.9** — stays at `services/balances.ts`, path becomes `"../../../services/balances.ts"` |
| `"./notifications.ts"` | `services/notifications.ts` | `"../services/notifications.ts"` (same module) |
| `"./ownership.ts"` | `services/ownership.ts` | **deferred to 1.9** — stays at `services/ownership.ts`, path becomes `"../../../services/ownership.ts"` |
| `"@compass/shared"` | external | unchanged |

**`services/notifications.ts`** (→ `modules/system/services/notifications.ts`)

| Current import | Resolves to | New relative path |
|---|---|---|
| `"../db/index.ts"` | `db/index.ts` | `"../../../db/index.ts"` |
| `"../db/schema.ts"` (`budgetAlerts`, `categories`, `notifications`) | `db/schema.ts` | `"../../../db/schema.ts"` (budgetAlerts/categories NOT in system schema.ts — cross-domain tables) |
| `"./periods.ts"` | `services/periods.ts` | **deferred to 1.9** — path becomes `"../../../services/periods.ts"` |
| `"../modules/planning/services/budgets.ts"` | planning module | `"../../planning/services/budgets.ts"` |
| `"@compass/shared"` | external | unchanged |

Notable: `notifications.ts` imports `budgetAlerts` and `categories` (both owned by planning/ledger domains) from `db/schema.ts`. These must NOT be re-exported through `modules/system/schema.ts` — they should continue to come from `../../db/schema.ts`. Also imports `getUtilization` from the planning module — direct cross-module edge, stays.

**`services/backup.ts`** (→ `modules/system/services/backup.ts`)

| Current import | Resolves to | New relative path |
|---|---|---|
| `"../config.ts"` | `config.ts` | `"../../../config.ts"` |
| `"../db/index.ts"` | `db/index.ts` | `"../../../db/index.ts"` |
| `"../lib/backup-archive.ts"` | `lib/backup-archive.ts` | `"../../../lib/backup-archive.ts"` |
| `"../lib/csv.ts"` | `lib/csv.ts` | `"../../../lib/csv.ts"` |
| `"../lib/crypto-backup.ts"` | `lib/crypto-backup.ts` | `"../../../lib/crypto-backup.ts"` |
| `"../lib/storage.ts"` | `lib/storage.ts` | `"../../../lib/storage.ts"` |
| Node built-ins (`node:fs/promises`, `node:path`, `node:stream`) | unchanged |

No cross-module edges; only lib/ dependencies.

**`services/restore-user.ts`** (→ `modules/system/services/restore-user.ts`)

| Current import | Resolves to | New relative path |
|---|---|---|
| `"../lib/errors.ts"` | `lib/errors.ts` | `"../../../lib/errors.ts"` |
| `"../lib/storage.ts"` | `lib/storage.ts` | `"../../../lib/storage.ts"` |
| `"../lib/backup-archive.ts"` | `lib/backup-archive.ts` | `"../../../lib/backup-archive.ts"` |
| `"../db/restore.ts"` | `db/restore.ts` | `"../../../db/restore.ts"` |
| `"./backup.ts"` | `services/backup.ts` | `"../services/backup.ts"` (same module) |
| `"pg"` | external pkg | unchanged |

**`services/demo.ts`** (→ `modules/system/services/demo.ts`)

| Current import | Resolves to | New relative path |
|---|---|---|
| `"../config.ts"` | `config.ts` | `"../../../config.ts"` |
| `"../db/index.ts"` | `db/index.ts` | `"../../../db/index.ts"` |
| `"../db/schema.ts"` (many tables: accounts, bankDetails, budgetLines, budgets, cardDetails, cardIssuerSettings, categories, emiDetails, goals, holdingEvents, holdingValuations, holdings, insurancePolicies, netWorthSnapshots, recurringTemplates, retirementDetails, rewardEntries, transactions, users) | `db/schema.ts` | `"../../../db/schema.ts"` — only `users` belongs to system schema.ts; all others are ledger/credit/investments/planning |
| `"../modules/ledger/services/categories.ts"` | ledger module | `"../../ledger/services/categories.ts"` |
| `"../repositories/users.ts"` | `repositories/users.ts` | `"../../../repositories/users.ts"` |
| `"argon2"` | external pkg | unchanged |

Cross-module edge: `demo.ts` is the seed script, touching tables from virtually every domain. It will continue to import multi-domain tables directly from `../../db/schema.ts`. Note: `users` also appears; the system `schema.ts` re-export covers it.

---

## 3. Inbound consumers

Files that import from the 5 route files or 9 system service files —
these specifiers must be updated if/when those files move.

### Route files — only consumed by `app.ts`

| Consumer | Import line | Target |
|---|---|---|
| `apps/api/src/app.ts:19` | `import { healthRoutes } from "./routes/health.ts"` | → `"./modules/system/plugin.ts"` (collapsed) |
| `apps/api/src/app.ts:20` | `import { authRoutes } from "./routes/auth.ts"` | collapsed into systemRoutes |
| `apps/api/src/app.ts:23` | `import { notificationRoutes } from "./routes/notifications.ts"` | collapsed into systemRoutes |
| `apps/api/src/app.ts:27` | `import { backupRoutes } from "./routes/backup.ts"` | collapsed into systemRoutes |
| `apps/api/src/app.ts:30` | `import { profileRoutes } from "./routes/profile.ts"` | collapsed into systemRoutes |

### Service files — consumers outside the system domain

**`services/session.ts`** — imported by:

| Consumer | Import line | Notes |
|---|---|---|
| `apps/api/src/plugins/auth.ts:3` | `import { getSession, SESSION_TTL_SECONDS } from "../services/session.ts"` | plugins/auth.ts lives at `src/plugins/` — path becomes `"../modules/system/services/session.ts"` |
| `apps/api/src/routes/auth.ts:16` | `import { createSession, destroySession, listSessions } from "../services/session.ts"` | moves with auth.ts into the module |
| 8 `*.route.test.ts` files across all modules | `import { createSession, destroySession } from "../../../services/session.ts"` | each would need `"../../../modules/system/services/session.ts"` |

The 8 test files are: `modules/ingest/routes/ingest.route.test.ts:15`, `modules/ledger/routes/user-tasks.route.test.ts:14`, `modules/planning/routes/projection-settings.route.test.ts:14`, `modules/automation/routes/automation.route.test.ts:14`, `modules/ledger/routes/ledger-events.route.test.ts:14`, `modules/protection/routes/protection.route.test.ts:14`, `modules/investments/routes/networth.route.test.ts:14`, `modules/planning/routes/planning.route.test.ts:14`.

**`services/notifications.ts`** — imported by:

| Consumer | Import line |
|---|---|
| `apps/api/src/routes/notifications.ts:14` | (moves into module, self-reference) |
| `apps/api/src/jobs/index.ts:4` | `import { evaluateBudgetAlerts } from "../services/notifications.ts"` → `"../modules/system/services/notifications.ts"` |
| `apps/api/src/modules/credit/services/alerts.ts:5` | `import { createNotification } from "../../../services/notifications.ts"` → `"../../system/services/notifications.ts"` |
| `apps/api/src/modules/planning/services/bills.ts:7` | `import { createNotification } from "../../../services/notifications.ts"` → `"../../system/services/notifications.ts"` |
| `apps/api/src/modules/planning/services/goals.ts:43` | `import { createNotification } from "../../../services/notifications.ts"` → `"../../system/services/notifications.ts"` |

**`services/prefs.ts`** — imported by:

| Consumer | Import line |
|---|---|
| `apps/api/src/routes/notifications.ts:15` | (moves into module) |
| `apps/api/src/jobs/index.ts:17` | `import { evaluateLargeTransactions, evaluateLowBalance, prefEnabled } from "../services/prefs.ts"` → `"../modules/system/services/prefs.ts"` |
| `apps/api/src/modules/planning/services/bills.ts:8` | `import { prefEnabled } from "../../../services/prefs.ts"` → `"../../system/services/prefs.ts"` |
| `apps/api/src/modules/planning/services/goals.ts:45` | `import { prefEnabled } from "../../../services/prefs.ts"` → `"../../system/services/prefs.ts"` |

**`services/backup.ts`** — imported by:

| Consumer | Import line |
|---|---|
| `apps/api/src/routes/backup.ts:12–18` | (moves into module) |
| `apps/api/src/jobs/index.ts:16` | `import { createEncryptedBackup } from "../services/backup.ts"` → `"../modules/system/services/backup.ts"` |
| `apps/api/src/db/restore.ts:4` | `import { ALL_TABLES } from "../services/backup.ts"` → `"../modules/system/services/backup.ts"` |

Note: `db/restore.ts` imports `ALL_TABLES` from `backup.ts`. This is a subtle dependency: `db/restore.ts` is a leaf that `restore-user.ts` imports. Moving `backup.ts` into `modules/system/` makes `db/restore.ts` reach out to a module, which is unusual but not cyclic.

**`services/restore-user.ts`** — imported by:

| Consumer | Import line |
|---|---|
| `apps/api/src/routes/backup.ts:19` | (moves into module) |
| `apps/api/src/services/backup.test.ts:24` | `import { restorableTables, restoreUserBackup } from "./restore-user.ts"` — moves to `modules/system/services/backup.test.ts` |

**`services/auth.ts`** — imported by:

| Consumer | Import line |
|---|---|
| `apps/api/src/routes/auth.ts:15` | (moves into module) |

**`services/demo.ts`** — imported by:

| Consumer | Import line |
|---|---|
| `apps/api/src/routes/auth.ts:17` | (moves into module) |

**`services/health.ts`** — imported by:

| Consumer | Import line |
|---|---|
| `apps/api/src/routes/health.ts:4` | (moves into module) |

**`services/profile.ts`** — imported by:

| Consumer | Import line |
|---|---|
| `apps/api/src/routes/profile.ts:18` | (moves into module) |

**No consumers in `apps/ingestor` or `apps/extractor`** — confirmed empty grep.

---

## 4. app.ts registration order

`apps/api/src/app.ts` `registerRoutes()` lines 133–146:

```
134: await app.register(healthRoutes);        ← position 1
135: await app.register(authRoutes);          ← position 2
136: await app.register(ledgerRoutes);
137: await app.register(ingestRoutes);
138: await app.register(planningRoutes);
139: await app.register(notificationRoutes);  ← position 6
140: await app.register(investmentsRoutes);
141: await app.register(creditRoutes);
142: await app.register(protectionRoutes);
143: await app.register(backupRoutes);        ← position 10
144: await app.register(automationRoutes);
145: await app.register(profileRoutes);       ← position 12 (last)
```

The 5 system routes span positions 1, 2, 6, 10, 12 — they are **not contiguous**. Collapsing them into a single `systemRoutes` plugin follows the same pattern as 1.7 (ingest), where `importRoutes`/`inboxRoutes`/`mailboxRoutes` were scattered and were gathered into position 1 (importRoutes' old slot). For system, the natural anchor is position 1 (`healthRoutes`), and `systemRoutes` would absorb all 5, with the internal order preserved as: `health → auth → notifications → backup → profile`.

The route-table (Fastify's `printRoutes()` tree) **will change** because five scattered registrations collapse into one contiguous plugin block — the same restructuring that happened in 1.7, 1.1, 1.2, and 1.3. The canonical (method, path) surface (`route-surface.snapshot.txt`) must remain byte-identical.

**Special concern — `healthRoutes` being first:** `/health` carries `config: { public: true }` and is the only system route that does. Moving it inside the `systemRoutes` plugin doesn't change when the auth guard fires (auth is global `onRequest` set up before `registerRoutes()`). However, `healthRoutes` must still be the first sub-registration inside `systemRoutes` to preserve the printRoutes tree structure most faithfully — and to keep the intent readable.

---

## 5. Table/enum re-export list for `modules/system/schema.ts`

`users` is **physically defined** in `apps/api/src/db/core-schema.ts` lines 11–20.
`db/schema.ts` imports it at line 20 and re-exports it at line 21: `export { users } from "./core-schema.ts"`.

The system module's `schema.ts` should re-export `users` **from `../../db/core-schema.ts`** (not from `../../db/schema.ts`) — the same pattern the ingest module's comment describes for cycle avoidance, and consistent with the fact that `db/schema.ts` itself imports `users` from `core-schema.ts`. This keeps the re-export pointing at the authoritative, cycle-free leaf.

All other system tables are physically in `db/schema.ts`:

| JS identifier | SQL table name | Line in `db/schema.ts` | Type |
|---|---|---|---|
| `users` | `users` | **`db/core-schema.ts:11`** | pgTable |
| `userProfiles` | `user_profiles` | 38 | pgTable |
| `familyRelationship` | — | 47 | pgEnum |
| `educationStage` | — | 55 | pgEnum |
| `familyMembers` | `family_members` | 66 | pgTable |
| `notifications` | `notifications` | 616 | pgTable |
| `alertLedger` | `alert_ledger` | 721 | pgTable |
| `notificationPrefs` | `notification_prefs` | 759 | pgTable |

**NOT in system schema.ts** (owned by other domains, used cross-domain by system services):
- `budgetAlerts` (planning, line 597) — used by `notifications.ts`
- `categories` (ledger, line 211) — used by `notifications.ts`

---

## 6. Guards / encapsulation concerns

### Auth plugin (`plugins/auth.ts`)

Registered app-level at `buildApp()` line 180: `await setupAuth(app)` — before `registerRoutes()`. Mechanism is a global `addHook("onRequest", ...)` that:

1. Reads and unsigns the `compass_sid` cookie; populates `req.session` or leaves it `null`.
2. If `req.routeOptions.config.public !== true` AND `req.session === null` → 401.
3. If `req.session?.demo` AND `MUTATING_METHODS.has(req.method)` AND route not in `DEMO_WRITE_ALLOWLIST` (`/api/auth/logout` only) → 403 DemoReadOnly.

**Routes with `config: { public: true }`** (confirmed by grepping):
- `/health` — `routes/health.ts:10`
- `/api/auth/bootstrap` — `routes/auth.ts:29`
- `/api/auth/demo` — `routes/auth.ts:43`
- `/api/auth/register` — `routes/auth.ts:58`
- `/api/auth/login` — `routes/auth.ts:74`

All other system routes (logout, me, profile, password, sessions, session-delete, capabilities, /api/profile, /api/family/*, all notifications, all backup) are **authenticated** (no `config.public`).

After moving into `systemRoutes`, these 4 public auth routes and 1 public health route will remain `config: { public: true }` — the global onRequest guard respects `req.routeOptions.config.public` regardless of plugin encapsulation level.

### Security plugin (`plugins/security.ts`)

Registered app-level at `buildApp()` line 181: `await setupSecurity(app)` — before `registerRoutes()`. Two global hooks:

- **`onSend`**: security headers on every response (unconditional).
- **`onRequest`**: CSRF Origin check on MUTATING methods; Redis fixed-window rate-limiting.

**Rate-limit buckets** (relevant to system routes):
- `AUTH_BUCKET` (15 req/5 min): `bucketFor()` returns this for URLs matching `/api/auth/(login|register|password)`.
- `WRITE_BUCKET` (120 req/min): any other mutating method.
- `READ_BUCKET` (600 req/min): reads.

Auth routes `/api/auth/login`, `/api/auth/register`, `/api/auth/password` land in `AUTH_BUCKET`. All others follow the method-based classification. This logic is URL-based in `bucketFor()`, not plugin-scope-based, so it survives encapsulation automatically.

**CSRF**: The Origin check applies to all MUTATING requests regardless of which plugin registered the route. No system route exempts itself from CSRF.

---

## 7. ingest.route.test.ts harness — what 1.8 inherits

The `modules/ingest/routes/ingest.route.test.ts` harness is the latest and most complete model. The `buildTestApp()` function (lines 70–106) establishes this pattern:

```
loadConfig() → Fastify({ logger: false, trustProxy: true })
→ setValidatorCompiler / setSerializerCompiler
→ decorate config, pg, db, redis
→ (optionally) decorate eventBus (only if route handlers emit ledger.mutated)
→ setupAuth(app) + setupSecurity(app)
→ addHook("onRoute", …) for config.public inspection
→ app.register(ingestRoutes)
→ addHook("onClose", …) for pg.end() + redis.disconnect()
```

Users table imported from `../../../db/core-schema.ts` (confirmed at line 17 of ingest.route.test.ts and at line 15 of planning.route.test.ts) — this will be the same pattern for `system.route.test.ts`.

**For the system module, the G1-equivalent tests will need to assert:**
- G1.1: unauthenticated request to any authenticated system route → 401
- G1.2: demo-session mutation (e.g. `POST /api/backup/run`) → 403 (write blocked)
- G1.3: authenticated POST with hostile Origin → 403 (CSRF)
- G1.4: only the known-public routes carry `config.public === true`; the rest do not
- G1.5: `AUTH_BUCKET` fires for `/api/auth/login|register|password`; `READ_BUCKET`/`WRITE_BUCKET` for others

**Key difference from ingest.route.test.ts**: the system module plugin has public routes (`/health`, `/api/auth/*` subset). G1.4 must therefore assert which routes ARE marked public (not that none are), and an eventBus decoration is not needed (no system route emits `ledger.mutated`).

Backup routes use `app.storage` (not decorated by the ingest harness). The system.route.test.ts harness will need to decorate `app.storage` with a stub (same interface as ingest.route.test.ts's `stubStorage` for backup.test.ts). However the backup route also uses multipart; the test harness would need `@fastify/multipart` registered too if any backup injection test is attempted.

---

## 8. backup.ts / ALL_TABLES moving

`services/backup.ts` contains `ALL_TABLES` (line 28), `USER_TABLES` (line 44), `LINKED_TABLES` (line 66), `FILE_COLUMNS` (line 148). These are string literals — no SQL identifiers or Drizzle object references — so moving the file does not change any table/column name strings.

`services/backup.test.ts` currently imports from:
- `"../db/schema.ts"` (as `* as schema`) for table introspection
- `"./backup.ts"` — same-folder relative
- `"./restore-user.ts"` — same-folder relative
- `"../db/restore.ts"`, `"../lib/crypto-backup.ts"`, `"../lib/backup-archive.ts"`, `"../lib/storage.ts"`, `"../db/index.ts"`, `"../infra/db.ts"`

After moving to `modules/system/services/backup.test.ts`:
- `"./backup.ts"` → `"./backup.ts"` (same folder — no change)
- `"./restore-user.ts"` → `"./restore-user.ts"` (same folder — no change)
- `"../db/schema.ts"` → `"../../../db/schema.ts"`
- `"../db/restore.ts"` → `"../../../db/restore.ts"`
- `"../lib/crypto-backup.ts"` → `"../../../lib/crypto-backup.ts"`
- `"../lib/backup-archive.ts"` → `"../../../lib/backup-archive.ts"`
- `"../lib/storage.ts"` → `"../../../lib/storage.ts"`
- `"../db/index.ts"` → `"../../../db/index.ts"`
- `"../infra/db.ts"` → `"../../../infra/db.ts"`

`db/restore.ts:4` imports `ALL_TABLES` from `"../services/backup.ts"` — after the move this becomes `"../modules/system/services/backup.ts"`. This is the one inbound edge from outside the module into `backup.ts`; it crosses from `db/` into `modules/system/services/`.

---

## Surprises and flags

1. **`services/session.ts` is imported by `plugins/auth.ts`** — a plugin reaching into a service. After the move, `plugins/auth.ts` must be updated: `"../services/session.ts"` → `"../modules/system/services/session.ts"`. There are also 8 route-test files across every non-system module that import `createSession`/`destroySession` from `services/session.ts` — all 8 need path updates. This is the highest-fan-out inbound edge of the migration.

2. **`db/restore.ts` imports from `services/backup.ts`** — a `db/` file reaching into `services/`. After the move it will reach into `modules/system/services/`. Unusual but not a cycle; flag for reviewer attention.

3. **`services/notifications.ts` imports from `modules/planning/services/budgets.ts`** (line 7) and uses `budgetAlerts`/`categories` from `db/schema.ts`. The `notifications` table is system-owned but `evaluateBudgetAlerts` in `notifications.ts` is a planning-aware function. This means `notifications.ts` has an upward dependency into the planning module. It moves physically into system but retains cross-module imports to planning — acceptable per 1.9-deferral, but the reviewer should note that `evaluateBudgetAlerts` could arguably live in planning (it only fires budget events). No recommendation to change scope; just flag it.

4. **`services/prefs.ts` imports `balances.ts` and `ownership.ts`** — both are deferred-to-1.9 services. After moving `prefs.ts` into `modules/system/services/`, its imports of `balances.ts` and `ownership.ts` become long cross-boundary paths (`"../../../services/balances.ts"`). This is the expected transitional state per the BATCH plan.

5. **`services/demo.ts` touches 19+ tables across ledger, credit, investments, planning** — it is purely a seed script and will remain cross-domain by nature. No concern for 1.8 scope; just confirm the reviewer is aware `demo.ts`'s `db/schema.ts` imports mostly refer to non-system tables and must continue reaching `"../../../db/schema.ts"` directly.

6. **`authRoutes` imports from two other modules** (`automation/ai-settings.ts` and `ingest/services/mailboxes.ts`). The `/api/capabilities` endpoint in `auth.ts` combines auth + AI + mailbox secrets — a design oddity. Both imports stay as cross-module direct paths per 1.9 deferral.

7. **No existing `plugin.ts`, `schema.ts`, `schema.smoke.test.ts`, or `plugin.test.ts`** in `modules/system/` — the directory does not yet exist. All four must be created.

8. **`route-table.snapshot.txt` will change** (5 scattered registrations collapse into 1 plugin block at position 1). `route-surface.snapshot.txt` must remain byte-identical. Same pattern as 1.7.
