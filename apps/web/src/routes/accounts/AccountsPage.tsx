import { Link } from "react-router";
import {
  formatINR,
  type AccountWithBalance,
  type BankAccountSubtype,
} from "@compass/shared";
import { useAccounts } from "../../lib/queries.ts";
import { ACCOUNT_TYPE_LABELS, maskAccountNumber } from "../../lib/account-meta.ts";
import { Icon } from "../../components/icons.tsx";
import {
  splitAccounts,
  owedPaise,
  balanceSummary,
  type AccountGroup,
} from "./account-groups.ts";

const SUBTYPE_LABELS: Record<BankAccountSubtype, string> = {
  savings: "Savings",
  current: "Current",
  salary: "Salary",
  nre: "NRE",
  nro: "NRO",
};

/** The label shown under an account name — the bank subtype if set, else the type. */
function accountKindLabel(a: AccountWithBalance): string {
  if (a.subtype) return SUBTYPE_LABELS[a.subtype];
  return ACCOUNT_TYPE_LABELS[a.type];
}

function AccountRow({ account }: { account: AccountWithBalance }) {
  return (
    <li>
      <Link
        to={`/accounts/${account.id}`}
        className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:bg-slate-50"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Icon name="wallet" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-800">{account.name}</p>
          <p className="truncate text-xs text-slate-400">
            {[
              accountKindLabel(account),
              account.institution,
              account.accountLast4 && maskAccountNumber(account.accountLast4),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span
          className={`shrink-0 tabular-nums font-semibold ${
            account.balancePaise < 0 ? "text-red-600" : "text-slate-800"
          }`}
        >
          {formatINR(account.balancePaise)}
        </span>
      </Link>
    </li>
  );
}

function AccountGroupTile({ title, group, showOwed }: { title: string; group: AccountGroup; showOwed?: boolean }) {
  const n = group.accounts.length;
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        <span className={`tabular-nums font-semibold ${group.totalPaise < 0 ? "text-red-600" : "text-slate-800"}`}>
          {formatINR(group.totalPaise)}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-slate-400">
        {showOwed
          ? `${formatINR(owedPaise(group.totalPaise))} owed · ${n} account${n === 1 ? "" : "s"}`
          : `${n} account${n === 1 ? "" : "s"}`}
      </p>
      <ul className="mt-3 space-y-2">
        {group.accounts.map((a) => (
          <AccountRow key={a.id} account={a} />
        ))}
      </ul>
    </section>
  );
}

export function AccountsPage() {
  const { data: accounts, isLoading } = useAccounts();

  if (isLoading) return <p className="text-sm text-slate-400">Loading…</p>;

  const groups = splitAccounts(accounts);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Accounts</h1>
        <Link
          to="/settings"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Manage accounts
        </Link>
      </div>

      {groups.count === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">No savings, current or overdraft accounts yet.</p>
          <Link to="/settings" className="mt-2 inline-block text-sm text-brand-600 underline">
            Add an account
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Total balance</p>
            <p
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                groups.totalPaise < 0 ? "text-red-600" : "text-slate-800"
              }`}
            >
              {formatINR(groups.totalPaise)}
            </p>
            <p className="mt-1 text-xs text-slate-400">{balanceSummary(groups)}</p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {groups.savings.accounts.length > 0 && (
              <AccountGroupTile title="Savings accounts" group={groups.savings} />
            )}
            {groups.loans.accounts.length > 0 && (
              <AccountGroupTile title="Loans" group={groups.loans} showOwed />
            )}
          </div>
        </>
      )}
    </div>
  );
}
