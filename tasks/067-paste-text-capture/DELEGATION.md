# Sonnet Worker Delegation — Task 9.4 (paste-text list capture)

## Task
9.4 · branch `feat/shopping-core-capture` (9.3 already committed as 40921c1 on this branch, so
`convertToBaseQuantity`/`DisplayUnitSchema` are available). Implement the APPROVED plan in
[`TASK.md`](./TASK.md) — read it fully first. Facts in [`investigation-1.md`](./investigation-1.md).

## Approved Plan (P1–P6) — implement exactly
- P1 `packages/shared/src/schemas/ai-events.ts`: add `"shopping_parse"` to `AiEventKindSchema`.
  `apps/api/src/modules/automation/schema.ts`: add `"shopping_parse"` to the `ai_event_kind` pgEnum.
  Run `npm run db:generate`; the emitted migration MUST be exactly `ALTER TYPE "public"."ai_event_kind"
  ADD VALUE 'shopping_parse'` (mirrors `drizzle/0004_*`). Keep it; do not hand-edit. If db:generate
  emits anything beyond that ADD VALUE, STOP and report.
- P1a `apps/web/src/routes/events/EventLogPage.tsx`: add a `shopping_parse` entry to the exhaustive
  `KIND_LABELS: Record<AiEventKind, string>` map (mandatory for the web typecheck). Optionally add it to
  the filter array (product nicety) — safe either way.
- P2 `packages/shared/src/schemas/shopping.ts`: `ParsedShoppingItemSchema`, `ParseListTextRequestSchema`,
  `ParseListTextResponseSchema` (+ types + `deepEqual` expected-object tests in shopping.test.ts). Shapes
  in TASK.md P2.
- P3 NEW `apps/api/src/modules/shopping/services/parse-list.ts`: `PARSE_LIST_TOOL: ToolSpec`
  (hand-written JSON `inputSchema`, NO zod-to-json-schema); pure exported `parseItemsFromTurn(turn,
  structured)` implementing the extractor's EXACT three-way logic (1→safeParse(input); 0→safeParse(
  extractJson(text)); ≥2→safeParse(undefined) fail-closed, never touches text); and `parseListText(db,
  userId, secret, allowedBaseUrls, input, observe)`. Mirror `apps/extractor/src/extract.ts:394-418`.
  Reuse `convertToBaseQuantity` from `@compass/shared` to normalize {quantity,unit}→{quantityBase,unit},
  leaving BOTH null on missing/throw. Graceful degrade when `!ai.enabled`. IMPORTANT: catch ONLY the
  parse/interpret/normalize step — let a thrown `ai.chat()` error PROPAGATE (do not catch-all).
- P4 NEW `apps/api/src/modules/shopping/routes/capture.ts`: `POST /parse-text` (relative to
  `/api/shopping`), ZodTypeProvider, Zod body/response from `@compass/shared`, `req.session!.userId`.
  Build an `AiObserver` that `recordAiEvent(app.db, userId, { kind: "shopping_parse", … })`
  fire-and-forget — copy the shape from `apps/api/src/modules/planning/routes/roadmap-narrative.ts:96-119`.
  Register in `plugin.ts`. No route `public`.
- P5 Regenerate BOTH route-snapshot fixtures (`apps/api/src/route-surface.snapshot.txt`,
  `apps/api/src/route-table.snapshot.txt`) with the SAME one-off-script-then-delete method 9.3 used
  (reuse the snapshot test's enumeration). Diff MUST be exactly `POST /parse-text` (+ NO auto-HEAD, it's
  a POST). Inspect and report the diff. Do not hand-edit.
- P6 Tests: hermetic `parse-list.test.ts` for `parseItemsFromTurn` (1 call→parsed; 0→prose extractJson;
  ≥2→fail-closed empty & prose NOT consulted; ollama structured=false→prose; garbage→null). Shared
  schema deepEqual + refine bite. Route hermetic (`capture.hermetic.test.ts`, mock.module the service as
  in `planning-analysis.hermetic.test.ts`): response shape, NO `shopping_list_items` write / `addItem`
  not called, `config.public !== true`, unauth→401, `shopping_parse` ai_event recorded. AC5 schema test:
  `AiEventKindSchema` includes `"shopping_parse"`. Any DB-gated route test runs in CI.

## Files and Symbols
- Edit: `packages/shared/src/schemas/ai-events.ts`, `apps/api/src/modules/automation/schema.ts`,
  `apps/web/src/routes/events/EventLogPage.tsx`, `packages/shared/src/schemas/shopping.ts`
  (+ shopping.test.ts), `apps/api/src/modules/shopping/plugin.ts`.
- New: `apps/api/src/modules/shopping/services/parse-list.ts` (+ parse-list.test.ts),
  `apps/api/src/modules/shopping/routes/capture.ts` (+ capture.hermetic.test.ts, and a DB-gated
  capture.route.test.ts only if practical).
- New migration file under `apps/api/drizzle/` from db:generate.
- Regenerate: the two snapshot fixtures.

## Must Not Change
- No other schema/table change; the ONLY DB change is the ai_event_kind ADD VALUE migration.
- Do NOT write to `shopping_list_items` or call `addItem` from the parse route (review-only, AC6).
- Do NOT import any AI vendor SDK anywhere (ESLint bans it outside packages/ai); use the existing
  `AiProvider.chat` path only. `.ts` import extensions, integer paise, user_id scoping.
- Do NOT mark any route `public`; add nothing to the demo allowlist.
- Do NOT commit/stage/push/touch git. Do NOT edit files outside the list above.

