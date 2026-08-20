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
  | { role: "user"; content: MessageContent }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxTokens?: number;
  /** override the default HTTP timeout (ms) — a big statement on a slow model needs longer */
  timeoutMs?: number;
  /** override the default retry count — fewer for a long, expensive call */
  retries?: number;
  /** Force the model to answer via exactly this named tool (which must also
   * appear in `tools`). Forces tool *selection*, not schema conformance —
   * downstream Zod validation remains required. Absent = today's free "auto"
   * choice, unchanged, used by the assistant's multi-turn loop. */
  toolChoice?: string;
}

/** Throws if `toolChoice` names a tool not present in `tools` — a programmer-facing
 * misconfiguration that must never reach the provider's HTTP endpoint. */
export function assertToolChoiceValid(request: ChatRequest): void {
  if (request.toolChoice && !request.tools.some((t) => t.name === request.toolChoice)) {
    throw new Error(`toolChoice "${request.toolChoice}" is not present in tools`);
  }
}

// ---------------------------------------------------------------------------
// Vision / image content (task 8.1)
// ---------------------------------------------------------------------------

/** Image formats every vision-capable provider in this repo accepts. */
export const SUPPORTED_IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export type AiImageMediaType = (typeof SUPPORTED_IMAGE_MEDIA_TYPES)[number];

/** Per-image ceiling on DECODED bytes. Anthropic rejects images above ~5 MB and
 * OpenAI-compatible endpoints are comparable, so one shared limit is enforced
 * locally — an oversized image never leaves the process and is never billed. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** A text part of a multi-part user message. */
export interface TextBlock {
  type: "text";
  text: string;
}

/** An image part of a multi-part user message. `data` is raw base64 with NO
 * `data:` URI prefix — each provider adds its own wire framing. */
export interface ImageBlock {
  type: "image";
  mediaType: AiImageMediaType;
  data: string;
}

export type ContentBlock = TextBlock | ImageBlock;

/** A user message is either a plain string — every pre-vision call site — or an
 * ordered list of text/image blocks. `string` stays assignable, so widening the
 * union breaks no existing caller. */
export type MessageContent = string | ContentBlock[];

/** Raised when an image payload is malformed, oversized or of an unsupported
 * media type. Thrown before any HTTP call. Deliberately NOT an
 * {@link AiUnavailableError}: this is bad input, not a provider failure, so it
 * must not be retried or reported as a transient outage. */
export class AiImageRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiImageRejectedError";
  }
}

/** Raised when images are sent to a provider with no image path (ollama). Call
 * sites gate on `ai.name !== "ollama"`, exactly as forced tool-calling does;
 * this is the fail-fast net for when they forget. */
export class AiVisionUnsupportedError extends Error {
  constructor(providerName: string) {
    super(`Provider "${providerName}" does not support image input`);
    this.name = "AiVisionUnsupportedError";
  }
}

/** Decoded byte length of a base64 string, without allocating a Buffer. */
export function base64ByteLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

/** True when any message carries at least one image block. */
export function hasImageContent(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) =>
      m.role === "user" &&
      typeof m.content !== "string" &&
      m.content.some((b) => b.type === "image"),
  );
}

/** Base64 alphabet with optional trailing padding. Deliberately FLAT: a nested
 *  quantifier like `(?:[A-Za-z0-9+/]{4})*` overflows the regex stack on a
 *  multi-megabyte image, so canonical length is checked arithmetically instead. */
const BASE64_CHARS_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** True for canonical base64: a non-empty, 4-aligned string over the base64
 *  alphabet with padding only at the end. A permissive character-class-only test
 *  accepts junk such as `"A"`, `"A="` or `"AAAA="` that decodes to nothing. */
function isCanonicalBase64(data: string): boolean {
  return data.length > 0 && data.length % 4 === 0 && BASE64_CHARS_RE.test(data);
}

/** Pre-flight validation of every image block in a request. Throws
 * {@link AiImageRejectedError} BEFORE any HTTP call, so an unsupported or
 * oversized image is rejected locally rather than by the provider. */
export function assertImagesValid(messages: ChatMessage[]): void {
  for (const m of messages) {
    if (m.role !== "user" || typeof m.content === "string") continue;
    for (const block of m.content) {
      if (block.type === "text") continue;
      // Every non-text block is serialized AS an image by the providers, so an
      // unknown `type` arriving at runtime must be rejected here rather than
      // reaching a provider with unvalidated media type and size. Widened to
      // `string` deliberately: the union says this is unreachable, but this guard
      // exists for values that never went through the type system.
      const blockType: string = block.type;
      if (blockType !== "image") {
        throw new AiImageRejectedError(`Unsupported content block type "${blockType}"`);
      }
      if (!(SUPPORTED_IMAGE_MEDIA_TYPES as readonly string[]).includes(block.mediaType)) {
        throw new AiImageRejectedError(
          `Unsupported image media type "${block.mediaType}" (allowed: ${SUPPORTED_IMAGE_MEDIA_TYPES.join(", ")})`,
        );
      }
      if (typeof block.data !== "string") {
        throw new AiImageRejectedError("Image data must be a base64 string");
      }
      if (block.data.startsWith("data:")) {
        throw new AiImageRejectedError(
          "Image data must be raw base64 without a data: URI prefix",
        );
      }
      if (!isCanonicalBase64(block.data)) {
        throw new AiImageRejectedError("Image data is not valid base64");
      }
      const bytes = base64ByteLength(block.data);
      if (bytes > MAX_IMAGE_BYTES) {
        throw new AiImageRejectedError(
          `Image is ${bytes} bytes, above the ${MAX_IMAGE_BYTES}-byte limit`,
        );
      }
    }
  }
}

/** Guard for providers with no image path. Throws before any HTTP call. */
export function assertNoImages(messages: ChatMessage[], providerName: string): void {
  if (hasImageContent(messages)) throw new AiVisionUnsupportedError(providerName);
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

/**
 * One model round-trip, observed at the HTTP boundary — the exact request body
 * sent to the provider and the raw response received. Used to build the AI event
 * log faithfully (not reconstructed from call-site inputs). Fired once per
 * `postJson` call regardless of retries; `ok` is false on an exhausted failure.
 * `response` is omitted in favour of a content-free placeholder when the REQUEST
 * carried an image, because a provider that echoes the submitted body would
 * otherwise write the image into the audit log in whatever shape it chose.
 */
export interface AiCallObservation {
  request: string;
  response: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}
/**
 * Best-effort sink for {@link AiCallObservation}. Invoked fire-and-forget from the
 * model-call path — it must never throw, and it must not be relied on to complete
 * before the call returns (the AI event log is best-effort, never a gate on a
 * model request).
 */
export type AiObserver = (obs: AiCallObservation) => void | Promise<void>;
