import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountTypeSchema } from "@compass/shared";
import { ACCOUNT_BUCKET } from "./networth.ts";

test("every account type is classified for net worth", () => {
  // A type missing here (undefined) contributes to neither assets nor
  // liabilities: the balance silently disappears from the balance sheet with
  // nothing to notice. This caught ppf/epf dropping ~4.6L before it shipped.
  // An explicit null is fine — it means "no balance of its own" (e.g. insurance,
  // a tracking record whose premiums live on the paying account).
  for (const type of AccountTypeSchema.options) {
    assert.ok(
      ACCOUNT_BUCKET[type] !== undefined,
      `account type "${type}" is not classified for net worth`,
    );
  }
});

test("insurance is a tracking record with no net-worth bucket", () => {
  assert.equal(ACCOUNT_BUCKET.insurance, null);
});

test("credited-balance schemes count as investment assets, not cash or debt", () => {
  assert.equal(ACCOUNT_BUCKET.ppf, "investmentAccountsPaise");
  assert.equal(ACCOUNT_BUCKET.epf, "investmentAccountsPaise");
  assert.equal(ACCOUNT_BUCKET.ssy, "investmentAccountsPaise");
});

test("account types map to the bucket their sign convention expects", () => {
  assert.equal(ACCOUNT_BUCKET.bank, "cashPaise");
  assert.equal(ACCOUNT_BUCKET.cash, "cashPaise");
  assert.equal(ACCOUNT_BUCKET.credit_card, "creditCardsPaise");
  assert.equal(ACCOUNT_BUCKET.loan, "loansPaise");
});
