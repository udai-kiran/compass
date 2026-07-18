import { createAnthropicProvider } from "./anthropic.ts";
import { createOllamaProvider } from "./ollama.ts";
import { createOpenAiCompatProvider } from "./openai-compat.ts";
import { NullProvider } from "./null-provider.ts";
import type { AiProvider } from "./types.ts";

export interface AiSettings {
  provider: "none" | "anthropic" | "ollama" | "openrouter" | "deepseek";
  anthropicApiKey?: string;
  anthropicModel?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
  deepseekApiKey?: string;
  deepseekModel?: string;
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
 * Build the provider purely from settings — swapping providers requires only an
 * env change, never a code change (task 7.2). Falls back to {@link NullProvider}
 * so the app stays fully functional with `AI_PROVIDER=none`.
 */
export function createAiProvider(settings: AiSettings): AiProvider {
  switch (settings.provider) {
    case "anthropic":
      if (!settings.anthropicApiKey) return NullProvider;
      return createAnthropicProvider({
        apiKey: settings.anthropicApiKey,
        model: settings.anthropicModel || DEFAULT_ANTHROPIC_MODEL,
      });
    case "ollama":
      if (!settings.ollamaBaseUrl) return NullProvider;
      return createOllamaProvider({
        baseUrl: settings.ollamaBaseUrl,
        model: settings.ollamaModel || DEFAULT_OLLAMA_MODEL,
      });
    case "openrouter":
      if (!settings.openrouterApiKey) return NullProvider;
      return createOpenAiCompatProvider({
        name: "openrouter",
        apiKey: settings.openrouterApiKey,
        model: settings.openrouterModel || DEFAULT_OPENROUTER_MODEL,
        baseUrl: OPENROUTER_BASE_URL,
      });
    case "deepseek":
      if (!settings.deepseekApiKey) return NullProvider;
      return createOpenAiCompatProvider({
        name: "deepseek",
        apiKey: settings.deepseekApiKey,
        model: settings.deepseekModel || DEFAULT_DEEPSEEK_MODEL,
        baseUrl: DEEPSEEK_BASE_URL,
      });
    default:
      return NullProvider;
  }
}
