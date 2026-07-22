import { useEffect, useState } from "react";
import { formatINR, type AiCategorySuggestion } from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import { useAiCategorize } from "../../lib/ai-queries.ts";

/**
 * AI categorization review (task 7.3). Fetches suggestions for uncategorized
 * transactions and lets the user accept per-row or all at once. Nothing is
 * applied without confirmation, and only uncategorized rows are ever touched —
 * manual categories are never overwritten.
 */
export function AiCategorizePanel({
  onClose,
  onApply,
}: {
  onClose: () => void;
  onApply: (transactionId: string, categoryId: string) => void;
}) {
  const categorize = useAiCategorize();
  const [pending, setPending] = useState<AiCategorySuggestion[]>([]);
  const [applied, setApplied] = useState(0);

  // Kick off the request once when the panel opens.
  const run = categorize.mutate;
  useEffect(() => {
    run(undefined, { onSuccess: (r) => setPending(r.suggestions) });
  }, [run]);

  function accept(s: AiCategorySuggestion) {
    if (!s.categoryId) return;
    onApply(s.transactionId, s.categoryId);
    setPending((prev) => prev.filter((p) => p.transactionId !== s.transactionId));
    setApplied((n) => n + 1);
  }

  function acceptAll() {
    for (const s of pending) if (s.categoryId) onApply(s.transactionId, s.categoryId);
    toast(`Applied ${pending.length} categories`, "success");
    setApplied((n) => n + pending.length);
    setPending([]);
  }

  const confColor = (c: number) =>
    c >= 0.8 ? "text-emerald-600" : c >= 0.5 ? "text-amber-600" : "text-slate-400";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">✨ Suggested categories</h2>
            <p className="text-xs text-slate-400">Review before applying — your manual categories are never changed.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">✕</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {categorize.isPending && <p className="p-8 text-center text-sm text-slate-400">Analyzing uncategorized transactions…</p>}
          {categorize.isError && (
            <p className="p-8 text-center text-sm text-amber-600">
              Couldn't get suggestions right now. You can still categorize manually.
            </p>
          )}
          {!categorize.isPending && !categorize.isError && pending.length === 0 && (
            <p className="p-8 text-center text-sm text-slate-500">
              {applied > 0 ? `All done — applied ${applied} categories.` : "Nothing to suggest — no uncategorized transactions."}
            </p>
          )}
          <ul className="divide-y divide-slate-100">
            {pending.map((s) => (
              <li key={s.transactionId} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-700">{s.merchant || "(no merchant)"}</p>
                  <p className="text-xs text-slate-400">{formatINR(s.amountPaise)}</p>
                </div>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{s.categoryName}</span>
                <span className={`w-10 text-right text-xs tabular-nums ${confColor(s.confidence)}`}>{Math.round(s.confidence * 100)}%</span>
                <button onClick={() => accept(s)} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">Accept</button>
              </li>
            ))}
          </ul>
        </div>

        {pending.length > 0 && (
          <footer className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
            <span className="text-xs text-slate-400">{pending.length} suggestion{pending.length === 1 ? "" : "s"}</span>
            <button onClick={acceptAll} className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
              Accept all
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
