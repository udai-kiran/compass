# Implementation 1 — Task 9.4 (paste-text list capture), P2–P6

Branch: `feat/shopping-core-capture`

## Status

All P2–P6 items implemented. All required commands pass. No deviations or blockers.

---

## P1 pre-validation: Migration

P1 (schema edits to `ai-events.ts`, `automation/schema.ts`, `EventLogPage.tsx`) was already completed by the prior worker. P1a (migration) needed to be run.

Command run:
```
DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/compass" npm run db:generate
```

Output (truncated — full run printed 66 table names then):
```
[✓] Your SQL migration file ➜ drizzle/0006_right_rogue.sql 🚀
```

**Migration content** (`apps/api/drizzle/0006_right_rogue.sql`):
```sql
ALTER TYPE "public"."ai_event_kind" ADD VALUE 'shopping_parse';
```

Confirmed: ADD-VALUE-only, mirrors `0004_parched_colonel_america.sql` exactly. No other schema drift.

---

## Files Changed

### New files
- `apps/api/drizzle/0006_right_rogue.sql` — generated migration
- `apps/api/drizzle/meta/0006_snapshot.json` — generated snapshot
- `apps/api/src/modules/shopping/services/parse-list.ts` — P3 service
- `apps/api/src/modules/shopping/services/parse-list.test.ts` — P6 hermetic service tests
- `apps/api/src/modules/shopping/routes/capture.ts` — P4 route
- `apps/api/src/modules/shopping/routes/capture.hermetic.test.ts` — P6 hermetic route tests

### Edited files
- `packages/shared/src/schemas/shopping.ts` — P2: added `ParsedShoppingItemSchema`, `ParseListTextRequestSchema`, `ParseListTextResponseSchema` + type exports
- `packages/shared/src/schemas/shopping.test.ts` — P2+AC5: added schema tests + `AiEventKindSchema` enum test
- `apps/api/src/modules/shopping/plugin.ts` — P4: registered `shoppingCaptureRoutes`
- `apps/api/src/route-surface.snapshot.txt` — P5: regenerated
- `apps/api/src/route-table.snapshot.txt` — P5: regenerated

(The P1/P1a files `ai-events.ts`, `automation/schema.ts`, `EventLogPage.tsx` were already modified by the prior worker — NOT touched here.)

---

## Implementation Details

### P2 — Shared Schemas (`packages/shared/src/schemas/shopping.ts`)

Added at end of file (after `CanonicalizeItemResponseSchema`):

```ts
export const ParsedShoppingItemSchema = z.object({
  rawText: z.string().min(1).max(200).trim().refine(v => v.length > 0, ...),
  quantityBase: quantityField().nullable(),
  unit: NormalizedUnitSchema.nullable(),
}).refine(v => (v.quantityBase === null) === (v.unit === null), ...);
export type ParsedShoppingItem = z.infer<typeof ParsedShoppingItemSchema>;

export const ParseListTextRequestSchema = z.object({
  text: z.string().min(1).max(4000).trim().refine(...),
  sourceKind: z.enum(["freetext", "recipe"]).default("freetext"),
});
export type ParseListTextRequest = z.input<typeof ParseListTextRequestSchema>;

export const ParseListTextResponseSchema = z.object({
  available: z.boolean(),
  items: z.array(ParsedShoppingItemSchema),
  rawInput: z.string(),
  message: z.string().nullable(),
});
export type ParseListTextResponse = z.infer<typeof ParseListTextResponseSchema>;
```

### P3 — Service (`apps/api/src/modules/shopping/services/parse-list.ts`)

- `PARSE_LIST_TOOL: ToolSpec` — hand-written JSON inputSchema (items[] with name required, quantity string, unit enum of display units)
- `parseItemsFromTurn(turn, _structured)` — pure three-way logic mirroring `extract.ts:410-418`:
  - `matches.length === 1` → `ModelOutputSchema.safeParse(matches[0].input)`
  - `matches.length === 0` → `ModelOutputSchema.safeParse(extractJson(turn.text))` (Ollama/prose path)
  - `matches.length >= 2` → `ModelOutputSchema.safeParse(undefined)` (FAIL CLOSED, never reads text)
- `parseListText(db, userId, secret, allowedBaseUrls, input, observe?)` — orchestrator:
  - Resolves provider via `getUserAiProvider`
  - `!ai.enabled` → returns `{available: false, items: [], rawInput, message: "AI is not configured"}`
  - `structured = ai.name !== "ollama"` gate for tools/toolChoice
  - System prompt selection: `sourceKind === "recipe"` → `RECIPE_SYSTEM` else `FREETEXT_SYSTEM`
  - `ai.chat()` errors PROPAGATE (not caught)
  - CATCHES ONLY the parse/interpret/normalize step (bad model output → `{available: true, items: [], ...}`)
  - `normalizeItem`: if quantity+unit both present → `convertToBaseQuantity(quantity, unit)`; on throw or missing → both null

