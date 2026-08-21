# Sonnet Worker Delegation — Task 9.5 (photo list capture)

## Task
9.5 · branch `feat/shopping-core-capture` (9.3=40921c1, 9.4=1095b71 already committed here). Implement
the APPROVED plan in [`TASK.md`](./TASK.md) — read it fully first. Facts in
[`investigation-1.md`](./investigation-1.md).

## Approved Plan (P0–P6) — implement exactly
- P0 `packages/ai` VISION CAPABILITY: add `readonly supportsVision: boolean` to the `AiProvider`
  interface (`packages/ai/src/types.ts` ~256). Add a pure exported `modelSupportsVision(model: string):
  boolean` helper — conservative allowlist: return true only if the lowercased model matches a known
  vision family (`gpt-4o`, `gpt-4.1`, `gpt-4-turbo`, `claude`, `gemini`, `llava`, `-vl`, `vision`),
  else FALSE (so `deepseek-chat` and unknown → false). Set the field in every provider constructor:
  anthropic (`anthropic.ts` ~41) → true; ollama (`ollama.ts` ~34) → false; null (`null-provider.ts` ~9)
  → false; openai-compat (`openai-compat.ts` ~48) → `modelSupportsVision(config.model)`. Add colocated
  tests for `modelSupportsVision` (allowlist hits + deepseek-chat/unknown → false) and each provider's
  flag value.
  - CRITICAL: adding a REQUIRED field to `AiProvider` breaks existing test fakes at typecheck. Update
    each of these to add `supportsVision` (match the provider they emulate, default false):
    `apps/api/src/modules/shopping/services/parse-list.test.ts` (~64),
    `apps/extractor/src/extract.test.ts` (~47 and ~71),
    `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts` (~440).
    Grep the whole repo for other objects typed as / satisfying `AiProvider` and fix any the typecheck
    flags — run `npm run typecheck` and fix every resulting error (do not suppress with `as any`).
- P1 refactor `apps/api/src/modules/shopping/services/parse-list.ts`: extract the inlined
  "normalize + blank-filter + graceful-empty" logic (currently in `parseListText` ~214–248) into an
  exported `itemsFromTurn(turn, structured): ParsedShoppingItem[]` (it calls `parseItemsFromTurn` then
  normalizes+filters). `parseListText` now calls `itemsFromTurn`. BEHAVIOUR MUST NOT CHANGE — 9.4's 14
  parse-list tests must still pass unchanged. Keep `parseItemsFromTurn` exported and unchanged.
- P2 `packages/shared/src/schemas/shopping.ts`: add `ParseListImageResponseSchema`
  ({ available: boolean, items: z.array(ParsedShoppingItemSchema), message: string|null }) + type +
  deepEqual expected-object test. NO `storageKey` field.
- P3 NEW `apps/api/src/modules/shopping/services/parse-image.ts`: `parseListImage(deps, userId, image,
  observe)` where `deps = { db, storage, secret, allowedBaseUrls }` (match how the route can supply
  `app.storage`/`app.config`). Steps: resolve provider via `getUserAiProvider`; if `!ai.enabled` →
  `{available:false, items:[], message:"AI is not configured"}` (no store, no chat); if
  `!ai.supportsVision` → `{available:false, items:[], message:"Photo capture requires a vision-capable
  AI provider"}` (no store, no chat). Else: `const key = await storage.put(image.buffer,
  image.contentType)`; in a `try { … } finally { await storage.delete(key).catch(()=>{}) }` build a
  vision `ChatMessage` (content = ContentBlock[] with a short text instruction + an ImageBlock:
  `{ type:"image", mediaType: <from contentType>, data: base64(buffer) }` — RAW base64, NO `data:`
  prefix), call `ai.chat({ system, messages, tools:[PARSE_LIST_TOOL], toolChoice: PARSE_LIST_TOOL.name,
  maxTokens, timeoutMs })`, then `const items = itemsFromTurn(turn, true)`; return
  `{available:true, items, message: items.length? null : "Could not read any items from the image"}`.
  `ai.chat()` errors PROPAGATE (only wrap parse/normalize in a catch that returns graceful empty). The
  `finally` delete must NOT throw over a propagating chat error (swallow delete errors).
- P4 NEW `apps/api/src/modules/shopping/routes/capture-image.ts`: `POST /parse-image` (relative), uses
  `@fastify/multipart` `req.file({ limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } })`; read
  `file.toBuffer()`; validate content-type against {image/jpeg,image/png,image/webp} AND magic bytes
  (mirror `assertUploadable` in `apps/api/src/modules/ledger/services/attachments.ts`); on
  wrong-type → `HttpError(415 or 400, clear msg)`; on `file.file.truncated`/oversize →
  `HttpError(413, "…5 MB…")`. Build the `shopping_parse` AiObserver (roadmap-narrative shape, image
  source in title), call `parseListImage`, return `ParseListImageResponseSchema`. Register in
  `plugin.ts`. NOT public. Response schema wired via ZodTypeProvider.
- P5 regenerate BOTH route-snapshot fixtures via the one-off-script-then-delete method (as 9.3/9.4);
  diff MUST be exactly `POST /api/shopping/parse-image` (no auto-HEAD). Inspect + report.
