# Backend Engineer Delegation — task 1.6 (016-migrate-automation)

## Task
Migrate the automation/AI domain into `apps/api/src/modules/automation/`. Pure relocation + module
wiring. **No runtime behaviour change.** Follow the exact recipe used by `modules/credit/` and
`modules/planning/` (read those for reference).

## Approved plan (see TASK.md for full detail — this is the delegated subset)
Iteration 1 covers P2–P7: schema + smoke test, move 6 services + 1 service test, move 2 routes, create
plugin.ts, wire app.ts, repoint auth.ts, fix 4 doc comments.
Iteration 2 (separate call) covers P8–P9: plugin.test.ts + route test.

## Absolute rules
- Do NOT change any handler body, route URL, HTTP method, Zod schema, SQL predicate, `userId` filter,
  cache key, TTL, provider-resolution logic, or observer body. The ONLY edits to moved files are import
  specifiers (and, in `app.ts`/planning/extractor, doc comments).
- Do NOT edit `apps/api/src/db/schema.ts`, `apps/api/src/services/backup.ts`, `packages/ai/**`, or
  `packages/shared/**`.
- Do NOT add `void` anywhere. In particular the `observe` arrow in the moved `routes/ai.ts` must remain
  byte-identical (it returns `recordAiEvent(...)`'s promise; leave it exactly so).
- A "move" = create the new file with corrected imports AND delete the old file. Old paths must not exist
  afterward.

## Relative-import rewrite rules (apply mechanically to every moved file)
From `src/routes/*` or `src/services/ai/*` into `src/modules/automation/routes/*` or
`src/modules/automation/services/*`, adjust EVERY relative specifier:
1. `../../db/X`  → `../../../db/X`   ;  `../../lib/X` → `../../../lib/X`
2. `../../modules/<mod>/...` → `../../<mod>/...`   (sibling module; drop one `../` and the `modules/` seg)
3. `../periods.ts` (flat service) → `../../../services/periods.ts`
4. `./X.ts` (same folder) → unchanged
5. Owned-table imports come from the module schema: `aiSettings` and `aiEvents` are imported from
   `../schema.ts` (NOT `../../../db/schema.ts`). Any OTHER table stays at `../../../db/schema.ts`.
6. Route files: `../lib/X` → `../../../lib/X`; `../services/ai/X` → `../services/X`;
   `../services/ai-settings.ts` → `../services/ai-settings.ts` (now intra-module); other flat
   `../services/X` (e.g. mailboxes) → `../../../services/X`.
`@compass/shared`, `@compass/ai`, `drizzle-orm`, `zod`, `node:*`, `ioredis`, `fastify*` imports never change.

## Files to MOVE (old path → new path), with the specific import edits

### Services (into `modules/automation/services/`)
- `services/ai/assistant.ts` → `modules/automation/services/assistant.ts`
  - `./tools.ts` unchanged; apply rules 1–2 to any other relative import present.
- `services/ai/categorize.ts` → `modules/automation/services/categorize.ts`
  - `../../db/index.ts` → `../../../db/index.ts`; apply rules to any others.
- `services/ai/events.ts` → `modules/automation/services/events.ts`
  - `../../db/index.ts` → `../../../db/index.ts`
  - `../../db/schema.ts` (imports `aiEvents` only) → `import { aiEvents } from "../schema.ts";`
  - `../../lib/errors.ts` → `../../../lib/errors.ts`
- `services/ai/summary.ts` → `modules/automation/services/summary.ts`
  - `../../db/index.ts` → `../../../db/index.ts`
  - `../../modules/planning/services/reports.ts` → `../../planning/services/reports.ts`
  - `../../modules/planning/services/insights.ts` → `../../planning/services/insights.ts`
- `services/ai/tools.ts` → `modules/automation/services/tools.ts`
  - `../../db/index.ts` → `../../../db/index.ts`
  - `../../modules/planning/services/reports.ts`  → `../../planning/services/reports.ts`
  - `../../modules/planning/services/budgets.ts`  → `../../planning/services/budgets.ts`
  - `../../modules/planning/services/insights.ts` → `../../planning/services/insights.ts`
  - `../../modules/ledger/services/search.ts`     → `../../ledger/services/search.ts`
  - `../../modules/planning/services/goals.ts`    → `../../planning/services/goals.ts`
  - `../periods.ts` → `../../../services/periods.ts`
- `services/ai-settings.ts` → `modules/automation/services/ai-settings.ts`
  - `../db/index.ts` → `../../../db/index.ts`
  - `../db/schema.ts` (imports `aiSettings` only) → `import { aiSettings } from "../schema.ts";`
  - `../lib/secret-box.ts` → `../../../lib/secret-box.ts`
  - `../lib/errors.ts` → `../../../lib/errors.ts`
  - (verify against the actual file; adjust ANY relative specifier by the rules)
- `services/ai-settings.test.ts` → `modules/automation/services/ai-settings.test.ts`
  - its `./ai-settings.ts` import stays `./ai-settings.ts` (same folder). Adjust any other relative import.

### Routes (into `modules/automation/routes/`)
- `routes/ai.ts` → `modules/automation/routes/ai.ts`
  - `../lib/errors.ts` → `../../../lib/errors.ts`
  - `../services/ai/categorize.ts` → `../services/categorize.ts`
  - `../services/ai/summary.ts`    → `../services/summary.ts`
  - `../services/ai/assistant.ts`  → `../services/assistant.ts`
  - `../services/ai/events.ts`     → `../services/events.ts`
  - `../services/ai-settings.ts`   → `../services/ai-settings.ts`
  - `../services/mailboxes.ts`     → `../../../services/mailboxes.ts`
  - EVERYTHING ELSE byte-identical (handlers, the `observe` arrow, degrade, all 5 routes).
- `routes/ai-events.ts` → `modules/automation/routes/ai-events.ts`
  - `../services/ai/events.ts` → `../services/events.ts`; everything else byte-identical.

## Files to CREATE

### `apps/api/src/modules/automation/schema.ts`
Model exactly on `apps/api/src/modules/credit/schema.ts` (thin named re-export, no `pgTable`/`pgEnum`
declaration). Header comment adapted for automation (2 tables + 3 enums, thin re-export, defers physical
relocation to task 1.9, `db/schema.ts` does not `export *` back). Body:
```ts
export {
  aiSettings,
  aiEvents,
  aiProvider,
  aiEventKind,
  aiEventStatus,
} from "../../db/schema.ts";
```

### `apps/api/src/modules/automation/schema.smoke.test.ts`
Model on `apps/api/src/modules/credit/schema.smoke.test.ts` — 2 `test()` cases, object-identity via
`assert.strictEqual`, no DB/Fastify/env:
- Case 1: table objects — `TABLE_NAMES = ["aiSettings","aiEvents"]`, for each assert
  `automationSchema[name] === barrel[name]`.
- Case 2: enum objects — `ENUM_NAMES = ["aiProvider","aiEventKind","aiEventStatus"]`, same pattern.
Imports: `import * as barrel from "../../db/schema.ts";` and
`import * as automationSchema from "./schema.ts";`.

### `apps/api/src/modules/automation/plugin.ts`
Model on `apps/api/src/modules/credit/plugin.ts`. Header comment in the same style noting this is the
sixth of 8 Phase-1 migrations (task 1.6), that the two AI registrations were already adjacent and in
order so wrapping them does NOT change `printRoutes()` (route-table snapshot stays byte-identical).
```ts
import type { FastifyInstance } from "fastify";
import { aiRoutes } from "./routes/ai.ts";
import { aiEventRoutes } from "./routes/ai-events.ts";

export async function automationRoutes(app: FastifyInstance): Promise<void> {
  await app.register(aiRoutes);
  await app.register(aiEventRoutes);
}
```

## Files to EDIT

### `apps/api/src/app.ts`
- Replace the two imports at lines 28–29 (`aiRoutes` from `./routes/ai.ts`, `aiEventRoutes` from
  `./routes/ai-events.ts`) with a single: `import { automationRoutes } from "./modules/automation/plugin.ts";`
  (place it where the removed imports were, keeping import ordering sensible).
- Replace the two registrations at lines 130–131 (`await app.register(aiRoutes);` /
  `await app.register(aiEventRoutes);`) with a single `await app.register(automationRoutes);` in the SAME
  position (between `backupRoutes` and `profileRoutes`).
- Fix the doc comment at line 157 that references `services/ai-settings.ts` → point it to the new path
  `modules/automation/services/ai-settings.ts`.
- Add a short paragraph to the `registerRoutes` migration-history comment block (~lines 75–117), modelled
  on the protection paragraph (110–117): state that as of task 1.6 the 2 automation route registrations
  (`aiRoutes`/`aiEventRoutes`) collapse into the single `automationRoutes` plugin, and that — like
  protection — wrapping two already-adjacent, already-in-order registrations does not change the raw
  `printRoutes()` tree, so `route-table.snapshot.txt` stays byte-identical.

### `apps/api/src/routes/auth.ts`
- Line 20 only: repoint `getAiSettings, getUserAiProvider` import from `"../services/ai-settings.ts"` to
  `"../modules/automation/services/ai-settings.ts"`. The `/api/capabilities` handler body is untouched.

### Doc-comment-only path fixes (change the referenced path text ONLY, verify exact current text first)
- `apps/api/src/modules/planning/services/goals.ts:19` — `services/ai/tools.ts` →
  `modules/automation/services/tools.ts`
- `apps/api/src/modules/planning/services/reports.ts:27` — same old→new path text
- `apps/extractor/src/extract.ts:61` — `apps/api/src/services/ai/tools.ts` →
  `apps/api/src/modules/automation/services/tools.ts`

## Must NOT change
- `db/schema.ts`, `services/backup.ts`, `packages/ai/**`, `packages/shared/**`.
- Any route URL, method, handler body, Zod schema, SQL, provider resolution or observer semantics.
- The snapshot `.txt` files (do NOT regenerate — both must stay byte-identical).

## Acceptance criteria (proven later by independent verification)
- typecheck exit 0, lint exit 0.
- Old paths gone; `src/services/ai/` directory removed.
- Every moved production file's diff is import-lines-only (plus doc comments where noted).
- `modules/automation/schema.smoke.test.ts` passes; `db:generate` zero diff.

## Commands (run from /home/udai/PennyPilot)
1. `cd apps/api && npx tsc --noEmit` (or `npm run typecheck`)
2. `npm run lint`
3. `node --test apps/api/src/modules/automation/schema.smoke.test.ts`
4. `npm run db:generate` (expect "No schema changes")

## Required evidence in your report
- Full list of files created / moved / deleted / edited.
- The complete `git status` and `git diff --stat`.
- Literal output + exit code of each command above.
- Any deviation from this brief or blocker, stated explicitly (do NOT silently change scope).

---

# Iteration 2 — plugin.test.ts + route test (P8–P9)

Iteration 1 is landed and verified. Do NOT touch any iteration-1 file. Create exactly two new test files
under `apps/api/src/modules/automation/`, each modelled precisely on an existing template that you must
read first.

## CREATE `apps/api/src/modules/automation/plugin.test.ts`
Model on `apps/api/src/modules/credit/plugin.test.ts` (read it). One `test()` case, fully hermetic
(`Fastify({ logger:false })` + the zod validator/serializer compilers, `await app.register(automationRoutes)`,
`await app.ready()`, `t.after(() => app.close())`). NO `app.inject()`, NO DB/Redis. Assert
`EXPECTED_PAIRS.length === 2` and that `app.hasRoute(...)` is true for each:
- `{ method: "GET", url: "/api/ai/settings" }`
- `{ method: "GET", url: "/api/ai-events" }`
Import `automationRoutes` from `./plugin.ts`.

## CREATE `apps/api/src/modules/automation/routes/automation.route.test.ts`
Model on `apps/api/src/modules/planning/routes/planning.route.test.ts` (read it and reuse its EXACT
test-helper imports — `buildTestApp`/`createUser`/`createSession`/`sessionCookie`/cleanup, whatever it
uses, from the same helper module). Register `automationRoutes` instead of `planningRoutes`. Two
`test()` cases, each proving a demo session is blocked on a mutating method with no row written:
- Case 1 — PUT `/api/ai/settings` with a valid `UpdateAiSettings` payload (e.g.
  `{ provider: "none", baseUrl: "", model: "" }`): assert 0 `ai_settings` rows for the user before,
  `res.statusCode === 403`, and still 0 `ai_settings` rows after. Import `aiSettings` from
  `../schema.ts`.
- Case 2 — POST `/api/ai/categorize` with `{ transactionIds: [] }` (or a minimal valid body per
  `AiCategorizeRequestSchema`): assert 0 `ai_events` rows for the user before, `res.statusCode === 403`,
  and still 0 `ai_events` rows after. Import `aiEvents` from `../schema.ts`.
Handle CSRF/Origin exactly the way `planning.route.test.ts` does so the request reaches the demo-write
block (the assertion is 403 with no write). If `buildTestApp` needs `AI_ALLOWED_BASE_URLS` in its config,
add it; the demo block short-circuits before the handler reads it, so a placeholder value is fine. Do NOT
decorate `storage`/`queues` unless the template does — the automation handlers do not use them.

## Commands (run from /home/udai/PennyPilot)
1. `node --test apps/api/src/modules/automation/plugin.test.ts`
2. `node --env-file-if-exists=./.env --test apps/api/src/modules/automation/routes/automation.route.test.ts`
   (or however planning.route.test.ts is invoked — match its env-file convention)
3. `cd apps/api && npx tsc --noEmit`
4. `npm run test -w apps/api 2>&1 | tail -12`  (expect 853 pass / 0 fail; report the literal counts)

## Report
Files created; literal output + exit code of each command; the before→after `apps/api` test count. State
any blocker explicitly.
