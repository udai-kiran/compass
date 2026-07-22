import { extractJson, postJson } from "./http.ts";
import { categorizationPrompt, summaryPrompt, SUMMARY_SYSTEM } from "./prompts.ts";
import {
  AiUnavailableError,
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

interface OpenAiCompatConfig {
  /** provider label surfaced as {@link AiProvider.name}, e.g. "openrouter" | "deepseek" */
  name: string;
  apiKey: string;
  model: string;
  /** API root including version — e.g. https://openrouter.ai/api/v1 */
  baseUrl: string;
  observe?: AiObserver;
}

interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}
interface OpenAiMessage {
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
}
interface OpenAiResponse {
  choices?: { message?: OpenAiMessage }[];
}

/**
 * Provider for any OpenAI Chat Completions-compatible endpoint. Both OpenRouter
 * (`https://openrouter.ai/api/v1`) and DeepSeek (`https://api.deepseek.com/v1`)
 * speak this protocol, so one implementation serves both — only the base URL and
 * default model differ. Plain `fetch`, no vendor SDK, upholding the
 * "no AI SDK outside packages/ai" rule.
 */
export function createOpenAiCompatProvider(config: OpenAiCompatConfig): AiProvider {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers = { authorization: `Bearer ${config.apiKey}` };

  async function call(
    body: Record<string, unknown>,
    opts: { timeoutMs?: number; retries?: number } = {},
  ): Promise<OpenAiResponse> {
    return (await postJson(url, { model: config.model, ...body }, {
      headers,
      timeoutMs: opts.timeoutMs,
      retries: opts.retries,
      observe: config.observe,
    })) as OpenAiResponse;
  }

  function messageOf(res: OpenAiResponse): OpenAiMessage {
    return res.choices?.[0]?.message ?? {};
  }
  function textOf(res: OpenAiResponse): string {
    return (messageOf(res).content ?? "").trim();
  }

  return {
    name: config.name,
    enabled: true,

    async suggestCategories(input: SuggestCategoriesInput): Promise<CategorySuggestion[]> {
      if (input.transactions.length === 0) return [];
      const res = await call({
        max_tokens: 1024,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: `${categorizationPrompt(input)}\n\nRespond with a JSON object {"suggestions":[...]}.`,
          },
        ],
      });
      const raw = extractJson(textOf(res));
      const arr = Array.isArray(raw) ? raw : (raw as { suggestions?: unknown })?.suggestions;
      const parsed = CategorySuggestionsSchema.safeParse(arr);
      if (!parsed.success) return []; // invalid output discarded safely
      const validIds = new Set(input.categories.map((c) => c.id));
      return parsed.data.filter((s) => s.categoryId === null || validIds.has(s.categoryId));
    },

    async generateSummary(input: SummaryInput): Promise<string> {
      const res = await call({
        max_tokens: 700,
        messages: [
          { role: "system", content: SUMMARY_SYSTEM },
          { role: "user", content: summaryPrompt(input) },
        ],
      });
      const text = textOf(res);
      if (!text) throw new AiUnavailableError("Empty summary");
      return text;
    },

    async chat(request: ChatRequest): Promise<ChatTurn> {
      const res = await call(
        {
          max_tokens: request.maxTokens ?? 1024,
          messages: toOpenAiMessages(request),
          tools: request.tools.length
            ? request.tools.map((t) => ({
                type: "function",
                function: { name: t.name, description: t.description, parameters: t.inputSchema },
              }))
            : undefined,
        },
        { timeoutMs: request.timeoutMs, retries: request.retries },
      );
      const msg = messageOf(res);
      const toolCalls: ToolCall[] = (msg.tool_calls ?? [])
        .filter((c) => c.function?.name)
        .map((c, i) => ({
          id: c.id ?? `call_${Date.now()}_${i}`,
          name: c.function!.name!,
          input: safeJson(c.function!.arguments),
        }));
      return { text: (msg.content ?? "").trim(), toolCalls };
    },
  };
}

/** OpenAI tool-call arguments arrive as a JSON string; parse defensively. */
function safeJson(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function toOpenAiMessages(request: ChatRequest): unknown[] {
  const out: unknown[] = [{ role: "system", content: request.system }];
  for (const m of request.messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const msg: Record<string, unknown> = { role: "assistant", content: m.content || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
        }));
      }
      out.push(msg);
    } else {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return out;
}
