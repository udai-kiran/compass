import type { AccountType, AssetClass } from "@compass/shared";

/**
 * Assumed annual growth rates, in basis points (710 = 7.10%), used to project a
 * goal's mapped assets forward. These are deliberately round, conservative,
 * long-horizon assumptions — not a forecast of any specific fund. They are shown
 * on the goal card so the user can see what the projection assumes.
 *
 * PPF/EPF/SSY are the exception: their rate is a credited fact, so the projection
 * reads the stored `retirement_details.annual_rate_bps` instead of guessing here
 * (marked "stored" below). Anything that is a liability or a non-earning balance
 * grows at 0.
 */

export const STORED = "stored" as const;
export const DEFAULT_EQUITY_RETURN_BPS = 1200;

export const ACCOUNT_RETURN_BPS: Record<AccountType, number | typeof STORED> = {
  bank: 0,
  cash: 0,
  // A generic investment account (broker cash, etc.) — treated like broad equity.
  investment: DEFAULT_EQUITY_RETURN_BPS,
  // Credited-rate schemes: use the exact stored rate, never an assumption.
  ppf: STORED,
  epf: STORED,
  ssy: STORED,
  // NPS is market-linked; use a conservative blended long-horizon assumption.
  nps: 1000,
  // Liabilities don't "grow" a goal; their balance is already negative and stays flat here.
  credit_card: 0,
  loan: 0,
  overdraft: 0,
  home_loan_od: 0,
  // An insurance policy isn't a goal-eligible asset (accountCanHaveGoal excludes
  // it), so this is never actually read — but the map is exhaustive, and a
  // tracking record with no balance doesn't grow anything.
  insurance: 0,
};

export const ASSET_CLASS_RETURN_BPS: Record<AssetClass, number> = {
  stock: DEFAULT_EQUITY_RETURN_BPS,
  mutual_fund: DEFAULT_EQUITY_RETURN_BPS,
  etf: DEFAULT_EQUITY_RETURN_BPS,
  nps: 1000,
  gold: 800,
  fd: 700,
  other: 0,
};

/**
 * The assumed annual return for a mapped account. PPF/EPF/SSY resolve to their
 * stored rate (falling back to a sensible default when none was recorded).
 */
export function accountReturnBps(
  type: AccountType,
  storedRateBps: number | null,
  equityReturnBps = DEFAULT_EQUITY_RETURN_BPS,
): number {
  if (type === "investment") return equityReturnBps;
  const base = ACCOUNT_RETURN_BPS[type];
  if (base !== STORED) return base;
  // PPF/EPF/SSY with no recorded rate: a modest small-savings default beats 0.
  return storedRateBps && storedRateBps > 0 ? storedRateBps : 700;
}

export function assetClassReturnBps(
  assetClass: AssetClass,
  equityReturnBps = DEFAULT_EQUITY_RETURN_BPS,
): number {
  if (assetClass === "stock" || assetClass === "mutual_fund" || assetClass === "etf") {
    return equityReturnBps;
  }
  return ASSET_CLASS_RETURN_BPS[assetClass];
}
