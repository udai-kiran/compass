import type { AccountType, AssetClass, GainsTaxClass } from "@compass/shared";
import { holdingAllocationClass } from "./goal-allocation.ts";
import type { GoalAllocationClass } from "./goal-allocation.ts";

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

/**
 * Assumed return for market-linked debt (debt/gilt/corporate-bond funds, MLDs,
 * unlisted bonds) — instruments with no declared rate, whose NAV tracks yields.
 * Deliberately distinct from the small-savings fallback below: they are the
 * same number today by coincidence, not by meaning, and must not be merged.
 */
export const DEFAULT_DEBT_RETURN_BPS = 700;

/**
 * Fallback rates for a credited-rate scheme with nothing stored yet. These are
 * the declared figures as of the FY2024-25 announcements and WILL go stale —
 * they exist only so an un-filled account beats projecting at a flat guess. A
 * stored `retirement_details.annual_rate_bps` always wins over these.
 */
const SMALL_SAVINGS_FALLBACK_BPS: Record<"ppf" | "epf" | "ssy", number> = {
  ppf: 710,
  epf: 825,
  ssy: 820,
};

/**
 * Reached only if a future account type is added to ACCOUNT_RETURN_BPS as
 * STORED without a matching SMALL_SAVINGS_FALLBACK_BPS entry. Unreachable
 * today — it exists so that such an omission degrades to a named, greppable
 * assumption instead of silently inheriting an unrelated constant. It is NOT
 * the same quantity as DEFAULT_DEBT_RETURN_BPS despite the equal value.
 */
const UNKNOWN_CREDITED_SCHEME_FALLBACK_BPS = 700;

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

/**
 * Asset classes whose assumption belongs to the asset itself rather than to the
 * equity/debt bucket it groups into: gold and NPS are neither, and an FD's
 * assumption is about deposit rates, not bond-fund yields. Everything else
 * takes its rate from its allocation class.
 */
const ASSET_SPECIFIC_RETURN_BPS: Partial<Record<AssetClass, number>> = {
  nps: 1000,
  gold: 800,
  fd: 700,
};

/**
 * Fallback per allocation class. Equity is deliberately absent: it resolves to
 * the user's configured rate via the early return in `holdingReturnBps`, and
 * excluding it from the type makes it impossible to reintroduce a hardcoded
 * equity assumption here that would silently override that setting.
 */
const ALLOCATION_RETURN_BPS: Record<Exclude<GoalAllocationClass, "equity">, number> = {
  debt: DEFAULT_DEBT_RETURN_BPS,
  other: 0,
};

/**
 * The assumed annual return for a mapped account. PPF/EPF/SSY resolve to their
 * stored rate, falling back to that scheme's own small-savings rate — never a
 * single flat number — when nothing has been recorded.
 */
export function accountReturnBps(
  type: AccountType,
  storedRateBps: number | null,
  equityReturnBps = DEFAULT_EQUITY_RETURN_BPS,
): number {
  if (type === "investment") return equityReturnBps;
  const base = ACCOUNT_RETURN_BPS[type];
  if (base !== STORED) return base;
  if (storedRateBps && storedRateBps > 0) return storedRateBps;
  // Only ppf/epf/ssy resolve to STORED above, but that fact lives in the data
  // (ACCOUNT_RETURN_BPS), not the type system — narrow explicitly rather than
  // asserting it with a cast.
  return isSmallSavingsType(type)
    ? SMALL_SAVINGS_FALLBACK_BPS[type]
    : UNKNOWN_CREDITED_SCHEME_FALLBACK_BPS;
}

function isSmallSavingsType(type: AccountType): type is keyof typeof SMALL_SAVINGS_FALLBACK_BPS {
  return type === "ppf" || type === "epf" || type === "ssy";
}

/**
 * The assumed annual return for a holding, derived from the same
 * `holdingAllocationClass` the goal card groups by rather than accepting a class
 * as a parameter — so a holding grouped as debt is never projected at the equity
 * rate, which is the drift this function exists to prevent.
 *
 * Under the residual `other` tax class the instrument's own assumption applies
 * instead (gold 800, NPS 1000, FD 700) — including for an FD, which derives to
 * debt but carries a deposit-rate assumption rather than a bond-fund one. That
 * is not a grouping disagreement: the allocation bucket is a portfolio view,
 * while these rates are properties of the instrument.
 */
export function holdingReturnBps(
  assetClass: AssetClass,
  taxClass: GainsTaxClass,
  equityReturnBps = DEFAULT_EQUITY_RETURN_BPS,
): number {
  const allocation = holdingAllocationClass(assetClass, taxClass);
  if (allocation === "equity") return equityReturnBps;
  // An explicit gains tax class is a deliberate signal and outranks the
  // instrument's own assumption — the same precedence the stock carve-out in
  // `holdingAllocationClass` applies. Only the residual "other" tax class
  // leaves the instrument as the best available evidence, so that is the one
  // case where a gold/NPS/FD assumption may refine the allocation fallback.
  if (taxClass === "other") {
    return ASSET_SPECIFIC_RETURN_BPS[assetClass] ?? ALLOCATION_RETURN_BPS[allocation];
  }
  return ALLOCATION_RETURN_BPS[allocation];
}
