# Investigation 1 — Paste-text list capture (task 9.4)

Read-only fact-gather. No files changed.

---

## 1. AI provider + chat/tool-call path

### `createAiProvider` — `packages/ai/src/factory.ts:58`

```ts
export function createAiProvider(settings: AiSettings): AiProvider {
  const { apiKey, baseUrl, model, observe } = settings;
  switch (settings.provider) {
    case "anthropic":
      if (!apiKey) return NullProvider;
      return createAnthropicProvider({ apiKey, model: model || DEFAULT_ANTHROPIC_MODEL, observe });
    case "ollama":
      if (!baseUrl) return NullProvider;
      return createOllamaProvider({ baseUrl, model: model || DEFAULT_OLLAMA_MODEL, observe });
    case "openrouter":
      if (!apiKey) return NullProvider;
      return createOpenAiCompatProvider({ name: "openrouter", apiKey, model: ..., baseUrl: OPENROUTER_BASE_URL, observe });
    case "deepseek":
      if (!apiKey) return NullProvider;
      return createOpenAiCompatProvider({ name: "deepseek", apiKey, model: ..., baseUrl: DEEPSEEK_BASE_URL, observe });
    case "custom":
      if (!apiKey || !baseUrl || !model) return NullProvider;
      return createOpenAiCompatProvider({ name: "custom", apiKey, model, baseUrl, observe });
    default:
      return NullProvider;
  }
}
```

`AiSettings.provider` values: `"none" | "anthropic" | "ollama" | "openrouter" | "deepseek" | "custom"`.

### `AiProvider` interface — `packages/ai/src/types.ts:256`

```ts
export interface AiProvider {
  /** "none" | "anthropic" | "ollama" */
  readonly name: string;
  /** false only for the NullProvider. */
  readonly enabled: boolean;
  suggestCategories(input: SuggestCategoriesInput): Promise<CategorySuggestion[]>;
  generateSummary(input: SummaryInput): Promise<string>;
  chat(request: ChatRequest): Promise<ChatTurn>;
}
```

Actual `.name` values at runtime:
- `NullProvider` → `"none"` (`packages/ai/src/null-provider.ts:10`)
- `createAnthropicProvider` → `"anthropic"` (`packages/ai/src/anthropic.ts:68`)
- `createOllamaProvider` → `"ollama"` (`packages/ai/src/ollama.ts:46`)
- `createOpenAiCompatProvider` → takes `config.name` string (`packages/ai/src/openai-compat.ts:72`); set to `"openrouter"`, `"deepseek"`, or `"custom"` by factory.

### `ChatRequest` / `chat()` signature — `packages/ai/src/types.ts:86-99`

```ts
export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
  /** Force the model to answer via exactly this named tool (which must also
   * appear in `tools`). Forces tool *selection*, not schema conformance —
   * downstream Zod validation remains required. Absent = today's free "auto"
   * choice */
  toolChoice?: string;
}
```

Return type: `Promise<ChatTurn>` where:

```ts
export interface ChatTurn {   // packages/ai/src/types.ts:247
  text: string;
  toolCalls: ToolCall[];
}
```

### `ToolSpec` shape — `packages/ai/src/types.ts:68`

```ts
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's input object. */
  inputSchema: Record<string, unknown>;
}
```

`toolChoice` is a `string` matching the tool's `name`; checked by `assertToolChoiceValid` (`types.ts:104`).

### `AiObserver` type — `packages/ai/src/types.ts:288`

```ts
export type AiObserver = (obs: AiCallObservation) => void | Promise<void>;
```

Passed as `observe` in `AiSettings`; wired in `AiSettings` interface (`factory.ts:18`).

---

## 2. Extractor's use of the chat/tool-call path

All in `apps/extractor/src/extract.ts`.

### `RECORD_TXNS_TOOL` definition — `extract.ts:115`

```ts
const RECORD_TXNS_TOOL: ToolSpec = {
  name: "record_transactions",
  description: "Record the email's classification and every transaction it contains.",
  inputSchema: {
    type: "object",
    properties: {
      classification: { type: "string", enum: ["transaction_alert","card_statement","bill","otp","promo","other"] },
      transactions: { type: "array", items: txnItemSchema() },
    },
    required: ["classification", "transactions"],
  },
};
```

### `ai.name !== "ollama"` gate — `extract.ts:394`

```ts
const structured = ai.name !== "ollama";
const turn = await ai.chat({
  system: EXTRACT_SYSTEM,
  messages: [{ role: "user", content: userPrompt(email, categories, identity) }],
  tools: structured ? [RECORD_TXNS_TOOL] : [],
  toolChoice: structured ? RECORD_TXNS_TOOL.name : undefined,
  maxTokens: 2048,
  timeoutMs: 90_000,
});
```

