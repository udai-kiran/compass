import { useEffect, useState } from "react";
import { formatINR, type Account, type Category, type ExtractedTransaction } from "@compass/shared";
import { useAccounts, useCategories } from "../../lib/queries.ts";
import { useInbox, useInboxMutations, useOrphanedInbox } from "../../lib/inbox-queries.ts";
import { toast } from "../../lib/toast.tsx";
import { CategoryPicker } from "../../components/CategoryPicker.tsx";
import { DateField } from "../../components/DateField.tsx";
import { isRepaymentEligible } from "./repayment-eligibility.ts";

const today = () => new Date().toISOString().slice(0, 10);

export function InboxPage() {
  const { data: drafts, isLoading } = useInbox("pending");
  const { data: duplicates } = useInbox("duplicate");
  const { data: orphaned } = useOrphanedInbox();
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
          check them, tweak anything that's off, and accept to add each to the ledger. A debit and
          a matching credit are grouped as one transfer. Nothing is added automatically.
        </p>
      </header>

      {orphaned && orphaned.length > 0 && <OrphanedSection rows={orphaned} />}

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}

      {drafts && drafts.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Nothing waiting for review. New transaction emails will show up here once connected.
        </div>
      )}

      <div className="space-y-3">
        {drafts ? groupDrafts(drafts, openAccounts, openCategories) : null}
      </div>

      {duplicates && duplicates.length > 0 && <DuplicatesGroup rows={duplicates} />}
    </div>
  );
}

/**
 * "Needs attention": accepted drafts whose ledger transaction was hard-deleted
 * after acceptance — otherwise invisible (gone from the pending queue, absent
 * from the ledger). Restore sends one back to `pending` for re-review;
 * Dismiss rejects it outright. Only rendered when non-empty.
 */