- P6 tests: P0 vision-capability tests; hermetic `parse-image.test.ts` (mock.module getUserAiProvider +
  a mock Storage): success path asserts exactly one ImageBlock with correct mediaType + raw base64 (no
  `data:` prefix) sent to chat, tools/toolChoice set, and BOTH `storage.put` AND `storage.delete`
  called; chat-throw path asserts `storage.delete` still called and the error propagates; `!enabled`
  and `!supportsVision` (ollama AND a text-only openai-compat stub) → graceful message, chat NOT called,
  storage.put NOT called; unreadable turn → empty items. Route: content-type reject (pdf/text bytes) →
  4xx; oversize → 413; not public; unauth → 401; demo-403 (DB-gated, mirror `catalog.route.test.ts`/
  `capture.route.test.ts`). Shared deepEqual. Confirm 9.4's 14 parse-list tests still pass.

## Must Not Change
- NO schema/table/migration/backup change (reuse `shopping_parse` kind). NO behaviour change to
  `parseListText`/`parseItemsFromTurn` (pure refactor). Do NOT weaken any provider's existing image
  validation. NO AI vendor SDK import outside `packages/ai`. `.ts` imports, integer paise, user_id
  scoping. Do NOT mark any route public / touch the demo allowlist. Do NOT commit/stage/push.

## Acceptance Criteria
AC1–AC7 in TASK.md. Key: shares 9.4 parse/validate (PARSE_LIST_TOOL + itemsFromTurn); size/content-type
→ clear 4xx (AC2); unreadable → empty review, infra errors propagate (AC3); Storage put+delete transient
(AC4); non-vision/disabled → clear message, no crash/chat/store (AC5); review-only + shopping_parse
event + demo-safe + unauth 401 (AC6); gates green (AC7).

## Commands (run from repo root; paste literal output + exit codes)
1. `npm run typecheck` → exit 0 (MUST catch + you MUST fix all AiProvider-fake breakages).
2. `npm run lint` → exit 0.
3. `npm run test -w packages/shared` → counts + exit.
4. `node --experimental-test-module-mocks --test packages/ai/src/<vision-capability test>` (name it) → counts + exit.
5. `node --experimental-test-module-mocks --test apps/api/src/modules/shopping/services/parse-list.test.ts`
   (prove 9.4's 14 still pass) and `.../services/parse-image.test.ts` and
   `.../routes/capture-image.hermetic.test.ts` → counts + exit.
6. `node --test apps/api/src/app.route-snapshot.test.ts` → pass; paste the two-fixture git diff.
7. `git status --porcelain`.

## Required Evidence
- Files changed + full unified diffs of each source file; the fixture git diff; every command's literal
  output + counts + exit codes; the regen script text + deletion confirmation; the list of AiProvider
  fakes you updated; the DB-gated demo test's local behavior. Any deviation/blocker → STOP and report.

Write the report to `/work/personal/compass/tasks/068-photo-capture/implementation-1.md`; reply with a
≤20-line digest + that path. If any assumed signature (Storage.put/delete, getUserAiProvider,
ImageBlock/ChatMessage shape, @fastify/multipart req.file, assertUploadable) differs, STOP and report.

---

## Iteration 2 (post code-review-3 — 1 blocking + 1 test-vacuity fix)

Apply exactly these; change nothing else.

1. **BLOCKING — tighten `modelSupportsVision`** (`packages/ai/src/types.ts`): the current allowlist is
   too broad and yields false-positives that send images to text-only models. Fix the matching so:
   - REMOVE the bare `"vision"` token (it matches text models like `not-vision`,
     `my-vision-benchmark-text-model`).
   - REPLACE bare `"claude"` with `"claude-3"` and `"claude-4"` (bare `claude` matches text-only
     `claude-2`/`claude-instant`).
   - KEEP specific vision tokens: `gpt-4o`, `gpt-4.1`, `gpt-4-turbo`, `llava`, `-vl`, `qwen2-vl`,
     `pixtral` (add these if not present; all are genuinely vision-capable families).
   - Default FALSE for everything else (deepseek-chat, unknown — already correct).
   Update the helper's tests to assert FALSE for: `not-vision`, `my-vision-benchmark-text-model`,
   `claude-2`, `claude-instant-1`, `deepseek-chat`; and TRUE for: `gpt-4o`, `gpt-4o-mini`,
   `anthropic/claude-3.5-sonnet`, `claude-3-opus`, `llava-1.6`, `qwen2-vl-7b`, `pixtral-12b`. Keep the
   openai-compat provider deriving `supportsVision` from this helper.
2. **Non-blocking — non-vacuous image-route event test**
   (`apps/api/src/modules/shopping/routes/capture-image.hermetic.test.ts`): the mocked `parseListImage`
   currently ignores its args and never fires the observer, so the `shopping_parse` recording assertion
   is vacuous. Make the mock INVOKE the `observe` callback it is passed (e.g. `observe?.({ ok:true,
   request:"{}", response:"{}", latencyMs:1 })` — match AiCallObservation), and assert the recorded
   kinds include `"shopping_parse"` (mirror `capture.hermetic.test.ts`'s AC5 test).

Do NOT change the route's 413/415 handling (accepted as-is). Do NOT touch schema/migration/backup or
9.4's parse-list behaviour. `.ts` imports; no AI SDK outside packages/ai. Do NOT commit/stage/push.

Commands (paste literal output + exit codes): `npm run typecheck`; `npm run lint`;
`node --experimental-test-module-mocks --test <the packages/ai vision-capability test>`;
`node --experimental-test-module-mocks --test apps/api/src/modules/shopping/routes/capture-image.hermetic.test.ts`;
`node --experimental-test-module-mocks --test apps/api/src/modules/shopping/services/parse-image.test.ts`;
`git status --porcelain`. Append the report to a NEW file
`tasks/068-photo-capture/implementation-2.md` (do not overwrite implementation-1.md). Reply with a
≤15-line digest + that path. If a fix rests on a wrong assumption, STOP and report.
