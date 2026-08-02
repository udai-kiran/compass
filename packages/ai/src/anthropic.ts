import { extractJson, postJson } from "./http.ts";
import { categorizationPrompt, summaryPrompt, SUMMARY_SYSTEM } from "./prompts.ts";
import {
  AiUnavailableError,
  assertToolChoiceValid,
  CategorySuggestionsSchema,
  type AiObserver,
  type AiProvider,
  type ChatRequest,
  type ChatTurn,
  type CategorySuggestion,
  type SuggestCategoriesInput,
  type SummaryInput,
  type ToolCall,
} from "./types.ts";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

interface AnthropicConfig {
  apiKey: string;
  model: string;
  observe?: AiObserver;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}
interface AnthropicResponse {
  content?: AnthropicContentBlock[];
}

/** Anthropic Messages API provider. Uses `fetch` directly — no vendor SDK — so
 * the "no AI SDK outside packages/ai" rule is trivially upheld. */
export function createAnthropicProvider(config: AnthropicConfig): AiProvider {
  const headers = {
    "x-api-key": config.apiKey,
    "anthropic-version": API_VERSION,
  };

  async function call(
    body: Record<string, unknown>,
    opts: { timeoutMs?: number; retries?: number } = {},
  ): Promise<AnthropicResponse> {
    return (await postJson(ENDPOINT, { model: config.model, ...body }, {
      headers,
      timeoutMs: opts.timeoutMs,
      retries: opts.retries,
      observe: config.observe,
    })) as AnthropicResponse;
  }

  function textOf(res: AnthropicResponse): string {
    return (res.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("")
      .trim();
  }

  return {
    name: "anthropic",
    enabled: true,

    async suggestCategories(input: SuggestCategoriesInput): Promise<CategorySuggestion[]> {
      if (input.transactions.length === 0) return [];
      const res = await call({
        max_tokens: 1024,
        messages: [{ role: "user", content: categorizationPrompt(input) }],
      });
      const parsed = CategorySuggestionsSchema.safeParse(extractJson(textOf(res)));
      if (!parsed.success) return []; // invalid output discarded safely
      const validIds = new Set(input.categories.map((c) => c.id));
      return parsed.data.filter(
        (s) => s.categoryId === null || validIds.has(s.categoryId),
      );
    },

    async generateSummary(input: SummaryInput): Promise<string> {
      const res = await call({
        max_tokens: 700,
        system: SUMMARY_SYSTEM,
        messages: [{ role: "user", content: summaryPrompt(input) }],
      });
      const text = textOf(res);
      if (!text) throw new AiUnavailableError("Empty summary");
      return text;
    },

    async chat(request: ChatRequest): Promise<ChatTurn> {
      assertToolChoiceValid(request);
      const res = await call(
        {
          max_tokens: request.maxTokens ?? 1024,
          system: request.system,
          tools: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema,
          })),
          messages: toAnthropicMessages(request),
          ...(request.toolChoice
            ? { tool_choice: { type: "tool", name: request.toolChoice } }
            : {}),
        },
        { timeoutMs: request.timeoutMs, retries: request.retries },
      );
      const toolCalls: ToolCall[] = (res.content ?? [])
        .filter((b) => b.type === "tool_use" && b.id && b.name)
        .map((b) => ({ id: b.id!, name: b.name!, input: b.input }));
      return { text: textOf(res), toolCalls };
    },
  };
}

function toAnthropicMessages(request: ChatRequest): unknown[] {
  const out: unknown[] = [];
  for (const m of request.messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const blocks: unknown[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
      }
      out.push({ role: "assistant", content: blocks });
    } else {
      out.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
      });
    }
  }
  return out;
}
