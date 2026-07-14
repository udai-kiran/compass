import { useState } from "react";
import { Link } from "react-router";
import { formatINR, type InsightCard } from "@compass/shared";
import { Meter, Sparkline, SERIES } from "../../lib/viz.tsx";
import { useInsights } from "../../lib/insights-queries.ts";
import { useAiSummary } from "../../lib/ai-queries.ts";
import { useCapabilities } from "../../lib/settings-queries.ts";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const SENTIMENT_ACCENT: Record<InsightCard["sentiment"], string> = {
  positive: "border-l-emerald-400",
  neutral: "border-l-slate-300",
  warning: "border-l-amber-400",
};

export function InsightsPage() {
  const [period, setPeriod] = useState(currentMonth());
  const { data, isLoading } = useInsights(period);
  const isCurrent = period >= currentMonth();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Insights</h1>
          <p className="mt-0.5 text-sm text-slate-500">Deterministic observations from your ledger — no AI.</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setPeriod(shiftMonth(period, -1))} className="rounded-md border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50">←</button>
          <span className="w-24 text-center font-medium text-slate-700">{period}</span>
          <button onClick={() => setPeriod(shiftMonth(period, 1))} disabled={isCurrent} className="rounded-md border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40">→</button>
        </div>
      </header>

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}

      {data && (
        <>
          <AiSummarySection period={period} />
          <HealthCard health={data.health} />
          {data.cards.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              Not enough activity this month to surface insights yet.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {data.cards.map((c) => <Card key={c.id} c={c} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * AI month-in-review (task 7.6). Absent entirely when summaries are disabled.
 * The narrative is generated on demand; the numbers it cites come from the
 * deterministic insight computations, never model arithmetic. Dismissible.
 */
function AiSummarySection({ period }: { period: string }) {
  const { data: cap } = useCapabilities();
  const summary = useAiSummary();
  const [dismissed, setDismissed] = useState(false);

  if (!cap?.features.summaries || dismissed) return null;

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-violet-800">✨ Month in review</h2>
          <p className="mt-0.5 text-xs text-violet-500">AI-written narrative · figures come from your computed insights.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => summary.mutate({ period, refresh: !!summary.data })}
            disabled={summary.isPending}
            className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {summary.isPending ? "Writing…" : summary.data ? "Regenerate" : "Generate"}
          </button>
          <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="text-violet-400 hover:text-violet-600">✕</button>
        </div>
      </div>
      {summary.isError && (
        <p className="mt-3 text-sm text-amber-600">Couldn't generate a summary right now — your numeric insights below are unaffected.</p>
      )}
      {summary.data && (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{summary.data.narrative}</p>
      )}
    </div>
  );
}

function HealthCard({ health }: { health: NonNullable<ReturnType<typeof useInsights>["data"]>["health"] }) {
  const gradeColor =
    health.score >= 70 ? "text-emerald-600" : health.score >= 40 ? "text-amber-600" : "text-red-600";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center gap-6">
        <div className="text-center">
          <p className={`text-5xl font-bold ${gradeColor}`}>{health.score}</p>
          <p className="text-sm text-slate-500">Health score · {health.grade}</p>
        </div>
        <div className="min-w-64 flex-1 space-y-2">
          {health.components.map((comp) => (
            <div key={comp.label}>
              <div className="mb-0.5 flex justify-between text-xs text-slate-500">
                <span>{comp.label} <span className="text-slate-400">({comp.weightPct}%)</span></span>
                <span className="tabular-nums">{comp.score}</span>
              </div>
              <Meter pct={comp.score} />
              <p className="mt-0.5 text-xs text-slate-400">{comp.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Card({ c }: { c: InsightCard }) {
  const body = (
    <div className={`h-full rounded-lg border border-l-4 border-slate-200 bg-white p-4 ${SENTIMENT_ACCENT[c.sentiment]}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">{c.title}</h3>
        {c.spark.length > 1 && <Sparkline values={c.spark} color={c.sentiment === "warning" ? "#e0a100" : SERIES[0]} />}
      </div>
      <p className="mt-1 text-sm text-slate-600">{c.detail}</p>
      <div className="mt-2 flex items-baseline gap-2">
        {c.valuePaise !== null && <span className="text-lg font-semibold text-slate-800">{formatINR(c.valuePaise)}</span>}
        {c.deltaPct !== null && (
          <span className={`text-xs ${c.deltaPct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {c.deltaPct >= 0 ? "▲" : "▼"} {Math.abs(c.deltaPct)}{c.kind === "income_stability" ? " CV" : "%"}
          </span>
        )}
      </div>
    </div>
  );
  return c.link ? <Link to={c.link} className="block">{body}</Link> : body;
}
