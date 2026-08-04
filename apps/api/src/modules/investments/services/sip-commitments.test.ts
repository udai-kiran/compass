import assert from "node:assert/strict";
import test from "node:test";
import { classifySipTarget, committedSplit, monthlyEquivalentPaise } from "./sip-commitments.ts";

// ---------- committedSplit / classifySipTarget ----------

test("committedSplit sums active SIPs into their equity/debt legs", () => {
  assert.deepEqual(
    committedSplit([
      { amountPaise: 5_000_00, allocationClass: "equity" },
      { amountPaise: 3_000_00, allocationClass: "debt" },
      { amountPaise: 2_000_00, allocationClass: "equity" },
    ]),
    { committedEquityPaise: 7_000_00, committedDebtPaise: 3_000_00 },
  );
});

test("committedSplit ignores 'other' targets and handles an empty list", () => {
  assert.deepEqual(
    committedSplit([{ amountPaise: 1_000_00, allocationClass: "other" }]),
    { committedEquityPaise: 0, committedDebtPaise: 0 },
  );
  assert.deepEqual(committedSplit([]), { committedEquityPaise: 0, committedDebtPaise: 0 });
});

test("classifySipTarget: an mf_folio SIP takes its holding's classification", () => {
  assert.equal(
    classifySipTarget({
      targetKind: "mf_folio",
      holding: { assetClass: "mutual_fund", gainsTaxClass: "equity" },
      account: null,
    }),
    "equity",
  );
  assert.equal(
    classifySipTarget({
      targetKind: "mf_folio",
      holding: { assetClass: "mutual_fund", gainsTaxClass: "specified_fund" },
      account: null,
    }),
    "debt",
  );
});

test("classifySipTarget: credited schemes are debt while blended NPS stays other", () => {
  assert.equal(
    classifySipTarget({ targetKind: "account", holding: null, account: { type: "ppf" } }),
    "debt",
  );
  assert.equal(
    classifySipTarget({ targetKind: "account", holding: null, account: { type: "ssy" } }),
    "debt",
  );
  assert.equal(
    classifySipTarget({ targetKind: "account", holding: null, account: { type: "nps" } }),
    "other",
  );
});

test("classifySipTarget: a missing joined target (deleted row) degrades to 'other', not a crash", () => {
  assert.equal(classifySipTarget({ targetKind: "mf_folio", holding: null, account: null }), "other");
  assert.equal(classifySipTarget({ targetKind: "account", holding: null, account: null }), "other");
});

// ---------- frequency monthlyization ----------

test("monthlyEquivalentPaise: monthly passes through, quarterly/yearly divide down (rounded)", () => {
  assert.equal(monthlyEquivalentPaise(5_000_00, "monthly"), 5_000_00);
  assert.equal(monthlyEquivalentPaise(36_000_00, "quarterly"), 12_000_00);
  assert.equal(monthlyEquivalentPaise(1_20_000_00, "yearly"), 10_000_00);
  // rounds rather than truncating/erroring on a non-exact split
  assert.equal(monthlyEquivalentPaise(1_000_00, "quarterly"), 33_333); // 100000/3 = 33333.33
  assert.equal(monthlyEquivalentPaise(1_000_00, "yearly"), 8_333); // 100000/12 = 8333.33
});

test("committedSplit monthlyizes each SIP's contribution by its own frequency before summing", () => {
  assert.deepEqual(
    committedSplit([
      // MF SIP, monthly, equity
      { amountPaise: 10_000_00, frequency: "monthly", allocationClass: "equity" },
      // PPF SIP, quarterly, debt — contributes a third per month
      { amountPaise: 30_000_00, frequency: "quarterly", allocationClass: "debt" },
      // SSY SIP, yearly, debt — contributes a twelfth per month
      { amountPaise: 1_20_000_00, frequency: "yearly", allocationClass: "debt" },
    ]),
    { committedEquityPaise: 10_000_00, committedDebtPaise: 10_000_00 + 10_000_00 },
  );
});

test("committedSplit treats a missing frequency as monthly (backward compatible)", () => {
  assert.deepEqual(
    committedSplit([{ amountPaise: 5_000_00, allocationClass: "equity" }]),
    { committedEquityPaise: 5_000_00, committedDebtPaise: 0 },
  );
});