function OrphanedSection({ rows }: { rows: ExtractedTransaction[] }) {
  const { restore, reject } = useInboxMutations();
  const busy = restore.isPending || reject.isPending;
  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-amber-300">
      <div className="bg-amber-100 px-4 py-3">
        <p className="text-sm font-medium text-amber-900">
          {rows.length} accepted transactions are missing from your ledger
        </p>
        <p className="mt-0.5 text-xs text-amber-800">
          Their ledger entry was deleted after they were accepted. Restore to send one back to
          review, or dismiss if you don't want to track it.
        </p>
      </div>
      <ul className="divide-y divide-amber-100 bg-white">
        {rows.map((r) => {
          const isDebit = r.direction === "debit";
          return (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-slate-700">
                {r.counterparty || "Unknown"}
                <span className="ml-2 text-xs text-slate-400">{r.occurredAt ?? ""}</span>
                <span className="block truncate text-xs text-slate-400">
                  {r.subject} · {r.fromAddr}
                </span>
              </span>
              <span
                className={`shrink-0 tabular-nums ${isDebit ? "text-rose-700" : "text-emerald-700"}`}
              >
                {isDebit ? "−" : "+"}
                {formatINR(r.amountPaise)}
              </span>
              <button
                onClick={() => restore.mutate(r.id, { onSuccess: () => toast("Restored to review") })}
                disabled={busy}
                className="shrink-0 text-xs font-medium text-brand-700 hover:underline disabled:opacity-40"
              >
                Restore
              </button>
              <button
                onClick={() => reject.mutate(r.id, { onSuccess: () => toast("Dismissed") })}
                disabled={busy}
                className="shrink-0 text-xs text-slate-500 hover:text-slate-800 hover:underline disabled:opacity-40"
              >
                Dismiss
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Statement lines the matcher tied to a transaction already in the ledger (from
 * a real-time alert this cycle). Collapsed by default so they stay out of the
 * way; "Not a duplicate" sends one back to the pending queue if the match is wrong.
 */
function DuplicatesGroup({ rows }: { rows: ExtractedTransaction[] }) {
  const [open, setOpen] = useState(false);
  const { unmatch } = useInboxMutations();
  const missingCount = rows.filter((r) => r.matchedTransactionId === null).length;
  const matchedCount = rows.length - missingCount;
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-slate-600 hover:bg-slate-50"
      >
        <span>
          {missingCount === 0 ? (
            <>
              <span className="font-medium text-slate-700">{rows.length}</span> already in your
              ledger — matched from earlier alerts, hidden from review
            </>
          ) : matchedCount === 0 ? (
            <>
              <span className="font-medium text-slate-700">{rows.length}</span> previously matched —
              ledger entry missing, hidden from review
            </>
          ) : (
            <>
              <span className="font-medium text-slate-700">{matchedCount}</span> already in your
              ledger · <span className="font-medium text-slate-700">{missingCount}</span> previously
              matched — ledger entry missing
            </>
          )}
        </span>
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {rows.map((r) => {
            const isDebit = r.direction === "debit";
            return (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-slate-700">
                  {r.counterparty || "Unknown"}
                  <span className="ml-2 text-xs text-slate-400">{r.occurredAt ?? ""}</span>
                  {/* The matched ledger row was hard-deleted after matching — don't
                      assert a link that no longer exists. */}
                  {r.matchedTransactionId === null && (
                    <span className="ml-2 text-xs text-amber-600">
                      previously matched — ledger entry missing
                    </span>
                  )}
                </span>
                <span
                  className={`shrink-0 tabular-nums ${isDebit ? "text-rose-700" : "text-emerald-700"}`}
                >
                  {isDebit ? "−" : "+"}
                  {formatINR(r.amountPaise)}
                </span>
                <button
                  onClick={() => unmatch.mutate(r.id, { onSuccess: () => toast("Moved to review") })}
                  disabled={unmatch.isPending}
                  className="shrink-0 text-xs text-slate-500 hover:text-slate-800 hover:underline disabled:opacity-40"
                >
                  Not a duplicate
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Render the drafts, collapsing a matched debit+credit pair (draft.transferPartnerId)
 * into a single Transfer card so a fund movement is reviewed once, not twice.
 * Everything else renders as an ordinary draft.
 */
function groupDrafts(list: ExtractedTransaction[], accounts: Account[], categories: Category[]) {
  const rendered = new Set<string>();
  const items: React.ReactNode[] = [];
  for (const d of list) {
    if (rendered.has(d.id)) continue;
    const partner = d.transferPartnerId ? list.find((x) => x.id === d.transferPartnerId) : undefined;
    if (partner && !rendered.has(partner.id)) {
      rendered.add(d.id);
      rendered.add(partner.id);
      const debit = d.direction === "debit" ? d : partner;
      const credit = d.direction === "debit" ? partner : d;
      items.push(
        <TransferGroup
          key={`t-${debit.id}-${credit.id}`}
          debit={debit}
          credit={credit}
          accounts={accounts}
          categories={categories}
        />,
      );
    } else {
      rendered.add(d.id);
      items.push(<DraftCard key={d.id} draft={d} accounts={accounts} categories={categories} />);
    }
  }
  return items;
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
  const { accept, acceptRepayment, reject } = useInboxMutations();
  const [accountId, setAccountId] = useState(draft.suggestedAccountId ?? "");
  const [payingAccountId, setPayingAccountId] = useState("");
  const [categoryId, setCategoryId] = useState(draft.suggestedCategoryId ?? "");
  const [date, setDate] = useState(draft.occurredAt ?? today());
  const [merchant, setMerchant] = useState(draft.counterparty);

  const isDebit = draft.direction === "debit";
  const busy = accept.isPending || acceptRepayment.isPending || reject.isPending;
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const repaymentEligible = isRepaymentEligible(draft, selectedAccount);

  useEffect(() => {
    setPayingAccountId(selectedAccount?.linkedAccountId ?? "");
  }, [accountId, selectedAccount?.linkedAccountId]);

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

  function onRecordRepayment() {
    if (!payingAccountId) {
      toast("Pick a paying account first", "error");
      return;
    }
    acceptRepayment.mutate(
      { id: draft.id, cardAccountId: accountId, fromAccountId: payingAccountId, occurredAt: date },
      { onSuccess: () => toast("Card payment recorded", "success") },
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
            {/* Display-only: the model flagged this credit as a card bill payment,
                not a merchant refund. No behaviour changes on the back of it. */}
            {draft.intent === "repayment" && (
              <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
                Card payment
              </span>
            )}
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
          <CategoryPicker
            categories={categories}
            value={categoryId || null}
            onChange={(id) => setCategoryId(id ?? "")}
            kind={isDebit ? "expense" : "income"}
            emptyLabel="No category"
            className="w-full"
          />
        </Field>
        <Field label="Date">
          <DateField value={date} onChange={(iso) => setDate(iso)} className="w-full" aria-label="Transaction date" />
        </Field>
        <Field label="Merchant">
          <input value={merchant} onChange={(e) => setMerchant(e.target.value)} className="input" />
        </Field>
        {repaymentEligible && (
          <Field label="Paying account">
            <select
              value={payingAccountId}
              onChange={(e) => setPayingAccountId(e.target.value)}
              className="input"
              aria-label="Paying account"
            >
              <option value="">Select…</option>
              {accounts
                .filter((a) => a.id !== accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
            </select>
          </Field>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
        <button
          onClick={onAccept}
          disabled={busy}
          className="rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {accept.isPending ? "Adding…" : "Accept"}
        </button>
        {repaymentEligible && (
          <button
            onClick={onRecordRepayment}
            disabled={busy}
            className="rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-40"
          >
            {acceptRepayment.isPending ? "Recording…" : "Record as card payment"}
          </button>
        )}
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

/**
 * A detected transfer: one debit leg + its matching credit leg, offered as a
 * single "record transfer" action. "Not a transfer" drops back to two ordinary
 * draft cards so the reviewer is never trapped by a wrong guess.
 */
function TransferGroup({
  debit,
  credit,
  accounts,
  categories,
}: {
  debit: ExtractedTransaction;
  credit: ExtractedTransaction;
  accounts: Account[];
  categories: Category[];
}) {
  const { acceptTransfer } = useInboxMutations();
  const [notTransfer, setNotTransfer] = useState(false);
  const [fromAccountId, setFromAccountId] = useState(debit.suggestedAccountId ?? "");
  const [toAccountId, setToAccountId] = useState(credit.suggestedAccountId ?? "");
  const [date, setDate] = useState(debit.occurredAt ?? credit.occurredAt ?? today());

  if (notTransfer) {
    return (
      <div className="space-y-3">
        <DraftCard draft={debit} accounts={accounts} categories={categories} />
        <DraftCard draft={credit} accounts={accounts} categories={categories} />
      </div>
    );
  }

  const busy = acceptTransfer.isPending;

  function onRecord() {
    if (!fromAccountId || !toAccountId) {
      toast("Pick both accounts first", "error");
      return;
    }
    if (fromAccountId === toAccountId) {
      toast("From and To must be different accounts", "error");
      return;
    }
    acceptTransfer.mutate(
      { outId: debit.id, inId: credit.id, fromAccountId, toAccountId, occurredAt: date },
      { onSuccess: () => toast("Transfer added to the ledger", "success") },
    );
  }

  return (
    <section className="rounded-lg border border-indigo-200 bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-slate-800">Looks like a transfer</span>
            <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
              Transfer
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            A debit and a matching credit — record them as one movement between your accounts, not
            as spend + income.
          </p>
        </div>
        <span className="shrink-0 text-lg font-semibold tabular-nums text-slate-800">
          {formatINR(debit.amountPaise)}
        </span>
      </div>

      {(debit.sourceQuote || credit.sourceQuote) && (
        <div className="space-y-1 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs italic text-slate-500">
          {debit.sourceQuote && <p>“{debit.sourceQuote}”</p>}
          {credit.sourceQuote && <p>“{credit.sourceQuote}”</p>}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        <Field label="From account">
          <select
            value={fromAccountId}
            onChange={(e) => setFromAccountId(e.target.value)}
            className="input"
            aria-label="From account"
          >
            <option value="">Select…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </Field>
        <Field label="To account">
          <select
            value={toAccountId}
            onChange={(e) => setToAccountId(e.target.value)}
            className="input"
            aria-label="To account"
          >
            <option value="">Select…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <DateField value={date} onChange={(iso) => setDate(iso)} className="w-full" aria-label="Transfer date" />
        </Field>
      </div>

      <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
        <button
          onClick={onRecord}
          disabled={busy}
          className="rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {busy ? "Recording…" : "Record transfer"}
        </button>
        <button
          onClick={() => setNotTransfer(true)}
          disabled={busy}
          className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          Not a transfer
        </button>
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
