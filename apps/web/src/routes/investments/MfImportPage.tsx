import { useState } from "react";
import { Link } from "react-router";
import { formatINR, type MfImportPreview } from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import { useMfImportCommit, useMfImportPreview } from "../../lib/wealth-queries.ts";

const SAMPLE =
  "Date, Folio Number, Name of the Fund, Order, Units, NAV, Current Nav, Amount (INR)\n" +
  "2026-07-06,11216780,Parag Parikh Flexi Cap Growth Direct Plan,buy,393.813,91.4093,90.9438,35998.2";

export function MfImportPage() {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<MfImportPreview | null>(null);
  const previewM = useMfImportPreview();
  const commitM = useMfImportCommit();

  function doPreview() {
    setPreview(null);
    previewM.mutate(csv, {
      onSuccess: (p) => setPreview(p),
      onError: (e) => toast(e instanceof Error ? e.message : "Preview failed"),
    });
  }

  function doCommit() {
    commitM.mutate(csv, {
      onSuccess: (r) => {
        toast(
          `Imported ${r.eventsInserted} transaction${r.eventsInserted === 1 ? "" : "s"}` +
            (r.eventsDuplicate ? ` · ${r.eventsDuplicate} already present` : ""),
          "success",
        );
        setPreview(null);
        setCsv("");
      },
      onError: (e) => toast(e instanceof Error ? e.message : "Import failed"),
    });
  }

  const unmapped = preview?.funds.filter((f) => f.amfiSchemeCode === null) ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-2">
      <header>
        <Link to="/investments" className="text-xs text-slate-500 underline">
          ‹ Back to investments
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-800">Import mutual fund transactions</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Paste your transactions CSV. Each fund is matched to its AMFI scheme so its value tracks
          the published NAV. Re-importing the same file is safe — duplicates are skipped.
        </p>
      </header>

      <div>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={SAMPLE}
          className="w-full rounded-md border border-slate-300 p-3 font-mono text-xs"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={doPreview}
            disabled={csv.trim() === "" || previewM.isPending}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50"
          >
            {previewM.isPending ? "Reading…" : "Preview"}
          </button>
          {preview && (
            <button
              onClick={doCommit}
              disabled={commitM.isPending || preview.totalRows === 0}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {commitM.isPending ? "Importing…" : `Import ${preview.totalRows} transactions`}
            </button>
          )}
        </div>
      </div>

      {preview && (
        <div className="space-y-3">
          {unmapped.length > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
              {unmapped.length} fund{unmapped.length === 1 ? "" : "s"} not in the scheme map
              ({unmapped.map((f) => f.fundName).join(", ")}) will import with no AMFI link — valued
              from the CSV only, and skipped by NAV refresh.
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">Fund</th>
                  <th className="px-3 py-2">AMFI scheme</th>
                  <th className="px-3 py-2 text-right">NAV</th>
                  <th className="px-3 py-2 text-right">Buys / Sells</th>
                  <th className="px-3 py-2 text-right">Net units</th>
                  <th className="px-3 py-2 text-right">Invested</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.funds.map((f) => (
                  <tr key={f.fundName}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-700">{f.fundName}</div>
                      {f.folioNumber && <div className="text-xs text-slate-400">Folio {f.folioNumber}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {f.amfiSchemeCode ? (
                        <>
                          <span className="font-mono text-slate-600">{f.amfiSchemeCode}</span>
                          {f.canonicalName && <div className="text-slate-400">{f.canonicalName}</div>}
                        </>
                      ) : (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">unmapped</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {f.latestNav !== null ? `₹${f.latestNav.toFixed(4)}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {f.buyCount} / {f.sellCount}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {f.netUnits.toFixed(3)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {formatINR(f.investedPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.skippedRows.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <p className="font-medium">
                {preview.skippedRows.length} row{preview.skippedRows.length === 1 ? "" : "s"} couldn't be read:
              </p>
              <ul className="mt-1 space-y-0.5">
                {preview.skippedRows.slice(0, 10).map((s) => (
                  <li key={s.line}>Line {s.line}: {s.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
