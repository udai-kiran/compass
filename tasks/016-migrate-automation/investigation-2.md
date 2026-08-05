# Investigation 2 — migrate-automation baseline
Date: 2026-08-05

---

## 1. Table definitions in `apps/api/src/db/schema.ts`

### Enums

| Exported const | Line range | Values |
|---|---|---|
| `aiProvider` | 92–99 | "none", "anthropic", "ollama", "openrouter", "deepseek", "custom" |
| `aiEventKind` | 1722–1729 | "email_extract", "statement_parse", "statement_summary", "categorize", "summary", "assistant" |
| `aiEventStatus` | 1730 | "ok", "error" |

### Tables

**`aiSettings`** — exported const `aiSettings`, lines 107–120

```
pgTable("ai_settings", {
  userId:     uuid PK → users.id (cascade delete)
  provider:   aiProvider
  apiKeyEnc:  text
  baseUrl:    text
  model:      text
  createdAt / updatedAt
})
```

Outbound FKs: `userId → users.id` (cascade delete).
Inbound FKs into `aiSettings`: **none** — grep for `.references(() => aiSettings` in `db/schema.ts` returns no matches.

---

**`aiEvents`** — exported const `aiEvents`, lines 1739–1763

```
pgTable("ai_events", {
  id:             uuid PK
  userId:         uuid NOT NULL → users.id
  kind:           aiEventKind
  status:         aiEventStatus
  provider:       text
  model:          text
  title:          text
  ingestionId:    uuid → emailIngestions.id (set null)
  accountId:      uuid → accounts.id (set null)
  requestContext: text
  responseRaw:    text
  latencyMs:      integer
  error:          text
  createdAt
})
index: ai_events_user_created_idx on (userId, createdAt.desc())
```

Outbound FKs: `userId → users.id`; `ingestionId → emailIngestions.id (set null)`; `accountId → accounts.id (set null)`.
Inbound FKs into `aiEvents`: **none** — grep for `.references(() => aiEvents` returns no matches.

### ES-module cycle verdict

Both `aiSettings` and `aiEvents` only reference `users`, `emailIngestions`, and `accounts` (inbound FKs from non-AI tables point at those, not at the AI tables). There are **no cross-module FKs that point into the AI tables**. The same thin-re-export pattern used by credit/planning/etc. (task 1.1–1.5) applies here: table definitions stay in `db/schema.ts`; `modules/automation/schema.ts` is a thin named re-export.

`db/schema.ts` does **not** already `export *` from any automation module (confirmed: grep for "automation" in `db/schema.ts` returns no matches).

---

## 2. backup.ts coverage

File: `apps/api/src/services/backup.ts`

**`ALL_TABLES`** (lines 28–41):
```ts
// line 34:
"ai_settings",
// line 40:
"statement_reconciliations", "ai_events",
```
Both `ai_settings` and `ai_events` are present.

**`USER_TABLES`** (lines 44–59):
```ts
// line 49:
family_members: "user_id", ai_settings: "user_id",
// line 58:
statement_reconciliations: "user_id", ai_events: "user_id",
```
Both are present and scoped by `user_id`.

Conclusion: no backup.ts changes are required; this migration adds no new tables.

---

## 3. Shared schema

### `packages/shared/src/schemas/ai-events.ts`

Exports consumed by routes:

| Symbol | Kind | Notes |
|---|---|---|
| `AiEventKindSchema` | `z.enum(...)` | 6-member closed enum; also exported as type `AiEventKind` |
| `AiEventStatusSchema` | `z.enum(["ok","error"])` | |
| `AiEventSummarySchema` | `z.object(...)` | used in list response |
| `AiEventDetailSchema` | extends Summary | used in GET /:id response |
| `AiEventPageSchema` | `z.object({ items, nextCursor })` | |
| `ListAiEventsQuerySchema` | `z.object({ kind?, cursor?, limit })` | querystring |

`AiEventKind` is a closed enum in both `db/schema.ts` (`pgEnum aiEventKind`, line 1722) and `packages/shared` (`AiEventKindSchema`). Adding a kind requires changes in both places.

### `packages/shared/src/schemas/ai.ts`

Exports consumed by `routes/ai.ts`:

