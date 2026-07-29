import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatINR, ReportSchema, todayInIST, type Report, type ReportPeriod } from "@compass/shared";
import { apiGet } from "../../lib/api.ts";
import { DateField } from "../../components/DateField.tsx";
import { compareCategories, compareMerchants } from "./report-comparison.ts";
import { previousSelection, reportQueryString, selectionError, type ReportSelection } from "./report-query.ts";

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function useReport(queryString: string, enabled = true) {
  return useQuery({
    queryKey: ["report", queryString],
    queryFn: () => apiGet(`/api/reports?${queryString}`, ReportSchema),
    enabled,
  });
}

export function ReportsPage() {
  const [period, setPeriod] = useState<ReportPeriod>("monthly");
  const [monthKey, setMonthKey] = useState(currentMonth());
  const [yearKey, setYearKey] = useState(currentMonth().slice(0, 4));
  const [customFrom, setCustomFrom] = useState(`${todayInIST().slice(0, 7)}-01`);
  const [customTo, setCustomTo] = useState(todayInIST());
  const [compare, setCompare] = useState(true);

  const selection: ReportSelection =
    period === "custom"
      ? { period: "custom", from: customFrom, to: customTo }
      : period === "annual"
        ? { period: "annual", key: yearKey }
        : { period: "monthly", key: monthKey };
  const selectionProblem = selectionError(selection);
  const selectionIsValid = selectionProblem === null;
  const queryString = reportQueryString(selection);
  const prevSelection = selectionIsValid ? previousSelection(selection) : null;
  const prevQueryString = prevSelection ? reportQueryString(prevSelection) : "";

  const { data: report, isLoading, isError } = useReport(queryString, selectionIsValid);
  const {
    data: prior,
    isLoading: isPriorLoading,
    isError: isPriorError,
  } = useReport(prevQueryString, compare && !!prevSelection);
  const comparing = compare && !!prior;
  const noun = period === "custom" ? "Range" : period === "annual" ? "Year" : "Month";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Reports</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Period summary{comparing ? ` — this ${noun.toLowerCase()} vs. the previous one` : ""} —
            export as CSV or print.
          </p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5 text-slate-600">
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
            />
            Compare to previous
          </label>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as ReportPeriod)}
            className="input"
          >
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
            <option value="custom">Custom range</option>
          </select>
          {period === "monthly" ? (
            <input
              type="month"
              value={monthKey}
              onChange={(e) => setMonthKey(e.target.value)}
              className="input"
            />
          ) : period === "annual" ? (
            <input
              type="number"
              min={2000}
              max={2100}
              value={yearKey}
              onChange={(e) => setYearKey(e.target.value)}
              className="input w-24"
            />
          ) : (
            <>
              <DateField
                value={customFrom}
                onChange={setCustomFrom}
                className="w-36"
                aria-label="From date"
              />
              <DateField
                value={customTo}
                onChange={setCustomTo}
                className="w-36"
                aria-label="To date"
              />
            </>
          )}
          {selectionIsValid && (
            <a
              href={`/api/reports.csv?${queryString}`}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50"
            >
              Export CSV
            </a>
          )}
          <button
            onClick={() => window.print()}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-white"
          >
            Print
          </button>
        </div>
      </header>

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {!selectionIsValid && <p className="text-sm text-amber-600">{selectionProblem}</p>}
      {isError && <p className="text-sm text-red-600">Could not load the report.</p>}
      {compare && isPriorLoading && report && (
        <p className="text-sm text-slate-400">Loading previous period…</p>
      )}
      {compare && isPriorError && (
        <p className="text-sm text-red-600">Could not load the previous period.</p>
      )}
      {report && (
        <>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">
              {report.period === "custom"
                ? `Custom range · ${report.from} to ${report.to}`
                : `${noun} ${report.periodKey} · ${report.from} to ${report.to}`}
              {comparing && (
                <span className="text-slate-400">
                  {" "}
                  vs.{" "}
                  {prior.period === "custom" ? `${prior.from} to ${prior.to}` : prior.periodKey}
                </span>
              )}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Kpi
                label="Income"
                cur={report.incomePaise}
                prev={comparing ? prior.incomePaise : null}
              />
              <Kpi
                label="Expense"
                cur={report.expensePaise}
                prev={comparing ? prior.expensePaise : null}
                badUp
              />
              <Kpi label="Net" cur={report.netPaise} prev={comparing ? prior.netPaise : null} />
              <Kpi
                label="Savings rate"
                cur={report.savingsRatePct}
                prev={comparing ? prior.savingsRatePct : null}
                unit="%"
              />
            </div>

            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="text-xs font-medium text-slate-500">Spend by necessity</p>
              <div className="mt-2 grid grid-cols-3 gap-4">
                <Kpi
                  label="Essential"
                  cur={report.necessity.essentialPaise}
                  prev={comparing ? prior.necessity.essentialPaise : null}
                />
                <Kpi
                  label="Non-essential"
                  cur={report.necessity.nonEssentialPaise}
                  prev={comparing ? prior.necessity.nonEssentialPaise : null}
                  badUp
                />
                <Kpi
                  label="Unclassified"
                  cur={report.necessity.unclassifiedPaise}
                  prev={comparing ? prior.necessity.unclassifiedPaise : null}
                />
              </div>
              {report.necessity.unclassifiedPaise > 0 && (
                <p className="mt-2 text-xs text-amber-700">
                  Some spend has no necessity set — set a default per category in Settings →
                  Categories, or mark individual transactions, to make the essential figure
                  complete.
                </p>
              )}
            </div>
          </div>

          <Section title="By category">
            {comparing ? (
              <CategoryCompare current={report} prior={prior} />
            ) : (
              <Table
                head={["Category", "Spent"]}
                rows={report.categories.map((c) => [c.name, formatINR(c.spentPaise)])}
                empty="No spending this period."
              />
            )}
          </Section>

          <Section title="Top merchants">
            {comparing ? (
              <MerchantCompare current={report} prior={prior} />
            ) : (
              <Table
                head={["Merchant", "Spent", "Txns"]}
                rows={report.topMerchants.map((m) => [
                  m.merchant,
                  formatINR(m.spentPaise),
                  String(m.count),
                ])}
                empty="No merchant activity this period."
              />
            )}
          </Section>
        </>
      )}
    </div>
  );
}

