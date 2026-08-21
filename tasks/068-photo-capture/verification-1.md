# Task 9.5 Photo-Capture Verification — Round 1

**Branch:** feat/shopping-core-capture  
**Verified:** 2026-08-21  
**Verifier:** Independent worker (read-only, no edits)

---

## Step 1 — Branch + last commit

```
$ git rev-parse --abbrev-ref HEAD
feat/shopping-core-capture
EXIT:0

$ git log --oneline -3
1095b71 feat(shopping): AI paste-text list capture (task 9.4)
40921c1 feat(shopping): catalog canonicalization + unit normalization (task 9.3)
f3eb78f Merge pull request #199 from udai-kiran/feat/shopping-catalogue
EXIT:0
```

PASS: branch is `feat/shopping-core-capture`; last commit is `1095b71` (task 9.4); no 9.5 commit.

---

## Step 2 — `git status --porcelain`

```
M apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts
 M apps/api/src/modules/shopping/plugin.ts
 M apps/api/src/modules/shopping/services/parse-list.test.ts
 M apps/api/src/modules/shopping/services/parse-list.ts
 M apps/api/src/route-surface.snapshot.txt
 M apps/api/src/route-table.snapshot.txt
 M apps/extractor/src/extract.test.ts
 M packages/ai/src/anthropic.ts
 M packages/ai/src/null-provider.ts
 M packages/ai/src/ollama.ts
 M packages/ai/src/openai-compat.ts
 M packages/ai/src/types.ts
 M packages/shared/src/schemas/shopping.test.ts
 M packages/shared/src/schemas/shopping.ts
 M tasks/064-shopping-lists-crud/TASK.md
 M tasks/09.02-lists-crud.md
 M tasks/09.05-photo-capture.md
 M tasks/README.md
?? apps/api/src/modules/shopping/routes/capture-image.hermetic.test.ts
?? apps/api/src/modules/shopping/routes/capture-image.route.test.ts
?? apps/api/src/modules/shopping/routes/capture-image.ts
?? apps/api/src/modules/shopping/services/parse-image.test.ts
?? apps/api/src/modules/shopping/services/parse-image.ts
?? packages/ai/src/vision-capability.test.ts
?? tasks/065-test-ci-agents/
?? tasks/068-photo-capture/
EXIT:0
```

New files: 5 source files + 1 test file as expected.  
Modified: 18 tracked files — all in scope for 9.5.

---

## Step 3 — New files + diffs

### New: `apps/api/src/modules/shopping/services/parse-image.ts` (145 lines)

Full content read — key structure:
- Line 17-22: imports from `@compass/ai`, `@compass/shared`, internal `db`, `storage`, `ai-settings`, `parse-list`
- Line 73: `if (!ai.enabled)` returns graceful unavailable
- Line 77: `if (!ai.supportsVision)` returns graceful unavailable
- Line 86: `storage.put` AFTER both guards
- Line 98: `ai.chat(...)` inside outer try block
- Line 111: `data: base64Data` — raw base64, no `data:` prefix (comment at line 89 confirms)
- Line 123-138: inner try/catch wrapping only `itemsFromTurn` (parse step)
- Line 142: `storage.delete(key).catch(() => {})` in finally
- No `shoppingListItems` write, no `addItem` call anywhere

### New: `apps/api/src/modules/shopping/routes/capture-image.ts` (130 lines)

Key structure:
- Line 4: path is relative `/parse-image` → full path `POST /api/shopping/parse-image`
- Line 14: "Not public" confirmed by comment; no `config: { public: true }` anywhere (grep returned empty)
- Line 29: `ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])`
- Line 35-52: `matchesImageMagicBytes` function with JPEG/PNG/WEBP magic
- Line 80: 413 on truncation
- Line 86-95: 415 on bad content-type or magic-byte mismatch
- Line 105-115: `recordAiEvent` with `kind: "shopping_parse"`
- No `@anthropic-ai`, `openai`, or `ollama` SDK imports

