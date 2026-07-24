import { useMemo, useState, type FormEvent } from "react";
import {
  formatINR,
  isRetirementAccount,
  rupeesToPaise,
  type CreatePayslipInput,
  type PayslipDeductionKind,
} from "@compass/shared";
import { useAccounts, useCategories, usePayslipMutation } from "../../lib/queries.ts";
import { toast } from "../../lib/toast.tsx";
import { DateField } from "../../components/DateField.tsx";

/** A deduction row in the form (rupees as strings while editing). */
interface DeductionDraft {
  key: number;
  kind: PayslipDeductionKind;
  label: string;
  amount: string;
  toAccountId: string;
}

const KIND_LABELS: Record<PayslipDeductionKind, string> = {
  tds: "TDS (income tax)",
  professional_tax: "Professional tax",
  epf: "EPF (retirement)",
  other: "Other deduction",
};

let nextKey = 1;
function newDeduction(kind: PayslipDeductionKind): DeductionDraft {
  return { key: nextKey++, kind, label: "", amount: "", toAccountId: "" };
}

function parseRupees(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? rupeesToPaise(n) : null;
}

export function PayslipModal({ onClose }: { onClose: () => void }) {
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const payslip = usePayslipMutation();

  const bankAccounts = useMemo(
    () => (accounts ?? []).filter((a) => !a.archivedAt && (a.type === "bank" || a.type === "cash")),
    [accounts],
  );
  const epfAccounts = useMemo(
    () => (accounts ?? []).filter((a) => !a.archivedAt && isRetirementAccount(a.type)),
    [accounts],
  );
  const incomeCategories = useMemo(
    () => (categories ?? []).filter((c) => !c.archivedAt && c.kind === "income"),
    [categories],
  );

  const [bankAccountId, setBankAccountId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [employer, setEmployer] = useState("");
  const [gross, setGross] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [deductions, setDeductions] = useState<DeductionDraft[]>([
    newDeduction("tds"),
    newDeduction("epf"),
  ]);

  const effBank = bankAccountId || bankAccounts[0]?.id || "";
  const grossPaise = parseRupees(gross) ?? 0;
  const deductionsPaise = deductions.reduce((s, d) => s + (parseRupees(d.amount) ?? 0), 0);
  const netPaise = grossPaise - deductionsPaise;

  function updateDeduction(key: number, patch: Partial<DeductionDraft>) {
    setDeductions((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!effBank) return toast("Add a bank account first");
    if (grossPaise <= 0) return toast("Enter the gross salary");

    const rows: CreatePayslipInput["deductions"] = [];
    for (const d of deductions) {
      const amountPaise = parseRupees(d.amount);
      if (amountPaise === null) continue; // skip blank rows
      if (d.kind === "epf" && !d.toAccountId) {
        return toast("Pick the account your EPF goes into");
      }
      rows.push({
        kind: d.kind,
        label: d.label,
        amountPaise,
        toAccountId: d.kind === "epf" ? d.toAccountId : null,
      });
    }

    if (netPaise <= 0) return toast("Deductions exceed gross — take-home must be positive");

    payslip.mutate(
      {
        bankAccountId: effBank,
        date,
        employer,
        grossPaise,
        categoryId: categoryId || null,
        deductions: rows,
        notes: "",
      },
      {
        onSuccess: (r) => {
          toast(`Payslip added — ${formatINR(r.netPaise)} take-home`, "success");
          onClose();
        },
      },
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Add payslip"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="my-8 w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-800">Add payslip</h2>
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
          <p className="text-xs text-slate-500">
            Enter your gross salary and what's withheld at source. We'll record the gross as
            income, TDS as a tax expense, and EPF as a transfer into your retirement account —
            your bank nets to take-home.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Credited to</span>
              <select
                value={effBank}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                {bankAccounts.length === 0 && <option value="">No bank account</option>}
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Employer (source)</span>
              <input
                value={employer}
                onChange={(e) => setEmployer(e.target.value)}
                placeholder="e.g. Acme Corp"
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Gross salary</span>
              <input
                value={gross}
                onChange={(e) => setGross(e.target.value)}
                inputMode="decimal"
                placeholder="₹"
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm"
              />
            </label>
          </div>

          {incomeCategories.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Income category</span>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">Salary (default)</option>
                {incomeCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600">Deductions</span>
            </div>
            <div className="space-y-2">
              {deductions.map((d) => (
                <div key={d.key} className="flex items-center gap-2">
                  <select
                    value={d.kind}
                    onChange={(e) =>
                      updateDeduction(d.key, { kind: e.target.value as PayslipDeductionKind })
                    }
                    className="w-40 shrink-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    {(Object.keys(KIND_LABELS) as PayslipDeductionKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                  {d.kind === "epf" ? (
                    <select
                      value={d.toAccountId}
                      onChange={(e) => updateDeduction(d.key, { toAccountId: e.target.value })}
                      aria-label="EPF account"
                      className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">EPF account…</option>
                      {epfAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  ) : d.kind === "other" ? (
                    <input
                      value={d.label}
                      onChange={(e) => updateDeduction(d.key, { label: e.target.value })}
                      placeholder="Label"
                      className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  ) : (
                    <span className="min-w-0 flex-1" />
                  )}
                  <input
                    value={d.amount}
                    onChange={(e) => updateDeduction(d.key, { amount: e.target.value })}
                    inputMode="decimal"
                    placeholder="₹"
                    className="w-24 shrink-0 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setDeductions((prev) => prev.filter((x) => x.key !== d.key))}
                    aria-label="Remove deduction"
                    className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setDeductions((prev) => [...prev, newDeduction("other")])}
              className="mt-2 text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              + Add deduction
            </button>
            {epfAccounts.length === 0 && deductions.some((d) => d.kind === "epf") && (
              <p className="mt-1 text-xs text-amber-600">
                No retirement account yet — create an EPF/PPF account to earmark EPF.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-500">Net take-home</span>
            <span
              className={`tabular-nums font-semibold ${netPaise <= 0 ? "text-red-600" : "text-slate-800"}`}
            >
              {formatINR(netPaise)}
            </span>
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
            disabled={payslip.isPending}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {payslip.isPending ? "Saving…" : "Add payslip"}
          </button>
        </div>
      </form>
    </div>
  );
}
