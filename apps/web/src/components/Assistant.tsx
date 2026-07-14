import { useRef, useState } from "react";
import { SUGGESTED_PROMPTS, type AiChatMessage } from "@compass/shared";
import { streamAssistant, type AssistantEvent } from "../lib/ai-queries.ts";
import { useCapabilities } from "../lib/settings-queries.ts";

const TOOL_LABELS: Record<string, string> = {
  get_spending_summary: "Reviewing your spending summary",
  get_budget_status: "Checking your budget status",
  get_financial_health: "Assessing your financial health",
  search_transactions: "Searching your transactions",
  list_goals: "Looking up your goals",
};

interface Turn {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
}

/** Floating AI assistant (task 7.5). Renders nothing when AI is disabled. */
export function Assistant() {
  const { data: cap } = useCapabilities();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!cap?.features.assistant) return null;

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    const history: AiChatMessage[] = [
      ...turns.map((t) => ({ role: t.role, content: t.content })),
      { role: "user" as const, content: q },
    ];
    setTurns((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "", tools: [] }]);
    setBusy(true);

    const apply = (fn: (t: Turn) => Turn) =>
      setTurns((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") next[next.length - 1] = fn(last);
        return next;
      });

    const onEvent = (e: AssistantEvent) => {
      if (e.type === "tool" && e.name) apply((t) => ({ ...t, tools: [...(t.tools ?? []), e.name!] }));
      else if (e.type === "text" && e.delta) apply((t) => ({ ...t, content: t.content + e.delta }));
      else if (e.type === "error") apply((t) => ({ ...t, content: e.message ?? "Something went wrong." }));
      queueMicrotask(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    };

    try {
      await streamAssistant(history, onEvent);
    } catch {
      apply((t) => ({ ...t, content: "The assistant is unavailable right now." }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Open AI assistant"
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-lg text-white shadow-lg hover:bg-slate-700"
      >
        ✨
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-40 flex h-[32rem] w-96 max-w-[calc(100vw-2.5rem)] flex-col rounded-xl border border-slate-200 bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <span className="text-sm font-semibold text-slate-700">✨ Assistant</span>
            <button onClick={() => setOpen(false)} aria-label="Close assistant" className="text-slate-400 hover:text-slate-600">✕</button>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {turns.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-slate-500">Ask about your finances. Try:</p>
                {SUGGESTED_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => ask(p)}
                    className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={t.role === "user" ? "text-right" : ""}>
                {t.tools && t.tools.length > 0 && (
                  <div className="mb-1 space-y-1">
                    {t.tools.map((tool, j) => (
                      <div key={j} className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                        {TOOL_LABELS[tool] ?? tool}…
                      </div>
                    ))}
                  </div>
                )}
                {(t.content || t.role === "user") && (
                  <span
                    className={`inline-block whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                      t.role === "user" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {t.content || (busy ? "…" : "")}
                  </span>
                )}
              </div>
            ))}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); void ask(input); }}
            className="flex items-center gap-2 border-t border-slate-200 p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              disabled={busy}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
