import { useState } from "react";
import { formatINR } from "@compass/shared";
import { useCashflow, useForecast } from "../../lib/goal-queries.ts";
import { Columns, compactINR, LineChart, SERIES, StatTile } from "../../lib/viz.tsx";

const MONTH_OPTIONS = [6, 12, 24] as const;

export function CashFlowPage() {
  const [months, setMonths] = useState<number>(12);
  const { data: rows } = useCashflow(months);
  const { data: forecast } = useForecast();

  const totalNet = rows?.reduce((s, r) => s + r.netPaise, 0) ?? 0;
  const avgNet = rows && rows.length > 0 ? Math.round(totalNet / rows.length) : 0;
  const positiveMonths = rows?.filter((r) => r.netPaise >= 0).length ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Cash Flow</h1>
        <div className="flex items-center gap-2 text-sm">
          {MONTH_OPTIONS.map((m) => (
            <button
              key={m}
              onClick={() => setMonths(m)}
              className={`rounded-md px-2.5 py-1 ${months === m ? "bg-slate-800 text-white" : "border border-slate-300 text-slate-600"}`}
            >
              {m}mo
            </button>
          ))}
          <a
            href={`/api/cashflow/export.csv?months=${months}`}
            download
            className="ml-2 rounded-md border border-slate-300 px-3 py-1 text-slate-600 hover:bg-slate-50"
          >
            Export CSV
          </a>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label={`Net over ${months} months`}
          value={compactINR(totalNet)}
          sub={totalNet >= 0 ? "saved" : "overspent"}
        />
        <StatTile label="Average monthly net" value={compactINR(avgNet)} />
        <StatTile
          label="Cash-flow-positive months"
          value={`${positiveMonths} / ${rows?.length ?? 0}`}
        />
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Money in vs money out</h2>
        <div className="mt-3">
          {rows && (
            <Columns
              groups={rows.map((r) => ({
                label: r.month,
                values: [r.incomePaise, r.expensePaise],
              }))}
              names={["Income", "Spending"]}
              colors={[SERIES[1], SERIES[0]]}
            />
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Monthly detail</h2>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-1 font-normal">Month</th>
                <th className="py-1 text-right font-normal">In</th>
                <th className="py-1 text-right font-normal">Out</th>
                <th className="py-1 text-right font-normal">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows?.map((r) => (
                <tr key={r.month}>
                  <td className="py-1.5 text-slate-600">{r.month}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-700">
                    {formatINR(r.incomePaise)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-slate-700">
                    {formatINR(r.expensePaise)}
                  </td>
                  <td
                    className={`py-1.5 text-right tabular-nums font-medium ${r.netPaise < 0 ? "text-red-700" : "text-slate-800"}`}
                  >
                    {formatINR(r.netPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SeasonalSection />

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">90-day forecast</h2>
        {forecast && (
          <>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <StatTile label="Cash today" value={compactINR(forecast.startBalancePaise)} />
              <StatTile
                label="Average monthly burn"
                value={compactINR(forecast.avgMonthlyBurnPaise)}
                sub={forecast.avgMonthlyBurnPaise <= 0 ? "cash-flow positive" : undefined}
              />
              <StatTile
                label="Runway"
                value={forecast.runwayMonths === null ? "∞" : `${forecast.runwayMonths} mo`}
                sub={forecast.runwayMonths === null ? "income covers spending" : "at current burn"}
              />
            </div>
            <div className="mt-4">
              <LineChart
                labels={forecast.days.map((d) => d.date)}
                series={[
                  {
                    name: "Projected balance",
                    color: SERIES[4],
                    values: forecast.days.map((d) => d.balancePaise),
                  },
                ]}
                height={200}
              />
            </div>
            <UpcomingObligations days={forecast.days} />
          </>
        )}
      </section>
    </div>
  );
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Same month across years — recurring annual spikes (insurance, fees) stand out. */
function SeasonalSection() {
  const { data: rows } = useCashflow(36);
  if (!rows) return null;

  const years = [...new Set(rows.map((r) => r.month.slice(0, 4)))].sort();
  if (years.length < 2) return null; // seasonality needs at least two years

  const shownYears = years.slice(-3);
  const byKey = new Map(rows.map((r) => [r.month, r.expensePaise]));
  const groups = MONTH_NAMES.map((name, mi) => ({
    label: name,
    values: shownYears.map((y) => byKey.get(`${y}-${String(mi + 1).padStart(2, "0")}`) ?? 0),
  }));

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Seasonal spending</h2>
      <p className="mt-0.5 text-xs text-slate-400">
        Same month compared across years — annual payments show as repeating spikes.
      </p>
      <div className="mt-3">
        <Columns groups={groups} names={shownYears} colors={shownYears.map((_, i) => SERIES[i]!)} />
      </div>
    </section>
  );
}

function UpcomingObligations({
  days,
}: {
  days: Array<{ date: string; obligations: Array<{ merchant: string; amountPaise: number }> }>;
}) {
  const upcoming = days
    .flatMap((d) => d.obligations.map((o) => ({ ...o, date: d.date })))
    .filter((o) => o.amountPaise < 0)
    .slice(0, 8);
  if (upcoming.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold text-slate-500">Scheduled payments in this window</h3>
      <ul className="mt-1 divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
        {upcoming.map((o, i) => (
          <li key={`${o.date}-${o.merchant}-${i}`} className="flex items-center gap-3 px-3 py-1.5">
            <span className="text-slate-500">{o.date}</span>
            <span className="flex-1 truncate text-slate-700">{o.merchant}</span>
            <span className="tabular-nums text-slate-700">{formatINR(o.amountPaise)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
