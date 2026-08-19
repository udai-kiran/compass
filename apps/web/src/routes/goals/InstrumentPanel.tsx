import { useState } from "react";
import { useInstrumentGuidance } from "../../lib/planning-queries.ts";
import { tierLabel, tierBadgeClass } from "./instrument-view.ts";

/**
 * Instrument guidance panel — suggests equity and debt instrument categories
 * suited to this goal's horizon. Collapsed by default. Never names a fund or AMC.
 */
export function InstrumentPanel({ goalId }: { goalId: string }) {
  const [open, setOpen] = useState(false);
  const [leg, setLeg] = useState<"equity" | "debt">("equity");

  const { data: guidance, isLoading } = useInstrumentGuidance(goalId, leg, undefined, open);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 text-xs text-brand-600 underline"
      >
        Show instrument guidance →
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50/40 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">Instrument guidance</span>
        <button onClick={() => setOpen(false)} className="text-xs text-slate-400 hover:text-slate-600">
          Hide
        </button>
      </div>

      <div className="mt-2 flex gap-2">
        {(["equity", "debt"] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLeg(l)}
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
              leg === l
                ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {l === "equity" ? "Equity" : "Debt"}
          </button>
        ))}
      </div>

      {isLoading && <p className="mt-2 text-xs text-slate-400">Loading…</p>}

      {guidance && guidance.suggestions.length === 0 && (
        <p className="mt-2 text-xs text-slate-400">No instrument categories available.</p>
      )}

      {guidance && guidance.suggestions.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-100">
          {guidance.suggestions.map((s) => (
            <li key={s.category} className="py-2">
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tierBadgeClass(s.tier)}`}
                >
                  {tierLabel(s.tier)}
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-slate-700">{s.label}</p>
                  <p className="text-[11px] text-slate-500">{s.rationale}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
                    <span>Tax: {s.taxSummary}</span>
                    <span>Liquidity: {s.liquiditySummary}</span>
                    {s.lockInSummary && <span className="text-amber-600">Lock-in: {s.lockInSummary}</span>}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
