import { formatINR } from "@compass/shared";
import { useIncomeAdequacy } from "../../lib/planning-queries.ts";
import { leverTitle, leverSummary } from "./allocation-view.ts";

/**
 * Income adequacy lever advisor. Shows whether the user's surplus covers all
 * goal SIPs, and if not, lists actionable levers. Advisory tone — never scolding.
 */
export function LeverPanel() {
  const { data, isLoading } = useIncomeAdequacy();

  if (isLoading) return null;
  if (!data) return null;

  if (!data.hasShortfall) {
    return (
      <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        ✓ Your income is sufficient to cover all goal contributions.
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Income adequacy</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Monthly shortfall: <b className="tabular-nums text-amber-700">{formatINR(data.totalShortfallPaise)}</b>.
        Here are ways to close the gap:
      </p>

      {data.levers.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">No levers available.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.levers.map((lever, i) => (
            <li key={i} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-xs font-medium text-slate-700">{leverTitle(lever)}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{leverSummary(lever)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