| Symbol | Used by |
|---|---|
| `AiSettingsSchema` | GET `/api/ai/settings` response |
| `UpdateAiSettingsSchema` | PUT `/api/ai/settings` body |
| `AiCategorizeRequestSchema` / `AiCategorizeResponseSchema` | POST `/api/ai/categorize` |
| `AiSummaryRequestSchema` / `AiSummarySchema` | POST `/api/ai/summary` |
| `AiChatRequestSchema` | POST `/api/ai/chat` |
| `AiProviderSchema` | (via AiSettingsSchema) |

Also: `AiEventKind` (type only) is imported in `routes/ai.ts` from `@compass/shared`.

None of these schemas are changed by the migration.

---

## 4. Test templates

### `modules/credit/schema.smoke.test.ts`

2 `test()` cases:
1. `"modules/credit/schema.ts re-exports the same 8 table objects as db/schema.ts"` — iterates `TABLE_NAMES` (8 credit tables), calls `assert.strictEqual(creditSchema[name], barrel[name])` for each.
2. `"modules/credit/schema.ts re-exports the same 2 owned enum objects as db/schema.ts"` — same pattern for 2 enums (`cardNetwork`, `bankAccountSubtype`).

Imports: `import * as barrel from "../../db/schema.ts"` and `import * as creditSchema from "./schema.ts"`. No DB, no Fastify, no env. Object-identity (not structural equality) is the invariant.

For automation: mirror with `aiSettings` + `aiEvents` (2 tables) and `aiProvider` + `aiEventKind` + `aiEventStatus` (3 enums).

---

### `modules/credit/plugin.test.ts`

1 `test()` case: `"creditRoutes registers one uniquely-attributable route from each of the 4 internal route files"`.

Pattern:
```
const app = Fastify({ logger: false });
app.setValidatorCompiler(...); app.setSerializerCompiler(...);
await app.register(creditRoutes);
await app.ready();
t.after(() => app.close());
// assert EXPECTED_PAIRS.length === 4
for each { method, url } in EXPECTED_PAIRS:
  assert.ok(app.hasRoute({ method, url }), ...)
```

4 pairs asserted (one per route file): GET /api/cards, GET /api/emis, GET /api/accounts/:accountId/bank-details, GET /api/accounts/:accountId/overdraft-details.

No `app.inject()`, no DB/Redis, fully hermetic. Catches a silently missing `register(...)` call in `plugin.ts`.

For automation: mirror with 2 route files (`ai.ts` → GET /api/ai/settings; `ai-events.ts` → GET /api/ai-events). `EXPECTED_PAIRS.length` assertion value would be 2.

---

### `modules/planning/routes/planning.route.test.ts`

2 `test()` cases; both assert demo-403 with no DB row written.

Pattern (both cases follow the same structure):
```
buildTestApp() → wires pg, redis, config, auth, security, planningRoutes
createUser() → insert into users; return userId
createSession(app.redis, userId, { demo: true }) → returns sessionId
t.after: destroySession + cleanupUser

// assert pre-condition: 0 rows for this user
const res = await app.inject({ method, url, cookies: sessionCookie(sessionId), payload });
assert.equal(res.statusCode, 403, "expected 403 for demo session on ...");
// assert post-condition: still 0 rows (no write leaked through)
```

Case 1: PUT `/api/budgets/monthly/2024-01` with `{ lines: [] }` — checks `budgets` table.
Case 2: POST `/api/goals` with a goal payload — checks `goals` table.

