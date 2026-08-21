# Implementation 2 — post code-review-3 fixes (iter2)

## Files inspected
- `tasks/068-photo-capture/DELEGATION.md` (Iteration 2 section)
- `packages/ai/src/types.ts`
- `packages/ai/src/vision-capability.test.ts`
- `apps/api/src/modules/shopping/routes/capture-image.hermetic.test.ts`
- `apps/api/src/modules/shopping/routes/capture-image.ts` (read only, for observer wiring)
- `apps/api/src/modules/shopping/routes/capture.hermetic.test.ts` (read only, for AC5 pattern)
- `packages/ai/src/index.ts` (read only, to confirm AiCallObservation export)

## Files changed

### 1. `packages/ai/src/types.ts`
**Fix 1 (BLOCKING)** — `modelSupportsVision` helper tightened.

Diff:
```diff
-/**
- * Conservative allowlist: returns true only if the lowercased model name
- * matches a known vision family. Unknown / text-only models (e.g.
- * "deepseek-chat") return false — they would error on image input, and we
- * gate before ever calling chat() with an image.
- *
- * Allowlist families: gpt-4o, gpt-4.1, gpt-4-turbo, claude, gemini, llava,
- * -vl suffix, vision keyword. Exported so openai-compat.ts and tests can use it.
- */
-export function modelSupportsVision(model: string): boolean {
-  const m = model.toLowerCase();
-  return (
-    m.includes("gpt-4o") ||
-    m.includes("gpt-4.1") ||
-    m.includes("gpt-4-turbo") ||
-    m.includes("claude") ||
-    m.includes("gemini") ||
-    m.includes("llava") ||
-    m.includes("-vl") ||
-    m.includes("vision")
-  );
-}
+/**
+ * Conservative allowlist: returns true only if the lowercased model name
+ * matches a known vision family. Unknown / text-only models (e.g.
+ * "deepseek-chat") return false — they would error on image input, and we
+ * gate before ever calling chat() with an image.
+ *
+ * Allowlist families: gpt-4o, gpt-4.1, gpt-4-turbo, claude-3, claude-4,
+ * llava, -vl suffix, qwen2-vl, pixtral. Bare "claude", "gemini", and the
+ * bare "vision" token are intentionally excluded — they cause false-positives
+ * on text-only models (claude-2, claude-instant, vision-benchmark-*).
+ * Exported so openai-compat.ts and tests can use it.
+ */
+export function modelSupportsVision(model: string): boolean {
+  const m = model.toLowerCase();
+  return (
+    m.includes("gpt-4o") ||
+    m.includes("gpt-4.1") ||
+    m.includes("gpt-4-turbo") ||
+    m.includes("claude-3") ||
+    m.includes("claude-4") ||
+    m.includes("llava") ||
+    m.includes("-vl") ||
+    m.includes("qwen2-vl") ||
+    m.includes("pixtral")
+  );
+}
```

Tokens removed: `"claude"` (bare), `"gemini"`, `"vision"` (bare).
Tokens added/kept: `"claude-3"`, `"claude-4"`, `"qwen2-vl"`, `"pixtral"`.
Tokens unchanged: `"gpt-4o"`, `"gpt-4.1"`, `"gpt-4-turbo"`, `"llava"`, `"-vl"`.

### 2. `packages/ai/src/vision-capability.test.ts`
**Fix 1** — tests updated to match tightened helper. File fully rewritten.

Removed (now-wrong TRUE assertions):
- `claude-haiku-4-5-20251001 → true` (matched bare `claude`; now false)
- `gemini-1.5-pro → true` (matched `gemini`; now false)
- `internvision → true` (matched `vision`; now false)
- `some-vision-model → true` (matched `vision`; now false)

Updated comment:
- `claude-3-haiku → true (contains claude)` → `(contains claude-3)`

Added TRUE assertions:
- `anthropic/claude-3.5-sonnet → true` (contains `claude-3`)
- `claude-3-opus → true` (contains `claude-3`)
- `llava-1.6 → true` (contains `llava`)
- `qwen2-vl-7b → true` (contains `-vl`)
- `pixtral-12b → true` (contains `pixtral`)

