import type { AccountType } from "@compass/shared";

/** Order the type dropdowns offer — commonest first, not enum order. */
export const ACCOUNT_TYPES: AccountType[] = [
  "bank",
  "cash",
  "credit_card",
  "investment",
  "loan",
  "overdraft",
  "home_loan_od",
  "ppf",
  "epf",
  "ssy",
];

// `insurance` is intentionally absent above — it's a deprecated account type
// (insurance is now its own feature), so the dropdown never offers it. The label
// stays below because AccountType still includes the value.
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: "Bank",
  cash: "Cash",
  credit_card: "Credit card",
  investment: "Investment",
  loan: "Loan",
  overdraft: "Overdraft loan",
  home_loan_od: "Home loan (overdraft)",
  ppf: "PPF",
  epf: "EPF",
  ssy: "Sukanya Samriddhi",
  insurance: "Insurance",
};

/** Masks all but the last 4 — the account number is shown only on request. */
export function maskAccountNumber(n: string): string {
  if (n.length <= 4) return n;
  return `${"•".repeat(n.length - 4)} ${n.slice(-4)}`;
}
