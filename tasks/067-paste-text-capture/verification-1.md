# Task 9.4 Paste-Text Capture — Verification 1

Date: 2026-08-21  
Branch: feat/shopping-core-capture  
Verifier: claude-sonnet-4-6 (independent, read-only)

---

## Step 1 — Git identity

```
$ git rev-parse --abbrev-ref HEAD
feat/shopping-core-capture

$ git log --oneline -2
40921c1 feat(shopping): catalog canonicalization + unit normalization (task 9.3)
f3eb78f Merge pull request #199 from udai-kiran/feat/shopping-catalogue
```

PASS: Branch is `feat/shopping-core-capture`. Last commit is `40921c1` (task 9.3). No 9.4 commit yet — implementation is in the working tree only.

---

## Step 2 — git status --porcelain

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

---

## Step 3 — Per-file diffs (tracked files) and new file contents

### packages/shared/src/schemas/ai-events.ts
Single line added: `"shopping_parse"` to the `AiEventKindSchema` enum. No other changes.

### packages/shared/src/schemas/shopping.ts
Added 65 lines defining: `ParsedShoppingItemSchema`, `ParseListTextRequestSchema`, `ParseListTextResponseSchema` (and their types). No existing definitions changed.

### apps/api/src/modules/automation/schema.ts
Single line added to `aiEventKind` pgEnum: `"shopping_parse"` with comment.

### apps/web/src/routes/events/EventLogPage.tsx
Two lines added: `shopping_parse: "Shopping list parsed"` to `KIND_LABELS` and `{ id: "shopping_parse", label: "Shopping" }` to `FILTERS`.

### apps/api/src/modules/shopping/plugin.ts
Import of `shoppingCaptureRoutes` added; `app.register(shoppingCaptureRoutes)` added at the bottom.

### apps/api/src/route-surface.snapshot.txt
`POST /api/shopping/parse-text` added in alphabetical position.

### apps/api/src/route-table.snapshot.txt
`/api/shopping/parse-text (POST)` added under the shopping tree node.

### NEW: apps/api/src/modules/shopping/services/parse-list.ts (full content verified above)

Three exported symbols:
- `PARSE_LIST_TOOL` — ToolSpec with name `parse_shopping_list`.
- `parseItemsFromTurn` — pure three-way: `matches.length === 1` → `safeParse(input)`; `=== 0` → `safeParse(extractJson(turn.text))`; else → `safeParse(undefined)`.
- `parseListText` — orchestrator using `getUserAiProvider`, `structured = ai.name !== "ollama"`, `ai.chat()` OUTSIDE the try/catch (errors propagate), `convertToBaseQuantity` inside `normalizeItem` with its own try/catch (leaves both null on throw).

### NEW: apps/api/src/modules/shopping/services/parse-list.test.ts (full content verified above)

9 hermetic tests for `parseItemsFromTurn`. No DB, no env vars, pure node:test.

### NEW: apps/api/src/modules/shopping/routes/capture.ts (full content verified above)

Single POST `/parse-text` route. No `config: { public: true }`. Uses `req.session!.userId`. Does NOT import `addItem` or write to `shopping_list_items`. Calls `recordAiEvent` with `kind: "shopping_parse"`.

### NEW: apps/api/src/modules/shopping/routes/capture.hermetic.test.ts (full content verified above)

8 hermetic tests using mock.module to stub service dependencies, then registering the real route.

---

## Step 4 — Migration

```
$ git status --porcelain -- apps/api/drizzle/
 M apps/api/drizzle/meta/_journal.json
?? apps/api/drizzle/0006_right_rogue.sql
?? apps/api/drizzle/meta/0006_snapshot.json
```

Content of `apps/api/drizzle/0006_right_rogue.sql` (single line, confirmed):
```sql
ALTER TYPE "public"."ai_event_kind" ADD VALUE 'shopping_parse';
```

PASS: Exactly one ALTER TYPE statement. No table/column changes. Meta snapshot `0006_snapshot.json` added (8903 lines). `_journal.json` updated.

---

## Step 5 — No leftover regen scripts

```
$ ls apps/api/*.mjs
(eval):1: no matches found: /work/personal/compass/apps/api/*.mjs
exit=1
```

PASS: No `.mjs` files in `apps/api/`.

---

## Step 6 — Unchanged files

