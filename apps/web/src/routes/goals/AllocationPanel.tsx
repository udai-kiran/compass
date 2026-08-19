import { formatINR } from "@compass/shared";
import type { Goal } from "@compass/shared";
import { useMultiGoalAllocation } from "../../lib/planning-queries.ts";

/**
 * Page-level panel showing how available monthly surplus is allocated across
 * all active goals. Covers every goal in priority order.
 */
export function AllocationPanel({ goals }: { goals: Goal[] }) {
  const { data: plan, isLoading } = useMultiGoalAllocation();

  if (goals.length === 0) return null;
  if (isLoading) return <p className="mt-4 text-xs text-slate-400">Loading allocation plan…</p>;
  if (!plan) return null;

  const goalById = new Map(goals.map((g) => [g.id, g]));

  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Monthly surplus allocation</h2>
      <p className="mt-0.5 text-xs text-slate-400">
        How available income is distributed across goals, in priority order.
      </p>

      {plan.perGoal.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">No active goals to allocate.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {plan.perGoal.map((alloc) => {
            const goal = goalById.get(alloc.goalId);
            return (
              <li key={alloc.goalId} className="flex items-center gap-3 py-2 text-xs">
                <span className="flex-1 truncate text-slate-700">
                  {goal?.name ?? alloc.goalId}
                </span>
                <span className="tabular-nums text-slate-600">
                  {formatINR(alloc.allocatedMonthlyPaise)}/mo
                </span>
                {alloc.fullyCovered ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                    ✓ covered
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                    ⚠ short
                    {alloc.slipMonths !== null ? ` ${alloc.slipMonths} mo` : ""}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex gap-6 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
        <span>
          Total allocated{" "}
          <b className="tabular-nums text-slate-700">{formatINR(plan.totalAllocatedPaise)}/mo</b>
        </span>
        {plan.freeCashPaise > 0 && (
          <span>
            Free cash{" "}
            <b className="tabular-nums text-emerald-700">{formatINR(plan.freeCashPaise)}/mo</b>
          </span>
        )}
      </div>
    </div>
  );
}
