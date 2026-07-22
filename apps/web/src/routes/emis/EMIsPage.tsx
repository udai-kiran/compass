import { useState, type FormEvent } from "react";
import { formatINR, standardEmiPaise, type EmiSummary } from "@compass/shared";
import { Meter } from "../../lib/viz.tsx";
import { toast } from "../../lib/toast.tsx";
import { useAccounts, useCategories } from "../../lib/queries.ts";
import { useEmiMutations, useEmis } from "../../lib/emi-queries.ts";

export function EMIsPage() {
  const { data: emis, isLoading } = useEmis();

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-slate-800">EMIs &amp; Loans</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Loan schedules on the recurring engine — installments post automatically each month.
        </p>
      </header>

      <NewEmiForm />

      {isLoading && <p className="mt-4 text-sm text-slate-400">Loading…</p>}
      {emis && emis.length === 0 && (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No EMIs yet. Add one above to start tracking a loan.
        </p>
      )}

      <div className="mt-4 space-y-3">
        {emis?.map((e) => <EmiRow key={e.templateId} emi={e} />)}
      </div>
    </div>
  );
}

function EmiRow({ emi }: { emi: EmiSummary }) {
  const { remove, setPaused } = useEmiMutations();
  const pct = Math.round((emi.paidInstallments / emi.totalInstallments) * 100);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <span className="truncate">{emi.merchant}</span>
            {emi.paused && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                Paused
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {formatINR(emi.installmentPaise)}/mo · {(emi.annualRateBps / 100).toFixed(2)}% p.a. ·{" "}
            {formatINR(emi.principalPaise)} principal
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setPaused.mutate({ templateId: emi.templateId, paused: !emi.paused })}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            {emi.paused ? "Resume" : "Pause"}
          </button>
          <button
            onClick={() => {
              if (confirm(`Delete EMI “${emi.merchant}”? Past installments stay as transactions.`))
                remove.mutate(emi.templateId);
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:bg-red-50 hover:text-red-600"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-slate-500">
          <span>
            {emi.paidInstallments} of {emi.totalInstallments} paid
          </span>
          <span>{pct}%</span>
        </div>
        <Meter pct={pct} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Remaining" value={`${emi.remainingInstallments} mo`} />
        <Stat label="Outstanding" value={formatINR(emi.outstandingPaise)} />
        <Stat label="Total interest" value={formatINR(emi.totalInterestPaise)} />
        <Stat label="Payoff date" value={emi.payoffDate} />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

function NewEmiForm() {
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const { create } = useEmiMutations();
  const [accountId, setAccountId] = useState("");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("");
  const [tenure, setTenure] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));

  const principalPaise = Math.round((parseFloat(principal) || 0) * 100);
  const annualRateBps = Math.round((parseFloat(rate) || 0) * 100);
  const months = parseInt(tenure, 10) || 0;
  const preview =
    principalPaise > 0 && months > 0
      ? standardEmiPaise(principalPaise, annualRateBps, months)
      : 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!accountId || !name || principalPaise <= 0 || months <= 0) return;
    create.mutate(
      {
        accountId,
        name,
        categoryId: categoryId || null,
        principalPaise,
        annualRateBps,
        totalInstallments: months,
        startDate,
      },
      {
        onSuccess: () => {
          setName("");
          setPrincipal("");
          setRate("");
          setTenure("");
          toast("EMI created", "success");
        },
      },
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="mb-3 text-sm font-semibold text-slate-700">New EMI</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Account
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input">
            <option value="">Select…</option>
            {accounts?.filter((a) => !a.archivedAt).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Loan name
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="e.g. iPhone EMI" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Category (optional)
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input">
            <option value="">None</option>
            {categories?.filter((c) => !c.archivedAt).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Principal (₹)
          <input inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} className="input" placeholder="120000" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Interest (% p.a.)
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="input" placeholder="13.5" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Tenure (months)
          <input type="number" min={1} max={600} value={tenure} onChange={(e) => setTenure(e.target.value)} className="input" placeholder="12" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          First installment
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-4">
        <button
          type="submit"
          disabled={create.isPending || !accountId || !name || principalPaise <= 0 || months <= 0}
          className="rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {create.isPending ? "Creating…" : "Create EMI"}
        </button>
        {preview > 0 && (
          <span className="text-sm text-slate-600">
            Monthly installment ≈ <span className="font-semibold text-slate-800">{formatINR(preview)}</span>
          </span>
        )}
      </div>
    </form>
  );
}