```
$ git diff apps/api/src/modules/shopping/schema.ts \
           apps/api/src/modules/shopping/services/lists.ts \
           apps/api/src/modules/shopping/services/canonicalize.ts \
           apps/api/src/modules/system/services/backup.ts
(no output)
```

PASS: All four files have zero diff.

---

## Step 7 — npm run typecheck

```
EXIT=0
```

No `error TS` lines. All 6 workspaces pass including `apps/web` (KIND_LABELS exhaustiveness satisfied).

---

## Step 8 — npm run lint

```
EXIT=0
```

---

## Step 9 — npm run test -w packages/shared

```
ℹ tests 327
ℹ pass 327
ℹ fail 0
EXIT=0
```

Includes new tests: `ParsedShoppingItemSchema`, `ParseListTextRequestSchema`, `ParseListTextResponseSchema`, `AC5: AiEventKindSchema includes 'shopping_parse'` — all pass.

---

## Step 10 — parse-list.test.ts

```
$ node --experimental-test-module-mocks --test apps/api/src/modules/shopping/services/parse-list.test.ts

ℹ tests 9
ℹ pass 9
ℹ fail 0
EXIT=0
```

---

## Step 11 — capture.hermetic.test.ts

```
$ node --experimental-test-module-mocks --test apps/api/src/modules/shopping/routes/capture.hermetic.test.ts

(node:133861) ExperimentalWarning: Module mocking is an experimental feature ...
ℹ tests 8
ℹ pass 8
ℹ fail 0
EXIT=0
```

---

## Step 12 — route snapshot test

```
$ node --test apps/api/src/app.route-snapshot.test.ts

ℹ tests 7
ℹ pass 7
ℹ fail 0
EXIT=0
```

---

## Step 13 — Grep verifications

### routes/capture.ts
- `config: { public: true }` — NOT PRESENT (only in a comment saying "No route has `config: { public: true }`").
- Route path: `/parse-text` (line 30).
- `req.session!.userId` used at line 38.
- NO import of `addItem`; NO reference to `shoppingListItems` or `shopping_list_items` in code (only in a comment at line 8).
- Calls `recordAiEvent` at line 48 with `kind: "shopping_parse"` at line 49.

### services/parse-list.ts
- `parseItemsFromTurn` three-way: filter by exact tool name (line 122), `matches.length === 1` → `safeParse(input)` (lines 126–127), `=== 0` → `safeParse(extractJson(turn.text))` (lines 128–131), else → `safeParse(undefined)` (line 135).
- `structured = ai.name !== "ollama"` at line 200.
- `getUserAiProvider` imported (line 32) and called (line 189).
- `convertToBaseQuantity` imported (line 25) and called (line 155) inside `normalizeItem` with its own try/catch (lines 154–158) that leaves `quantityBase`+`unit` null on throw.
- `ai.chat()` at line 204 is OUTSIDE the outer try block (which starts at line 214). Errors propagate.

### No SDK imports
No `@anthropic-ai`, `openai`, or `ollama` SDK imports in either new file.

---

## Step 14 — DB-gated tests

The only test file for the capture route is `capture.hermetic.test.ts`, which is fully hermetic (no `DATABASE_URL`, no `skip` conditions, no `process.env` checks). It uses `mock.module` to stub all service dependencies and a stub `{}` db. No DB connection is required; the test runs without one.

There is no separate DB-gated (integration) test for the capture route.

---

## Summary

Everything the brief asked to verify checks out:

1. Branch and last commit are correct.
2. Migration is exactly `ALTER TYPE ... ADD VALUE 'shopping_parse'` — nothing else.
3. No leftover regen `.mjs` scripts.
4. `schema.ts`, `lists.ts`, `canonicalize.ts`, `backup.ts` are all unchanged.
5. typecheck, lint, all test suites — all pass (EXIT=0).
6. Route is auth-gated (no `public: true`), uses `req.session!.userId`, does not call `addItem` or write to `shopping_list_items`.
7. `parseItemsFromTurn` implements the correct three-way discipline.
8. `structured = ai.name !== "ollama"` gate is present.
9. `convertToBaseQuantity` is used with a per-item try/catch that leaves `quantityBase`+`unit` null on throw.
10. `ai.chat()` is NOT wrapped in the parse catch — errors propagate.
11. `recordAiEvent` is called with `kind: "shopping_parse"`.
12. No forbidden SDK imports.

**No contradictions with the implementer's digest found.**
