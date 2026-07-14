import { z } from "zod";

/** Raised when an AI method is invoked while `AI_PROVIDER=none`. Callers should
 * translate this to a 404 so the feature reads as "not available". */
export class AiDisabledError extends Error {
  constructor(message = "AI features are disabled") {
    super(message);
    this.name = "AiDisabledError";
  }
}

/** Raised when a configured provider is unreachable or misbehaves. Callers
 * degrade to non-AI behavior with a UI notice — never an error page. */
export class AiUnavailableError extends Error {
  constructor(message = "AI provider is temporarily unavailable") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// Categorization (task 7.3)
// ---------------------------------------------------------------------------

export interface CategoryOption {
  id: string;
  name: string;
  kind: "expense" | "income";
}

export interface UncategorizedTxn {
  id: string;
  merchant: string;
  description: string;
  /** signed minor units; negative = outflow */
  amountPaise: number;
}

export interface SuggestCategoriesInput {
  categories: CategoryOption[];
  transactions: UncategorizedTxn[];
}

/** Model output for one transaction. `categoryId` must be one of the supplied
 * options or null (no confident match). Validated before use. */
export const CategorySuggestionSchema = z.object({
  transactionId: z.string(),
  categoryId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export const CategorySuggestionsSchema = z.array(CategorySuggestionSchema);
export type CategorySuggestion = z.infer<typeof CategorySuggestionSchema>;

// ---------------------------------------------------------------------------
// Monthly summary (task 7.6) — AI narrates numbers computed deterministically
// ---------------------------------------------------------------------------

export interface SummaryInput {
  period: string; // e.g. "2026-06"
  /** Pre-computed facts the model must narrate verbatim, never re-derive. */
  facts: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// Chat / tool loop (task 7.4)
// ---------------------------------------------------------------------------

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's input object. */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxTokens?: number;
}

/** One assistant turn: free text plus any tool calls the model wants run. */
export interface ChatTurn {
  text: string;
  toolCalls: ToolCall[];
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface AiProvider {
  /** "none" | "anthropic" | "ollama" */
  readonly name: string;
  /** false only for the NullProvider. */
  readonly enabled: boolean;
  suggestCategories(input: SuggestCategoriesInput): Promise<CategorySuggestion[]>;
  generateSummary(input: SummaryInput): Promise<string>;
  chat(request: ChatRequest): Promise<ChatTurn>;
}
