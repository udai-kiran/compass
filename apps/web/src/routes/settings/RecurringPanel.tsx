import { useState, type FormEvent } from "react";
import { formatDisplayDate, formatINR, type RecurringFrequency } from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import { useAccounts, useCategories } from "../../lib/queries.ts";
import { useRecurring, useRecurringMutations } from "../../lib/budget-queries.ts";
import { useResources } from "../../lib/resource-queries.ts";
import { DateField } from "../../components/DateField.tsx";

const FREQUENCIES: RecurringFrequency[] = ["daily", "weekly", "monthly", "yearly"];

export function RecurringPanel() {
  const { data: templates } = useRecurring();
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const { create, update, remove } = useRecurringMutations();
  const { data: resources } = useResources();

  const active = accounts?.filter((a) => !a.archivedAt) ?? [];
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [templateKind, setTemplateKind] = useState<"none" | "bill" | "subscription">("none");
  const [frequency, setFrequency] = useState<RecurringFrequency>("monthly");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [nextDue, setNextDue] = useState(new Date().toISOString().slice(0, 10));
  const [resourceId, setResourceId] = useState("");
  const effAccount = accountId || active[0]?.id || "";

  function submit(e: FormEvent) {
    e.preventDefault();
    const rupees = parseFloat(amount);
    if (!merchant || !effAccount || Number.isNaN(rupees) || rupees <= 0) return;
    create.mutate(
      {
        accountId: effAccount,
        merchant,
        amountPaise: Math.round(rupees * 100) * (kind === "expense" ? -1 : 1),
        frequency,
        nextDueDate: nextDue,
        categoryId: categoryId || null,
        resourceId: resourceId || null,
        kind: templateKind,
      },
      {
        onSuccess: () => {
          setMerchant("");
          setAmount("");
          toast("Recurring template created", "success");
        },
      },
    );
  }

  const accName = (id: string) => accounts?.find((a) => a.id === id)?.name ?? "…";
  const catName = (id: string | null) =>
    id === null ? "—" : (categories?.find((c) => c.id === id)?.name ?? "…");

  return (
    <div className="mt-4 max-w-3xl">
      <p className="text-xs text-slate-400">
        Due instances are created automatically each day (and immediately when already due), marked
        as <code>recurring</code> and editable like any transaction.
      </p>
      <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <select value={kind} onChange={(e) => setKind(e.target.value as "expense" | "income")} className="rounded-md border border-slate-300 px-2 py-1.5">
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <input placeholder="Merchant / payee" value={merchant} onChange={(e) => setMerchant(e.target.value)} className="w-40 rounded-md border border-slate-300 px-2 py-1.5" />
        <input placeholder="₹ amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-right" />
        <select value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringFrequency)} className="rounded-md border border-slate-300 px-2 py-1.5">
          {FREQUENCIES.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <select value={templateKind} onChange={(e) => setTemplateKind(e.target.value as typeof templateKind)} className="rounded-md border border-slate-300 px-2 py-1.5">
          <option value="none">Recurring</option>
          <option value="bill">Bill</option>
          <option value="subscription">Subscription</option>
        </select>
        <label className="flex items-center gap-1 text-slate-500">
          next due
          <DateField value={nextDue} onChange={(iso) => setNextDue(iso)} className="w-36" aria-label="Next due date" />
        </label>
        <select value={effAccount} onChange={(e) => setAccountId(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5">
          {active.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5">
          <option value="">Category…</option>
          {categories?.filter((c) => !c.archivedAt && c.kind === kind).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={resourceId} onChange={(e) => setResourceId(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5">
          <option value="">Asset / connection…</option>
          {resources?.filter((r) => !r.archived).map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <button type="submit" disabled={create.isPending} className="rounded-md bg-brand-600 px-3 py-1.5 text-white disabled:opacity-50">
          Add
        </button>
      </form>

      <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {templates?.map((t) => (
          <li key={t.id} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${t.paused ? "opacity-50" : ""}`}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-slate-700">
                {t.merchant}
                {t.paused && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500">paused</span>}
              </p>
              <p className="text-xs text-slate-400">
                {t.frequency}{t.interval > 1 ? ` ×${t.interval}` : ""} · next {formatDisplayDate(t.nextDueDate)} · {accName(t.accountId)} · {catName(t.categoryId)}
                {t.endDate && ` · ends ${formatDisplayDate(t.endDate)}`}
                {t.resourceId && ` · ${resources?.find((r) => r.id === t.resourceId)?.name ?? "linked resource"}`}
              </p>
            </div>
            <span className={`tabular-nums ${t.amountPaise < 0 ? "text-slate-800" : "text-emerald-600"}`}>
              {formatINR(t.amountPaise)}
            </span>
            <select
              aria-label={`Asset or connection for ${t.merchant}`}
              value={t.resourceId ?? ""}
              onChange={(e) => update.mutate({ id: t.id, resourceId: e.target.value || null })}
              className="max-w-40 rounded-md border border-slate-200 px-1.5 py-1 text-xs"
            >
              <option value="">No connection</option>
              {resources?.filter((r) => !r.archived).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <button
              className="text-xs text-slate-500 underline"
              onClick={() => update.mutate({ id: t.id, paused: !t.paused })}
            >
              {t.paused ? "Resume" : "Pause"}
            </button>
            <button
              className="text-xs text-slate-500 underline"
              onClick={() => {
                const end = prompt("End date (YYYY-MM-DD):", t.nextDueDate);
                if (end) update.mutate({ id: t.id, endDate: end }, { onSuccess: () => toast("End date set", "success") });
              }}
            >
              End
            </button>
            <button className="text-slate-400 hover:text-red-600" onClick={() => remove.mutate(t.id)}>✕</button>
          </li>
        ))}
        {templates?.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-slate-400">No recurring templates yet.</li>
        )}
      </ul>
    </div>
  );
}
