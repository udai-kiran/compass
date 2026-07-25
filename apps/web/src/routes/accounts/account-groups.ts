import { formatINR, isLiabilityAccount, type AccountType, type AccountWithBalance } from "@compass/shared";

/**
 * Deposit / operating accounts you spend from — the ones with a running ledger.
 * Credit cards, term loans and investments have their own sections.
 */
export const OPERATING_TYPES: readonly AccountType[] = ["bank", "cash", "overdraft", "home_loan_od"];

export type AccountGroup = {
  accounts: AccountWithBalance[];
  /**
   * Plain signed sum of the group's balances. Deliberately NOT sign-flipped for
   * liabilities: the two group subtotals must add up to the page total, and an
   * overdraft home loan with surplus parked in it legitimately goes positive.
   */
  totalPaise: number;
};

export type AccountGroups = {
  savings: AccountGroup;
  loans: AccountGroup;
  /** savings.totalPaise + loans.totalPaise — the page's "Total balance". */
  totalPaise: number;
  count: number;
};

export function splitAccounts(accounts: readonly AccountWithBalance[] | undefined): AccountGroups {
  const filtered = (accounts ?? [])
    .filter((a) => !a.archivedAt && OPERATING_TYPES.includes(a.type))
    .slice() // copy before sorting to avoid mutating caller's array
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const savings: AccountWithBalance[] = [];
  const loans: AccountWithBalance[] = [];

  for (const account of filtered) {
    if (isLiabilityAccount(account.type)) {
      loans.push(account);
    } else {
      savings.push(account);
    }
  }

  const savingsTotalPaise = savings.reduce((s, a) => s + a.balancePaise, 0);
  const loansTotalPaise = loans.reduce((s, a) => s + a.balancePaise, 0);

  return {
    savings: { accounts: savings, totalPaise: savingsTotalPaise },
    loans: { accounts: loans, totalPaise: loansTotalPaise },
    totalPaise: savingsTotalPaise + loansTotalPaise,
    count: filtered.length,
  };
}

/**
 * Balances are negative for liabilities, so owed is the positive amount you owe;
 * a group in credit owes nothing.
 */
export function owedPaise(totalPaise: number): number {
  return Math.max(0, -totalPaise);
}

export function balanceSummary(groups: AccountGroups): string {
  const segments: string[] = [];
  if (groups.savings.accounts.length > 0) {
    segments.push(`${formatINR(groups.savings.totalPaise)} in savings`);
  }
  if (groups.loans.accounts.length > 0) {
    segments.push(`${formatINR(owedPaise(groups.loans.totalPaise))} owed`);
  }
  segments.push(`${groups.count} account${groups.count === 1 ? "" : "s"}`);
  return segments.join(" · ");
}