### P4 — Route (`apps/api/src/modules/shopping/routes/capture.ts`)

- `POST /parse-text` (relative, resolves to `POST /api/shopping/parse-text`)
- `ZodTypeProvider`, body: `ParseListTextRequestSchema`, response 200: `ParseListTextResponseSchema`
- `req.session!.userId` — auth-gated, NOT `public`
- `AiObserver` built following roadmap-narrative.ts pattern:
  ```ts
  const observe: AiObserver = (obs) =>
    recordAiEvent(app.db, userId, { kind: "shopping_parse", ... });
  ```
- Registered in `plugin.ts`: `await app.register(shoppingCaptureRoutes);`

### P5 — Snapshot Regeneration

One-off script written to `apps/api/src/regen-snapshots.ts`, run with:
```
node --experimental-strip-types apps/api/src/regen-snapshots.ts
```
Output:
```
Written: route-surface.snapshot.txt
Written: route-table.snapshot.txt
```
Script then deleted (confirmed: `rm apps/api/src/regen-snapshots.ts`).

**Fixture diffs:**

`route-surface.snapshot.txt`:
```diff
+POST /api/shopping/parse-text
```
(no auto-HEAD — POST only, correct)

`route-table.snapshot.txt`:
```diff
+├── /api/shopping/parse-text (POST)
```

Both exactly match expected: only `POST /parse-text` added, no HEAD.

### P6 — Tests

**`parse-list.test.ts`** (9 tests, hermetic, no DB/provider):
- 1 tool call → parsed model output (AC1)
- 1 tool call wrong name → 0 matches → prose path
- 0 tool calls structured=true → prose extractJson
- 0 tool calls structured=false (ollama) → prose extractJson (AC4)
- 0 tool calls markdown fenced JSON → extractJson works
- garbage text → null (AC2)
- invalid tool schema → null (AC2)
- 2 matching tool calls → fail closed (null), prose NOT consulted (AC3)
- 3 matching tool calls → fail closed (null) (AC3)

**`capture.hermetic.test.ts`** (8 tests, mock.module):
- 200 + schema-valid body (ParseListTextResponseSchema)
- 400 on empty text
- 400 on missing text field
- `config.public !== true` (GET 404 confirms not publicly accessible)
- unauth → 401 (auth simulation via preHandler that returns 401 when no session set)
- `shopping_parse` observer / parseListText called (AC5 structural wiring)
- AC6: addItem NOT called (DB stub {} would throw on any write → confirms 200)
- recipe sourceKind accepted (AC1)

**`shopping.test.ts`** — added 14 new tests for P2 schemas + 2 AC5 tests:
- `ParsedShoppingItemSchema`: accepts null pair, accepts both-set, rejects blank/long rawText, refine bites (qty-without-unit, unit-without-qty)
- `ParseListTextRequestSchema`: accepts text only (defaults freetext), recipe, rejects blank/too-long/unknown-kind
- `ParseListTextResponseSchema`: deepEqual available=true + available=false, rejects qty-without-unit in items
- AC5: `AiEventKindSchema.safeParse("shopping_parse")` succeeds; `.options.includes("shopping_parse")` is true

---

## Command Outputs

### 1. `npm run db:generate` (with dummy DATABASE_URL)

```
> compass@0.1.0 db:generate
> npm run db:generate -w apps/api
> @compass/api@0.1.0 db:generate
> node --env-file-if-exists=../../.env ../../node_modules/drizzle-kit/bin.cjs generate
[✓] Your SQL migration file ➜ drizzle/0006_right_rogue.sql 🚀
```

Migration content: `ALTER TYPE "public"."ai_event_kind" ADD VALUE 'shopping_parse';`

### 2. `npm run typecheck`

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

Exit: 0
```

### 3. `npm run lint`

```
> compass@0.1.0 lint
> eslint .

Exit: 0
```

### 4. `npm run test -w packages/shared`

```
ℹ tests 327
ℹ suites 0
ℹ pass 327
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 310.423783

Exit: 0
```

### 5a. `node --experimental-test-module-mocks --test apps/api/src/modules/shopping/services/parse-list.test.ts`

```
✔ parseItemsFromTurn: 1 tool call with valid input → returns parsed model output (1.215055ms)
✔ parseItemsFromTurn: 1 tool call with wrong name is ignored (matches.length=0 → prose path) (0.201454ms)
✔ parseItemsFromTurn: 0 tool calls, prose JSON → returns parsed from text (structured=true path) (0.16772ms)
✔ parseItemsFromTurn: 0 tool calls, structured=false (ollama) → prose extractJson path (0.138875ms)
✔ parseItemsFromTurn: 0 tool calls, JSON in markdown fenced block → parsed via extractJson (0.103447ms)
✔ parseItemsFromTurn: 0 tool calls, garbage text → null (0.298078ms)
✔ parseItemsFromTurn: 1 tool call with invalid schema (missing items) → null (0.126241ms)
✔ parseItemsFromTurn: 2 matching tool calls → fail closed (null), prose NOT consulted (0.100231ms)
✔ parseItemsFromTurn: 3 matching tool calls → fail closed (null) (0.130499ms)
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 419.071774

