import assert from "node:assert/strict";
import test from "node:test";
import { accountReturnBps, DEFAULT_EQUITY_RETURN_BPS, holdingReturnBps } from "./goal-returns.ts";

test("configured equity return applies to equity-style assets", () => {
  assert.equal(accountReturnBps("investment", null, 950), 950);
  assert.equal(holdingReturnBps("mutual_fund", "equity", 950), 950);
  assert.equal(holdingReturnBps("stock", "equity", 950), 950);
  assert.equal(holdingReturnBps("etf", "equity", 950), 950);
});

test("a non-equity mutual fund projects at the debt rate, not the equity rate", () => {
  // The fix: assetClass alone used to pick the return, so a debt fund
  // (specified_fund/other tax treatment) projected as if it were equity.
  assert.equal(holdingReturnBps("mutual_fund", "specified_fund", 950), 700);
  assert.equal(holdingReturnBps("mutual_fund", "other", 950), 700);
  assert.equal(holdingReturnBps("etf", "other", 950), 700);
  assert.equal(holdingReturnBps("other", "unlisted_bond", 950), 700);
  assert.equal(holdingReturnBps("other", "market_linked_debenture", 950), 700);
});

test("asset-specific assumptions apply under the residual tax class", () => {
  assert.equal(holdingReturnBps("gold", "other", 950), 800);
  assert.equal(holdingReturnBps("nps", "other", 950), 1000);
  // NOTE: this cannot distinguish the fd entry in ASSET_SPECIFIC_RETURN_BPS
  // from the debt fallback — both are 700 today. The entry is kept because it
  // means something different (deposit rate, not bond-fund yield) and will
  // diverge once per-FD contracted rates are stored.
  assert.equal(holdingReturnBps("fd", "other", 950), 700);
});

test("a residual holding with no equity, debt, or asset-specific signal grows at 0", () => {
  assert.equal(holdingReturnBps("other", "other", 950), 0);
});

test("a stock is equity-rated even when its tax class was hand-set to other", () => {
  assert.equal(holdingReturnBps("stock", "other", 950), 950);
  assert.equal(holdingReturnBps("stock", "unlisted_shares", 950), 950);
});

test("an explicit equity tax class outranks an asset-specific assumption", () => {
  assert.equal(holdingReturnBps("gold", "equity", 950), 950);
  assert.equal(holdingReturnBps("nps", "equity", 950), 950);
});

test("an explicit debt tax class outranks the stock carve-out", () => {
  assert.equal(holdingReturnBps("stock", "specified_fund", 950), 700);
  assert.equal(holdingReturnBps("stock", "market_linked_debenture", 950), 700);
  assert.equal(holdingReturnBps("stock", "unlisted_bond", 950), 700);
});

test("an explicit debt tax class outranks an asset-specific assumption", () => {
  // Grouping already calls these debt; the rate must agree rather than keeping
  // the instrument's own assumption.
  assert.equal(holdingReturnBps("gold", "specified_fund", 950), 700);
  assert.equal(holdingReturnBps("gold", "market_linked_debenture", 950), 700);
  assert.equal(holdingReturnBps("nps", "unlisted_bond", 950), 700);
  assert.equal(holdingReturnBps("fd", "specified_fund", 950), 700);
});

test("credited-rate schemes ignore the configured equity return", () => {
  // Deliberately not 710/825/820: those are the per-scheme fallbacks, so
  // reusing them would let this pass even if the stored rate were ignored.
  assert.equal(accountReturnBps("epf", 799, 950), 799);
  assert.equal(accountReturnBps("ppf", 655, 950), 655);
  assert.equal(accountReturnBps("ssy", 901, 950), 901);
});

test("a zero stored rate counts as not recorded", () => {
  assert.equal(accountReturnBps("epf", 0, 950), 825);
});

test("credited-rate schemes with no recorded rate fall back per scheme, not to a single default", () => {
  assert.equal(accountReturnBps("epf", null, 950), 825);
  assert.equal(accountReturnBps("ppf", null, 950), 710);
  assert.equal(accountReturnBps("ssy", null, 950), 820);
});

test("NPS accounts use a conservative blended market return", () => {
  assert.equal(accountReturnBps("nps", null, 950), 1000);
});

test("non-earning and liability accounts grow at 0", () => {
  assert.equal(accountReturnBps("bank", null, 950), 0);
  assert.equal(accountReturnBps("cash", null, 950), 0);
  assert.equal(accountReturnBps("loan", null, 950), 0);
  assert.equal(accountReturnBps("credit_card", null, 950), 0);
});

test("the equity rate defaults to the built-in assumption when not configured", () => {
  assert.equal(accountReturnBps("investment", null), DEFAULT_EQUITY_RETURN_BPS);
  assert.equal(holdingReturnBps("stock", "equity"), DEFAULT_EQUITY_RETURN_BPS);
});

test("an exempt holding keeps its instrument assumption, not the residual 0%", () => {
  // An SGB marked exempt is still gold: taxability says nothing about growth.
  // Without "exempt" joining the "other" gate this returns 0 and silently
  // zeroes a real asset in every goal projection that maps it.
  assert.equal(holdingReturnBps("gold", "exempt", 950), 800);
  assert.equal(holdingReturnBps("silver", "exempt", 950), 700);
  assert.equal(holdingReturnBps("real_estate", "exempt", 950), 700);
  assert.equal(holdingReturnBps("fd", "exempt", 950), 700);
  // An exempt debt fund must keep the debt rate, not fall to the residual 0%.
  assert.equal(holdingReturnBps("mutual_fund", "exempt", 950), 700);
  assert.equal(holdingReturnBps("etf", "exempt", 950), 700);
});

test("an exempt stock still projects at the configured equity rate", () => {
  assert.equal(holdingReturnBps("stock", "exempt", 950), 950);
});