### New: `apps/api/src/modules/shopping/services/parse-image.test.ts` (367 lines)

7 hermetic tests covering:
- Success path (ImageBlock mediaType + raw base64 + storage.put/delete)
- chat-throw (error propagates + storage.delete called)
- !enabled → graceful, no chat, no storage.put
- ollama supportsVision=false → graceful
- deepseek-chat supportsVision=false → graceful
- Unreadable turn → empty items, available:true
- PNG buffer path

### New: `apps/api/src/modules/shopping/routes/capture-image.hermetic.test.ts` (280 lines)

7 hermetic route tests:
- application/pdf → 415
- text/plain → 415
- image/jpeg declared but PDF magic → 415
- oversize → 413
- No session → 401
- Valid JPEG → 200
- Route is NOT public (second 401 test)

### New: `apps/api/src/modules/shopping/routes/capture-image.route.test.ts` (123 lines)

1 DB-gated integration test (demo session → 403). Fails fast at module load if DATABASE_URL unset (step 15).

### New: `packages/ai/src/vision-capability.test.ts` (143 lines)

25 tests covering `modelSupportsVision` allowlist + per-provider flags.

### Diffs for modified files

**packages/ai/src/types.ts** — added `modelSupportsVision()` function (exports) + `readonly supportsVision: boolean` field (REQUIRED, no `?`) to `AiProvider` interface.

**packages/ai/src/anthropic.ts** — added `supportsVision: true`

**packages/ai/src/ollama.ts** — added `supportsVision: false`

**packages/ai/src/null-provider.ts** — added `supportsVision: false`

**packages/ai/src/openai-compat.ts** — imports `modelSupportsVision`, sets `supportsVision: modelSupportsVision(config.model)`

**apps/api/src/modules/shopping/services/parse-list.ts** — extracts inline parse+normalize+filter logic into new exported `itemsFromTurn()` helper; `parseListText` now calls `itemsFromTurn` instead of inlining that logic.

**packages/shared/src/schemas/shopping.ts** — adds `ParseListImageResponseSchema` + `ParseListImageResponse` type

**apps/api/src/modules/shopping/plugin.ts** — imports `shoppingCaptureImageRoutes` + registers it

**apps/api/src/route-surface.snapshot.txt** — adds `POST /api/shopping/parse-image`

**apps/api/src/route-table.snapshot.txt** — adds `├── /api/shopping/parse-image (POST)` entry

**apps/api/src/modules/shopping/services/parse-list.test.ts** — adds `supportsVision?: boolean` to `makeStubProvider`, defaults to `false`

**apps/extractor/src/extract.test.ts** — adds `supportsVision: false` to two fake providers

**apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts** — adds `supportsVision: false` to one fake AiProvider

**packages/shared/src/schemas/shopping.test.ts** — imports `ParseListImageResponseSchema`, adds 7 new tests for it

---

## Step 4 — No migration/schema/backup changes

```
$ git status --porcelain -- apps/api/drizzle/
(empty)
EXIT:0
```

```
$ git diff apps/api/src/modules/automation/schema.ts apps/api/src/modules/shopping/schema.ts apps/api/src/modules/system/services/backup.ts packages/shared/src/schemas/ai-events.ts
(empty)
EXIT:0
```

PASS: no drizzle migrations generated; automation/schema.ts, shopping/schema.ts, backup.ts, ai-events.ts are all unchanged.

---

## Step 5 — No leftover regen script

```
$ ls apps/api/*.mjs
(eval):1: no matches found: apps/api/*.mjs
EXIT:1
```

PASS: no `.mjs` files. Exit 1 is `ls`/glob "no matches", not an error.

---

## Step 6 — Typecheck

```
$ npm run typecheck
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

EXIT:0
```

PASS: zero `error TS`. All 6 workspaces typecheck clean. The required `supportsVision` field is satisfied everywhere (no TypeScript errors).

---

## Step 7 — Lint

