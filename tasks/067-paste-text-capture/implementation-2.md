# Implementation 2 — Iteration 2 fixes (post code-review-3)

Five fixes per the DELEGATION.md Iteration 2 section.

---

## Files Inspected

- `tasks/067-paste-text-capture/DELEGATION.md` (Iteration 2 section)
- `tasks/067-paste-text-capture/TASK.md`
- `apps/api/src/modules/shopping/services/parse-list.ts` (existing)
- `apps/api/src/modules/shopping/services/parse-list.test.ts` (existing, restructured)
- `apps/api/src/modules/shopping/routes/capture.ts` (existing)
- `apps/api/src/modules/shopping/routes/capture.hermetic.test.ts` (existing, amended)
- `apps/api/src/modules/shopping/routes/lists.route.test.ts` (reference for demo-403 pattern)
- `apps/api/src/modules/shopping/routes/catalog.route.test.ts` (reference)
- `apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts` (reference for mock.module)
- `packages/ai/src/types.ts` (AiCallObservation, AiProvider, ChatRequest shapes)
- `apps/api/src/modules/automation/services/ai-settings.ts` (getUserAiProvider signature)

---

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/modules/shopping/services/parse-list.ts` | Fix 1: blank-name filter after `map(normalizeItem)` |
| `apps/api/src/modules/shopping/services/parse-list.test.ts` | Full restructure: mock.module + dynamic import; 5 new test cases |
| `apps/api/src/modules/shopping/routes/capture.hermetic.test.ts` | Fix 2: mock calls observe; AC5 assertion non-vacuous |
| `apps/api/src/modules/shopping/routes/capture.route.test.ts` | NEW: DB-gated demo-403 test |

---

## Implementation Details

### Fix 1 — BLOCKING: blank-name filtering (`parse-list.ts`)

In `parseListText`, after `modelOutput.items.map(normalizeItem)`, added
`.filter((item) => item.rawText.length > 0)`. If the filtered list is empty,
returns the graceful `{ available:true, items:[], rawInput, message:"Could not
read any items from the text" }`. Non-blank items proceed normally. The change
is inside the existing `try` block; `parseItemsFromTurn` is unchanged.

Diff (parse-list.ts, inside `parseListText`):
```diff
-    const items = modelOutput.items.map(normalizeItem);
-
-    return {
-      available: true,
-      items,
-      rawInput,
-      message: null,
-    };
+    // BLOCKING FIX (iter2): drop items whose rawText is empty after trim.
+    const items = modelOutput.items
+      .map(normalizeItem)
+      .filter((item) => item.rawText.length > 0);
+
+    if (items.length === 0) {
+      return {
+        available: true,
+        items: [],
+        rawInput,
+        message: "Could not read any items from the text",
+      };
+    }
+
+    return {
+      available: true,
+      items,
+      rawInput,
+      message: null,
+    };
```

### Fix 2 — AC5 non-vacuous event recording (`capture.hermetic.test.ts`)

**Problem:** The mock's `parseListText: async () => { ... }` accepted no
parameters, so the `observe` callback was never invoked. The AC5 assertion
`parseListTextCallCount > 0` was vacuous — it didn't verify that the event
was actually recorded.

**Fix:**
1. Added `import type { AiCallObservation } from "@compass/ai"`.
2. Updated the mock to accept `observe?: (obs: AiCallObservation) => void` and
   call `observe?.({ ok: true, request: "{}", response: "{}", latencyMs: 1 })`.
3. Updated the AC5 test to assert
   `recordedKinds.includes("shopping_parse")` — now non-vacuous because the
   mock fires observe → route handler's AiObserver fires → mocked
   `recordAiEvent` pushes `"shopping_parse"` to `recordedKinds`.

### Fix 3 — AC4 ollama orchestrator path + Fix 4 — AC1 recipe prompt selection (`parse-list.test.ts`)

**Structural challenge:** The original `parse-list.test.ts` had a static
import `import { parseItemsFromTurn, PARSE_LIST_TOOL } from "./parse-list.ts"`.
Static imports are hoisted and evaluated before any code runs, so `mock.module`
calls placed later in the file would not affect parse-list.ts's already-bound
`getUserAiProvider` reference. The planning-analysis.hermetic.test.ts pattern
only works because it never statically imports the module under test.

**Solution:** Restructured the entire test file:
1. Changed `import test from "node:test"` → `import { test, mock } from "node:test"`.
2. Added type imports for `AiProvider`, `ChatRequest`, `Db`.
3. Declared `let stubProviderRef: AiProvider | null = null` at module level.
4. Set up `await mock.module("...ai-settings.ts", { exports: { getUserAiProvider: async () => stubProviderRef } })` as top-level await BEFORE any import of parse-list.ts.
5. Replaced the static import with `const { parseItemsFromTurn, PARSE_LIST_TOOL, parseListText } = await import("./parse-list.ts")`.
6. All existing `parseItemsFromTurn` tests kept with identical assertions.

**New tests added:**
- **Fix 1 blank tests (2 cases):** stub provider returns tool call with `items:[{name:"   "},{name:"milk"}]` → only `milk` in result; all-blank names → `{items:[], message}`.
- **AC4 ollama (1 case):** stub provider with `name:"ollama"` captures `tools` and `toolChoice`; asserts `tools:[]`, `toolChoice:undefined`; result has items parsed via prose extractJson.
- **AC1 recipe (1 case):** stub with `name:"anthropic"` captures `system`; `sourceKind:"recipe"` → system includes "recipe"/"INGREDIENT", not "free-text".
- **AC1 freetext (1 case):** same stub; `sourceKind:"freetext"` → system includes "free-text", not "INGREDIENT".

Each new test resets `stubProviderRef = null` in `t.after()` to prevent cross-test pollution.

### Fix 5 — AC6/demo real-auth 403 (`capture.route.test.ts` — NEW FILE)

**Pattern:** Mirrors `lists.route.test.ts` exactly. DB-gated with `requireEnv("DATABASE_URL")`, `requireEnv("REDIS_URL")`, `requireEnv("SESSION_SECRET")` at module level (fail-fast if unset).

**Approach:** The auth chokepoint in `plugins/auth.ts` rejects mutating methods (POST) for demo sessions before the route handler runs. Since `parseListText` is never called, no AI provider mock is needed. The file imports the real `shoppingRoutes` plugin and the real auth/security plugins. A test user + demo session (via `createSession(app.redis, userId, { demo: true })`) are created and cleaned up per-test.

**DB-gate note:** This test requires DATABASE_URL, REDIS_URL, SESSION_SECRET. When run locally without them (as shown below), it throws the requireEnv error immediately (same behavior as `lists.route.test.ts` / `catalog.route.test.ts`).

---

## Commands Run

### 1. `npm run typecheck`
```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit
[...6 other workspaces, all pass...]

EXIT:0
```

### 2. `npm run lint`
```
> compass@0.1.0 lint
> eslint .

EXIT:0
```

### 3. `npm run test -w packages/shared`
```
ℹ tests 327
ℹ pass 327
ℹ fail 0
ℹ duration_ms 318.237396

EXIT:0
```

### 4. `node --experimental-test-module-mocks --test apps/api/src/modules/shopping/services/parse-list.test.ts`
```
(node:...) ExperimentalWarning: Module mocking is an experimental feature...
✔ parseItemsFromTurn: 1 tool call with valid input → returns parsed model output (1.305067ms)
✔ parseItemsFromTurn: 1 tool call with wrong name is ignored (matches.length=0 → prose path) (0.206173ms)
✔ parseItemsFromTurn: 0 tool calls, prose JSON → returns parsed from text (structured=true path) (0.156729ms)
✔ parseItemsFromTurn: 0 tool calls, structured=false (ollama) → prose extractJson path (0.115621ms)
✔ parseItemsFromTurn: 0 tool calls, JSON in markdown fenced block → parsed via extractJson (0.105431ms)
✔ parseItemsFromTurn: 0 tool calls, garbage text → null (0.311143ms)
✔ parseItemsFromTurn: 1 tool call with invalid schema (missing items) → null (0.134066ms)
✔ parseItemsFromTurn: 2 matching tool calls → fail closed (null), prose NOT consulted (0.121942ms)
✔ parseItemsFromTurn: 3 matching tool calls → fail closed (null) (0.129377ms)
✔ parseListText: blank-name item dropped, non-blank item kept (iter2 blocking fix) (0.621985ms)
✔ parseListText: all-blank names → empty items + graceful message (iter2 blocking fix) (0.219118ms)
✔ parseListText: ollama provider → chat called with tools:[] toolChoice:undefined, items parsed via prose (AC4) (0.613589ms)
✔ parseListText: sourceKind:recipe → recipe system prompt (AC1) (0.222244ms)
✔ parseListText: sourceKind:freetext → freetext system prompt (AC1) (0.208367ms)
ℹ tests 14
ℹ suites 0
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 188.615662

EXIT:0
```

### 5. `node --experimental-test-module-mocks --test apps/api/src/modules/shopping/routes/capture.hermetic.test.ts`
```
(node:...) ExperimentalWarning: Module mocking is an experimental feature...
✔ POST /parse-text — 200 and schema-valid body (available=true, items present) (68.926045ms)
✔ POST /parse-text — 400 on empty text (3.086662ms)
✔ POST /parse-text — 400 on missing text field (1.949846ms)
✔ POST /parse-text — config.public is NOT true (route is auth-gated) (1.77356ms)
✔ POST /parse-text — unauth → 401 when no session (auth simulation) (1.709417ms)
✔ POST /parse-text — records shopping_parse ai_event via observer (AC5) (1.650916ms)
✔ POST /parse-text — AC6: does NOT call addItem or write shopping_list_items (1.513925ms)
✔ POST /parse-text — recipe sourceKind is accepted (AC1) (1.82067ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 292.546045

EXIT:0
```

### 6. DB-gated `capture.route.test.ts` local behavior
```
Error: capture.route.test.ts needs DATABASE_URL set — export it (see apps/api/.env) before running `npm run test -w apps/api`.
  [requireEnv throws at module level, identical to lists.route.test.ts / catalog.route.test.ts pattern]

EXIT:1
```
Expected — no DATABASE_URL set locally. In CI, where DATABASE_URL/REDIS_URL/SESSION_SECRET are available, the test runs. Same gating as `lists.route.test.ts` and `catalog.route.test.ts`.

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
?? apps/api/src/modules/shopping/routes/capture.route.test.ts
?? apps/api/src/modules/shopping/routes/capture.ts
?? apps/api/src/modules/shopping/services/parse-list.test.ts
?? apps/api/src/modules/shopping/services/parse-list.ts
?? tasks/065-test-ci-agents/
?? tasks/067-paste-text-capture/
?? tasks/068-photo-capture/
```

Note: The `M` (modified) files above were changed by implementation-1. The `??` (untracked) files under shopping/routes and shopping/services were all created by implementation-1 except for `capture.route.test.ts` which is new in this iteration.

---

## Assumptions

1. The `mock.module` / dynamic-import restructure of `parse-list.test.ts` is classified as "restructuring the test" (acceptable), not "restructuring the service" (prohibited). All test assertions are semantically identical to the originals.
2. `stubProviderRef` initialized to `null` is safe for `parseItemsFromTurn` tests that never call `parseListText` (getUserAiProvider is mocked but never invoked).
3. `AiCallObservation` shape `{ ok, request, response, latencyMs, error? }` — the `error` field is optional, so `{ ok:true, request:"{}", response:"{}", latencyMs:1 }` is valid.
4. `capture.route.test.ts` does not need a mock of `parseListText` because the auth chokepoint rejects the demo session (POST = mutating method) before the route handler executes. This is confirmed by the auth plugin design documented in CLAUDE.md.

---

## Unresolved Risks

- None. All five fixes are implemented, typecheck/lint exit 0, all hermetic tests pass (14 + 8 = 22 tests). The DB-gated test fails locally as expected (no DB in this environment) — identical behavior to `lists.route.test.ts` and `catalog.route.test.ts` which CI exercises.
