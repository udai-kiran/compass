import { formatINR } from "@compass/shared";
import { useAdequacy } from "../../lib/protection-queries.ts";
import { PageLoading } from "../../components/States.tsx";

export function AdequacyPanel() {
  const { data, isLoading, isError } = useAdequacy();
  if (isLoading) return <PageLoading />;
  if (isError || !data) return null; // silently degrade — the page still works
  const { termLife, health, suggestions } = data;

  return (
    <section className="mb-6">
      <h2 className="mb-3 text-lg font-semibold text-slate-800">Coverage adequacy</h2>

      {/* Term Life */}
      <div className="card mb-4 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-slate-700">Term life</h3>
          <span className={`badge text-xs ${
            termLife.verdict === "adequate" ? "bg-emerald-100 text-emerald-700" :
            termLife.verdict === "underinsured" ? "bg-amber-100 text-amber-700" :
            "bg-slate-100 text-slate-600"
          }`}>
            {termLife.verdict === "adequate" ? "Adequate" :
             termLife.verdict === "underinsured" ? "Gap identified" :
             "Insufficient data"}
          </span>
        </div>

        {termLife.verdict === "insufficient_data" ? (
          <p className="text-sm text-slate-500">
            Income data is needed to assess term-life adequacy. Record at least 3 months of income transactions.
          </p>
        ) : (
          <>
            {termLife.gapPaise > 0 && (
              <p className="mb-3 text-2xl font-semibold text-amber-700 tabular-nums">
                {formatINR(termLife.gapPaise)} <span className="text-sm font-normal text-slate-500">gap</span>
              </p>
            )}
            {termLife.gapPaise === 0 && (
              <p className="mb-3 text-sm text-emerald-600">
                Your existing cover meets the estimated need. No additional term life cover is required.
              </p>
            )}

            {/* Workings */}
            <details className="text-sm text-slate-600">
              <summary className="cursor-pointer font-medium text-slate-700 hover:text-slate-900">
                How this is calculated
              </summary>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  <tr className="border-b border-slate-100"><td className="py-1">Annual income</td><td className="py-1 text-right tabular-nums">{termLife.annualIncomePaise != null ? formatINR(termLife.annualIncomePaise) : "—"}</td></tr>
                  <tr className="border-b border-slate-100"><td className="py-1">× {termLife.assumptions.incomeReplacementYears} years</td><td className="py-1 text-right tabular-nums">{formatINR(termLife.incomeReplacementNeedPaise)}</td></tr>
                  <tr className="border-b border-slate-100"><td className="py-1">+ Outstanding liabilities</td><td className="py-1 text-right tabular-nums">{formatINR(termLife.outstandingLiabilitiesPaise)}</td></tr>
                  <tr className="border-b border-slate-100"><td className="py-1">− Liquid assets</td><td className="py-1 text-right tabular-nums">{formatINR(termLife.liquidAssetsPaise)}</td></tr>
                  <tr className="border-b border-slate-200 font-medium"><td className="py-1">= Total need</td><td className="py-1 text-right tabular-nums">{formatINR(termLife.totalNeedPaise)}</td></tr>
                  <tr className="border-b border-slate-100"><td className="py-1">− Existing personal cover</td><td className="py-1 text-right tabular-nums">{formatINR(termLife.existingCoverPaise)}</td></tr>
                  {termLife.employerCoverPaise > 0 && (
                    <tr className="border-b border-slate-100"><td className="py-1">− Employer cover <span className="text-xs text-amber-600">(ends with job)</span></td><td className="py-1 text-right tabular-nums">{formatINR(termLife.employerCoverPaise)}</td></tr>
                  )}
                  <tr className="font-semibold"><td className="py-1">= Gap</td><td className="py-1 text-right tabular-nums">{formatINR(termLife.gapPaise)}</td></tr>
                </tbody>
              </table>

              {termLife.dependents.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-slate-500 mb-1">Dependents considered</p>
                  <ul className="text-xs text-slate-500 space-y-0.5">
                    {termLife.dependents.map((d) => (
                      <li key={d.id}>
                        {d.name} ({d.relationship}{d.age != null ? `, age ${d.age}` : ""}
                        {d.dependencyYearsRemaining != null ? `, ~${d.dependencyYearsRemaining}y dependency` : ""})
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="mt-2 text-xs text-slate-400">
                Assumption: {termLife.assumptions.incomeReplacementYears} years income replacement. This is an estimate, not financial advice.
              </p>
            </details>
          </>
        )}
      </div>

      {/* Health */}
      <div className="card mb-4 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-slate-700">Health</h3>
          <span className={`badge text-xs ${
            health.verdict === "adequate" ? "bg-emerald-100 text-emerald-700" :
            health.verdict === "review_needed" ? "bg-amber-100 text-amber-700" :
            "bg-slate-100 text-slate-600"
          }`}>
            {health.verdict === "adequate" ? "Adequate" :
             health.verdict === "review_needed" ? "Review needed" :
             "Insufficient data"}
          </span>
        </div>

        {health.verdict === "insufficient_data" ? (
          <p className="text-sm text-slate-500">No health insurance policies found. Add a health policy to assess adequacy.</p>
        ) : (
          <>
            {/* Usable cover more prominent than headline */}
            <div className="mb-3 flex gap-6">
              <div>
                <p className="text-xs text-slate-500">Usable cover</p>
                <p className="text-xl font-semibold text-slate-800 tabular-nums">{formatINR(health.usableCoverPaise)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Headline sum insured</p>
                <p className="text-base text-slate-500 tabular-nums">{formatINR(health.totalCoverPaise)}</p>
              </div>
            </div>

            {health.employerOnlyCoverPaise > 0 && (
              <p className="mb-2 text-sm text-amber-600">
                ⚠ {formatINR(health.employerOnlyCoverPaise)} of cover is employer-provided — it ends with the job.
              </p>
            )}

            {health.gaps.length > 0 && (
              <ul className="mb-3 space-y-1">
                {health.gaps.map((g) => (
                  <li key={g.type} className="text-sm text-slate-600">• {g.description}</li>
                ))}
              </ul>
            )}

            <details className="text-sm text-slate-600">
              <summary className="cursor-pointer font-medium text-slate-700 hover:text-slate-900">Inflation projection</summary>
              <p className="mt-1 text-xs text-slate-500">
                At {(health.assumptions.medicalInflationBps / 100).toFixed(0)}% medical inflation over {health.assumptions.healthProjectionYears} years,
                today&apos;s {formatINR(health.totalCoverPaise)} cover buys what {formatINR(health.projectedCoverPaise)} buys today.
              </p>
            </details>
          </>
        )}
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-medium text-slate-700 mb-2">Suggestions</h3>
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li key={s.coverType} className="text-sm text-slate-600">
                <span className="font-medium text-slate-700">{s.coverType}</span>
                {s.suggestedAmountPaise > 0 && <span className="text-slate-500"> — {formatINR(s.suggestedAmountPaise)}</span>}
                <p className="text-xs text-slate-500 mt-0.5">{s.rationale}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
