import type { AccountType } from "@compass/shared";

/** Order the type dropdowns offer — commonest first, not enum order. */
export const ACCOUNT_TYPES: AccountType[] = [
  "bank",
  "cash",
  "credit_card",
  "investment",
  "loan",
  "ppf",
  "epf",
];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: "Bank",
  cash: "Cash",
  credit_card: "Credit card",
  investment: "Investment",
  loan: "Loan",
  ppf: "PPF",
  epf: "EPF",
};

/** Masks all but the last 4 — the account number is shown only on request. */
export function maskAccountNumber(n: string): string {
  if (n.length <= 4) return n;
  return `${"•".repeat(n.length - 4)} ${n.slice(-4)}`;
}
