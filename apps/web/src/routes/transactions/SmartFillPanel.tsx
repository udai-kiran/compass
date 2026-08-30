import { useEffect, useState } from "react";
import { type MerchantSuggestion, type SmartFillResponse } from "@compass/shared";
import { useCategories } from "../../lib/queries.ts";
import { useSmartFill } from "../../lib/ai-queries.ts";
import { CategoryPicker } from "../../components/CategoryPicker.tsx";

/**
 * History-based Smart Fill panel. Groups uncategorized transactions by merchant
 * and shows one suggestion row per merchant (not per transaction), so the panel
 * scales to any transaction volume. No AI is used — suggestions come from the
 * user's own past categorization choices.
 *
 * Pre-checks rows with ≥ 80 % confidence; lower-confidence rows are shown but
 * unchecked so the user must explicitly select them.
 */

type Row = MerchantSuggestion & { checked: boolean; pickedCategoryId: string };

function toRows(suggestions: MerchantSuggestion[]): Row[] {
  return suggestions.map((s) => ({
    ...s,
    checked: s.confidence >= 0.8,
    pickedCategoryId: s.categoryId,
  }));
}

export function SmartFillPanel({
  onClose,
  onApplyMerchant,
}: {
  onClose: () => void;
  /** Called once per accepted merchant row with the txnIds and chosen categoryId. */
  onApplyMerchant: (txnIds: string[], categoryId: string) => void;
}) {
  const smartFill = useSmartFill();
  const { data: categories } = useCategories();
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<SmartFillResponse | null>(null);
  const [applied, setApplied] = useState(0);

  const run = smartFill.mutate;
  useEffect(() => {
    run(undefined, {
      onSuccess: (r) => {
        setResult(r);
        setRows(toRows(r.suggestions));
      },
    });
  }, [run]);

  const checkedRows = rows.filter((r) => r.checked);
  const checkedTxnCount = checkedRows.reduce((s, r) => s + r.txnCount, 0);

  function toggle(merchant: string) {
    setRows((prev) =>
      prev.map((r) => (r.merchant === merchant ? { ...r, checked: !r.checked } : r)),
    );
  }

  function pickCategory(merchant: string, id: string | null) {
    if (!id) return;
    setRows((prev) =>
      prev.map((r) =>
        r.merchant === merchant
          ? {
              ...r,
              pickedCategoryId: id,
              categoryName: categories?.find((c) => c.id === id)?.name ?? r.categoryName,
            }
          : r,
      ),
    );
  }

  function applySelected() {
    for (const r of checkedRows) {
      onApplyMerchant(r.txnIds, r.pickedCategoryId);
    }
    setApplied((n) => n + checkedTxnCount);
    setRows((prev) => prev.filter((r) => !r.checked));
  }

  const confBar = (c: number) => {
    const pct = Math.round(c * 100);
    const color = c >= 0.8 ? "bg-emerald-400" : c >= 0.5 ? "bg-amber-400" : "bg-slate-300";
    return (
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="w-8 text-right text-xs tabular-nums text-slate-500">{pct}%</span>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">⚡ Smart Fill</h2>
            <p className="text-xs text-slate-400">
              Suggestions from your past categorizations — review before applying.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {smartFill.isPending && (
            <p className="p-8 text-center text-sm text-slate-400">
              Analyzing your transaction history…
            </p>
          )}
          {smartFill.isError && (
            <p className="p-8 text-center text-sm text-amber-600">
              Couldn't load suggestions. Try again.
            </p>
          )}
          {!smartFill.isPending && !smartFill.isError && rows.length === 0 && (
            <p className="p-8 text-center text-sm text-slate-500">
              {applied > 0
                ? `All done — categorized ${applied} transactions.`
                : result?.uncoveredCount
                  ? `No history-matched suggestions. ${result.uncoveredCount} merchant${result.uncoveredCount === 1 ? "" : "s"} need manual categorization.`
                  : "Nothing to suggest — all transactions are already categorized."}
            </p>
          )}

          {rows.length > 0 && (
            <>
              {/* Column headers */}
              <div className="sticky top-0 flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                <span className="w-4 shrink-0" />
                <span className="min-w-0 flex-1">Merchant</span>
                <span className="w-8 text-right">Txns</span>
                <span className="w-40">Category</span>
                <span className="w-24 text-right">Confidence</span>
              </div>
              <ul className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <li
                    key={r.merchant}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
                      r.checked ? "bg-white" : "bg-slate-50/60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={r.checked}
                      onChange={() => toggle(r.merchant)}
                      className="shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-800">
                      {r.merchant || "(no merchant)"}
                      {r.historyCount > 0 && (
                        <span className="ml-1.5 text-xs font-normal text-slate-400">
                          ({r.historyCount} past)
                        </span>
                      )}
                    </span>
                    <span className="w-8 text-right tabular-nums text-slate-500">{r.txnCount}</span>
                    <div className="w-40">
                      <CategoryPicker
                        categories={categories ?? []}
                        value={r.pickedCategoryId}
                        onChange={(id) => pickCategory(r.merchant, id)}
                        emptyLabel="Pick…"
                        className="w-40 text-xs"
                      />
                    </div>
                    <div className="w-24 flex justify-end">{confBar(r.confidence)}</div>
                  </li>
                ))}
              </ul>
              {result?.uncoveredCount != null && result.uncoveredCount > 0 && (
                <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
                  +{result.uncoveredCount} merchant
                  {result.uncoveredCount === 1 ? "" : "s"} with no history — categorize
                  manually or use ✨ AI Suggest.
                </p>
              )}
            </>
          )}
        </div>

        {checkedRows.length > 0 && (
          <footer className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
            <span className="text-xs text-slate-400">
              {checkedRows.length} merchant{checkedRows.length === 1 ? "" : "s"} ·{" "}
              {checkedTxnCount} transaction{checkedTxnCount === 1 ? "" : "s"}
            </span>
            <button
              onClick={applySelected}
              className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              Apply selected
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
