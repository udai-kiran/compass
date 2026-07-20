import { useState } from "react";
import { formatINR, type Account, type Category, type ExtractedTransaction } from "@compass/shared";
import { useAccounts, useCategories } from "../../lib/queries.ts";
import { useInbox, useInboxMutations } from "../../lib/inbox-queries.ts";
import { toast } from "../../lib/toast.tsx";

const today = () => new Date().toISOString().slice(0, 10);

export function InboxPage() {
  const { data: drafts, isLoading } = useInbox("pending");
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const openAccounts = (accounts ?? []).filter((a) => a.archivedAt === null);
  const openCategories = (categories ?? []).filter((c) => c.archivedAt === null);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-slate-800">Inbox</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Transactions our reader pulled from your email. We pre-fill the account and a category —
          reusing what you filed this merchant under before, or a best guess for a new one — so
          check them, tweak anything that's off, and accept to add each to the ledger. Nothing is
          added automatically.
        </p>
      </header>

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}

      {drafts && drafts.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Nothing waiting for review. New transaction emails will show up here once connected.
        </div>
      )}

      <div className="space-y-3">
        {drafts?.map((d) => (
          <DraftCard key={d.id} draft={d} accounts={openAccounts} categories={openCategories} />
        ))}
      </div>
    </div>
  );
}

function DraftCard({
  draft,
  accounts,
  categories,
}: {
  draft: ExtractedTransaction;
  accounts: Account[];
  categories: Category[];
}) {
  const { accept, reject } = useInboxMutations();
  const [accountId, setAccountId] = useState(draft.suggestedAccountId ?? "");
  const [categoryId, setCategoryId] = useState(draft.suggestedCategoryId ?? "");
  const [date, setDate] = useState(draft.occurredAt ?? today());
  const [merchant, setMerchant] = useState(draft.counterparty);

  const isDebit = draft.direction === "debit";
  const busy = accept.isPending || reject.isPending;
  // A debit is an expense, a credit is income — only offer categories of that kind.
  const relevantCategories = categories.filter((c) => c.kind === (isDebit ? "expense" : "income"));

  function onAccept() {
    if (!accountId) {
      toast("Pick an account first", "error");
      return;
    }
    accept.mutate(
      {
        id: draft.id,
        accountId,
        categoryId: categoryId || null,
        occurredAt: date,
        amountPaise: draft.amountPaise,
        direction: draft.direction,
        merchant: merchant.trim() || draft.counterparty || "—",
      },
      { onSuccess: () => toast("Added to the ledger", "success") },
    );
  }

  function onReject() {
    reject.mutate(draft.id, { onSuccess: () => toast("Dismissed") });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-base font-semibold text-slate-800">
              {draft.counterparty || "Unknown"}
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${
                isDebit ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {isDebit ? "Debit" : "Credit"}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {draft.subject} · {draft.fromAddr}
          </p>
        </div>
        <span
          className={`shrink-0 text-lg font-semibold tabular-nums ${isDebit ? "text-rose-700" : "text-emerald-700"}`}
        >
          {isDebit ? "−" : "+"}
          {formatINR(draft.amountPaise)}
        </span>
      </div>

      {draft.sourceQuote && (
        <p className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs italic text-slate-500">
          “{draft.sourceQuote}”
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <Field label="Account">
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="input"
            aria-label="Account"
          >
            <option value="">Select…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="input"
            aria-label="Category"
          >
            <option value="">No category</option>
            {relevantCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </Field>
        <Field label="Merchant">
          <input value={merchant} onChange={(e) => setMerchant(e.target.value)} className="input" />
        </Field>
      </div>

      <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
        <button
          onClick={onAccept}
          disabled={busy}
          className="rounded-md bg-slate-800 px-4 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {accept.isPending ? "Adding…" : "Accept"}
        </button>
        <button
          onClick={onReject}
          disabled={busy}
          className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          Reject
        </button>
        {draft.bankRef && <span className="ml-auto text-xs text-slate-400">Ref {draft.bankRef}</span>}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      {label}
      {children}
    </label>
  );
}
