import { useState } from "react";
import { compactINR } from "../../lib/viz.tsx";
import { useCapabilities } from "../../lib/settings-queries.ts";
import { useGlidePath, useRoadmapNarrative } from "../../lib/planning-queries.ts";
import { formatGlideStep, hasAllocationShift } from "./roadmap-view.ts";

/**
 * Goal roadmap timeline panel. Shows glide-path steps and an optional
 * AI-generated narrative when the user has AI enabled.
 * Collapsed by default to avoid overwhelming the card.
 */
export function RoadmapPanel({ goalId }: { goalId: string }) {
  const [open, setOpen] = useState(false);
  const { data: capabilities } = useCapabilities();
  const aiEnabled = capabilities?.aiEnabled ?? false;

  const { data: steps, isLoading, isError } = useGlidePath(goalId, open);
  const { data: narrative, isLoading: narrativeLoading } = useRoadmapNarrative(
    goalId,
    open && aiEnabled,
  );

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 text-xs text-brand-600 underline"
      >
        Show glide path →
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50/40 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">Glide path</span>
        <button onClick={() => setOpen(false)} className="text-xs text-slate-400 hover:text-slate-600">
          Hide
        </button>
      </div>

      {isLoading && <p className="mt-2 text-xs text-slate-400">Loading…</p>}
      {isError && <p className="mt-2 text-xs text-red-500">Could not load glide path.</p>}

      {steps && steps.length === 0 && (
        <p className="mt-2 text-xs text-slate-400">
          No glide path — set a target date to generate a phased allocation schedule.
        </p>
      )}

      {steps && steps.length > 0 && (
        <>
          {hasAllocationShift(steps) && (
            <p className="mt-1 text-[11px] text-slate-400">
              Allocation shifts as the goal approaches — de-risking over time.
            </p>
          )}
          <ul className="mt-2 space-y-1 text-[11px] text-slate-600">
            {steps.map((step, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span className="w-3 shrink-0 text-slate-300">·</span>
                <span>{formatGlideStep(step)}</span>
                {step.requiredMonthlyPaise !== null && step.requiredMonthlyPaise > 0 && (
                  <span className="ml-auto shrink-0 tabular-nums text-slate-500">
                    {compactINR(step.requiredMonthlyPaise)}/mo needed
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {aiEnabled && (
        <div className="mt-3 border-t border-slate-200 pt-2">
          <p className="text-[11px] font-medium text-slate-400">AI roadmap narrative</p>
          {narrativeLoading ? (
            <p className="mt-1 text-[11px] text-slate-400">Generating…</p>
          ) : narrative ? (
            <p className="mt-1 text-[11px] leading-relaxed text-slate-600 whitespace-pre-line">
              {narrative.narrative}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-slate-400">AI is not available right now.</p>
          )}
        </div>
      )}
    </div>
  );
}