Added FALSE assertions:
- `not-vision → false`
- `my-vision-benchmark-text-model → false`
- `claude-2 → false`
- `claude-instant-1 → false`

Kept existing FALSE: `deepseek-chat`, `deepseek/deepseek-chat`, `llama3.1`, `my-custom-text-model`, `empty string`.
Kept all provider flag tests unchanged.

Total: 30 tests (was 22), all pass.

### 3. `apps/api/src/modules/shopping/routes/capture-image.hermetic.test.ts`
**Fix 2 (non-blocking)** — non-vacuous event test added.

Diff summary:
1. Added `import type { AiCallObservation } from "@compass/ai";`
2. Added `let recordedKinds: string[] = [];` at module level
3. Updated `parseListImage` mock:
   - Now typed with `(deps, userId, image, observe?)` parameters
   - Calls `observe?.({ ok: true, request: "{}", response: "{}", latencyMs: 1 })` before returning
4. Updated `recordAiEvent` mock:
   - Was `async () => {}`
   - Now `async (_db, _userId, input: { kind: string }) => { recordedKinds.push(input.kind); }`
5. Added new test: `"POST /api/shopping/parse-image: valid JPEG → records shopping_parse ai_event (AC5)"`:
   - Resets `recordedKinds = []`
   - Sends a valid JPEG multipart request
   - Asserts `res.statusCode === 200`
   - Asserts `recordedKinds.includes("shopping_parse")`

Total: 8 tests (was 7), all pass.

## Commands run (exact lines + literal output)

### `npm run typecheck`
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

EXIT: 0
```

### `npm run lint`
```
> compass@0.1.0 lint
> eslint .

