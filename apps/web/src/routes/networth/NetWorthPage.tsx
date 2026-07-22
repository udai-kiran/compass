import { formatINR, type GoalGroup } from "@compass/shared";
import { LineChart, SERIES, StatTile } from "../../lib/viz.tsx";
import { toast } from "../../lib/toast.tsx";
import {
  useNetWorth,
  useNetWorthByGoal,
  useNetWorthBackfill,
} from "../../lib/wealth-queries.ts";

export function NetWorthPage() {
  const { data: nw, isLoading } = useNetWorth();
  const backfill = useNetWorthBackfill();

  if (isLoading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (!nw) return null;

  const b = nw.current.breakdown;
  const components = [
    { label: "Cash & bank", value: b.cashPaise },
    { label: "Investment accounts", value: b.investmentAccountsPaise },
    { label: "Holdings", value: b.holdingsPaise },
    { label: "Credit cards", value: b.creditCardsPaise },
    { label: "Loans", value: b.loansPaise },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Net Worth</h1>
          <p className="mt-0.5 text-sm text-slate-500">Assets minus liabilities, tracked over time.</p>
        </div>
        <button
          onClick={() =>
            backfill.mutate(12, { onSuccess: () => toast("Backfilled 12 months of history", "success") })
          }
          disabled={backfill.isPending}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          {backfill.isPending ? "Estimating…" : "Estimate last 12 months"}
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Net worth" value={formatINR(nw.current.netPaise)} />
        <StatTile label="Assets" value={formatINR(nw.current.assetsPaise)} />
        <StatTile label="Liabilities" value={formatINR(nw.current.liabilitiesPaise)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">History</h2>
          {nw.history.length > 1 ? (
            <LineChart
              labels={nw.history.map((p) => p.date)}
              series={[
                { name: "Net worth", color: SERIES[0]!, values: nw.history.map((p) => p.netPaise) },
                { name: "Assets", color: SERIES[1]!, values: nw.history.map((p) => p.assetsPaise) },
              ]}
            />
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">
              Not enough history yet — a snapshot is taken nightly, or estimate the last 12 months above.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Breakdown</h2>
          <ul className="space-y-2 text-sm">
            {components.map((c) => (
              <li key={c.label} className="flex items-center justify-between">
                <span className="text-slate-600">{c.label}</span>
                <span className={`tabular-nums font-medium ${c.value < 0 ? "text-red-600" : "text-slate-800"}`}>
                  {formatINR(c.value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <ByGoalSection />

      {nw.forecast.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            6-month projection <span className="font-normal text-slate-400">(linear trend)</span>
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            {nw.forecast.map((f) => (
              <div key={f.date} className="rounded-md bg-slate-50 p-2 text-center">
                <p className="text-xs text-slate-500">{f.date.slice(0, 7)}</p>
                <p className="mt-0.5 text-sm font-medium text-slate-800">{formatINR(f.netPaise)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ByGoalSection() {
  const { data, isLoading } = useNetWorthByGoal();

  if (isLoading || !data) return null;
  // A zero-value holding is usually a fully redeemed MF folio. Keep zero-balance
  // accounts visible (they can still be useful containers), but do not clutter
  // the goal breakdown with closed/empty folios.
  const groups = data.groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.kind !== "holding" || item.valuePaise !== 0),
  }));

  const anyItems = groups.some((g) => g.items.length > 0);
  if (!anyItems) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-700">By goal</h2>
        <span className="text-xs text-slate-400">Assets earmarked to each goal</span>
      </div>
      <div className="divide-y divide-slate-100">
        {groups.map((group) => (
          <GoalGroupBlock key={group.goalId ?? group.goalName} group={group} />
        ))}
      </div>
    </div>
  );
}

function GoalGroupBlock({ group }: { group: GoalGroup }) {
  const pct =
    group.targetPaise && group.targetPaise > 0
      ? Math.min(100, Math.round((group.netPaise / group.targetPaise) * 100))
      : null;

  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="text-sm font-medium text-slate-800">{group.goalName}</span>
          {group.targetPaise != null && (
            <span className="ml-2 text-xs text-slate-400">of {formatINR(group.targetPaise)} target</span>
          )}
        </div>
        <span className={`tabular-nums text-sm font-semibold ${group.netPaise < 0 ? "text-red-600" : "text-slate-800"}`}>
          {formatINR(group.netPaise)}
        </span>
      </div>

      {pct !== null && (
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(0, pct)}%` }} />
        </div>
      )}

      {group.items.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">Nothing tagged here yet.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {group.items.map((it) => (
            <li key={`${it.kind}-${it.id}`} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-slate-600">
                {it.name} <span className="text-xs text-slate-400">· {it.subtitle}</span>
              </span>
              <span className={`w-28 shrink-0 text-right tabular-nums ${it.valuePaise < 0 ? "text-red-600" : "text-slate-700"}`}>
                {formatINR(it.valuePaise)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
