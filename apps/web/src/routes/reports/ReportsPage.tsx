import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatINR, ReportSchema, type ReportPeriod } from "@compass/shared";
import { apiGet } from "../../lib/api.ts";

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function ReportsPage() {
  const [period, setPeriod] = useState<ReportPeriod>("monthly");
  const [key, setKey] = useState(currentMonth());
  const effectiveKey = period === "annual" ? key.slice(0, 4) : key;

  const { data: report, isLoading } = useQuery({
    queryKey: ["report", period, effectiveKey],
    queryFn: () => apiGet(`/api/reports?period=${period}&key=${effectiveKey}`, ReportSchema),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Reports</h1>
          <p className="mt-0.5 text-sm text-slate-500">Period summary — export as CSV or print.</p>
        </div>
        <div className="no-print flex items-center gap-2 text-sm">
          <select value={period} onChange={(e) => setPeriod(e.target.value as ReportPeriod)} className="input">
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
          {period === "monthly" ? (
            <input type="month" value={key} onChange={(e) => setKey(e.target.value)} className="input" />
          ) : (
            <input type="number" min={2000} max={2100} value={key.slice(0, 4)} onChange={(e) => setKey(e.target.value)} className="input w-24" />
          )}
          <a
            href={`/api/reports.csv?period=${period}&key=${effectiveKey}`}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50"
          >
            Export CSV
          </a>
          <button onClick={() => window.print()} className="rounded-md bg-slate-800 px-3 py-1.5 text-white">
            Print
          </button>
        </div>
      </header>

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {report && (
        <>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">
              {report.period === "annual" ? "Year" : "Month"} {report.periodKey} · {report.from} to {report.to}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Kpi label="Income" value={formatINR(report.incomePaise)} />
              <Kpi label="Expense" value={formatINR(report.expensePaise)} />
              <Kpi label="Net" value={formatINR(report.netPaise)} />
              <Kpi label="Savings rate" value={`${report.savingsRatePct}%`} />
            </div>
          </div>

          <Section title="By category">
            <Table
              head={["Category", "Spent"]}
              rows={report.categories.map((c) => [c.name, formatINR(c.spentPaise)])}
              empty="No spending this period."
            />
          </Section>

          <Section title="Top merchants">
            <Table
              head={["Merchant", "Spent", "Txns"]}
              rows={report.topMerchants.map((m) => [m.merchant, formatINR(m.spentPaise), String(m.count)])}
              empty="No merchant activity this period."
            />
          </Section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-slate-800">{value}</p>
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
            {head.map((h, i) => <th key={h} className={`py-1.5 ${i > 0 ? "text-right" : ""}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-slate-100">
              {row.map((cell, ci) => (
                <td key={ci} className={`py-1.5 ${ci > 0 ? "text-right tabular-nums text-slate-700" : "text-slate-800"}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
