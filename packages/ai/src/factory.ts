import { createAnthropicProvider } from "./anthropic.ts";
import { createOllamaProvider } from "./ollama.ts";
import { createOpenAiCompatProvider } from "./openai-compat.ts";
import { NullProvider } from "./null-provider.ts";
import type { AiObserver, AiProvider } from "./types.ts";

/**
 * Unified provider settings. `apiKey`/`baseUrl`/`model` map 1:1 to the stored
 * per-user config; each provider reads the fields it needs. `custom` is a
 * generic OpenAI-compatible endpoint (base URL + key + model). `observe`, when
 * set, receives the exact request/response of every model round-trip.
 */
export interface AiSettings {
  provider: "none" | "anthropic" | "ollama" | "openrouter" | "deepseek" | "custom";
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  observe?: AiObserver;
}

const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_OLLAMA_MODEL = "llama3.1";
// OpenRouter routes to many models; DeepSeek is a strong, cheap default for
// extraction/categorization. DeepSeek's own API exposes it as "deepseek-chat".
const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-chat";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

/**
 * Build the provider purely from settings — swapping providers is a config
 * change, never a code change. Falls back to {@link NullProvider} whenever the
 * provider is `none` or its required fields are missing, so the app stays fully
 * functional with AI unconfigured.
 */
/**
 * The model actually sent for a provider — the stored value, or the provider's
 * default when it's blank. Mirrors the substitution in {@link createAiProvider}
 * so the AI event log records the effective model, not an empty stored field.
 */
export function effectiveModel(provider: AiSettings["provider"], model?: string): string {
  const m = (model ?? "").trim();
  switch (provider) {
    case "anthropic":
      return m || DEFAULT_ANTHROPIC_MODEL;
    case "ollama":
      return m || DEFAULT_OLLAMA_MODEL;
    case "openrouter":
      return m || DEFAULT_OPENROUTER_MODEL;
    case "deepseek":
      return m || DEFAULT_DEEPSEEK_MODEL;
    default:
      // `custom` requires an explicit model; `none` has no model.
      return m;
  }
}

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
      return createOpenAiCompatProvider({
        name: "openrouter",
        apiKey,
        model: model || DEFAULT_OPENROUTER_MODEL,
        baseUrl: OPENROUTER_BASE_URL,
        observe,
      });
    case "deepseek":
      if (!apiKey) return NullProvider;
      return createOpenAiCompatProvider({
        name: "deepseek",
        apiKey,
        model: model || DEFAULT_DEEPSEEK_MODEL,
        baseUrl: DEEPSEEK_BASE_URL,
        observe,
      });
    case "custom":
      if (!apiKey || !baseUrl || !model) return NullProvider;
      return createOpenAiCompatProvider({ name: "custom", apiKey, model, baseUrl, observe });
    default:
      return NullProvider;
  }
}
