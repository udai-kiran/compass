import { test } from "node:test";
import assert from "node:assert/strict";
import {
  availableToDrawPaise,
  isOverdraftAccount,
  UpsertOverdraftDetailsSchema,
} from "./ledger.ts";

test("drawing power is the limit minus what you owe", () => {
  // Limit 50L, owe 40L → 10L parked surplus you can pull back out.
  assert.equal(availableToDrawPaise(5_000_000_00, 4_000_000_00), 1_000_000_00);
  // Nothing parked: you owe the whole limit.
  assert.equal(availableToDrawPaise(5_000_000_00, 5_000_000_00), 0);
});

test("drawing power never goes negative", () => {
  // Owing more than the limit shouldn't imply you can withdraw a negative amount.
  assert.equal(availableToDrawPaise(4_000_000_00, 5_000_000_00), 0);
  assert.equal(availableToDrawPaise(0, 0), 0);
});

test("only overdraft loans carry overdraft details", () => {
  assert.equal(isOverdraftAccount("overdraft"), true);
  assert.equal(isOverdraftAccount("home_loan_od"), true);
  // A plain loan has no drawing power — it must not offer the section.
  assert.equal(isOverdraftAccount("loan"), false);
  assert.equal(isOverdraftAccount("bank"), false);
  assert.equal(isOverdraftAccount("ppf"), false);
});

test("overdraft details default to zero when unset", () => {
  assert.deepEqual(UpsertOverdraftDetailsSchema.parse({}), {
    sanctionedLimitPaise: 0,
    annualRateBps: 0,
  });
});

test("a home-loan rate above 20% is rejected as a typo", () => {
  assert.equal(UpsertOverdraftDetailsSchema.safeParse({ annualRateBps: 855 }).success, true);
  assert.equal(UpsertOverdraftDetailsSchema.safeParse({ annualRateBps: 2500 }).success, false);
  assert.equal(UpsertOverdraftDetailsSchema.safeParse({ annualRateBps: -1 }).success, false);
});

test("a negative sanctioned limit is rejected", () => {
  assert.equal(UpsertOverdraftDetailsSchema.safeParse({ sanctionedLimitPaise: -100 }).success, false);
});
