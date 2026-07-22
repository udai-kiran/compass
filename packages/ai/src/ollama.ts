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

interface OllamaConfig {
  baseUrl: string;
  model: string;
  observe?: AiObserver;
}

interface OllamaMessage {
  role: string;
  content?: string;
  tool_calls?: { function?: { name?: string; arguments?: unknown } }[];
}
interface OllamaResponse {
  message?: OllamaMessage;
}

/** Local Ollama provider (`/api/chat`). No SDK — plain fetch. */
export function createOllamaProvider(config: OllamaConfig): AiProvider {
  const url = `${config.baseUrl.replace(/\/$/, "")}/api/chat`;

  async function call(body: Record<string, unknown>): Promise<OllamaResponse> {
    return (await postJson(
      url,
      { model: config.model, stream: false, ...body },
      { timeoutMs: 60_000, observe: config.observe },
    )) as OllamaResponse;
  }

  return {
    name: "ollama",
    enabled: true,

    async suggestCategories(input: SuggestCategoriesInput): Promise<CategorySuggestion[]> {
      if (input.transactions.length === 0) return [];
      const res = await call({
        format: "json",
        messages: [
          { role: "user", content: `${categorizationPrompt(input)}\n\nRespond with {"suggestions":[...]}.` },
        ],
      });
      const raw = extractJson(res.message?.content ?? "");
      const arr = Array.isArray(raw)
        ? raw
        : (raw as { suggestions?: unknown })?.suggestions;
      const parsed = CategorySuggestionsSchema.safeParse(arr);
      if (!parsed.success) return [];
      const validIds = new Set(input.categories.map((c) => c.id));
      return parsed.data.filter((s) => s.categoryId === null || validIds.has(s.categoryId));
    },

    async generateSummary(input: SummaryInput): Promise<string> {
      const res = await call({
        messages: [
          { role: "system", content: SUMMARY_SYSTEM },
          { role: "user", content: summaryPrompt(input) },
        ],
      });
      const text = (res.message?.content ?? "").trim();
      if (!text) throw new AiUnavailableError("Empty summary");
      return text;
    },

    async chat(request: ChatRequest): Promise<ChatTurn> {
      const res = await call({
        messages: toOllamaMessages(request),
        tools: request.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        })),
      });
      const msg = res.message;
      const toolCalls: ToolCall[] = (msg?.tool_calls ?? [])
        .filter((c) => c.function?.name)
        .map((c, i) => ({
          id: `ollama_${Date.now()}_${i}`,
          name: c.function!.name!,
          input: c.function!.arguments ?? {},
        }));
      return { text: (msg?.content ?? "").trim(), toolCalls };
    },
  };
}

function toOllamaMessages(request: ChatRequest): unknown[] {
  const out: unknown[] = [{ role: "system", content: request.system }];
  for (const m of request.messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant")
      out.push({
        role: "assistant",
        content: m.content,
        tool_calls: (m.toolCalls ?? []).map((tc) => ({
          function: { name: tc.name, arguments: tc.input },
        })),
      });
    else out.push({ role: "tool", content: m.content });
  }
  return out;
}
