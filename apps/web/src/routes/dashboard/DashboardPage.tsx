import { Link, useNavigate } from "react-router";
import { formatDisplayDate, formatINR, formatPeriodKey } from "@compass/shared";
import { useCategories } from "../../lib/queries.ts";
import { useDashboard, useTrends } from "../../lib/budget-queries.ts";
import { useForecast } from "../../lib/goal-queries.ts";
import { Donut, LineChart, Meter, SERIES, StatTile, compactINR } from "../../lib/viz.tsx";

export function DashboardPage() {
  const { data, isLoading } = useDashboard();
  const { data: trends } = useTrends(12);
  const { data: forecast } = useForecast();
  const { data: categories } = useCategories();
  const navigate = useNavigate();

  if (isLoading || !data) {
    return <p className="p-8 text-center text-sm text-slate-400">Loading dashboard…</p>;
  }

  const catName = (id: string | null) =>
    id === null ? "Uncategorized" : (categories?.find((c) => c.id === id)?.name ?? "…");
  const months = trends?.months ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-4 text-2xl font-semibold text-slate-800">Dashboard</h1>

      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Cash available" value={formatINR(data.cashAvailablePaise)} to="/transactions" />
        <StatTile
          label="Runway"
          value={
            forecast
              ? forecast.runwayMonths === null
                ? "∞"
                : `${forecast.runwayMonths} mo`
              : "…"
          }
          sub={forecast?.runwayMonths === null ? "income covers spending" : "at current burn"}
          to="/cash-flow"
        />
        <StatTile
          label={`Income · ${formatPeriodKey(data.month.periodKey)}`}
          value={formatINR(data.month.incomePaise)}
          to="/transactions"
        />
        <StatTile
          label={`Spending · ${formatPeriodKey(data.month.periodKey)}`}
          value={formatINR(data.month.expensePaise)}
          sub={
            data.month.incomePaise > 0
              ? `${Math.round((data.month.expensePaise / data.month.incomePaise) * 100)}% of income`
              : undefined
          }
          to="/transactions"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Budget summary */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Budgets this month</h2>
            <Link to="/budgets" className="text-xs text-slate-500 underline">All budgets</Link>
          </div>
          {data.budget.lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              No budget yet — <Link to="/budgets" className="underline">set one up</Link>.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-slate-500">
                {formatINR(data.budget.totalSpentPaise)} spent of {formatINR(data.budget.totalBudgetedPaise)}
              </p>
              <ul className="mt-3 space-y-2.5">
                {data.budget.lines.map((l) => {
                  const avail = l.budgetedPaise + l.carryPaise;
                  const pct = avail > 0 ? (l.spentPaise / avail) * 100 : 0;
                  return (
                    <li key={l.categoryId}>
                      <div className="mb-0.5 flex items-baseline justify-between text-xs">
                        <span className="text-slate-600">{catName(l.categoryId)}</span>
                        <span className="tabular-nums text-slate-500">
                          {compactINR(l.spentPaise)} / {compactINR(avail)}
                        </span>
                      </div>
                      <Meter pct={pct} />
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        {/* Category donut */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Spending by category</h2>
            <Link to="/trends" className="text-xs text-slate-500 underline">Trends</Link>
          </div>
          <div className="mt-3">
            <Donut
              slices={data.byCategory.map((c) => ({
                key: c.categoryId ?? "none",
                label: catName(c.categoryId),
                value: c.spentPaise,
              }))}
            />
          </div>
        </section>
      </div>

      {/* Trend */}
      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Income vs spending · 12 months</h2>
          <Link to="/trends" className="text-xs text-slate-500 underline">Full trends</Link>
        </div>
        {months.length > 0 && (
          <div className="mt-2">
            <LineChart
              labels={months.map((m) => m.month)}
              series={[
                { name: "Spending", color: SERIES[0], values: months.map((m) => m.expensePaise) },
                { name: "Income", color: SERIES[1], values: months.map((m) => m.incomePaise) },
              ]}
              onPointClick={(i) => {
                const m = months[i];
                if (m) void navigate(`/trends?month=${m.month}`);
              }}
            />
          </div>
        )}
      </section>

      {/* Recent transactions */}
      <section className="mt-4 rounded-lg border border-slate-200 bg-white">
        <div className="flex items-baseline justify-between px-4 pt-3">
          <h2 className="text-sm font-semibold text-slate-700">Recent transactions</h2>
          <Link to="/transactions" className="text-xs text-slate-500 underline">All transactions</Link>
        </div>
        <ul className="mt-2 divide-y divide-slate-50">
          {data.recent.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="w-20 text-slate-400">{formatDisplayDate(t.date)}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
                {t.merchant || "(no merchant)"}
              </span>
              <span className="hidden text-xs text-slate-400 sm:block">{catName(t.categoryId)}</span>
              <span className={`tabular-nums ${t.amountPaise < 0 ? "text-slate-800" : "text-emerald-600"}`}>
                {formatINR(t.amountPaise)}
              </span>
            </li>
          ))}
          {data.recent.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-slate-400">No transactions yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
