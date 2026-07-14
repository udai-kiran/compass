import { createAnthropicProvider } from "./anthropic.ts";
import { createOllamaProvider } from "./ollama.ts";
import { NullProvider } from "./null-provider.ts";
import type { AiProvider } from "./types.ts";

export interface AiSettings {
  provider: "none" | "anthropic" | "ollama";
  anthropicApiKey?: string;
  anthropicModel?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
}

const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_OLLAMA_MODEL = "llama3.1";

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
    default:
      return NullProvider;
  }
}
