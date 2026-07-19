import { useEffect, useState } from "react";
import type { AiProviderName } from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import { useAiSettings, useAiSettingsMutation } from "../../lib/ai-queries.ts";

const PROVIDERS: { value: AiProviderName; label: string }[] = [
  { value: "none", label: "Disabled" },
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "ollama", label: "Ollama (local)" },
  { value: "custom", label: "Custom (OpenAI-compatible)" },
];

const KEYED = new Set<AiProviderName>(["anthropic", "openrouter", "deepseek", "custom"]);
const NEEDS_URL = new Set<AiProviderName>(["ollama", "custom"]);

const MODEL_HINT: Partial<Record<AiProviderName, string>> = {
  anthropic: "claude-haiku-4-5-20251001",
  deepseek: "deepseek-chat",
  openrouter: "deepseek/deepseek-chat",
  ollama: "llama3.1",
  custom: "e.g. gpt-4o-mini",
};

const input = "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";

export function AiPanel() {
  const { data: settings } = useAiSettings();
  const save = useAiSettingsMutation();

  const [provider, setProvider] = useState<AiProviderName>("none");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");

  // Seed the form once settings load (and after a save returns fresh values).
  useEffect(() => {
    if (!settings) return;
    setProvider(settings.provider);
    setBaseUrl(settings.baseUrl);
    setModel(settings.model);
    setApiKey("");
  }, [settings]);

  const hasStoredKey = settings?.hasApiKey ?? false;
  const showKey = KEYED.has(provider);
  const showUrl = NEEDS_URL.has(provider);
  const showModel = provider !== "none";

  function submit() {
    save.mutate(
      {
        provider,
        baseUrl,
        model,
        apiKey: apiKey === "" ? undefined : apiKey,
      },
      {
        onSuccess: () => toast("AI settings saved", "success"),
        onError: (e) => toast(e instanceof Error ? e.message : "Couldn't save AI settings"),
      },
    );
  }

  return (
    <div className="mt-4 max-w-lg">
      <p className="text-sm text-slate-500">
        Bring your own AI provider for categorization, the assistant, monthly summaries, and email
        extraction. The key is stored encrypted and never shown again.
      </p>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
        <label className="block text-sm font-medium text-slate-700">
          Provider
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as AiProviderName)}
            className={input}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        {showUrl && (
          <label className="mt-3 block text-sm font-medium text-slate-700">
            {provider === "ollama" ? "Ollama base URL" : "API endpoint (base URL)"}
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={
                provider === "ollama" ? "http://localhost:11434" : "https://api.example.com/v1"
              }
              className={input}
            />
          </label>
        )}

        {showKey && (
          <label className="mt-3 block text-sm font-medium text-slate-700">
            API key
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                hasStoredKey ? "•••••••• on file — leave blank to keep" : "Paste your API key"
              }
              className={input}
            />
          </label>
        )}

        {showModel && (
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Model {provider === "custom" && <span className="text-red-500">*</span>}
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={MODEL_HINT[provider] ?? ""}
              className={input}
            />
            {provider !== "custom" && (
              <span className="mt-1 block text-xs text-slate-400">
                Leave blank to use the provider default ({MODEL_HINT[provider]}).
              </span>
            )}
          </label>
        )}

        <button
          onClick={submit}
          disabled={save.isPending}
          className="mt-4 rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
        <span className="ml-3 text-xs text-slate-400">
          {provider === "none"
            ? "AI features are off."
            : hasStoredKey || !KEYED.has(provider)
              ? "Configured."
              : "Add a key to enable AI."}
        </span>
      </div>
    </div>
  );
}
