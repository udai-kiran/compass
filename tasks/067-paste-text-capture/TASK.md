# Task 9.4 — Paste-text list capture

Board task: [`tasks/09.04-paste-text-capture.md`](../09.04-paste-text-capture.md) · release 2.3.0 ·
depends 9.3 (in-progress on same branch). Branch: `feat/shopping-core-capture`. Investigation:
[`investigation-1.md`](./investigation-1.md).

## Status
CODE COMPLETE & REVIEWED (integration/DB-gated demo test runs in CI, per convention).
- review-4 (code re-review): NO blocking, NO non-blocking — ready to commit. Blocking whitespace-name
  defect fully resolved (filter empty rawText after normalize, both parser paths; empty→graceful), AC2
  satisfied, all 4 previously-vacuous tests now genuine (AC5 observer-fired event, AC4 ollama
  orchestrator tools:[]/prose, AC1 recipe-vs-freetext prompt, AC6 DB-gated demo-403), no regression, all
  9 original parseItemsFromTurn assertions preserved.
- Local gates SEEN green: typecheck 0, lint 0, shared 327, parse-list 14/14, capture.hermetic 8/8,
  route-snapshot 7/7. capture.route.test.ts (demo-403) DB-gated → CI. Independent verification-1 confirmed
  migration ADD-VALUE-only, must-not-change files untouched, no SDK imports, snapshot diff exact.

## Review log (code) — do not re-read review files
- review-3 (code): 1 BLOCKING — a whitespace-only model item name (`"   "` passes `z.string().min(1)`)
  is trimmed to `rawText:""` in normalizeItem, which violates `ParsedShoppingItemSchema` (nonblank) and
  would 500 on response validation → breaks AC2. FIX (iter2): drop blank-name items during normalize;
  if none remain, return the graceful empty+message result. 4 non-blocking test-vacuity fixes (make
  AC1/AC4/AC5/AC6 non-vacuous): AC5 route-observer recording, AC4 ollama orchestrator path, AC1 recipe
  prompt selection, real-auth demo-403 for POST /parse-text. Confirmed correct by review-3: three-way
  discipline, ai.chat() error boundary, quantity pairing, review-only (no addItem/list write), migration
  ADD-VALUE-only, no SDK imports, snapshot diff exactly POST /parse-text no auto-HEAD.

Original plan APPROVED at review-2. Wording nit folded in: `parseListText` "never throws" applies to
bad-model-output / parse-normalization failures only — `ai.chat()` provider/network errors propagate (5xx).

## Review log (digested — do not re-read review files)
- review-1 (plan): 1 BLOCKING — adding `"shopping_parse"` to `AiEventKindSchema` breaks the web
  typecheck because `EventLogPage.tsx:5` has `KIND_LABELS: Record<AiEventKind, string>` (exhaustive).
  FIX: add `apps/web/src/routes/events/EventLogPage.tsx` to scope + a `shopping_parse` label (P1a).
  Non-blocking folded in: distinguish bad-model-output (→ empty items, 200, AC2) from provider/network
  outage (`ai.chat()` throw must PROPAGATE, not be swallowed) — catch only the parse/interpret path.
  Confirmed by review-1: migration IS required (`aiEvents.kind` is `pgEnum` automation/schema.ts:60/85),
  safe like the existing `0004` goal_roadmap `ALTER TYPE ADD VALUE` migration; no test hard-codes the
  kind count; three-way logic, AI-disabled degrade, AC6 review-only, quantity normalization, demo/auth
  all validated correct.

## Objective
Turn free text ("2kg atta, milk 1L, 6 eggs, dal") — or a recipe — into structured, **reviewable**
`(rawText, quantityBase, unit)` candidate rows using the EXISTING AI path, reusing the extractor's
discipline verbatim. Nothing is written to a list; the user reviews and then calls the existing 9.2
`POST /lists/:id/items`. App must remain fully functional with AI disabled.

## Root Cause
Net-new feature. One schema change only: add the `"shopping_parse"` value to the `ai_event_kind` enum
(closed enum — known trap). This requires a Drizzle-generated `ALTER TYPE … ADD VALUE` migration.

## Scope
- **Edit** `packages/shared/src/schemas/ai-events.ts` — add `"shopping_parse"` to `AiEventKindSchema`.
- **Edit** `apps/api/src/modules/automation/schema.ts` — add `"shopping_parse"` to the `aiEvents.kind`
  pgEnum (confirmed a real `pgEnum("ai_event_kind", …)` at :60/:85). Run `npm run db:generate`, review
  the emitted `ALTER TYPE "public"."ai_event_kind" ADD VALUE 'shopping_parse'` migration (must be that
  ADD-VALUE-only statement — mirrors the existing `0004` goal_roadmap migration), keep it in
  `apps/api/drizzle/`.