### "Filter tool calls by exact name" — `extract.ts:410`

```ts
const matches = turn.toolCalls.filter((c) => c.name === RECORD_TXNS_TOOL.name);
```

### "Fail closed on 2+ matching tool calls" + `extractJson` fallback — `extract.ts:411-418`

```ts
let parsed: ReturnType<typeof ModelResultSchema.safeParse>;
if (matches.length === 1) {
  parsed = ModelResultSchema.safeParse(matches[0]!.input);
} else if (matches.length === 0) {
  parsed = ModelResultSchema.safeParse(extractJson(turn.text));
} else {
  parsed = ModelResultSchema.safeParse(undefined); // 2+ matches: fail closed, never touches turn.text
}
```

The same three-way pattern repeats verbatim for `RECORD_STATEMENT_TXNS_TOOL` (`extract.ts:527-534`) and `RECORD_STATEMENT_SUMMARY_TOOL` (`extract.ts:661-668`).

`extractJson` is exported from `packages/ai/src/http.ts:353` and re-exported via `packages/ai/src/index.ts:4`:

```ts
/** Pull the first fenced or bare JSON value out of a model's text response.
 * Returns `undefined` when nothing parseable is found (caller discards). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.search(/[[{]/);
  if (start === -1) return undefined;
  ...
}
```

---

## 3. `ai_events` kinds enum — `packages/shared/src/schemas/ai-events.ts`

### Full closed enum — `ai-events.ts:4`

```ts
export const AiEventKindSchema = z.enum([
  "email_extract",
  "statement_parse",
  "statement_summary",
  "categorize",
  "summary",
  "assistant",
  "goal_roadmap",
]);
export type AiEventKind = z.infer<typeof AiEventKindSchema>;
```

