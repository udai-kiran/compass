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

function parseRupees(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? rupeesToPaise(n) : null;
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
  const [amount, setAmount] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const accountId = toAccountId || (epfAccounts.length === 1 ? epfAccounts[0]!.id : "");
    if (!accountId) return toast("Pick a retirement account");
    const amountPaise = parseRupees(amount);
    if (amountPaise === null) return toast("Enter the amount");

    const body: CreateEpfContributionInput = {
      toAccountId: accountId,
      date,
      employer,
      amountPaise,
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
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Destination account</span>
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

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Pay date</span>
            <DateField
              value={date}
              onChange={(iso) => setDate(iso)}
              className="w-full"
              aria-label="Pay date"
            />
          </label>

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

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Amount</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="₹"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm"
            />
          </label>
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
