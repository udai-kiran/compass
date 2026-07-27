import { useState } from "react";
import { Link } from "react-router";
import {
  formatINR,
  type AssetClass,
  type CapitalGainsSlice,
  type CapitalGainsStatement,
} from "@compass/shared";
import { StatTile } from "../../lib/viz.tsx";
import { useCapitalGains } from "../../lib/wealth-queries.ts";

const ASSET_LABELS: Record<AssetClass, string> = {
  stock: "Stocks",
  mutual_fund: "Mutual funds",
  etf: "ETFs",
  gold: "Gold",
  silver: "Silver",
  fd: "Fixed deposit",
  nps: "NPS",
  real_estate: "Real estate",
  other: "Other",
};

const rupees = (paise: number) => (paise / 100).toFixed(2);

/** ITR-friendly CSV, built client-side from the fetched statement. */
function downloadCsv(stmt: CapitalGainsStatement) {
  const header = [
    "Holding",
    "Asset class",
    "Acquired",
    "Sold",
    "Units",
    "Proceeds",
    "Cost",
    "Gain",
    "Term",
    "Days held",
    "Grandfathered",
  ];
  const rows = stmt.holdings.flatMap((h) =>
    h.slices.map((s) => [
      h.holdingName,
      ASSET_LABELS[h.assetClass],
      s.buyDate,
      s.sellDate,
      String(s.units),
      rupees(s.proceedsPaise),
      rupees(s.costPaise),
      rupees(s.gainPaise),
      s.term === "long" ? "Long-term" : "Short-term",
      String(s.heldDays),
      s.grandfathered ? "Yes" : "No",
    ]),
  );
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `capital-gains-${stmt.fy}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function CapitalGainsPage() {
  const [fy, setFy] = useState<string | undefined>(undefined);
  const { data: stmt, isLoading } = useCapitalGains(fy);

  const gainClass = (paise: number) => (paise >= 0 ? "text-emerald-600" : "text-red-600");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Link to="/investments" className="hover:text-slate-700">
              ← Investments
            </Link>
          </div>
          <h1 className="mt-1 text-xl font-semibold text-slate-800">Capital gains</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Realized gains matched <strong>First-In-First-Out</strong> — short vs long term by
            holding period, using each holding's tax treatment and 31-Jan-2018 grandfathering for
            equity. Portfolio cards use average cost.
          </p>
          <p className="mt-1 text-xs text-amber-700">
            An estimate to help you prepare — it depends on the tax class you set per holding and
            doesn't cover every rule (set-off, surcharge, indexation). Verify before filing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stmt && stmt.availableFys.length > 0 && (
            <select
              value={stmt.fy}
              onChange={(e) => setFy(e.target.value)}
              aria-label="Financial year"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
            >
              {(stmt.availableFys.includes(stmt.fy)
                ? stmt.availableFys
                : [stmt.fy, ...stmt.availableFys]
              ).map((f) => (
                <option key={f} value={f}>
                  FY {f}
                </option>
              ))}
            </select>
          )}
          {stmt && stmt.holdings.length > 0 && (
            <button
              onClick={() => downloadCsv(stmt)}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white"
            >
              Download CSV
            </button>
          )}
        </div>
      </header>

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}

      {stmt && stmt.holdings.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No redemptions in FY {stmt.fy}. Sell events on your holdings show up here as realized
          gains, split into short- and long-term.
        </div>
      )}

      {stmt && stmt.holdings.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="Short-term gains"
              value={formatINR(stmt.shortTermGainPaise)}
              sub={<span className={gainClass(stmt.shortTermGainPaise)}>STCG</span>}
            />
            <StatTile
              label="Long-term gains"
              value={formatINR(stmt.longTermGainPaise)}
              sub={<span className={gainClass(stmt.longTermGainPaise)}>LTCG</span>}
            />
            <StatTile
              label="Total realized"
              value={formatINR(stmt.totalGainPaise)}
              sub={
                <span className={gainClass(stmt.totalGainPaise)}>
                  {stmt.totalGainPaise >= 0 ? "▲ gain" : "▼ loss"}
                </span>
              }
            />
            <StatTile label="Redemption proceeds" value={formatINR(stmt.totalProceedsPaise)} />
          </div>

          <div className="space-y-4">
            {stmt.holdings.map((h) => (
              <section key={h.holdingId} className="rounded-lg border border-slate-200 bg-white">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 p-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-800">{h.holdingName}</h2>
                    <p className="mt-0.5 text-xs text-slate-500">{ASSET_LABELS[h.assetClass]}</p>
                  </div>
                  <div className="text-right text-sm">
                    <span className="mr-3 text-slate-500">
                      STCG{" "}
                      <span className={gainClass(h.shortTermGainPaise)}>
                        {formatINR(h.shortTermGainPaise)}
                      </span>
                    </span>
                    <span className="text-slate-500">
                      LTCG{" "}
                      <span className={gainClass(h.longTermGainPaise)}>
                        {formatINR(h.longTermGainPaise)}
                      </span>
                    </span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                        <th className="px-4 py-2 font-medium">Acquired</th>
                        <th className="px-4 py-2 font-medium">Sold</th>
                        <th className="px-4 py-2 text-right font-medium">Units</th>
                        <th className="px-4 py-2 text-right font-medium">Proceeds</th>
                        <th className="px-4 py-2 text-right font-medium">Cost</th>
                        <th className="px-4 py-2 text-right font-medium">Gain</th>
                        <th className="px-4 py-2 font-medium">Term</th>
                      </tr>
                    </thead>
                    <tbody>
                      {h.slices.map((s, i) => (
                        <SliceRow key={i} s={s} gainClass={gainClass} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SliceRow({
  s,
  gainClass,
}: {
  s: CapitalGainsSlice;
  gainClass: (paise: number) => string;
}) {
  return (
    <tr className="border-b border-slate-50 last:border-0">
      <td className="px-4 py-2 text-slate-600">{s.buyDate}</td>
      <td className="px-4 py-2 text-slate-600">{s.sellDate}</td>
      <td className="px-4 py-2 text-right tabular-nums text-slate-600">{s.units}</td>
      <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatINR(s.proceedsPaise)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-slate-600">
        {formatINR(s.costPaise)}
        {s.grandfathered && (
          <span className="ml-1 text-xs text-amber-600" title="Cost stepped up to the 31-Jan-2018 FMV">
            ⓖ
          </span>
        )}
      </td>
      <td className={`px-4 py-2 text-right font-medium tabular-nums ${gainClass(s.gainPaise)}`}>
        {formatINR(s.gainPaise)}
      </td>
      <td className="px-4 py-2">
        <span
          className={`rounded px-1.5 py-0.5 text-xs ${
            s.term === "long" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
          }`}
          title={`Held ${s.heldDays} days`}
        >
          {s.term === "long" ? "LTCG" : "STCG"}
        </span>
      </td>
    </tr>
  );
}
