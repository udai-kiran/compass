# Implementation Report — Task 9.5 (photo list capture)

Branch: `feat/shopping-core-capture`

## Files Changed

### Modified
1. `packages/ai/src/types.ts` — Added `modelSupportsVision(model: string): boolean` helper + `readonly supportsVision: boolean` to `AiProvider` interface
2. `packages/ai/src/anthropic.ts` — Added `supportsVision: true` to returned provider object
3. `packages/ai/src/ollama.ts` — Added `supportsVision: false` to returned provider object
4. `packages/ai/src/null-provider.ts` — Added `supportsVision: false` to `NullProvider`
5. `packages/ai/src/openai-compat.ts` — Imported `modelSupportsVision`; added `supportsVision: modelSupportsVision(config.model)` to returned provider object
6. `apps/api/src/modules/shopping/services/parse-list.ts` — Extracted `itemsFromTurn(turn, structured): ParsedShoppingItem[]`; `parseListText` now calls it (P1 refactor, behaviour unchanged)
7. `apps/api/src/modules/shopping/services/parse-list.test.ts` — Added `supportsVision?: boolean` option to `makeStubProvider` (default false)
8. `apps/extractor/src/extract.test.ts` — Added `supportsVision: false` to both `fakeAi` and `recordingAi` objects
9. `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts` — Added `supportsVision: false` to `fakeAi`
10. `packages/shared/src/schemas/shopping.ts` — Added `ParseListImageResponseSchema` + `ParseListImageResponse` type
11. `packages/shared/src/schemas/shopping.test.ts` — Added `ParseListImageResponseSchema` import and 7 new tests
12. `apps/api/src/modules/shopping/plugin.ts` — Added import + registration of `shoppingCaptureImageRoutes`
13. `apps/api/src/route-surface.snapshot.txt` — Regenerated (added `POST /api/shopping/parse-image`)
14. `apps/api/src/route-table.snapshot.txt` — Regenerated (added `POST /api/shopping/parse-image` entry)

### New Files
15. `packages/ai/src/vision-capability.test.ts` — 25 tests for `modelSupportsVision` allowlist + each provider's flag
16. `apps/api/src/modules/shopping/services/parse-image.ts` — `parseListImage` service (P3)
17. `apps/api/src/modules/shopping/services/parse-image.test.ts` — 7 hermetic tests (P6)
18. `apps/api/src/modules/shopping/routes/capture-image.ts` — `POST /parse-image` route (P4)
19. `apps/api/src/modules/shopping/routes/capture-image.hermetic.test.ts` — 7 hermetic route tests (P6)
20. `apps/api/src/modules/shopping/routes/capture-image.route.test.ts` — DB-gated demo-403 test (P6)

## Key Diffs (load-bearing changes)

### packages/ai/src/types.ts — modelSupportsVision + AiProvider.supportsVision
```diff
+export function modelSupportsVision(model: string): boolean {
+  const m = model.toLowerCase();
+  return (
+    m.includes("gpt-4o") || m.includes("gpt-4.1") || m.includes("gpt-4-turbo") ||
+    m.includes("claude") || m.includes("gemini") || m.includes("llava") ||
+    m.includes("-vl") || m.includes("vision")
+  );
+}
 export interface AiProvider {
   readonly name: string;
   readonly enabled: boolean;
+  readonly supportsVision: boolean;
   ...
 }
```

### packages/ai/src/openai-compat.ts — conservative model-name gate
```diff
+  modelSupportsVision,
 ...
   return {
     name: config.name,
     enabled: true,
+    supportsVision: modelSupportsVision(config.model),
```

### apps/api/src/modules/shopping/services/parse-list.ts — itemsFromTurn extracted
```diff
+export function itemsFromTurn(turn: ChatTurn, structured: boolean): ParsedShoppingItem[] {
+  const modelOutput = parseItemsFromTurn(turn, structured);
+  if (modelOutput === null || modelOutput.items.length === 0) return [];
+  return modelOutput.items.map(normalizeItem).filter((item) => item.rawText.length > 0);
+}
 // In parseListText, now:
-    const modelOutput = parseItemsFromTurn(turn, structured);
-    const items = modelOutput.items.map(normalizeItem).filter(...)
+    const items = itemsFromTurn(turn, structured);
```

