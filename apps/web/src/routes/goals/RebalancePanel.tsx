import { useState } from "react";
import { compactINR } from "../../lib/viz.tsx";
import { useTaxAwareRebalancing } from "../../lib/planning-queries.ts";
import { actionLabel, driftSeverity } from "./rebalance-view.ts";

/**
 * Rebalancing and tax-cost panel. Shows drift analysis, recommended actions,
 * and tax annotations for any corpus switches. Collapsed by default.
 */
export function RebalancePanel({ goalId }: { goalId: string }) {
  const [open, setOpen] = useState(false);

  const { data: tax, isLoading } = useTaxAwareRebalancing(goalId, open);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 text-xs text-brand-600 underline"
      >
        Show rebalancing plan →
      </button>
    );
  }

  const plan = tax?.plan;
  const drift = plan?.drift;
  const severity = drift ? driftSeverity(drift) : "low";

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50/40 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">Rebalancing</span>
        <button onClick={() => setOpen(false)} className="text-xs text-slate-400 hover:text-slate-600">
          Hide
        </button>
      </div>

      {isLoading && <p className="mt-2 text-xs text-slate-400">Loading…</p>}

      {drift && (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-600">
          <span>
            Equity current{" "}
            <b className="tabular-nums text-slate-800">{compactINR(drift.equityCurrentPaise)}</b>
            {" "} → target{" "}
            <b className="tabular-nums text-slate-800">{compactINR(drift.equityTargetPaise)}</b>
          </span>
          <span>
            Debt current{" "}
            <b className="tabular-nums text-slate-800">{compactINR(drift.debtCurrentPaise)}</b>
            {" "} → target{" "}
            <b className="tabular-nums text-slate-800">{compactINR(drift.debtTargetPaise)}</b>
          </span>
          {drift.overweightLeg !== "none" && (
            <span className={`col-span-2 ${severity === "high" ? "text-amber-700" : "text-slate-500"}`}>
              {severity === "high" ? "⚠ " : ""}
              {drift.overweightLeg.charAt(0).toUpperCase() + drift.overweightLeg.slice(1)} is overweight
              by {compactINR(drift.driftPaise)}.
            </span>
          )}
        </div>
      )}

      {plan && plan.actions.length === 0 && (
        <p className="mt-2 text-[11px] text-slate-400">No rebalancing actions needed — allocation is within tolerance.</p>
      )}

      {plan && plan.actions.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-slate-600">
          {plan.actions.map((action, i) => {
            const annotation = tax?.switchAnnotations.find((a) => a.actionIndex === i);
            return (
              <li key={i}>
                <div className="flex items-baseline gap-2">
                  <span className="w-3 shrink-0 text-slate-300">·</span>
                  <span>{actionLabel(action)}</span>
                </div>
                {annotation && annotation.notRecommendedNow && (
                  <p className="ml-5 mt-0.5 text-[10px] text-amber-600">
                    ⚠ {annotation.notRecommendedReason ?? "Not recommended now due to tax impact."}
                  </p>
                )}
                {annotation && !annotation.notRecommendedNow && annotation.estimatedLtcgPaise > 0 && (
                  <p className="ml-5 mt-0.5 text-[10px] text-slate-400">
                    Est. LTCG {compactINR(annotation.estimatedLtcgPaise)}
                    {annotation.ltcgFitsInHeadroom ? " — fits within ₹1.25 L exemption" : " — may exceed exemption"}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {tax && (
        <p className="mt-2 text-[10px] text-slate-400 italic">{tax.redirectionNote}</p>
      )}
    </div>
  );
}
