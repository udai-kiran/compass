import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { formatINR } from "@compass/shared";
import { useCategories } from "../../lib/queries.ts";
import { useTrends } from "../../lib/budget-queries.ts";
import { Donut, LineChart, SERIES, compactINR } from "../../lib/viz.tsx";

export function TrendsPage() {
  const [months, setMonths] = useState(12);
  const [params, setParams] = useSearchParams();
  const { data } = useTrends(months);
  const { data: categories } = useCategories();
  const selectedMonth = params.get("month");
  const selectedCat = params.get("categoryId");

  const catName = (id: string | null) =>
    id === null ? "Uncategorized" : (categories?.find((c) => c.id === id)?.name ?? "…");

  const list = data?.months ?? [];
  const monthDetail = useMemo(
    () => (selectedMonth ? list.find((m) => m.month === selectedMonth) : undefined),
    [list, selectedMonth],
  );

  function setParam(k: string, v: string | null) {
    const next = new URLSearchParams(params);
    if (v === null) next.delete(k);
    else next.set(k, v);
    setParams(next, { replace: true });
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Spending trends</h1>
        <select
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value={6}>6 months</option>
          <option value={12}>12 months</option>
          <option value={24}>24 months</option>
        </select>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">
          {selectedCat ? `${catName(selectedCat)} spend` : "Income vs spending"}
          {selectedCat && (
            <button className="ml-2 text-xs font-normal text-slate-400 underline" onClick={() => setParam("categoryId", null)}>
              back to overview
            </button>
          )}
        </h2>
        {list.length > 0 && (
          <div className="mt-2">
            <LineChart
              labels={list.map((m) => m.month)}
              series={
                selectedCat
                  ? [
                      {
                        name: catName(selectedCat),
                        color: SERIES[0],
                        values: list.map(
                          (m) => m.byCategory.find((c) => c.categoryId === selectedCat)?.spentPaise ?? 0,
                        ),
                      },
                    ]
                  : [
                      { name: "Spending", color: SERIES[0], values: list.map((m) => m.expensePaise) },
                      { name: "Income", color: SERIES[1], values: list.map((m) => m.incomePaise) },
                    ]
              }
              onPointClick={(i) => {
                const m = list[i];
                if (m) setParam("month", m.month);
              }}
            />
            <p className="mt-1 text-xs text-slate-400">Click a month to drill into its categories.</p>
          </div>
        )}
      </section>

      {monthDetail && (
        <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              {monthDetail.month} — {formatINR(monthDetail.expensePaise)} spent
            </h2>
            <button className="text-xs text-slate-400 underline" onClick={() => setParam("month", null)}>close</button>
          </div>
          <div className="mt-3">
            <Donut
              slices={monthDetail.byCategory.map((c) => ({
                key: c.categoryId ?? "none",
                label: catName(c.categoryId),
                value: c.spentPaise,
              }))}
            />
          </div>
          <ul className="mt-3 divide-y divide-slate-50 text-sm">
            {monthDetail.byCategory.slice(0, 12).map((c) => (
              <li key={c.categoryId ?? "none"} className="flex items-center justify-between py-1.5">
                <button
                  className="text-slate-600 underline-offset-2 hover:underline"
                  onClick={() => c.categoryId && setParam("categoryId", c.categoryId)}
                >
                  {catName(c.categoryId)}
                </button>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums text-slate-500">{compactINR(c.spentPaise)}</span>
                  <Link
                    to={`/transactions?categoryId=${c.categoryId ?? ""}&from=${monthDetail.month}-01&to=${monthDetail.month}-31`}
                    className="text-xs text-slate-400 underline"
                  >
                    transactions
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
