import { Link } from "react-router";
import {
  formatINR,
  type AccountType,
  type AccountWithBalance,
  type BankAccountSubtype,
} from "@compass/shared";
import { useAccounts } from "../../lib/queries.ts";
import { ACCOUNT_TYPE_LABELS, maskAccountNumber } from "../../lib/account-meta.ts";
import { Icon } from "../../components/icons.tsx";

// Deposit / operating accounts you spend from — the ones with a running ledger.
// Credit cards, loans and investments have their own sections.
const OPERATING_TYPES: readonly AccountType[] = ["bank", "cash", "overdraft", "home_loan_od"];

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

export function AccountsPage() {
  const { data: accounts, isLoading } = useAccounts();

  if (isLoading) return <p className="text-sm text-slate-400">Loading…</p>;

  const rows = (accounts ?? [])
    .filter((a) => !a.archivedAt && OPERATING_TYPES.includes(a.type))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const total = rows.reduce((s, a) => s + a.balancePaise, 0);

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

      {rows.length === 0 ? (
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
                total < 0 ? "text-red-600" : "text-slate-800"
              }`}
            >
              {formatINR(total)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Across {rows.length} account{rows.length === 1 ? "" : "s"}
            </p>
          </div>

          <ul className="space-y-2">
            {rows.map((a) => (
              <li key={a.id}>
                <Link
                  to={`/accounts/${a.id}`}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <Icon name="wallet" className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-800">{a.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {[
                        accountKindLabel(a),
                        a.institution,
                        a.accountLast4 && maskAccountNumber(a.accountLast4),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 tabular-nums font-semibold ${
                      a.balancePaise < 0 ? "text-red-600" : "text-slate-800"
                    }`}
                  >
                    {formatINR(a.balancePaise)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