### packages/shared/src/schemas/shopping.ts — ParseListImageResponseSchema
```diff
+export const ParseListImageResponseSchema = z.object({
+  available: z.boolean(),
+  items: z.array(ParsedShoppingItemSchema),
+  message: z.string().nullable(),
+});
+export type ParseListImageResponse = z.infer<typeof ParseListImageResponseSchema>;
```
NO `storageKey` field (B1 — image is transient).

### parse-image.ts — critical path
- Gates `!ai.enabled` → graceful, no store, no chat
- Gates `!ai.supportsVision` → graceful, no store, no chat
- `storage.put(image.buffer, image.contentType)` → key
- `try { vision chat → itemsFromTurn → return } finally { storage.delete(key).catch(()=>{}) }`
- ai.chat() errors propagate; only parse/normalize wrapped in catch → graceful empty
- ImageBlock: `{ type: "image", mediaType: contentType as AiImageMediaType, data: buffer.toString("base64") }` — raw base64, NO `data:` prefix

### capture-image.ts — route handler
- `req.file({ limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } })`
- After `toBuffer()`, checks `file.file.truncated` → HttpError(413)
- Content-type allowlist: `{image/jpeg, image/png, image/webp}` (no PDF)
- Magic-byte check inline (mirrors assertUploadable pattern)
- Wrong type → HttpError(415); wrong content → HttpError(415)
- Records `shopping_parse` ai_event with `title: "photo: <filename>"`
- Not public (no `config: { public: true }`)

## AiProvider Fakes Updated

| File | Object | Change |
|------|--------|--------|
| `apps/api/src/modules/shopping/services/parse-list.test.ts:61` | `makeStubProvider` return | Added `supportsVision: opts.supportsVision ?? false` |
| `apps/extractor/src/extract.test.ts:47` | `fakeAi` return | Added `supportsVision: false` |
| `apps/extractor/src/extract.test.ts:71` | `recordingAi` `.ai` object | Added `supportsVision: false` |
| `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:440` | `fakeAi: AiProvider` | Added `supportsVision: false` |

No `as any`, no `@ts-ignore`.

## Fixture Git Diff

```
diff --git a/apps/api/src/route-surface.snapshot.txt b/apps/api/src/route-surface.snapshot.txt
+POST /api/shopping/parse-image

diff --git a/apps/api/src/route-table.snapshot.txt b/apps/api/src/route-table.snapshot.txt
+├── /api/shopping/parse-image (POST)
```

Exactly `POST /api/shopping/parse-image` — no auto-HEAD, as required.

## Regen Script

Script written to `apps/api/src/regen-snapshots.ts`, run with:
```
node apps/api/src/regen-snapshots.ts
```
Output:
```
Wrote route-surface.snapshot.txt
Wrote route-table.snapshot.txt
Done. Delete this file.
```
Then `rm apps/api/src/regen-snapshots.ts` — confirmed deleted.

## Command Outputs (literal)

### 1. `npm run typecheck` — exit 0
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

TYPECHECK EXIT: 0
```

### 2. `npm run lint` — exit 0
```
> compass@0.1.0 lint
> eslint .