EXIT: 0
```

### `node --experimental-test-module-mocks --test packages/ai/src/vision-capability.test.ts`
```
✔ modelSupportsVision: gpt-4o → true (0.591507ms)
✔ modelSupportsVision: gpt-4o-mini → true (contains gpt-4o) (0.07344ms)
✔ modelSupportsVision: gpt-4.1 → true (0.079852ms)
✔ modelSupportsVision: gpt-4-turbo → true (0.066937ms)
✔ modelSupportsVision: claude-3-haiku → true (contains claude-3) (0.060726ms)
✔ modelSupportsVision: anthropic/claude-3.5-sonnet → true (contains claude-3) (0.056478ms)
✔ modelSupportsVision: claude-3-opus → true (contains claude-3) (0.051248ms)
✔ modelSupportsVision: llava → true (0.624991ms)
✔ modelSupportsVision: llava:13b → true (contains llava) (0.089331ms)
✔ modelSupportsVision: llava-1.6 → true (contains llava) (0.125419ms)
✔ modelSupportsVision: qwen2-vl → true (contains -vl) (0.07322ms)
✔ modelSupportsVision: qwen2-vl-7b → true (contains -vl) (0.054885ms)
✔ modelSupportsVision: pixtral-12b → true (contains pixtral) (0.03643ms)
✔ modelSupportsVision: not-vision → false (bare 'vision' token removed) (0.034405ms)
✔ modelSupportsVision: my-vision-benchmark-text-model → false (bare 'vision' token removed) (0.032001ms)
✔ modelSupportsVision: claude-2 → false (bare 'claude' removed; only claude-3/claude-4 match) (0.038744ms)
✔ modelSupportsVision: claude-instant-1 → false (bare 'claude' removed) (0.040828ms)
✔ modelSupportsVision: deepseek-chat → false (0.039756ms)
✔ modelSupportsVision: deepseek/deepseek-chat → false (OpenRouter default) (0.028865ms)
✔ modelSupportsVision: llama3.1 → false (Ollama default) (0.025419ms)
✔ modelSupportsVision: unknown/custom-text-model → false (0.025088ms)
✔ modelSupportsVision: empty string → false (0.028023ms)
✔ NullProvider.supportsVision is false (0.030478ms)
✔ Anthropic provider.supportsVision is true (0.093298ms)
✔ Ollama provider.supportsVision is false (0.090733ms)
✔ OpenAI-compat (openrouter) with deepseek-chat model → supportsVision false (0.095993ms)
✔ OpenAI-compat (openrouter) with gpt-4o model → supportsVision true (0.049604ms)
✔ OpenAI-compat (deepseek) with default deepseek-chat → supportsVision false (0.038574ms)
✔ OpenAI-compat (custom) with gpt-4-turbo model → supportsVision true (0.039836ms)
✔ OpenAI-compat (custom) with unknown model → supportsVision false (0.04168ms)
ℹ tests 30
ℹ suites 0
ℹ pass 30
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 101.588136
EXIT: 0
```

### `node --experimental-test-module-mocks --test apps/api/src/modules/shopping/routes/capture-image.hermetic.test.ts`
```
(node:187445) ExperimentalWarning: Module mocking is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
✔ POST /api/shopping/parse-image: application/pdf content-type → 415 (70.40243ms)
✔ POST /api/shopping/parse-image: text/plain content-type → 415 (3.021008ms)
✔ POST /api/shopping/parse-image: image/jpeg declared but PDF magic bytes → 415 (magic byte mismatch) (2.603893ms)
✔ POST /api/shopping/parse-image: oversize file → 413 (5.016852ms)
✔ POST /api/shopping/parse-image: no session → 401 (2.321034ms)
✔ POST /api/shopping/parse-image: valid JPEG → 200 with items (4.085667ms)
✔ POST /api/shopping/parse-image: route is NOT public (verified by 401 without session) (2.926989ms)
✔ POST /api/shopping/parse-image: valid JPEG → records shopping_parse ai_event (AC5) (2.834783ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 321.989507
EXIT: 0
```

### `node --experimental-test-module-mocks --test apps/api/src/modules/shopping/services/parse-image.test.ts`
```
(node:187496) ExperimentalWarning: Module mocking is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
✔ parseListImage: success path — ImageBlock has correct mediaType + raw base64, tools/toolChoice set, storage.put AND delete called (1.508805ms)
✔ parseListImage: chat throws → error propagates AND storage.delete still called (0.362902ms)
✔ parseListImage: !ai.enabled → graceful message, chat NOT called, storage.put NOT called (0.111393ms)
✔ parseListImage: ollama (supportsVision=false) → graceful message, chat NOT called, storage.put NOT called (0.112805ms)
✔ parseListImage: text-only openai-compat (deepseek-chat, supportsVision=false) → graceful message, chat NOT called, storage.put NOT called (0.123495ms)
✔ parseListImage: unreadable turn (no tool call, no JSON) → empty items, available:true (0.422826ms)
✔ parseListImage: PNG buffer — ImageBlock mediaType is image/png (0.243674ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 182.804997
EXIT: 0
```

### `git status --porcelain`
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
EXIT: 0
```

## Assumptions
- `qwen2-vl` (without `qwen2-vl` explicitly) would already match via `-vl`; both tokens kept for clarity
  as instructed.
- `claude-haiku-4-5-20251001` (a model in the existing test set) does NOT contain `claude-3` or `claude-4`
  as a substring — confirmed by inspection — so its old TRUE test was removed. This is intentional: the
  model name format doesn't match either new token. If Anthropic releases a haiku model under a name that
  must be vision-capable, it would need to be added separately (e.g. `claude-haiku` as a token), but the
  brief does not ask for this.
- `gemini` was in the old allowlist but not in the brief's keep-list; removed accordingly.
- Nothing changed in route 413/415 handling, schema, migration, backup, or parse-list behaviour.

## Unresolved risks
- The `claude-haiku-4-5-20251001` model name used as a test fixture elsewhere (e.g. in
  `capture-image.hermetic.test.ts`'s AI settings mock) still returns that string from `getAiSettings`,
  but `effectiveModel()` / the event log only use it as a label — not for vision gating (gating is done
  via `ai.supportsVision` on the resolved provider, not re-checking the model name in the route). No
  correctness issue.
- None of the three commands were skipped or timed out.
