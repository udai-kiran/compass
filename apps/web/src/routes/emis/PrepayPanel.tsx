import { useState } from "react";
import { formatINR, type EmiSummary } from "@compass/shared";
import { useRateResetImpact, usePrepayVsInvest } from "../../lib/emi-queries.ts";
import { compactINR } from "../../lib/viz.tsx";
import {
  formatRate,
  rateResetSummary,
  recommendationLabel,
  tenureChangeLabel,
  riskLabel,
  type RecommendationKind,
} from "./prepay-view.ts";

export function PrepayPanel({ emi }: { emi: EmiSummary }) {
  const [newRate, setNewRate] = useState("");
  const [lumpSum, setLumpSum] = useState("");
  const [charges, setCharges] = useState("");

  const newRateBps = newRate ? Math.round(parseFloat(newRate) * 100) : null;
  const lumpSumPaise = lumpSum ? Math.round(parseFloat(lumpSum) * 100) : 0;
  const chargesPaise = charges ? Math.round(parseFloat(charges) * 100) : 0;

  const { data: resetImpact } = useRateResetImpact(emi.templateId, newRateBps);
  const { data: prepayResult } = usePrepayVsInvest(
    emi.templateId,
    lumpSumPaise > 0 ? { lumpSumPaise, prepaymentChargesPaise: chargesPaise } : null,
  );

  return (
    <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
      {/* Rate-reset impact */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700">Rate-reset impact</h3>
        <p className="text-xs text-slate-500">
          Current rate: {formatRate(emi.annualRateBps)}. What if it changes?
        </p>
        <div className="mt-2 flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            New rate (% p.a.)
            <input
              inputMode="decimal"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              className="input w-28"
              placeholder="9.0"
            />
          </label>
        </div>
        {resetImpact && (
          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-700">
              {rateResetSummary(
                resetImpact.currentRateBps,
                resetImpact.newRateBps,
                resetImpact.sameEmi.tenureChangedBy,
                resetImpact.sameEmi.interestDeltaPaise,
              )}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="font-medium text-slate-600">Keep EMI, change tenure</p>
                <p className="text-slate-500">
                  Tenure: {tenureChangeLabel(resetImpact.sameEmi.tenureChangedBy)}
                </p>
                <p className="text-slate-500">
                  Interest: {compactINR(resetImpact.sameEmi.totalInterestPaise)}
                  {" "}({resetImpact.sameEmi.interestDeltaPaise >= 0 ? "+" : ""}{compactINR(resetImpact.sameEmi.interestDeltaPaise)})
                </p>
              </div>
              <div>
                <p className="font-medium text-slate-600">Keep tenure, change EMI</p>
                <p className="text-slate-500">
                  New EMI: {formatINR(resetImpact.sameTenure.newInstallmentPaise)}
                  {" "}({resetImpact.sameTenure.installmentDeltaPaise >= 0 ? "+" : ""}{formatINR(resetImpact.sameTenure.installmentDeltaPaise)}/mo)
                </p>
                <p className="text-slate-500">
                  Interest: {compactINR(resetImpact.sameTenure.totalInterestPaise)}
                  {" "}({resetImpact.sameTenure.interestDeltaPaise >= 0 ? "+" : ""}{compactINR(resetImpact.sameTenure.interestDeltaPaise)})
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Prepay vs invest */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700">Prepay vs invest</h3>
        <p className="text-xs text-slate-500">
          Compare a lump-sum prepayment against investing the same amount.
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Lump sum (₹)
            <input
              inputMode="decimal"
              value={lumpSum}
              onChange={(e) => setLumpSum(e.target.value)}
              className="input w-32"
              placeholder="500000"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Prepayment charges (₹)
            <input
              inputMode="decimal"
              value={charges}
              onChange={(e) => setCharges(e.target.value)}
              className="input w-28"
              placeholder="0"
            />
          </label>
        </div>

        {prepayResult && <PrepayResult result={prepayResult} />}
      </div>
    </div>
  );
}

function PrepayResult({ result }: { result: NonNullable<ReturnType<typeof usePrepayVsInvest>["data"]> }) {
  const rec = recommendationLabel(result.recommendation as RecommendationKind);

  return (
    <div className="mt-3 space-y-3">
      {/* Recommendation banner */}
      <div className={`rounded-md border px-3 py-2 ${rec.colorClass}`}>
        <p className="text-sm font-semibold">{rec.label}</p>
        <p className="mt-0.5 text-xs">{result.recommendationReason}</p>
      </div>

      {/* Tenure reduction vs EMI reduction */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PrepayOptionCard
          title="Tenure reduction"
          subtitle="Same EMI, shorter loan"
          interestSaved={result.tenureReduction.interestSavedPaise}
          detail={
            result.tenureReduction.tenureSavedInstallments !== null
              ? `${result.tenureReduction.tenureSavedInstallments} months saved`
              : null
          }
          riskCertain
        />
        <PrepayOptionCard
          title="EMI reduction"
          subtitle="Same tenure, lower EMI"
          interestSaved={result.emiReduction.interestSavedPaise}
          detail={
            result.emiReduction.installmentReductionPaise !== null
              ? `EMI reduced by ${formatINR(result.emiReduction.installmentReductionPaise)}/mo`
              : null
          }
          riskCertain
        />
      </div>

      {/* Investment alternative */}
      <div className="rounded-md border border-slate-200 bg-white p-3">
        <p className="text-xs font-medium text-slate-600">Investment alternative</p>
        <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-slate-500">
          <p>
            Projected gain: <span className="font-medium text-slate-700">{formatINR(result.investAlternative.projectedGainPaise)}</span>
          </p>
          <p>
            Post-tax gain: <span className="font-medium text-slate-700">{formatINR(result.investAlternative.postTaxGainPaise)}</span>
          </p>
          <p>
            Assumed return: {formatRate(result.investAlternative.assumedReturnBps)}
          </p>
          <p>
            Horizon: {result.investAlternative.horizonMonths} months
          </p>
        </div>
        <p className="mt-2 text-[11px] italic text-slate-400">
          {riskLabel(false)}
        </p>
      </div>

      {/* Section 24(b) note */}
      {result.section24bApplied && (
        <p className="text-xs text-slate-500">
          Section 24(b) deduction applied — effective loan rate reduced to {formatRate(result.effectiveLoanRateBps)}.
        </p>
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

function PrepayOptionCard({
  title,
  subtitle,
  interestSaved,
  detail,
  riskCertain,
}: {
  title: string;
  subtitle: string;
  interestSaved: number;
  detail: string | null;
  riskCertain: boolean;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium text-slate-600">{title}</p>
      <p className="text-[11px] text-slate-400">{subtitle}</p>
      <p className="mt-1 text-sm font-semibold text-slate-800">
        {formatINR(interestSaved)} saved
      </p>
      {detail && <p className="text-xs text-slate-500">{detail}</p>}
      <p className="mt-1 text-[11px] italic text-slate-400">{riskLabel(riskCertain)}</p>
    </div>
  );
}