A new kind for paste-text capture (e.g. `"shopping_parse"`) must be added to this enum. Because it is a closed `z.enum`, adding a value is a one-line schema edit here plus updating the Drizzle enum in `apps/api/src/modules/automation/schema.ts` (the `aiEvents` table's `kind` column).

### `AiEventSummarySchema` — `ai-events.ts:19`

```ts
export const AiEventSummarySchema = z.object({
  id: z.uuid(),
  kind: AiEventKindSchema,
  status: AiEventStatusSchema,
  provider: z.string(),
  model: z.string(),
  title: z.string(),
  ingestionId: z.uuid().nullable(),
  accountId: z.uuid().nullable(),
  latencyMs: z.number().int().nullable(),
  createdAt: z.string(),
});
```

### Recording function — `apps/api/src/modules/automation/services/events.ts:34`

```ts
export async function recordAiEvent(
  db: DbOrTx,
  userId: string,
  input: RecordAiEventInput,
): Promise<void>
```

Where `RecordAiEventInput` (`events.ts:15`) contains `kind: AiEventKind`. Called fire-and-forget inside an `AiObserver` callback — see the `roadmap-narrative.ts` pattern below.

---

## 4. AI settings / per-user provider resolution

### `getUserAiProvider` — `apps/api/src/modules/automation/services/ai-settings.ts:78`

```ts
export async function getUserAiProvider(
  db: Db,
  userId: string,
  secret: string,
  allowedBaseUrls: string,
  observe?: AiObserver,
): Promise<AiProvider>
```

Implementation:
- Reads `ai_settings` row for `userId`.
- If no row or `row.provider === "none"` → returns `NullProvider`.
- Decrypts `row.apiKeyEnc` with `decryptSecret(row.apiKeyEnc, secret)`.
- Calls `createAiProvider({ provider: row.provider, apiKey, baseUrl: row.baseUrl, model: row.model, observe })`.

The `secret` is `mailboxSecret(app.config)` (same secret used by ingest/mailboxes); `allowedBaseUrls` is `app.config.AI_ALLOWED_BASE_URLS`. Both are available on `app.config`.

The `ai_settings` table stores: `provider`, `baseUrl`, `model`, `apiKeyEnc` (encrypted). Possible `provider` values (from schema): `"none" | "anthropic" | "ollama" | "openrouter" | "deepseek" | "custom"`.

---

## 5. Existing AI-backed route as template

### `apps/api/src/modules/planning/routes/roadmap-narrative.ts`

Full structure (lines 96-119):

```ts
// 1. Resolve settings (read model — no decrypt, no provider yet).
const meta = await getAiSettings(app.db, userId);
const model = effectiveModel(meta.provider, meta.model);

// 2. Build observer that records ai_event fire-and-forget.
const observe: AiObserver = (obs) =>
  recordAiEvent(app.db, userId, {
    kind: "goal_roadmap",          // ← new routes add a new kind here
    status: obs.ok ? "ok" : "error",
    provider: meta.provider,
    model,
    title: goal.name,
    requestContext: obs.request,
    responseRaw: obs.response,
    latencyMs: obs.latencyMs,
    error: obs.error ?? null,
  });

// 3. Call service which calls getUserAiProvider internally.
return generateRoadmapNarrative(
  app.db, userId,
  mailboxSecret(app.config),
  app.config.AI_ALLOWED_BASE_URLS,
  input,
  observe,
);
```

Guard when AI is disabled: `generateRoadmapNarrative` internally calls `getUserAiProvider`; if it returns `NullProvider` (`enabled === false`) the service returns `null` and the route returns `200 null` (the response schema is `.nullable()`). The pattern: check `ai.enabled` in the service; return a "not available" result rather than throwing.

---

## 6. Shopping list item write path (task 9.2)

### `addItem` signature — `apps/api/src/modules/shopping/services/lists.ts:155`

```ts
export async function addItem(
  db: Db,
  userId: string,
  listId: string,
  input: CreateShoppingListItem,
): Promise<ShoppingListWithItems>
```

Runs in a DB transaction; acquires a `SELECT … FOR UPDATE` lock on the list row, computes `nextPosition = MAX(position)+1`, inserts, bumps `updatedAt`, returns the full list+items.

### `CreateShoppingListItemSchema` — `packages/shared/src/schemas/shopping.ts:196`

```ts
export const CreateShoppingListItemSchema = z.object({
  /** Verbatim user text, 1–200 characters, trimmed non-empty. */
  rawText: z.string().min(1).max(200).trim().refine(...),
  /** Optional link to a catalog item the user owns. */
  catalogItemId: z.uuid().nullable().default(null),
  /** Quantity in base units (g / ml / piece). Must be paired with unit. */
  quantityBase: quantityField().nullable().default(null),
  /** Unit for the quantity. Must be paired with quantityBase. */
  unit: NormalizedUnitSchema.nullable().default(null),
}).refine(
  (v) => (v.quantityBase === null) === (v.unit === null),
  { message: "quantityBase and unit must both be set or both be null" },
);
```

`NormalizedUnitSchema = z.enum(["g", "ml", "piece"])` (`shopping.ts:32`).

Route: `POST /api/shopping/lists/:id/items` (`apps/api/src/modules/shopping/routes/lists.ts:116-126`).

---

## 7. Where 9.4's output goes — review pattern

### `extracted_transactions` (the email pipeline's review staging table)

Defined at `apps/api/src/modules/ingest/schema.ts:155`. It is a **persistent staging table**: the extractor writes rows there; the reviewer accepts them one-by-one into the ledger. It exists because the email pipeline is async (BullMQ worker) — results must outlive the HTTP request.

**For task 9.4 (paste-text capture) the situation is different**: the AI call is synchronous within the HTTP request cycle (user posts text, waits for parsed items, reviews, then decides to add). There is **no existing "review/staging" table for shopping items** in the current schema, and no evidence of one planned in the shopping module files inspected.

The natural model for 9.4 is therefore **return-in-response**: the route returns the parsed `(rawText, quantityBase, unit)[]` rows in the HTTP response body; the client displays them for user review; the user then calls `POST /api/shopping/lists/:id/items` (one call per accepted item) to add each one. This mirrors the planning analysis route pattern (`planning-analysis.hermetic.test.ts` — not read, but referenced) and avoids a new table/migration.

No staging table is needed unless the coordinator decides to persist draft rows for async review. That decision is not yet made.

---

## Files inspected (no changes made)

- `packages/ai/src/types.ts`
- `packages/ai/src/factory.ts`
- `packages/ai/src/http.ts` (lines 1-50, 350-377)
- `packages/ai/src/null-provider.ts` (grep)
- `packages/ai/src/anthropic.ts` (grep)
- `packages/ai/src/ollama.ts` (grep)
- `packages/ai/src/openai-compat.ts` (grep)
- `packages/ai/src/index.ts` (grep)
- `apps/extractor/src/extract.ts`
- `packages/shared/src/schemas/ai-events.ts`
- `apps/api/src/modules/automation/services/ai-settings.ts`
- `apps/api/src/modules/automation/services/events.ts`
- `apps/api/src/modules/planning/routes/roadmap-narrative.ts`
- `apps/api/src/modules/shopping/services/lists.ts`
- `apps/api/src/modules/shopping/routes/lists.ts`
- `packages/shared/src/schemas/shopping.ts`
- `apps/api/src/modules/ingest/schema.ts` (lines 150-214, grep)