## Acceptance Criteria
AC1–AC7 in TASK.md. Key: free text AND recipe both parse (AC1); unparseable→empty+message, 200, no 500
(AC2); ≥2 tool calls fail closed, prose NOT consulted (AC3); ollama prose fallback works (AC4);
`shopping_parse` kind added + recorded (AC5); review-only, no list write (AC6); gates green (AC7).

## Commands (run from repo root; paste literal output + exit codes)
1. `npm run db:generate` → paste the generated migration file content; confirm it is ADD-VALUE-only.
2. `npm run typecheck` → exit 0 (this catches the web KIND_LABELS exhaustiveness — must be 0).
3. `npm run lint` → exit 0.
4. `npm run test -w packages/shared` → counts + exit.
5. `node --experimental-test-module-mocks --test apps/api/src/modules/shopping/services/parse-list.test.ts`
   and `.../routes/capture.hermetic.test.ts` → counts + exit.
6. `node --test apps/api/src/app.route-snapshot.test.ts` → pass; paste the two-fixture git diff.
7. `git status --porcelain` → report all changed/new files (do NOT stage/commit).

## Required Evidence
- Files changed + full unified diffs of each source file; the generated migration content; the fixture
  git diff; every command's literal output + counts + exit codes; the regen script text + confirmation
  it was deleted; the DB-gated test's literal local behavior. Any deviation/blocker → STOP and report.

Write the report to `/work/personal/compass/tasks/067-paste-text-capture/implementation-1.md`; reply
with a ≤20-line digest + that path. If any assumed signature (getUserAiProvider, recordAiEvent,
extractJson, ChatTurn, mock.module pattern) differs from the plan, STOP and report — do not improvise.

---

## Iteration 2 (post code-review-3 — 1 blocking + 4 test-vacuity fixes)

Apply exactly these. Do NOT change any other behaviour.

1. **BLOCKING fix — blank-name model items must not 500** (`services/parse-list.ts`): a whitespace-only
   `name` passes `z.string().min(1)` then normalizes to `rawText:""`, which violates
   `ParsedShoppingItemSchema` and would 500 on response validation. Fix in `parseListText`: after
   `modelOutput.items.map(normalizeItem)`, FILTER OUT any item whose `rawText` is empty (length 0 after
   the existing trim). If the filtered list is empty, return the graceful
   `{ available:true, items:[], rawInput, message:"Could not read any items from the text" }`. Keep the
   non-blank items. (Equivalent: skip blank-name items inside the map.) Do NOT throw.
   - Add a hermetic `parse-list.test.ts` case: a turn whose single tool call has
     `items:[{name:"   "},{name:"milk"}]` → result `items` is exactly `[{rawText:"milk",quantityBase:null,unit:null}]`
     (blank dropped, no throw); and a turn with ONLY blank names → `{ items:[], message }`.
   - Note: `parseItemsFromTurn` stays as-is (it correctly returns the raw model output); the filtering
     belongs in `parseListText`'s normalization step so the pure helper stays a faithful mirror.

2. **AC5 non-vacuous event recording** (`routes/capture.hermetic.test.ts`): the mocked `parseListText`
   currently never fires the observer, so the `recordedKinds` assertion is vacuous. Make the mock INVOKE
   the `observe` callback it is passed (simulate the provider firing it, e.g. `observe?.({ ok:true,
   request:{}, response:{}, latencyMs:1, error:null })` — match the AiCallObservation shape), then
   assert `recordedKinds` includes `"shopping_parse"`. Replace the `parseListTextCallCount > 0`-only
   assertion with a real one.

3. **AC4 ollama orchestrator path** (`services/parse-list.test.ts`, hermetic): add a test that exercises
   `parseListText` with a STUB provider whose `name === "ollama"` and `enabled === true`, whose `chat()`
   (a) captures the `tools`/`toolChoice` it was called with and (b) returns a `ChatTurn` with NO
   toolCalls but prose text containing a JSON items array. Use `mock.module` to stub
   `../../automation/services/ai-settings.ts`'s `getUserAiProvider` to return that stub. Assert: chat
   was called with `tools: []` and `toolChoice: undefined`, and the result parsed the items via the
   prose fallback. (If mock.module on getUserAiProvider is impractical, STOP and report rather than
   restructuring the service — but it is the same pattern as planning-analysis.hermetic.test.ts.)

4. **AC1 recipe prompt selection** (`services/parse-list.test.ts`): in a `parseListText` test with a
   stub provider capturing the `system` string passed to `chat()`, assert that `sourceKind:"recipe"`
   selects the recipe system prompt and `sourceKind:"freetext"` (or default) selects the freetext one.
   (Can share the stub-provider harness from fix #3.)

5. **AC6 / demo-safety real-auth 403** (`routes/capture.hermetic.test.ts` or a route test): add a test
   that registers the REAL route under the REAL auth hook with a DEMO session and asserts
   `POST /api/shopping/parse-text` returns 403 (mirror the demo-403 pattern used in
   `lists.route.test.ts` / `catalog.route.test.ts` for 9.2/9.3). If that pattern requires a DB and must
   be DB-gated, follow the exact same env-gating convention those files use and note it; if it can be
   done hermetically via the auth plugin without a DB, prefer that. Keep the existing unauth→401 and
   non-public assertions.

Commands (paste literal output + exit codes): `npm run typecheck`; `npm run lint`;
`npm run test -w packages/shared`; `node --experimental-test-module-mocks --test
apps/api/src/modules/shopping/services/parse-list.test.ts`; same for `.../routes/capture.hermetic.test.ts`;
and if you added a DB-gated demo test, note its local behavior. Do NOT commit/stage/push. Append your
report to a NEW file `tasks/067-paste-text-capture/implementation-2.md` (do not overwrite
implementation-1.md). Reply with a ≤15-line digest + that path. If a fix proves to rest on a wrong
assumption, STOP and report rather than improvising.