- **Edit** `apps/web/src/routes/events/EventLogPage.tsx` — add a `shopping_parse` entry to the
  exhaustive `KIND_LABELS: Record<AiEventKind, string>` map (mandatory — else the web typecheck fails);
  optionally add it to the (non-exhaustive) filter list for consistency. [review-1 BLOCKING]
- **Edit** `packages/shared/src/schemas/shopping.ts` — add `ParsedShoppingItemSchema`,
  `ParseListTextRequestSchema`, `ParseListTextResponseSchema` (+ types + `deepEqual` tests).
- **New** `apps/api/src/modules/shopping/services/parse-list.ts` — `PARSE_LIST_TOOL: ToolSpec`, a pure
  `parseItemsFromTurn(turn, structured)` helper (the three-way tool-call logic, hermetically testable),
  and `parseListText(db, userId, secret, allowedBaseUrls, input, observe)` that resolves the provider,
  calls `chat`, delegates to the helper, normalizes quantities via `convertToBaseQuantity`, and returns
  reviewable rows. Colocated `parse-list.test.ts` (hermetic) + any DB-gated route test.
- **New** `apps/api/src/modules/shopping/routes/capture.ts` — `POST /parse-text` (relative to
  `/api/shopping`). Register in `plugin.ts`. Not `public`.
- **Tests**: hermetic (pure parse logic: 1/0/2+ tool calls, ollama prose fallback, unparseable→empty)
  + shared schema tests + a route-config/hermetic test (mock.module the service, assert no list write,
  auth/demo config). CI-gated route test for the wired path if practical.

## Dependencies
- 9.3 (same branch) for `convertToBaseQuantity` + `DisplayUnitSchema`.
- 9.2 for the list-item write path the reviewed items eventually flow into (not called by 9.4).

## Design decisions
- **Reuse the extractor's three-way discipline VERBATIM** (extract.ts:394–418):
  `const structured = ai.name !== "ollama"`; `chat({ system, messages, tools: structured?[TOOL]:[],
  toolChoice: structured?TOOL.name:undefined, maxTokens, timeoutMs })`; then
  `const matches = turn.toolCalls.filter(c => c.name === TOOL.name)`; **1 → `safeParse(matches[0].input)`;
  0 → `safeParse(extractJson(turn.text))`; ≥2 → `safeParse(undefined)` (FAIL CLOSED, never touches
  text)**. Extract this into a pure exported `parseItemsFromTurn(turn, structured)` returning the parsed
  model object or `null`, so it is unit-testable without a provider or DB.
- **Graceful AI-disabled degrade**: `parseListText` resolves via `getUserAiProvider(db, userId, secret,
  allowedBaseUrls, observe)`. If `!ai.enabled` (NullProvider) → return
  `{ available: false, items: [], message: "AI is not configured" }` — never throw. Mirrors the
  roadmap-narrative null path.
- **Never a 500 on bad model output** (AC2): a failed `safeParse`, empty text, or ≥2 tool calls all
  yield `{ available: true, items: [], message: "Could not read any items from the text" }`. The raw
  input is echoed back in the response (`rawInput`) for client replay, and the full request/response is
  captured in the `ai_event` via the `observe` callback (the durable replay trail) — no new table.
- **Distinguish bad output from provider outage** [review-1]: the graceful-empty path catches ONLY the
  parse/interpret step (tool-call filtering + `safeParse` + normalization). A thrown error from
  `ai.chat()` itself (network/provider/timeout) must PROPAGATE to Fastify's error handler (5xx) — do
  NOT wrap the whole call in a catch-all that would hide programming defects or infra failures behind a
  fake "no items" result. "Never a 500" is a promise about MODEL OUTPUT, not about infrastructure.
- **Quantity normalization**: the tool returns per item `{ name, quantity?: decimal-string, unit?:
  DisplayUnit }`. Build each reviewable row as `rawText = name` (verbatim), and if BOTH `quantity` and
  `unit` are present, `convertToBaseQuantity(quantity, unit)` → `{ quantityBase, unit }`; if conversion
  throws (excess precision / bad unit) or either is missing, leave `quantityBase`/`unit` **null** (the
  item stays usable as raw text). Quantity/unit paired both-or-neither, matching the DB CHECK.
- **Recipe mode = same call, different prompt** (board): `ParseListTextRequestSchema.sourceKind ∈
  {"freetext","recipe"}` (default freetext) selects the system prompt; both return the same
  `ParsedShoppingItem[]`.
- **Reviewable, never auto-saved** (AC6): the route ONLY returns candidates. It performs NO insert into
  `shopping_list_items` and does not call `addItem`. Adding is the user's separate 9.2 call.
