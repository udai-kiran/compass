import { useMemo, useState, type FormEvent } from "react";
import {
  formatINR,
  isRetirementAccount,
  rupeesToPaise,
  type CreateEpfContributionInput,
} from "@compass/shared";
import { useAccounts, useRecordEpfMutation } from "../../lib/queries.ts";
import { toast } from "../../lib/toast.tsx";
import { DateField } from "../../components/DateField.tsx";

/** Parse a component field: blank/0 → 0, valid nonneg → paise, invalid → NaN */
function parseEpfComponent(v: string): number {
  const s = v.trim();
  if (s === "" || s === "0") return 0;
  const n = Number(s); // Number() rejects trailing garbage ("100abc" → NaN); parseFloat would not
  if (!Number.isFinite(n) || n < 0) return NaN;
  return rupeesToPaise(n);
}

export function RecordEpfModal({ onClose }: { onClose: () => void }) {
  const { data: accounts } = useAccounts();
  const epf = useRecordEpfMutation();

  const epfAccounts = useMemo(
    () => (accounts ?? []).filter((a) => !a.archivedAt && isRetirementAccount(a.type)),
    [accounts],
  );

  const [toAccountId, setToAccountId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [employer, setEmployer] = useState("");
  const [ee, setEe] = useState(""); // Employee share (₹ text)
  const [er, setEr] = useState(""); // Employer share (₹ text)
  const [eps, setEps] = useState(""); // Pension / EPS (₹ text)
  const [basic, setBasic] = useState(""); // Quick-fill basic salary

  // Live total in paise (NaN if any field is invalid)
  const eePaise = parseEpfComponent(ee);
  const erPaise = parseEpfComponent(er);
  const epsPaise = parseEpfComponent(eps);
  const totalPaise = eePaise + erPaise + epsPaise;
  const totalValid = !Number.isNaN(totalPaise) && Number.isSafeInteger(totalPaise);

  function autoFill() {
    const basicRupees = Number(basic.trim()); // Number() rejects trailing garbage
    if (!Number.isFinite(basicRupees) || basicRupees <= 0) {
      return toast("Enter valid basic salary for quick-fill");
    }
    const basicPaise = rupeesToPaise(basicRupees);
    const eps_ = Math.min(Math.round(basicPaise * 0.0833), 125_000); // capped at ₹1,250
    const ee_ = Math.round(basicPaise * 0.12);
    const er_ = Math.round(basicPaise * 0.12) - eps_; // employer 12% − EPS
    // Display as rupees with up to 2 decimal places
    const toDisplay = (paise: number) => (paise / 100).toFixed(2).replace(/\.00$/, "");
    setEe(toDisplay(ee_));
    setEr(toDisplay(er_));
    setEps(toDisplay(eps_));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const accountId = toAccountId || (epfAccounts.length === 1 ? epfAccounts[0]!.id : "");
    if (!accountId) return toast("Pick a retirement account");
    if ([eePaise, erPaise, epsPaise].some(Number.isNaN)) {
      return toast("Enter valid amounts (0 or positive)");
    }
    if (!totalValid || totalPaise <= 0) {
      return toast("Total contribution must be greater than zero");
    }

    const body: CreateEpfContributionInput = {
      toAccountId: accountId,
      date,
      employer,
      employeeSharePaise: eePaise,
      employerSharePaise: erPaise,
      pensionSharePaise: epsPaise,
      notes: "",
    };
    epf.mutate(body, {
      onSuccess: (r) => {
        toast(`EPF contribution recorded — ${formatINR(r.amountPaise)}`, "success");
        onClose();
      },
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Record EPF contribution"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="my-8 w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-800">Record EPF contribution</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Account */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Destination account
            </span>
            <select
              value={toAccountId}
              onChange={(e) => setToAccountId(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Select an account…</option>
              {epfAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {epfAccounts.length === 0 && (
              <p className="mt-1 text-xs text-slate-500">
                No retirement account yet — create an EPF/PPF account to earmark EPF.
              </p>
            )}
          </label>

          {/* Date */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Pay date</span>
            <DateField value={date} onChange={(iso) => setDate(iso)} className="w-full" aria-label="Pay date" />
          </label>

          {/* Employer */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Employer (source)</span>
            <input
              type="text"
              value={employer}
              onChange={(e) => setEmployer(e.target.value)}
              placeholder="e.g. Acme Corp"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>

          {/* Quick-fill */}
          <div className="rounded-md bg-slate-50 px-3 py-2.5">
            <p className="mb-1.5 text-xs font-medium text-slate-500">
              Quick-fill from basic salary
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={basic}
                onChange={(e) => setBasic(e.target.value)}
                placeholder="₹ basic salary"
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={autoFill}
                className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Auto-fill
              </button>
            </div>
          </div>

          {/* Breakdown */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Contribution breakdown
            </p>
            <div className="space-y-2.5">
              <label className="flex items-center gap-3">
                <span className="w-44 text-xs text-slate-600">
                  Employee share <span className="text-slate-400">(12%)</span>
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={ee}
                  onChange={(e) => setEe(e.target.value)}
                  placeholder="₹"
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm"
                />
              </label>
              <label className="flex items-center gap-3">
                <span className="w-44 text-xs text-slate-600">
                  Employer share <span className="text-slate-400">(≈3.67%)</span>
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={er}
                  onChange={(e) => setEr(e.target.value)}
                  placeholder="₹"
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm"
                />
              </label>
              <label className="flex items-center gap-3">
                <span className="w-44 text-xs text-slate-600">
                  Pension / EPS <span className="text-slate-400">(8.33%, max ₹1,250)</span>
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={eps}
                  onChange={(e) => setEps(e.target.value)}
                  placeholder="₹"
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm"
                />
              </label>
              <div className="flex items-center gap-3 border-t border-slate-100 pt-2">
                <span className="w-44 text-xs font-semibold text-slate-700">Total credited</span>
                <span
                  className={`flex-1 text-right text-sm font-semibold tabular-nums ${
                    totalValid && totalPaise > 0 ? "text-slate-800" : "text-slate-400"
                  }`}
                >
                  {totalValid && totalPaise > 0 ? formatINR(totalPaise) : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={epf.isPending || epfAccounts.length === 0}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {epf.isPending ? "Saving…" : "Record EPF"}
          </button>
        </div>
      </form>
    </div>
  );
}