/** KPI that optionally shows the previous period's value and the change. */
function Kpi({
  label,
  cur,
  prev,
  unit,
  badUp,
}: {
  label: string;
  cur: number;
  prev: number | null;
  unit?: "%";
  badUp?: boolean;
}) {
  const fmt = (v: number) => (unit === "%" ? `${v}%` : formatINR(v));
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-slate-800">{fmt(cur)}</p>
      {prev !== null && (
        <p className="mt-0.5 text-xs">
          <Delta cur={cur} prev={prev} unit={unit} badUp={badUp} />
          <span className="text-slate-400"> from {fmt(prev)}</span>
        </p>
      )}
    </div>
  );
}

/** Colored change indicator. `badUp` flips the coloring (e.g. expense rising is bad). */
function Delta({
  cur,
  prev,
  unit,
  badUp,
}: {
  cur: number;
  prev: number;
  unit?: "%";
  badUp?: boolean;
}) {
  const diff = cur - prev;
  if (diff === 0) return <span className="text-slate-400">no change</span>;
  const up = diff > 0;
  const good = badUp ? !up : up;
  const mag = unit === "%" ? `${Math.abs(diff)} pts` : formatINR(Math.abs(diff));
  const pct =
    unit !== "%" && prev !== 0 ? ` (${Math.abs(Math.round((diff / Math.abs(prev)) * 100))}%)` : "";
  return (
    <span className={good ? "text-emerald-600" : "text-rose-600"}>
      {up ? "▲" : "▼"} {mag}
      {pct}
    </span>
  );
}

/** Per-category spend this period vs. the previous, merged and sorted by current spend. */
function CategoryCompare({ current, prior }: { current: Report; prior: Report }) {
  const list = compareCategories(current, prior);
  if (list.length === 0)
    return <p className="py-4 text-center text-sm text-slate-400">No spending in either period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="py-1.5">Category</th>
            <th className="py-1.5 text-right">This period</th>
            <th className="py-1.5 text-right">Previous</th>
            <th className="py-1.5 text-right">Change</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id} className="border-b border-slate-100">
              <td className="py-1.5 text-slate-800">{r.name}</td>
              <td className="py-1.5 text-right tabular-nums text-slate-700">
                {formatINR(r.currentPaise)}
              </td>
              <td className="py-1.5 text-right tabular-nums text-slate-400">
                {formatINR(r.previousPaise)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                <Delta cur={r.currentPaise} prev={r.previousPaise} badUp />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MerchantCompare({ current, prior }: { current: Report; prior: Report }) {
  const rows = compareMerchants(current, prior);
  if (rows.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-slate-400">
        No merchant activity in either period.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="py-1.5">Merchant</th>
            <th className="py-1.5 text-right">This period</th>
            <th className="py-1.5 text-right">Previous</th>
            <th className="py-1.5 text-right">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.merchant} className="border-b border-slate-100">
              <td className="py-1.5 text-slate-800">{row.merchant}</td>
              <td className="py-1.5 text-right tabular-nums text-slate-700">
                {formatINR(row.currentPaise)}{" "}
                <span className="text-xs text-slate-400">({row.currentCount})</span>
              </td>
              <td className="py-1.5 text-right tabular-nums text-slate-400">
                {formatINR(row.previousPaise)}{" "}
                <span className="text-xs">({row.previousCount})</span>
              </td>
              <td className="py-1.5 text-right tabular-nums">
                <Delta cur={row.currentPaise} prev={row.previousPaise} badUp />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2>
      {children}
    </div>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: string[][]; empty: string }) {
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-slate-400">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            {head.map((h, i) => (
              <th key={h} className={`py-1.5 ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-slate-100">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`py-1.5 ${ci > 0 ? "text-right tabular-nums text-slate-700" : "text-slate-800"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
