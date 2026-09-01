import { useEffect, useState } from "react";
import { type MerchantSuggestion, type SmartFillResponse } from "@compass/shared";
import { useCategories } from "../../lib/queries.ts";
import { useSmartFill } from "../../lib/ai-queries.ts";
import { CategoryPicker } from "../../components/CategoryPicker.tsx";

/**
 * History-based Smart Fill panel. Groups uncategorized transactions by merchant × direction
 * and shows one suggestion row per pair, so the panel scales to any transaction volume.
 * No AI is used — suggestions come from the user's own past categorization choices.
 *
 * Pre-checks rows with ≥ 80 % confidence; lower-confidence rows are shown but
 * unchecked so the user must explicitly select them.
 */

type Row = MerchantSuggestion & { checked: boolean; pickedCategoryId: string };

/** Composite key that uniquely identifies a merchant × direction pair. */
function rowKey(r: Pick<MerchantSuggestion, "merchant" | "direction">): string {
  return `${r.merchant}:${r.direction}`;
}

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
  /**
   * Called once per accepted merchant×direction row with the txnIds and chosen categoryId.
   * Must return a Promise so applySelected can await each call and only remove rows that
   * succeeded, keeping failed rows visible for retry.
   */
  onApplyMerchant: (txnIds: string[], categoryId: string) => Promise<void>;
}) {
  const smartFill = useSmartFill();
  const { data: categories } = useCategories();
  const [rows, setRows] = useState<Row[]>([]);
  const [appliedCount, setAppliedCount] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState(false);

  // Populate rows when the query data arrives or changes.
  useEffect(() => {
    if (smartFill.data) {
      setRows(toRows(smartFill.data.suggestions));
    }
  }, [smartFill.data]);

  const checkedRows = rows.filter((r) => r.checked);
  const checkedTxnCount = checkedRows.reduce((s, r) => s + r.txnCount, 0);

  function toggle(key: string) {
    setRows((prev) => prev.map((r) => (rowKey(r) === key ? { ...r, checked: !r.checked } : r)));
  }

  function pickCategory(key: string, id: string | null) {
    if (!id) return;
    setRows((prev) =>
      prev.map((r) =>
        rowKey(r) === key
          ? {
              ...r,
              pickedCategoryId: id,
              categoryName: categories?.find((c) => c.id === id)?.name ?? r.categoryName,
            }
          : r,
      ),
    );
  }

  async function applySelected() {
    setApplying(true);
    setApplyError(false);
    const toApply = checkedRows;
    const succeededKeys = new Set<string>();
    let succeededTxnCount = 0;

    await Promise.allSettled(
      toApply.map(async (r) => {
        try {
          await onApplyMerchant(r.txnIds, r.pickedCategoryId);
          succeededKeys.add(rowKey(r));
          succeededTxnCount += r.txnCount;
        } catch {
          // Leave the row visible so the user can retry.
        }
      }),
    );

    if (succeededKeys.size < toApply.length) setApplyError(true);
    if (succeededKeys.size > 0) {
      setAppliedCount((n) => n + succeededTxnCount);
      setRows((prev) => prev.filter((r) => !succeededKeys.has(rowKey(r))));
    }
    setApplying(false);
  }

  const result: SmartFillResponse | undefined = smartFill.data;

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
          {applyError && (
            <p className="mx-4 mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">
              Some rows failed to apply — they've been kept so you can retry.
            </p>
          )}
          {!smartFill.isPending && !smartFill.isError && rows.length === 0 && (
            <p className="p-8 text-center text-sm text-slate-500">
              {appliedCount > 0 && (result?.uncoveredCount ?? 0) > 0
                ? `Categorized ${appliedCount} transaction${appliedCount === 1 ? "" : "s"}. ${result!.uncoveredCount} merchant${result!.uncoveredCount === 1 ? "" : "s"} still need manual categorization.`
                : appliedCount > 0
                  ? `All done — categorized ${appliedCount} transaction${appliedCount === 1 ? "" : "s"}.`
                  : (result?.uncoveredCount ?? 0) > 0
                    ? `No history-matched suggestions. ${result!.uncoveredCount} merchant${result!.uncoveredCount === 1 ? "" : "s"} need manual categorization.`
                    : "Nothing to suggest — all transactions are already categorized."}
            </p>
          )}

          {rows.length > 0 && (
            <>
              {result?.capped && (
                <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-700">
                  Showing the top 200 merchants by pending transaction count — more exist.
                </p>
              )}
              {/* Column headers */}
              <div className="sticky top-0 flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                <span className="w-4 shrink-0" />
                <span className="min-w-0 flex-1">Merchant</span>
                <span className="w-8 text-right">Txns</span>
                <span className="w-40">Category</span>
                <span className="w-24 text-right">Confidence</span>
              </div>
              <ul className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const key = rowKey(r);
                  return (
                    <li
                      key={key}
                      className={`flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
                        r.checked ? "bg-white" : "bg-slate-50/60"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={r.checked}
                        onChange={() => toggle(key)}
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
                          onChange={(id) => pickCategory(key, id)}
                          emptyLabel="Pick…"
                          className="w-40 text-xs"
                        />
                      </div>
                      <div className="w-24 flex justify-end">{confBar(r.confidence)}</div>
                    </li>
                  );
                })}
              </ul>
              {(result?.uncoveredCount ?? 0) > 0 && (
                <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
                  +{result!.uncoveredCount} merchant
                  {result!.uncoveredCount === 1 ? "" : "s"} with no history — categorize
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
              onClick={() => void applySelected()}
              disabled={applying}
              className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {applying ? "Applying…" : "Apply selected"}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
