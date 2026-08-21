# Task 9.5 — Photo list capture

Board task: [`tasks/09.05-photo-capture.md`](../09.05-photo-capture.md) · release 2.3.0 ·
depends 8.1 (done) + 9.4 (committed on this branch). Branch: `feat/shopping-core-capture`.
Investigation: [`investigation-1.md`](./investigation-1.md).

## Status
CODE COMPLETE & REVIEWED (DB-gated demo test runs in CI, per convention).
- review-4 (code re-review): NO blocking — ready to commit. False-positive defect resolved
  (modelSupportsVision returns false for not-vision / my-vision-benchmark-text-model / claude-2 /
  claude-instant-1 / deepseek-chat / bare vision|gemini|claude; true for gpt-4o / claude-3 / claude-4 /
  llava / -vl / qwen2-vl / pixtral). False-negative tradeoff (gemini-1.5, claude-4-named openrouter
  routes → graceful "requires vision provider") confirmed SAFE/conservative. Tests non-vacuous; no
  provider-flag regression (anthropic true / ollama false / null false set independently). 1 accepted
  non-blocking: a deliberately-misleading alias (fake-pixtral-text) could still match — inherent to any
  substring heuristic, out of scope.
- Local gates SEEN green: typecheck 0, lint 0, shared 334, vision-capability 30/30, parse-list 14/14
  (9.4 intact), parse-image 7/7, capture-image.hermetic 8/8, route-snapshot 7/7. Independent
  verification-1 confirmed no schema/migration/backup change, required supportsVision wired everywhere,
  snapshot diff exact. capture-image.route.test.ts (demo-403) DB-gated → CI.

## Review log (code) — do not re-read review files
- review-3 (code): 1 BLOCKING — `modelSupportsVision` substring allowlist too broad (bare "vision"
  matches text models like `not-vision`; bare "claude" matches text-only `claude-2`/`claude-instant`) →
  a false-positive sends an image to a text-only openai-compat model → 4xx→5xx, regressing AC5. FIX
  (iter2): drop bare "vision"; require `claude-3`/`claude-4` not bare `claude`; keep specific vision
  tokens (gpt-4o/gpt-4.1/gpt-4-turbo/llava/-vl/qwen2-vl/pixtral); default false; add tests for the named
  false-positives. Non-blocking FIX: image-route event test vacuous (mock ignores observe) → fire
  observe, assert shopping_parse recorded. Non-blocking ACCEPTED as-is: the "5 MB" 413 wording may be
  pre-empted by @fastify/multipart's own 413, but the test asserts 413 either way (AC2 holds). Confirmed
  correct: required supportsVision field wired all providers + 4 fakes, gate order, transient put/delete
  in finally (delete swallowed), raw base64 no data: prefix, ai.chat outside parse catch, review-only,
  magic-byte checks, snapshot exact, no schema/migration/backup change, 9.4's 14 tests intact.

Original plan APPROVED at review-2 (all 3 blocking resolved). Two implementation notes folded in:
(1) adding required `AiProvider.supportsVision` will fail typecheck on existing test fakes — update
`apps/api/src/modules/shopping/services/parse-list.test.ts:64`, `apps/extractor/src/extract.test.ts:47`
and `:71`, `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:440` (add the field);
(2) in the `finally`, attempt `storage.delete` but do NOT let a delete failure mask a propagating
`ai.chat()` error (swallow/log delete errors).