- **New `ai_events` kind `"shopping_parse"` recorded per call** (AC5): the route builds an `AiObserver`
  that calls `recordAiEvent(app.db, userId, { kind: "shopping_parse", … })` fire-and-forget, exactly
  like roadmap-narrative.ts:96–119. Add the enum value in BOTH shared + drizzle (+ migration).
- **Demo & auth**: `POST /parse-text` is a mutating method → demo sessions auto-rejected by the auth
  chokepoint (no allowlist entry, no `public`). Route is session-authenticated; unauth → 401. Ollama
  gate honored (no forced tool-calling / no vision) via the `structured` flag.
- **Ollama vision/tool caveat** honored: structured tool-calling gated on `ai.name !== "ollama"` with
  the prose `extractJson` fallback, exactly as the extractor.

## Plan
- P1: `ai-events.ts` + `automation/schema.ts` — add `"shopping_parse"`; `db:generate`; review+keep the
  `ALTER TYPE` migration. Confirm no `ai-events`/`backup` test breaks (ai_events already backup-covered).
- P1a: `apps/web/src/routes/events/EventLogPage.tsx` — add the `shopping_parse` `KIND_LABELS` entry so
  the web typecheck stays green (exhaustive `Record<AiEventKind, string>`). [review-1 BLOCKING]
- P2: `shopping.ts` shared — `ParsedShoppingItemSchema` ({ rawText 1–200 trimmed, quantityBase int≥0
  nullable, unit NormalizedUnit nullable, paired refine }), `ParseListTextRequestSchema` ({ text 1–4000
  trimmed, sourceKind enum default "freetext" }), `ParseListTextResponseSchema` ({ available: bool,
  items: ParsedShoppingItem[], rawInput: string, message: string|null }). Expected-object tests.
- P3: `services/parse-list.ts` — `PARSE_LIST_TOOL` (hand-written JSON inputSchema: items[] of {name
  required, quantity string, unit enum of display units}), pure `parseItemsFromTurn`, `parseListText`
  (provider resolve, chat, helper, convertToBaseQuantity normalize, graceful degrade). "Never throws"
  covers bad-model-output/parse-normalization ONLY; `ai.chat()` errors propagate (see Design decisions).
- P4: `routes/capture.ts` — `POST /parse-text`, ZodTypeProvider, builds the observer + records
  `shopping_parse` event; register in `plugin.ts`; not public.
- P5: Regenerate BOTH route-snapshot fixtures by the same script-and-delete method as 9.2/9.3; diff =
  exactly `POST /parse-text` (+ NO auto-HEAD, since it's a POST).
- P6: Tests — hermetic `parseItemsFromTurn`: 1 tool call → parsed; 0 → prose `extractJson`; ≥2 → fail
  closed (empty, prose NOT consulted); ollama (structured=false) → prose path; garbage → null. Shared
  schema deepEqual + refine bite. Route hermetic (mock.module the service): asserts response shape, NO
  `shopping_list_items` write, `config.public !== true`, unauth → 401, and that a `shopping_parse`
  ai_event is recorded. AC5 schema test: `AiEventKindSchema` includes `"shopping_parse"`.

## Acceptance Criteria
- AC1: Free text AND recipe text both produce structured, reviewable `ParsedShoppingItem[]` (hermetic
  test with a stub turn for each `sourceKind`).
- AC2: Unparseable model output → `{ items: [], message }`, HTTP 200, never a 500/throw.
- AC3: ≥2 matching tool calls fail closed — empty result, prose fallback NOT consulted.
- AC4: A non-tool-calling provider (ollama gate) parses via the prose `extractJson` fallback.
- AC5: `"shopping_parse"` added to `AiEventKindSchema` (+ drizzle enum + migration) and a `shopping_parse`
  ai_event is recorded per call via the observer.
- AC6: Parsed items are returned for review only — the endpoint writes nothing to `shopping_list_items`
  and does not call `addItem`.
- AC7: `npm run typecheck`, `npm run lint` exit 0; hermetic + shared tests pass; any DB-gated test runs
  in CI.

## Verification
- T1: typecheck 0, lint 0. T2: shared + `parse-list` hermetic tests pass (paste counts). T3: route
  snapshot test passes; fixture diff = exactly `POST /parse-text`. T4: `db:generate` produced exactly
  the `ALTER TYPE … ADD VALUE 'shopping_parse'` migration (inspect it); no other schema drift. T5:
  "does the test bite" for the ≥2-fail-closed and the ollama-prose paths. T6: CI (`ci-validator`)
  confirms any DB-gated suite executed.

## Non-Goals
- Photo capture (9.5), catalog auto-linking on parsed items (that is 9.3's canonicalize, called
  separately by the client after review), web UI (12.x), any staging/persistence of drafts.
- Auto-categorization or auto-adding to a list — review-first, always.
