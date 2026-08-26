import { useState } from "react";
import { formatINR, type WindfallAllocationResult } from "@compass/shared";
import { useWindfallAllocation } from "../../lib/planning-queries.ts";
import { compactINR } from "../../lib/viz.tsx";

export function WindfallPanel() {
  const [amount, setAmount] = useState("");
  const [taxable, setTaxable] = useState(false);

  const windfallPaise = amount ? Math.round(parseFloat(amount) * 100) : null;
  const { data, isLoading } = useWindfallAllocation(windfallPaise, taxable);

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Windfall allocator</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Got a bonus, gift, or lump sum? See how to allocate it across your goals and debt.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Windfall amount (₹)
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input w-36"
            placeholder="500000"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={taxable}
            onChange={(e) => setTaxable(e.target.checked)}
            className="rounded border-slate-300"
          />
          Taxable (e.g. bonus)
        </label>
      </div>

      {isLoading && windfallPaise && windfallPaise > 0 && (
        <p className="mt-3 text-xs text-slate-400">Calculating allocation…</p>
      )}

      {data && <WindfallResult result={data} />}
    </div>
  );
}

function WindfallResult({ result }: { result: WindfallAllocationResult }) {
  const recStyle = recommendationStyle(result.recommendation);

  return (
    <div className="mt-3 space-y-3">
      {/* Recommendation banner */}
      <div className={`rounded-md border px-3 py-2 ${recStyle}`}>
        <p className="text-sm font-semibold">{result.recommendationSummary}</p>
      </div>

      {/* Emergency fund top-up */}
      {result.emergencyFundTopUp && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-medium text-amber-700">
            Emergency fund: {formatINR(result.emergencyFundTopUp.allocatedPaise)}
          </p>
          <p className="text-[11px] text-amber-600">{result.emergencyFundTopUp.reason}</p>
        </div>
      )}

      {/* High-interest debt payoff */}
      {result.highInterestDebtPayoff && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-xs font-medium text-red-700">
            Revolving debt: {formatINR(result.highInterestDebtPayoff.allocatedPaise)} allocated
          </p>
          <p className="text-[11px] text-red-600">
            Total revolving debt: {formatINR(result.highInterestDebtPayoff.totalRevolvingPaise)}
          </p>
        </div>
      )}

      {/* Goal allocations with months pulled forward */}
      {result.goalAllocations.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-600">Goal allocations</p>
          <div className="mt-1 space-y-1">
            {result.goalAllocations.map((g) => (
              <div key={g.goalId} className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                <div>
                  <p className="font-medium text-slate-700">{g.goalName}</p>
                  <p className="text-slate-500">{g.reason}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-slate-800">{compactINR(g.allocatedPaise)}</p>
                  {g.monthsPulledForward !== null && g.monthsPulledForward > 0 && (
                    <p className="text-emerald-600">{g.monthsPulledForward} months closer</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Debt prepay options */}
      {result.debtPrepayOptions.length > 0 && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer font-medium text-slate-600">
            Loan prepayment options
          </summary>
          <div className="mt-1 space-y-1">
            {result.debtPrepayOptions.map((d) => (
              <div key={d.emiTemplateId} className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                <div>
                  <p className="font-medium text-slate-700">{d.emiName}</p>
                  <p className="text-slate-400">
                    {(d.annualRateBps / 100).toFixed(2)}% · {formatINR(d.outstandingPaise)} outstanding
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-slate-800">{compactINR(d.interestSavedPaise)} saved</p>
                  <p className="text-slate-500">{d.tenureSavedInstallments} months shorter</p>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Unallocated */}
      {result.unallocatedPaise > 0 && (
        <p className="text-xs text-slate-400">
          Unallocated: {formatINR(result.unallocatedPaise)}
        </p>
      )}

      {/* Tax note */}
      {result.taxNote && (
        <p className="text-xs italic text-amber-600">{result.taxNote}</p>
      )}

      {/* Assumptions */}
      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer font-medium">Assumptions</summary>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          {result.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function recommendationStyle(rec: string): string {
  switch (rec) {
    case "emergency_fund_first":
      return "text-amber-700 bg-amber-50 border-amber-200";
    case "clear_revolving_debt":
      return "text-red-700 bg-red-50 border-red-200";
    case "no_goals":
      return "text-slate-600 bg-slate-50 border-slate-200";
    default:
      return "text-emerald-700 bg-emerald-50 border-emerald-200";
  }
}