## Review log (digested — do not re-read review files)
- review-1 (plan): 3 BLOCKING, all accepted:
  - B1 image lifecycle → TRANSIENT store-then-delete (not store-and-keep). `Storage.put` keys are meant
    to live in a DB `FILE_COLUMNS` col + be backed up (storage.ts:15, attachments.ts:86, backup.ts:217);
    an unreferenced key is a backup-omitted "orphan" (backup.ts:277). FIX: validate+gate → `storage.put`
    → vision call on in-memory buffer → `storage.delete(key)` in `finally`; DROP `storageKey` from the
    response schema. (Storage abstraction still exercised via put+delete → satisfies AC4.)
  - B2 vision gating too narrow — `ai.name !== "ollama"` wrongly treats deepseek / openrouter-default
    (deepseek-chat) / text-only custom as vision-capable → text-only openai-compat upstream 4xx →
    AiUnavailableError → 5xx, breaking graceful degrade. FIX: add a real `supportsVision` capability to
    `AiProvider` in packages/ai (anthropic→true, ollama→false, openai-compat→conservative model-name
    allowlist, unknown→false so deepseek-chat is false); gate the service on `ai.supportsVision`.
  - B3 UI deferral OK but the board AC "Mobile camera capture works; desktop file picker still works"
    must be explicitly transferred to 12.1 (like 9.2's household amendment). FIX: amend
    `tasks/09.05-photo-capture.md` + note in 9.5 status; 9.5 ships server endpoint + shared contract only.
  - Non-blocking accepted: catch multipart truncation/413 → clear `HttpError(413)`; tests assert exact
    ImageBlock (no `data:` prefix in `.data`); assert `put`+`delete` on a mock Storage (no new
    dual-backend test — 1.10 storage.test.ts covers both); `shopping_parse` reuse + no-migration
    confirmed; ImageBlock message shape confirmed correct; parse-list refactor low-risk if mechanical.

## Objective
Photograph a handwritten/printed list → the SAME structured, reviewable `ParsedShoppingItem[]` as 9.4's
paste-text, via the 8.1 vision path. Server-side: image → `Storage` → vision `chat` with the SAME
`PARSE_LIST_TOOL` + Zod validation as 9.4 → reviewable items (nothing auto-saved). App remains fully
functional with AI disabled / with a non-vision provider.

## Root Cause
Net-new feature. NO schema change and NO migration: reuse 9.4's `shopping_parse` ai_event kind (photo
parse is the same semantic — a shopping-list parse). No new table (image lifecycle per decision below).

## Scope
- **Edit** `packages/ai/src/types.ts` (+ `anthropic.ts`, `ollama.ts`, `openai-compat.ts`, `factory.ts`,
  `null-provider.ts`) — add `readonly supportsVision: boolean` to the `AiProvider` interface and set it
  per provider: anthropic → true, ollama → false, null → false, openai-compat → a pure
  `modelSupportsVision(model)` helper (conservative allowlist: model name matching known vision families
  e.g. `gpt-4o`, `gpt-4.1`, `claude`, `gemini`, `llava`, `*-vl`, `vision`; UNKNOWN → false, so
  `deepseek-chat` is false). Colocated tests for the helper + each provider's flag. This is the correct
  home for capability (8.1 added vision here). [review-1 B2]
- **Edit** `apps/api/src/modules/shopping/services/parse-list.ts` — refactor the shared
  "turn → ParsedShoppingItem[] with blank-filter + graceful-empty" logic (currently inlined in
  `parseListText`) into a reusable exported helper `itemsFromTurn(turn, structured)` and have BOTH
  `parseListText` and the new image path call it (DRY; keeps the iter-2 blank-name blocking fix shared).
- **New** `apps/api/src/modules/shopping/services/parse-image.ts` — `parseListImage(deps, userId, image:
  { buffer, contentType }, observe)` where `deps` carries `db`, `storage`, `secret`, `allowedBaseUrls`:
  resolve provider; if `!ai.enabled` or `!ai.supportsVision` → graceful message, chat NOT called; else
  `storage.put(buffer, contentType)` → key, build a vision `ChatMessage` (ImageBlock: raw base64, no
  `data:` prefix, + short text instruction), `chat` with `[PARSE_LIST_TOOL]`/`toolChoice`, delegate to
  `itemsFromTurn`, and `storage.delete(key)` in a `finally` (TRANSIENT — B1). Returns reviewable items +
  message (NO storageKey). `ai.chat()` errors propagate; parse/normalize caught → graceful empty.
- **New** `apps/api/src/modules/shopping/routes/capture-image.ts` — `POST /parse-image`
  (`multipart/form-data`, single file) under `/api/shopping`. Content-type allowlist (image/jpeg,
  image/png, image/webp — NOT pdf) + magic-byte check; size limit; clear errors. Records a
  `shopping_parse` ai_event (image-sourced) via the observer. Register in `plugin.ts`. Not public.
- **Edit** `packages/shared/src/schemas/shopping.ts` — add `ParseListImageResponseSchema`
  ({ available: boolean, items: ParsedShoppingItem[], message: string|null }) + type + deepEqual tests.
  (Reuses `ParsedShoppingItemSchema` from 9.4. NO `storageKey` — the image is transient, B1.)
- **Regenerate** both route-snapshot fixtures (script-then-delete, as 9.3/9.4); diff = exactly
  `POST /parse-image` (no auto-HEAD).
