import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import {
  EMI_DESTINATION_TYPES,
  formatDisplayDate,
  formatINR,
  standardEmiPaise,
  type AccountWithBalance,
  type EmiSummary,
} from "@compass/shared";
import { Meter } from "../../lib/viz.tsx";
import { toast } from "../../lib/toast.tsx";
import { useAccounts, useCategories } from "../../lib/queries.ts";
import { useEmiInstallments, useEmiMutations, useEmis } from "../../lib/emi-queries.ts";
import { DateField } from "../../components/DateField.tsx";
import { PrepayPanel } from "./PrepayPanel.tsx";

export function EMIsPage() {
  const { data: emis, isLoading } = useEmis();
  const { data: accounts } = useAccounts();

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
        {emis?.map((e) => <EmiRow key={e.templateId} emi={e} accounts={accounts} />)}
      </div>
    </div>
  );
}

function EmiRow({ emi, accounts }: { emi: EmiSummary; accounts: AccountWithBalance[] | undefined }) {
  const { remove, setPaused } = useEmiMutations();
  const [historyOpen, setHistoryOpen] = useState(false);
  const pct = Math.round((emi.paidInstallments / emi.totalInstallments) * 100);
  const account = accounts?.find((a) => a.id === emi.accountId);

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
          {account ? (
            <Link
              to={`/accounts/${emi.accountId}`}
              className="mt-0.5 inline-block text-xs text-slate-500 underline"
            >
              {account.name}
            </Link>
          ) : (
            <p className="mt-0.5 text-xs text-slate-400">Account unavailable</p>
          )}
          <LoanAccountSection emi={emi} accounts={accounts} />
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

      <details
        className="mt-4"
        open={historyOpen}
        onToggle={(e) => setHistoryOpen(e.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm text-slate-500">Installment history</summary>
        <div className="mt-2">
          <InstallmentHistory templateId={emi.templateId} open={historyOpen} />
        </div>
      </details>

      {emi.remainingInstallments > 0 && !emi.paused && <PrepayPanel emi={emi} />}
    </section>
  );
}

function LoanAccountSection({
  emi,
  accounts,
}: {
  emi: EmiSummary;
  accounts: AccountWithBalance[] | undefined;
}) {
  const { linkLoanAccount } = useEmiMutations();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");

  const loanAccount = accounts?.find((a) => a.id === emi.loanAccountId);
  const eligible = accounts?.filter(
    (a) =>
      !a.archivedAt &&
      (EMI_DESTINATION_TYPES as readonly string[]).includes(a.type) &&
      a.id !== emi.accountId,
  ) ?? [];

  if (emi.loanAccountId) {
    return (
      <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
        <Link
          to={`/accounts/${emi.loanAccountId}`}
          className="underline"
        >
          Loan account: {loanAccount?.name ?? "Unknown"}
        </Link>
        <button
          onClick={() => {
            if (!confirm("Unlink this loan account from the EMI?")) return;
            linkLoanAccount.mutate(
              { templateId: emi.templateId, loanAccountId: null },
              { onSuccess: () => toast("Loan account unlinked", "success") },
            );
          }}
          disabled={linkLoanAccount.isPending}
          className="text-slate-400 hover:text-red-500 disabled:opacity-40"
          title="Unlink loan account"
        >
          ×
        </button>
      </p>
    );
  }

  const canLink = emi.paidInstallments === 0;

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setSelectedId(eligible[0]?.id ?? ""); }}
        className="mt-0.5 text-xs text-brand-600 hover:underline disabled:text-slate-400 disabled:no-underline"
        disabled={!canLink || eligible.length === 0}
        title={
          !canLink
            ? "Can't link a loan account once installments have been paid"
            : eligible.length === 0
            ? "No eligible loan/OD accounts found"
            : undefined
        }
      >
        + Link loan account
      </button>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-2">
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="input text-xs py-0.5"
      >
        <option value="">Select…</option>
        {eligible.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
      <button
        onClick={() => {
          if (!selectedId) return;
          linkLoanAccount.mutate(
            { templateId: emi.templateId, loanAccountId: selectedId },
            {
              onSuccess: () => { setOpen(false); toast("Loan account linked", "success"); },
              onError: (err) => toast(err instanceof Error ? err.message : "Failed to link", "error"),
            },
          );
        }}
        disabled={!selectedId || linkLoanAccount.isPending}
        className="rounded-md bg-brand-600 px-2 py-0.5 text-xs text-white disabled:opacity-40"
      >
        {linkLoanAccount.isPending ? "Linking…" : "Link"}
      </button>
      <button
        onClick={() => setOpen(false)}
        className="text-xs text-slate-400 hover:text-slate-600"
      >
        Cancel
      </button>
    </div>
  );
}

function InstallmentHistory({ templateId, open }: { templateId: string; open: boolean }) {
  const { data: installments, isPending, isError } = useEmiInstallments(templateId, open);

  if (isPending) {
    return <p className="text-xs text-slate-400">Loading…</p>;
  }
  if (isError) {
    return <p className="text-xs text-slate-400">Couldn't load installment history.</p>;
  }
  if (installments.length === 0) {
    return <p className="text-xs text-slate-400">No installments recorded yet.</p>;
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-slate-500">
          <th className="pb-1 font-medium">Date</th>
          <th className="pb-1 font-medium">Amount</th>
          <th className="pb-1 font-medium">Principal</th>
          <th className="pb-1 font-medium">Interest</th>
          <th className="pb-1 font-medium">Balance after</th>
        </tr>
      </thead>
      <tbody>
        {installments.map((row) => (
          <tr key={row.transactionId} className="border-t border-slate-100">
            <td className="py-1 text-slate-600">{formatDisplayDate(row.date)}</td>
            <td className="py-1 text-slate-800">{formatINR(Math.abs(row.amountPaise))}</td>
            <td className="py-1 text-slate-800">{formatINR(row.principalPaise)}</td>
            <td className="py-1 text-slate-800">{formatINR(row.interestPaise)}</td>
            <td className="py-1 text-slate-800">{formatINR(row.balancePaise)}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
  const [loanAccountId, setLoanAccountId] = useState("");

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
        loanAccountId: loanAccountId || null,
      },
      {
        onSuccess: () => {
          setName("");
          setPrincipal("");
          setRate("");
          setTenure("");
          setLoanAccountId("");
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
          <select
            value={accountId}
            onChange={(e) => {
              const next = e.target.value;
              setAccountId(next);
              if (next && next === loanAccountId) setLoanAccountId("");
            }}
            className="input"
          >
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
          <DateField value={startDate} onChange={(iso) => setStartDate(iso)} className="w-full" aria-label="First installment date" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Loan account (optional)
          <select value={loanAccountId} onChange={(e) => setLoanAccountId(e.target.value)} className="input">
            <option value="">None</option>
            {accounts
              ?.filter(
                (a) =>
                  !a.archivedAt &&
                  (EMI_DESTINATION_TYPES as readonly string[]).includes(a.type) &&
                  a.id !== accountId,
              )
              .map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
          </select>
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