`buildTestApp()` deliberately does NOT call `buildApp()` from `app.ts` (avoids `startJobs` hanging `node --test`). Imports `users` from `db/core-schema.ts`, `budgets`/`goals` from `../schema.ts` (the module's thin re-export). Requires `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET` env vars (calls `requireEnv` at module top level — early fail if missing).

For automation: mirror with `ai_settings` and/or `ai_events` table. Natural demo-403 cases: PUT `/api/ai/settings` (mutating) and POST `/api/ai/categorize` or `/api/ai/summary`. The `storage` decorator is **not** decorated in `buildTestApp` — if the automation route handlers reference `app.storage` or `app.queues`, the hermetic app must decorate stubs for those.

---

## 5. app.ts registration

File: `apps/api/src/app.ts`

Import lines (28–29):
```ts
import { aiRoutes } from "./routes/ai.ts";       // line 28
import { aiEventRoutes } from "./routes/ai-events.ts"; // line 29
```

Registration in `registerRoutes()` (lines 119–135):
```ts
await app.register(backupRoutes);   // line 129
await app.register(aiRoutes);       // line 130
await app.register(aiEventRoutes);  // line 131
await app.register(profileRoutes);  // line 132
```

Context: `backupRoutes` immediately precedes; `profileRoutes` immediately follows. The new `automationRoutes` plugin will replace lines 130–131 with a single `await app.register(automationRoutes)` in the same position. The import pair on lines 28–29 is replaced with the single plugin import.

---

## 6. Baseline measurements

### Route snapshot checksums

```
$ sha256sum apps/api/src/route-surface.snapshot.txt apps/api/src/route-table.snapshot.txt
a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122  apps/api/src/route-surface.snapshot.txt
be3500582a5cd352dd95a12995b8f8c929a9d95ba3f7adb9962cc20be2bae1b5  apps/api/src/route-table.snapshot.txt
```

### Test run

```
$ npm run test -w apps/api 2>&1 | tail -35
[... see output below ...]
ℹ tests 848
ℹ suites 1
ℹ pass 848
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7992.236993
```

Exit code: 0. No failures; no flake in `modules/credit/services/card-due-tasks.test.ts` observed in this run (single run was clean).

### Typecheck

```
$ cd apps/api && npm run typecheck 2>&1 | tail -5; echo EXIT=$?
> @compass/api@0.1.0 typecheck
> tsc --noEmit

EXIT=0
```

Clean, exit 0.

---

## Summary of migration recipe for automation module

**Files to create:**
- `apps/api/src/modules/automation/schema.ts` — thin re-export of `aiSettings`, `aiEvents`, `aiProvider`, `aiEventKind`, `aiEventStatus` from `../../db/schema.ts`
- `apps/api/src/modules/automation/plugin.ts` — registers `aiRoutes` (from `./routes/ai.ts`) and `aiEventRoutes` (from `./routes/ai-events.ts`)
- `apps/api/src/modules/automation/routes/ai.ts` — copy of current `routes/ai.ts` (imports updated from `../services/...` → relative paths via `../../services/...` or the module's own `services/`)
- `apps/api/src/modules/automation/routes/ai-events.ts` — copy of current `routes/ai-events.ts`
- `apps/api/src/modules/automation/schema.smoke.test.ts` — 2 tests: 2 table objects identity check, 3 enum objects identity check
- `apps/api/src/modules/automation/plugin.test.ts` — 1 test: hermetic `hasRoute` check for 2 route files
- (Optional) `apps/api/src/modules/automation/routes/automation.route.test.ts` — 2 demo-403 tests (PUT /api/ai/settings, POST /api/ai/categorize)

**Files to change:**
- `apps/api/src/app.ts` — replace lines 28–29 import pair with `import { automationRoutes } from "./modules/automation/plugin.ts"` and replace lines 130–131 with `await app.register(automationRoutes)`

**No changes needed to:**
- `db/schema.ts` (table defs stay; no `export *` from automation module)
- `services/backup.ts` (both tables already listed)
- `packages/shared` (schemas are unchanged)
- Route snapshot `.txt` files: since the 2 route files are already contiguous and their (method, path) surface is unchanged, `route-surface.snapshot.txt` should be byte-identical; `route-table.snapshot.txt` may differ if the nesting changes (same situation as task 1.5 where wrapping adjacent already-ordered registrations into a plugin changed the raw tree).

**Risk note:** `routes/ai.ts` imports from `../services/ai-settings.ts` and `../services/mailboxes.ts` — when relocated to `modules/automation/routes/ai.ts`, these paths become `../../../services/ai-settings.ts` and `../../../services/mailboxes.ts` (the services are NOT being migrated into the module, only the route files are). Check that `app.config.AI_ALLOWED_BASE_URLS` and `app.config` are available on the Fastify instance in the module context (they are — `app.ts` decorates `config` on the instance globally).