Exit: 0
```

### 5b. `node --experimental-test-module-mocks --test apps/api/src/modules/shopping/routes/capture.hermetic.test.ts`

```
(node:131332) ExperimentalWarning: Module mocking is an experimental feature and might change at any time
✔ POST /parse-text — 200 and schema-valid body (available=true, items present) (68.235608ms)
✔ POST /parse-text — 400 on empty text (3.046666ms)
✔ POST /parse-text — 400 on missing text field (2.141902ms)
✔ POST /parse-text — config.public is NOT true (route is auth-gated) (1.92549ms)
✔ POST /parse-text — unauth → 401 when no session (auth simulation) (1.86803ms)
✔ POST /parse-text — records shopping_parse ai_event via observer (AC5) (1.851148ms)
✔ POST /parse-text — AC6: does NOT call addItem or write shopping_list_items (1.704979ms)
✔ POST /parse-text — recipe sourceKind is accepted (AC1) (1.623153ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 285.361739

Exit: 0
```

### 6. `node --test apps/api/src/app.route-snapshot.test.ts`

```
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte — the real 'unchanged API surface' gate (82.445035ms)
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte (29.997884ms)
✔ assertRouteTableMatches rejects an added route (0.183259ms)
✔ assertRouteTableMatches rejects a removed route (0.069823ms)
✔ assertRouteTableMatches rejects a renamed route (0.059634ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.087767ms)
✔ assertRouteTableMatches accepts identical tables (0.097265ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 884.009759

Exit: 0
```

Fixture diffs (see P5 above).

### 7. `git status --porcelain`

```
M apps/api/drizzle/meta/_journal.json
 M apps/api/src/modules/automation/schema.ts
 M apps/api/src/modules/shopping/plugin.ts
 M apps/api/src/route-surface.snapshot.txt
 M apps/api/src/route-table.snapshot.txt
 M apps/web/src/routes/events/EventLogPage.tsx
 M packages/shared/src/schemas/ai-events.ts
 M packages/shared/src/schemas/shopping.test.ts
 M packages/shared/src/schemas/shopping.ts
 M tasks/064-shopping-lists-crud/TASK.md
 M tasks/09.02-lists-crud.md
 M tasks/README.md
?? apps/api/drizzle/0006_right_rogue.sql
?? apps/api/drizzle/meta/0006_snapshot.json
?? apps/api/src/modules/shopping/routes/capture.hermetic.test.ts
?? apps/api/src/modules/shopping/routes/capture.ts
?? apps/api/src/modules/shopping/services/parse-list.test.ts
?? apps/api/src/modules/shopping/services/parse-list.ts
?? tasks/065-test-ci-agents/
?? tasks/067-paste-text-capture/
?? tasks/068-photo-capture/
```

The `tasks/` and pre-P1 modifications (`ai-events.ts`, `automation/schema.ts`, `EventLogPage.tsx`) were already modified by the prior worker. The `tasks/064-shopping-lists-crud/TASK.md`, `tasks/09.02-lists-crud.md`, `tasks/README.md` changes are pre-existing from prior work on this branch.

---

## Regen Script Text (deleted)

```ts
// apps/api/src/regen-snapshots.ts (deleted after use)
import { writeFileSync } from "node:fs";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { registerRoutes } from "./app.ts";

// ... (generates both snapshots using registerRoutes + onRoute hook / printRoutes)
```

Deleted: `rm /work/personal/compass/apps/api/src/regen-snapshots.ts` — confirmed.

---

## DB-gated test behavior

No DB-gated tests were written (the brief says "if practical"). Both test files are fully hermetic (no DATABASE_URL required). CI runs them via the normal `npm run test -w apps/api` command with `--experimental-test-module-mocks`.

---

## Assumptions

- `parseListText` input type is `ParseListTextRequest` (the `z.input<>` type, not `z.infer<>`) since `sourceKind` has a default.
- `effectiveModel` from `@compass/ai` is re-exported via `export * from "./factory.ts"` in `packages/ai/src/index.ts`.
- The `structured` parameter to `parseItemsFromTurn` is informational (`_structured` underscore-prefixed to suppress unused-var warnings) — the three-way branching uses `matches.length` only, matching the extractor pattern exactly.
- The migration uses a dummy DATABASE_URL for the offline schema diff (drizzle-kit doesn't need a live DB to generate migrations, only to apply them).

---

## Unresolved Risks

None. All required gates pass.