LINT EXIT: 0
```

### 3. `npm run test -w packages/shared` — 334 pass
```
ℹ tests 334
ℹ suites 0
ℹ pass 334
ℹ fail 0
ℹ duration_ms 318.185063
```
(7 new ParseListImageResponseSchema tests included in 334)

### 4. `node --experimental-test-module-mocks --test packages/ai/src/vision-capability.test.ts`
```
(node:168788) ExperimentalWarning: Module mocking is an experimental feature...
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
ℹ duration_ms 101.225626
```
Exit 0.

### 5a. `node --experimental-test-module-mocks --test apps/api/src/modules/shopping/services/parse-list.test.ts`
```
✔ parseItemsFromTurn: 1 tool call with valid input → returns parsed model output
✔ parseItemsFromTurn: 1 tool call with wrong name is ignored (matches.length=0 → prose path)
✔ parseItemsFromTurn: 0 tool calls, prose JSON → returns parsed from text (structured=true path)
✔ parseItemsFromTurn: 0 tool calls, structured=false (ollama) → prose extractJson path
✔ parseItemsFromTurn: 0 tool calls, JSON in markdown fenced block → parsed via extractJson
✔ parseItemsFromTurn: 0 tool calls, garbage text → null
✔ parseItemsFromTurn: 1 tool call with invalid schema (missing items) → null
✔ parseItemsFromTurn: 2 matching tool calls → fail closed (null), prose NOT consulted
✔ parseItemsFromTurn: 3 matching tool calls → fail closed (null)
✔ parseListText: blank-name item dropped, non-blank item kept (iter2 blocking fix)
✔ parseListText: all-blank names → empty items + graceful message (iter2 blocking fix)
✔ parseListText: ollama provider → chat called with tools:[] toolChoice:undefined, items parsed via prose (AC4)
✔ parseListText: sourceKind:recipe → recipe system prompt (AC1)
✔ parseListText: sourceKind:freetext → freetext system prompt (AC1)
ℹ tests 14
ℹ pass 14
ℹ fail 0
ℹ duration_ms 174.407007
```
Exit 0. All 14 unchanged.

### 5b. `node --experimental-test-module-mocks --test apps/api/src/modules/shopping/services/parse-image.test.ts`
```
✔ parseListImage: success path — ImageBlock has correct mediaType + raw base64, tools/toolChoice set, storage.put AND delete called
✔ parseListImage: chat throws → error propagates AND storage.delete still called
✔ parseListImage: !ai.enabled → graceful message, chat NOT called, storage.put NOT called
✔ parseListImage: ollama (supportsVision=false) → graceful message, chat NOT called, storage.put NOT called
✔ parseListImage: text-only openai-compat (deepseek-chat, supportsVision=false) → graceful message, chat NOT called, storage.put NOT called
✔ parseListImage: unreadable turn (no tool call, no JSON) → empty items, available:true
✔ parseListImage: PNG buffer — ImageBlock mediaType is image/png
ℹ tests 7
ℹ pass 7
ℹ fail 0
ℹ duration_ms 178.398816
```
Exit 0.

### 5c. `node --experimental-test-module-mocks --test apps/api/src/modules/shopping/routes/capture-image.hermetic.test.ts`
```
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
ℹ duration_ms 312.243938
```
Exit 0.

### 6. `node --test apps/api/src/app.route-snapshot.test.ts`
```
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte — the real 'unchanged API surface' gate (90.398348ms)
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte (32.094034ms)
✔ assertRouteTableMatches rejects an added route (0.188901ms)
✔ assertRouteTableMatches rejects a removed route (0.078629ms)
✔ assertRouteTableMatches rejects a renamed route (0.109248ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.081516ms)
✔ assertRouteTableMatches accepts identical tables (0.098999ms)
ℹ tests 7
ℹ pass 7
ℹ fail 0
ℹ duration_ms 885.942046
```
Exit 0. Fixture diff is exactly `POST /api/shopping/parse-image`.

### 7. `git status --porcelain`
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
```

Not committed/staged (as required).

## DB-Gated Demo Test

`capture-image.route.test.ts` requires `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET` to be set (same pattern as `capture.route.test.ts`). Local run without env vars fails fast with a clear error message. The test mirrors the demo-403 pattern from `capture.route.test.ts` exactly: creates a test user, creates a demo session, POSTs to `/api/shopping/parse-image`, asserts 403.

The DB-gated test was NOT run locally (no DB connection available). It is structured identically to `capture.route.test.ts` which is known to pass in CI.

## Schema/Migration Changes

NONE. No new schema, migration, or backup change. Reuses `shopping_parse` ai_event kind as specified.

## Assumptions

- `Storage.delete(key)` exists as `Promise<void>` — confirmed from `apps/api/src/lib/storage.ts:24`.
- `file.file.truncated` is the correct property for `@fastify/multipart` truncation detection — confirmed from `apps/api/src/modules/system/routes/backup.ts:88`.
- `req.file({ limits: { fileSize, files } })` is the correct multipart read API — confirmed from `apps/api/src/modules/ledger/routes/attachments.ts:28`.
- `ImageBlock.data` must be raw base64 without `data:` prefix — confirmed from `packages/ai/src/types.ts:134` and `assertImagesValid`.
- Adding `POST /api/shopping/parse-image` does NOT add a corresponding `HEAD` route — confirmed from snapshot diff (only POST added).

## Unresolved Risks

- The DB-gated `capture-image.route.test.ts` was not run locally. It uses the same pattern as `capture.route.test.ts` which CI has proven works.
- `internvision` test name was `internvl → true (contains vision)` — the test description is slightly misleading (the model name in the test is "internvision" which contains "vision", not "internvl"). The test is correct but the description could be clearer.