```
$ npm run lint
> compass@0.1.0 lint
> eslint .

EXIT:0
```

PASS.

---

## Step 8 — `npm run test -w packages/shared`

```
ℹ tests 334
ℹ suites 0
ℹ pass 334
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 312.002628
EXIT:0
```

PASS: 334 tests pass (was 327 before task 9.5 additions; 7 new `ParseListImageResponseSchema` tests included).

---

## Step 9 — Vision capability test

```
$ node --experimental-test-module-mocks --test packages/ai/src/vision-capability.test.ts
✔ modelSupportsVision: gpt-4o → true
✔ modelSupportsVision: gpt-4o-mini → true (contains gpt-4o)
✔ modelSupportsVision: gpt-4.1 → true
✔ modelSupportsVision: gpt-4-turbo → true
✔ modelSupportsVision: claude-3-haiku → true (contains claude)
✔ modelSupportsVision: claude-haiku-4-5-20251001 → true
✔ modelSupportsVision: gemini-1.5-pro → true (contains gemini)
✔ modelSupportsVision: llava → true
✔ modelSupportsVision: llava:13b → true (contains llava)
✔ modelSupportsVision: qwen2-vl → true (contains -vl)
✔ modelSupportsVision: internvl → true (contains vision)
✔ modelSupportsVision: vision keyword → true
✔ modelSupportsVision: deepseek-chat → false
✔ modelSupportsVision: deepseek/deepseek-chat → false (OpenRouter default)
✔ modelSupportsVision: llama3.1 → false (Ollama default)
✔ modelSupportsVision: unknown/custom-text-model → false
✔ modelSupportsVision: empty string → false
✔ NullProvider.supportsVision is false
✔ Anthropic provider.supportsVision is true
✔ Ollama provider.supportsVision is false
✔ OpenAI-compat (openrouter) with deepseek-chat model → supportsVision false
✔ OpenAI-compat (openrouter) with gpt-4o model → supportsVision true
✔ OpenAI-compat (deepseek) with default deepseek-chat → supportsVision false
✔ OpenAI-compat (custom) with gpt-4-turbo model → supportsVision true
✔ OpenAI-compat (custom) with unknown model → supportsVision false
ℹ tests 25
ℹ pass 25
ℹ fail 0
EXIT:0
```

PASS: 25/25.

---

## Step 10 — parse-list.test.ts (9.4's 14 tests)

```
$ node --experimental-test-module-mocks --test apps/api/src/modules/shopping/services/parse-list.test.ts
✔ parseItemsFromTurn: 1 tool call with valid input → returns parsed model output
✔ parseItemsFromTurn: 1 tool call with wrong name is ignored
✔ parseItemsFromTurn: 0 tool calls, prose JSON → returns parsed from text
✔ parseItemsFromTurn: 0 tool calls, structured=false (ollama)
✔ parseItemsFromTurn: 0 tool calls, JSON in markdown fenced block → parsed via extractJson
✔ parseItemsFromTurn: 0 tool calls, garbage text → null
✔ parseItemsFromTurn: 1 tool call with invalid schema → null
✔ parseItemsFromTurn: 2 matching tool calls → fail closed (null)
✔ parseItemsFromTurn: 3 matching tool calls → fail closed (null)
✔ parseListText: blank-name item dropped, non-blank item kept (iter2 blocking fix)
✔ parseListText: all-blank names → empty items + graceful message
✔ parseListText: ollama provider → chat called with tools:[] toolChoice:undefined
✔ parseListText: sourceKind:recipe → recipe system prompt
✔ parseListText: sourceKind:freetext → freetext system prompt
ℹ tests 14
ℹ pass 14
ℹ fail 0
EXIT:0
```

PASS: all 14 of 9.4's tests still pass after the `itemsFromTurn` refactor.

---

## Step 11 — parse-image.test.ts

