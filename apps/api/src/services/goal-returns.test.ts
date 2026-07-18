import assert from "node:assert/strict";
import test from "node:test";
import { accountReturnBps, assetClassReturnBps } from "./goal-returns.ts";

test("configured equity return applies to equity-style assets", () => {
  assert.equal(accountReturnBps("investment", null, 950), 950);
  assert.equal(assetClassReturnBps("stock", 950), 950);
  assert.equal(assetClassReturnBps("mutual_fund", 950), 950);
  assert.equal(assetClassReturnBps("etf", 950), 950);
});

test("credited-rate schemes ignore the configured equity return", () => {
  assert.equal(accountReturnBps("epf", 825, 950), 825);
  assert.equal(accountReturnBps("ppf", 710, 950), 710);
  assert.equal(accountReturnBps("ssy", 820, 950), 820);
});

test("non-equity holdings retain their own assumptions", () => {
  assert.equal(assetClassReturnBps("nps", 950), 1000);
  assert.equal(assetClassReturnBps("gold", 950), 800);
  assert.equal(assetClassReturnBps("fd", 950), 700);
});
