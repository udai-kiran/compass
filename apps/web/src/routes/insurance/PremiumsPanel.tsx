import { useState, type FormEvent } from "react";
import { formatDisplayDate, formatINR, isBankAccount, type InsurancePolicy } from "@compass/shared";
import { usePolicyPremiums, useLogPremium } from "../../lib/insurance-queries.ts";
import { useAccounts } from "../../lib/queries.ts";
import { toast } from "../../lib/toast.tsx";
import { DateField } from "../../components/DateField.tsx";

export function PremiumsPanel({ policy }: { policy: InsurancePolicy }) {
  const { data: premiums } = usePolicyPremiums(policy.id, true);
  const { data: accounts } = useAccounts();
  const log = useLogPremium(policy.id);

  const payFrom = (accounts ?? []).filter(
    (a) =>
      a.archivedAt === null &&
      (isBankAccount(a.type) || a.type === "credit_card"),
  );
  const bankAccounts = payFrom.filter((a) => isBankAccount(a.type));
  const creditCards = payFrom.filter((a) => a.type === "credit_card");
  const nameOf = new Map((accounts ?? []).map((a) => [a.id, a.name]));

  const [fromAccountId, setFromAccountId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(policy.premiumPaise === 0 ? "" : (policy.premiumPaise / 100).toString());
  const [note, setNote] = useState("");

  const amountPaise = amount === "" ? 0 : Math.round(Number(amount) * 100);
  const amountError =
    amount !== "" && (Number.isNaN(amountPaise) || amountPaise <= 0) ? "must be a positive amount" : null;
  const canSubmit = fromAccountId !== "" && amountPaise > 0 && amountError === null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    log.mutate(
      { fromAccountId, date, amountPaise, note: note.trim() },
      {
        onSuccess: () => {
          setNote("");
          toast("Premium logged", "success");
        },
      },
    );
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Premiums</h3>
        {premiums && premiums.count > 0 && (
          <span className="text-sm text-slate-500">
            <span className="font-medium tabular-nums text-slate-700">{formatINR(premiums.totalPaise)}</span> paid ·{" "}
            {premiums.count} payment{premiums.count === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <form onSubmit={submit} className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Paid from
          <select value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)} className="input">
            <option value="">Select account…</option>
            {bankAccounts.length > 0 && (
              <optgroup label="Bank accounts">
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            )}
            {creditCards.length > 0 && (
              <optgroup label="Credit cards">
                {creditCards.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Date
          <DateField value={date} onChange={(iso) => setDate(iso)} className="w-full" aria-label="Premium date" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Amount (₹)
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input w-28"
            placeholder="12000"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-slate-500">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input" placeholder="Optional" />
        </label>
        <button
          type="submit"
          disabled={!canSubmit || log.isPending}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {log.isPending ? "Logging…" : "Log premium"}
        </button>
      </form>
      {amountError && <p className="mb-2 text-xs text-red-600">{amountError}</p>}

      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
        {premiums?.items.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
            <span className="w-24 shrink-0 text-slate-500">{formatDisplayDate(p.date)}</span>
            <span className="min-w-0 flex-1 truncate text-slate-600">
              {nameOf.get(p.accountId) ?? "—"}
              {p.note && <span className="ml-1 text-xs text-slate-400">· {p.note}</span>}
            </span>
            <span className="tabular-nums text-slate-700">{formatINR(Math.abs(p.amountPaise))}</span>
          </li>
        ))}
        {premiums && premiums.count === 0 && (
          <li className="px-3 py-4 text-center text-xs text-slate-400">No premiums logged yet.</li>
        )}
      </ul>
    </div>
  );
}