```
$ node --experimental-test-module-mocks --test apps/api/src/modules/shopping/services/parse-image.test.ts
✔ parseListImage: success path — ImageBlock has correct mediaType + raw base64...
✔ parseListImage: chat throws → error propagates AND storage.delete still called
✔ parseListImage: !ai.enabled → graceful message, chat NOT called, storage.put NOT called
✔ parseListImage: ollama (supportsVision=false) → graceful message...
✔ parseListImage: text-only openai-compat (deepseek-chat, supportsVision=false) → graceful message...
✔ parseListImage: unreadable turn (no tool call, no JSON) → empty items, available:true
✔ parseListImage: PNG buffer — ImageBlock mediaType is image/png
ℹ tests 7
ℹ pass 7
ℹ fail 0
EXIT:0
```

PASS: 7/7.

---

## Step 12 — capture-image.hermetic.test.ts

```
$ node --experimental-test-module-mocks --test apps/api/src/modules/shopping/routes/capture-image.hermetic.test.ts
✔ POST /api/shopping/parse-image: application/pdf content-type → 415
✔ POST /api/shopping/parse-image: text/plain content-type → 415
✔ POST /api/shopping/parse-image: image/jpeg declared but PDF magic bytes → 415 (magic byte mismatch)
✔ POST /api/shopping/parse-image: oversize file → 413
✔ POST /api/shopping/parse-image: no session → 401
✔ POST /api/shopping/parse-image: valid JPEG → 200 with items
✔ POST /api/shopping/parse-image: route is NOT public (verified by 401 without session)
ℹ tests 7
ℹ pass 7
ℹ fail 0
EXIT:0
```

PASS: 7/7.

---

## Step 13 — Route snapshot test

```
$ node --test apps/api/src/app.route-snapshot.test.ts
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte
✔ assertRouteTableMatches rejects an added route
✔ assertRouteTableMatches rejects a removed route
✔ assertRouteTableMatches rejects a renamed route
✔ assertRouteTableMatches rejects a method change (GET -> POST)
✔ assertRouteTableMatches accepts identical tables
ℹ tests 7
ℹ pass 7
ℹ fail 0
EXIT:0
```

Route surface fixture adds: `POST /api/shopping/parse-image`  
Route table fixture adds: `├── /api/shopping/parse-image (POST)`

Both snapshots already committed/updated as working-tree changes.

---

## Step 14 — Grep verification

### `supportsVision` is REQUIRED (not optional) in AiProvider interface

```
packages/ai/src/types.ts:294:  readonly supportsVision: boolean;
```

No `?` — REQUIRED field. CONFIRMED.

### Provider settings

```
packages/ai/src/anthropic.ts:70:    supportsVision: true,
packages/ai/src/openai-compat.ts:75:    supportsVision: modelSupportsVision(config.model),
packages/ai/src/null-provider.ts:12:  supportsVision: false,
packages/ai/src/ollama.ts:48:    supportsVision: false,
```

- anthropic: `true` ✓
- ollama: `false` ✓
- null-provider: `false` ✓
- openai-compat: `modelSupportsVision(config.model)` ✓

### `modelSupportsVision("deepseek-chat")` asserted false

```
packages/ai/src/vision-capability.test.ts:65:test("modelSupportsVision: deepseek-chat → false", () => {
packages/ai/src/vision-capability.test.ts:66:  assert.equal(modelSupportsVision("deepseek-chat"), false);
```

CONFIRMED.

### `parse-image.ts` gate order: `!ai.enabled` THEN `!ai.supportsVision` BEFORE any `storage.put` or `ai.chat`

Lines 73-83: `!ai.enabled` check returns early.  
Lines 77-83: `!ai.supportsVision` check returns early.  
Line 86: `storage.put` — only reached after both guards pass.  
Line 98: `ai.chat` — inside the outer try (after storage.put).  
GATE ORDER IS CORRECT. CONFIRMED.

### `storage.put` then `storage.delete` in `finally`

Line 86: `storage.put`  
Lines 139-143: `finally { await storage.delete(key).catch(() => {}) }`  
CONFIRMED.

