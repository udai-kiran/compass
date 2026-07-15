import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountTypeSchema } from "@compass/shared";
import { ACCOUNT_BUCKET } from "./networth.ts";

test("every account type has a net-worth bucket", () => {
  // A type missing here contributes to neither assets nor liabilities: the
  // balance silently disappears from the balance sheet with nothing to notice.
  // This caught ppf/epf dropping ~4.6L from net worth before it shipped.
  for (const type of AccountTypeSchema.options) {
    assert.ok(ACCOUNT_BUCKET[type], `account type "${type}" is not classified for net worth`);
  }
});

test("PPF and EPF count as investment assets, not cash or debt", () => {
  assert.equal(ACCOUNT_BUCKET.ppf, "investmentAccountsPaise");
  assert.equal(ACCOUNT_BUCKET.epf, "investmentAccountsPaise");
});

test("account types map to the bucket their sign convention expects", () => {
  assert.equal(ACCOUNT_BUCKET.bank, "cashPaise");
  assert.equal(ACCOUNT_BUCKET.cash, "cashPaise");
  assert.equal(ACCOUNT_BUCKET.credit_card, "creditCardsPaise");
  assert.equal(ACCOUNT_BUCKET.loan, "loansPaise");
});