- **Tests**: hermetic (vision message shaping; provider-not-vision graceful; unreadable→empty; storage
  put called; content-type/size rejection) + shared schema + DB-gated route/demo test.

## Dependencies
- 8.1 vision (ImageBlock{mediaType, raw base64}; `MAX_IMAGE_BYTES` 5 MB; ollama's chat throws on images
  via assertNoImages). NEW: 9.5's P0 adds `AiProvider.supportsVision` (there is no such flag today).
  9.4 (`PARSE_LIST_TOOL`, `parseItemsFromTurn`/`itemsFromTurn`, `ParsedShoppingItem`).

## Design decisions (two flagged for plan review)
- **Reuse 9.4's tool + validation verbatim** — same `PARSE_LIST_TOOL`, same `ModelOutputSchema`/
  `itemsFromTurn`, same normalize+blank-filter. The ONLY difference from 9.4 is the message content is a
  vision ImageBlock instead of a text string. This is exactly what the board AC ("sharing the 4.4
  parse/validate path") requires.
- **Vision gate & graceful degrade** [B2]: resolve provider via `getUserAiProvider`. If `!ai.enabled` →
  `{ available:false, items:[], message:"AI is not configured" }`. If `!ai.supportsVision` (the new
  capability — covers ollama AND text-only openai-compat models like deepseek-chat) →
  `{ available:false, items:[], message:"Photo capture requires a vision-capable AI provider" }` WITHOUT
  calling chat and WITHOUT storing the image. Vision has no prose fallback (can't read an image without
  vision), so this is a clean capability gate. `ai.chat()` network/provider errors PROPAGATE (5xx); only
  parse/interpret/normalize is caught → graceful empty (AC3: unreadable photo → empty review).
- **Image size + content-type**: reject non-{jpeg,png,webp} by content-type AND magic bytes (mirror
  `assertUploadable` in `ledger/services/attachments.ts`) → clear 4xx. Enforce a max size via
  `req.file({ limits: { fileSize: MAX, files: 1 } })`. MAX = the vision ceiling (`MAX_IMAGE_BYTES`, 5 MB)
  since anything larger can't be sent to the model anyway. Catch multipart truncation
  (`file.file.truncated`) / `RequestFileTooLargeError` and rethrow `HttpError(413, "…5 MB…")` — a clear
  4xx, never a 500. (Reuse the existing constant/import path; do not hardcode a divergent number.)
- **[FLAG 1 → RESOLVED B1] Transient store-then-delete.** validate + capability-gate FIRST; then
  `storage.put(buffer, contentType)` → key; vision call on the in-memory buffer; `storage.delete(key)` in
  a `finally` (cleaned up on success AND on a propagating chat error). The response carries NO
  `storageKey`. This exercises the Storage abstraction (satisfies the board AC) without creating
  backup-omitted orphans (no table references the key). Durable photo attachment is a later task (11.4
  receipt loop), which will add a real owning table + backup `FILE_COLUMNS` entry.
- **[FLAG 2 → RESOLVED B3] Server endpoint + contract only; camera/file-picker UI deferred to 12.1.**
  The board AC "Mobile camera capture works; desktop file picker still works" + `capture=environment`
  are client concerns; task 12.1 ("Shopping nav group, lists & capture") owns the capture UI. Consistent
  with 9.2/9.3/9.4. 9.5 delivers `POST /parse-image` (the endpoint both the camera and picker will call).
  The board file `tasks/09.05-photo-capture.md` is AMENDED to transfer that UI AC to 12.1 (like 9.2's
  household amendment) so 9.5 completes on its server-side scope.
- **ai_event kind**: reuse `"shopping_parse"` (no new enum value, no migration) — photo parse is the
  same semantic operation. The event title notes image source (e.g. filename or "photo").
- **Demo/auth**: `POST /parse-image` is mutating → demo-rejected pre-handler; not public; unauth → 401.

## Plan
- P0: `packages/ai` — add `readonly supportsVision: boolean` to `AiProvider` (types.ts) + a pure
  `modelSupportsVision(model: string): boolean` helper; set the flag in each provider (anthropic→true,
  ollama→false, null→false, openai-compat→`modelSupportsVision(model)`). Colocated tests: helper
  allowlist (gpt-4o/claude/gemini/llava/*-vl/vision → true; `deepseek-chat`, unknown → false) + each
  provider's flag value. Export the helper if useful. [B2]
- P1: Refactor `parse-list.ts` — extract `itemsFromTurn(turn, structured): ParsedShoppingItem[]`
  (parseItemsFromTurn + normalize + blank-filter); `parseListText` calls it; behaviour unchanged
  (existing 14 tests stay green). Export it.
- P2: `shopping.ts` shared — `ParseListImageResponseSchema` ({ available, items, message }; NO
  storageKey) (+ type + deepEqual tests).
- P3: `services/parse-image.ts` — `parseListImage(deps, userId, image, observe)`: gate on `!ai.enabled`
  and `!ai.supportsVision` (graceful, no chat, no store); else `storage.put` → ImageBlock vision message
  (raw base64, no `data:` prefix) → chat gated → `itemsFromTurn` → `storage.delete` in `finally`. chat
  errors propagate; parse/normalize caught → graceful empty.
- P4: `routes/capture-image.ts` — `POST /parse-image` multipart (`req.file({limits:{fileSize:
  MAX_IMAGE_BYTES, files:1}})`); content-type allowlist + magic-byte check; catch truncation → 413
  clear error; observer records `shopping_parse`; passes `app.storage`; register in `plugin.ts`; not
  public.
- P5: Regenerate BOTH snapshot fixtures (script-then-delete); diff = exactly `POST /parse-image`, no HEAD.
- P6: Tests — packages/ai vision-capability tests (P0); hermetic parse-image with a stub vision provider
  (chat captures the message → assert exactly one ImageBlock with correct mediaType + raw base64 and NO
  `data:` prefix, tools/toolChoice set); `!supportsVision` (ollama AND a text-only openai-compat stub) →
  graceful message, chat NOT called, storage.put NOT called; unreadable turn → empty items; success path
  asserts `storage.put` AND `storage.delete` both called (mock storage), and delete also called when chat
  throws; content-type reject (pdf/text magic bytes) → 4xx; oversize → 413. Shared schema deepEqual +
  refine. DB-gated route/demo-403 test (mirror capture.route.test.ts). `itemsFromTurn` reuse: 9.4's 14
  tests still green.

## Acceptance Criteria
- AC1: Photo upload → structured `ParsedShoppingItem[]`, sharing 9.4's parse/validate path
  (`PARSE_LIST_TOOL` + `itemsFromTurn`). Proven by a hermetic test with a stub vision provider.
- AC2: Size and content-type limits enforced with a clear error (reject non-image + oversize → 4xx with
  a message, not a 500).
- AC3: A photo that yields nothing readable degrades to an empty review (`items: []` + message), not an
  error page; `ai.chat()` infra errors still propagate.
- AC4: Images are stored via the `Storage` abstraction (`storage.put`) and deleted after use
  (`storage.delete` in `finally`) — transient, no orphan. Works on both S3 and disk backends (the
  abstraction guarantees this — 1.10 contract-tests both; 9.5 asserts `put` AND `delete` are invoked).
  No `storageKey` in the response.
- AC5: A non-vision provider (ollama OR a text-only openai-compat model, via `!ai.supportsVision`) or
  disabled AI degrades with a clear message and does NOT crash, does NOT call chat, does NOT store.
- AC6: Review-only — the endpoint writes nothing to `shopping_list_items`; records a `shopping_parse`
  ai_event; demo-rejected; not public; unauth → 401.
- AC7: `npm run typecheck`, `npm run lint` exit 0; hermetic + shared tests pass; DB-gated test runs in CI.

## Verification
- T1: typecheck 0, lint 0. T2: shared + parse-image + parse-list hermetic tests pass (paste counts);
  9.4's 14 parse-list tests STILL pass after the refactor. T3: route-snapshot passes; diff = exactly
  POST /parse-image. T4: "does the test bite" for the vision-gate (ollama) and content-type-reject paths.
  T5: confirm NO new migration/schema/backup change. T6: CI (ci-validator) confirms DB-gated suite ran.

## Non-Goals
- Camera/file-picker/`capture="environment"` UI (task 12.1 — see FLAG 2).
- Persisting the storage key in a table / attaching the photo to a list / image GC & cleanup
  (deferred; see FLAG 1) — receipt-loop attachment is 11.4.
- A new ai_event kind or migration (reuses `shopping_parse`). PDF/multi-page OCR. Auto-save/auto-categorize.