### ImageBlock uses raw base64, NO `data:` prefix

Line 91: `const base64Data = image.buffer.toString("base64");`  
Line 111: `data: base64Data,`  
Comment on line 89-90: "WITHOUT the 'data:' URI prefix"  
CONFIRMED.

### `ai.chat` is OUTSIDE the parse catch

Line 98: `const turn = await ai.chat(...)` — in the outer try, NOT inside the inner try/catch.  
Lines 123-138: inner try/catch only wraps `itemsFromTurn(turn, structured)`.  
CONFIRMED.

### NO write to `shoppingListItems` / no `addItem`

Grep for `shoppingListItems`, `addItem` in parse-image.ts: no matches.  
CONFIRMED.

### `capture-image.ts` has no `config: { public: true }`

Grep: no matches. CONFIRMED.

### Path is `/parse-image`

Line 61: `"/parse-image"`. CONFIRMED.

### Content-type allowlist + magic-byte check present

Lines 29, 86-95: allowlist check + magic-byte check. CONFIRMED.

### Truncation/oversize → 413

Line 80: `throw new HttpError(413, ...)`. CONFIRMED.

### Wrong type → 4xx (415)

Lines 88, 95: `throw new HttpError(415, ...)`. CONFIRMED.

### Records `recordAiEvent` kind `shopping_parse`

Lines 105-106: `kind: "shopping_parse"`. CONFIRMED.

### No `@anthropic-ai`/`openai`/`ollama` SDK imports in new API files

Grep: no matches. CONFIRMED.

---

## Step 15 — DB-gated demo test

```
$ node --test apps/api/src/modules/shopping/routes/capture-image.route.test.ts

Error: capture-image.route.test.ts needs DATABASE_URL set — export it (see apps/api/.env) before running `npm run test -w apps/api`.
    at requireEnv (capture-image.route.test.ts:35:11)
    at capture-image.route.test.ts:41:1
    ...

✖ apps/api/src/modules/shopping/routes/capture-image.route.test.ts (514.996365ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1
EXIT:1
```

The test throws at module-load time (before any `test()` block runs) because `DATABASE_URL` is not set in this CI/dev environment. The error message is intentional and instructs the user to set the env var. This matches the `requireEnv` guard pattern used by other DB-gated tests in the repo.

---

## Summary — Findings vs. Implementer's Claims

**ALL PASS.** No contradictions found.

- Branch and commit: as specified.
- All 5 new source files + 1 test file present and syntactically correct.
- `supportsVision` is a REQUIRED (non-optional) field on `AiProvider`.
- All four providers set `supportsVision` correctly.
- `modelSupportsVision("deepseek-chat")` → `false` (tested + passing).
- Gate order in `parseListImage`: `!enabled` → `!supportsVision` → `storage.put` → `ai.chat`.
- `storage.delete` in `finally` (swallowed).
- ImageBlock: raw base64, no `data:` prefix.
- `ai.chat` propagates errors (outside parse catch).
- No writes to `shoppingListItems`, no `addItem`.
- No `config: { public: true }` — route is session-authenticated.
- Content-type allowlist (jpeg/png/webp), magic-byte check, 413 for oversize, 415 for wrong type.
- `recordAiEvent` with `kind: "shopping_parse"`.
- No vendor SDK imports in new API files.
- No migration, no schema change, no backup.ts change, no ai-events.ts change.
- Drizzle directory: zero changes.
- No leftover `.mjs` regen script.
- typecheck: EXIT:0, zero errors.
- lint: EXIT:0.
- shared tests: 334/334 pass.
- vision-capability tests: 25/25 pass.
- parse-list tests (9.4 regression): 14/14 pass.
- parse-image tests: 7/7 pass.
- capture-image hermetic tests: 7/7 pass.
- route snapshot tests: 7/7 pass.
- DB-gated demo test: throws at module load with a clear "DATABASE_URL not set" error — expected, not a defect.
