import { Link, useParams } from "react-router";
import { formatINR, type BankAccountSubtype, type Transaction } from "@compass/shared";
import { useAccounts, useCategories, useTransactionsInfinite } from "../../lib/queries.ts";
import { ACCOUNT_TYPE_LABELS, maskAccountNumber } from "../../lib/account-meta.ts";

const SUBTYPE_LABELS: Record<BankAccountSubtype, string> = {
  savings: "Savings",
  current: "Current",
  salary: "Salary",
  nre: "NRE",
  nro: "NRO",
};

export function AccountLedgerPage() {
  const { id } = useParams();
  const { data: accounts, isLoading: accountsLoading } = useAccounts();
  const { data: categories } = useCategories();
  const query = useTransactionsInfinite(id ? { accountId: id } : {});

  const account = accounts?.find((a) => a.id === id);
  const catName = (cid: string | null) =>
    cid ? (categories?.find((c) => c.id === cid)?.name ?? null) : null;

  if (accountsLoading) return <p className="p-6 text-sm text-slate-400">Loading…</p>;
  if (!account) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-500">That account no longer exists.</p>
        <Link to="/accounts" className="mt-2 inline-block text-sm text-slate-600 underline">
          Back to accounts
        </Link>
      </div>
    );
  }

  const kindLabel = account.subtype
    ? SUBTYPE_LABELS[account.subtype]
    : ACCOUNT_TYPE_LABELS[account.type];
  const txns = query.data?.pages.flatMap((p) => p.items) ?? [];
  const firstPage = query.data?.pages[0];
  const totalCount = firstPage?.totalCount ?? 0;
  const totalIn = firstPage?.totalInflowPaise ?? 0;
  const totalOut = firstPage?.totalOutflowPaise ?? 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/accounts" className="text-xs text-slate-500 underline">
        ‹ Back to accounts
      </Link>

      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-medium text-slate-800">{account.name}</h1>
          <p className="text-xs text-slate-500">
            {[kindLabel, account.institution, account.accountLast4 && maskAccountNumber(account.accountLast4)]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Link
          to={`/settings/accounts/${account.id}`}
          className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Edit account
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Current balance</p>
          <p
            className={`mt-1 text-2xl font-semibold tabular-nums ${
              account.balancePaise < 0 ? "text-red-600" : "text-slate-800"
            }`}
          >
            {formatINR(account.balancePaise)}
          </p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-medium text-emerald-700">Credits (in)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">
            {formatINR(totalIn)}
          </p>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <p className="text-xs font-medium text-rose-700">Debits (out)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-rose-700">
            {formatINR(totalOut)}
          </p>
        </div>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-baseline justify-between border-b border-slate-100 px-4 py-2.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Transactions</h2>
            <p className="text-xs text-slate-400">Everything posted to this account.</p>
          </div>
          <Link
            to={`/transactions?accountId=${account.id}`}
            className="text-xs text-brand-600 underline"
          >
            Open in Transactions
          </Link>
        </div>

        {query.isLoading ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">Loading…</p>
        ) : txns.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">
            No transactions in this account yet.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              <span className="min-w-0 flex-1">Description</span>
              <span className="w-24 shrink-0 text-right">Debit</span>
              <span className="w-24 shrink-0 text-right">Credit</span>
            </div>
            <ul>
              {txns.map((t) => (
                <TxnRow key={t.id} txn={t} categoryName={catName(t.categoryId)} />
              ))}
            </ul>
            <div className="flex items-center justify-between px-4 py-2.5 text-xs text-slate-400">
              <span>
                Showing {txns.length} of {totalCount}
              </span>
              {query.hasNextPage && (
                <button
                  type="button"
                  onClick={() => query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                  className="rounded-md border border-slate-300 px-3 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {query.isFetchingNextPage ? "Loading…" : "Load more"}
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function TxnRow({ txn, categoryName }: { txn: Transaction; categoryName: string | null }) {
  const isTransfer = txn.transferLinkId !== null;
  const isCredit = txn.amountPaise >= 0;
  const amount = formatINR(Math.abs(txn.amountPaise));
  return (
    <li className="flex items-center gap-3 border-b border-slate-50 px-4 py-2 text-sm last:border-0">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate font-medium text-slate-800">
          <span className="truncate">{txn.merchant || "—"}</span>
          {isTransfer && (
            <span className="shrink-0 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-normal text-slate-500">
              transfer
            </span>
          )}
        </p>
        <p className="text-xs text-slate-400">
          {txn.date}
          {categoryName ? ` · ${categoryName}` : ""}
        </p>
      </div>
      <span className="w-24 shrink-0 text-right tabular-nums text-slate-700">
        {isCredit ? "" : amount}
      </span>
      <span className="w-24 shrink-0 text-right tabular-nums text-emerald-600">
        {isCredit ? amount : ""}
      </span>
    </li>
  );
}
