import { test } from "node:test";
import assert from "node:assert/strict";
import { CreateAccountSchema, isRetirementAccount } from "./ledger.ts";
import {
  AssetClassSchema,
  CreateHoldingEventSchema,
  UpsertGoldDetailsSchema,
  UpsertNpsDetailsSchema,
  UpsertRetirementDetailsSchema,
} from "./wealth.ts";

test("a buy or sell holding event requires units; a dividend need not", () => {
  const base = { date: "2026-07-06", amountPaise: 100000 };
  assert.equal(CreateHoldingEventSchema.safeParse({ ...base, type: "buy", units: 10 }).success, true);
  assert.equal(CreateHoldingEventSchema.safeParse({ ...base, type: "buy" }).success, false);
  assert.equal(CreateHoldingEventSchema.safeParse({ ...base, type: "sell", units: null }).success, false);
  // A dividend is cash, no units.
  assert.equal(CreateHoldingEventSchema.safeParse({ ...base, type: "dividend" }).success, true);
});

test("PPF and EPF are account types, not asset classes", () => {
  // The whole point of the split: a credited balance is an account, a
  // mark-to-market one is a holding. Two homes for PPF would be a bug.
  assert.equal(AssetClassSchema.safeParse("ppf").success, false);
  assert.equal(AssetClassSchema.safeParse("epf").success, false);
  assert.equal(AssetClassSchema.safeParse("nps").success, true);
  assert.equal(AssetClassSchema.safeParse("gold").success, true);

  assert.equal(isRetirementAccount("ppf"), true);
  assert.equal(isRetirementAccount("epf"), true);
  assert.equal(isRetirementAccount("ssy"), true);
  assert.equal(isRetirementAccount("bank"), false);
  assert.equal(isRetirementAccount("investment"), false);
});

test("account last4 takes exactly 4 digits, or nothing", () => {
  const base = { name: "HDFC Joint", type: "bank" as const };
  assert.equal(CreateAccountSchema.safeParse({ ...base, accountLast4: "3510" }).success, true);
  assert.equal(CreateAccountSchema.safeParse({ ...base, accountLast4: null }).success, true);
  assert.equal(CreateAccountSchema.safeParse({ ...base, accountLast4: "351" }).success, false);
  assert.equal(CreateAccountSchema.safeParse({ ...base, accountLast4: "35100" }).success, false);
  assert.equal(CreateAccountSchema.safeParse({ ...base, accountLast4: "35a0" }).success, false);
  // A full account number must not slip through as a "last 4".
  assert.equal(
    CreateAccountSchema.safeParse({ ...base, accountLast4: "50100234567891" }).success,
    false,
  );
});

test("account defaults leave institution and last4 unset", () => {
  const parsed = CreateAccountSchema.parse({ name: "Cash", type: "cash" });
  assert.equal(parsed.institution, null);
  assert.equal(parsed.accountLast4, null);
  assert.equal(parsed.currency, "INR");
});

test("NPS scheme allocation must total 100%", () => {
  assert.equal(
    UpsertNpsDetailsSchema.safeParse({ equityPct: 50, corporatePct: 30, govtPct: 20 }).success,
    true,
  );
  assert.equal(
    UpsertNpsDetailsSchema.safeParse({ equityPct: 50, corporatePct: 30, govtPct: 10 }).success,
    false,
  );
  assert.equal(
    UpsertNpsDetailsSchema.safeParse({ equityPct: 60, corporatePct: 30, govtPct: 20 }).success,
    false,
  );
});

test("NPS defaults to tier I", () => {
  const parsed = UpsertNpsDetailsSchema.parse({ equityPct: 100, corporatePct: 0, govtPct: 0 });
  assert.equal(parsed.tier, "tier_i");
  assert.equal(parsed.pran, "");
});

test("gold purity applies to metal, not paper", () => {
  assert.equal(UpsertGoldDetailsSchema.safeParse({ form: "physical", purityKarat: 22 }).success, true);
  assert.equal(UpsertGoldDetailsSchema.safeParse({ form: "digital", purityKarat: 24 }).success, true);
  assert.equal(UpsertGoldDetailsSchema.safeParse({ form: "etf", purityKarat: 24 }).success, false);
  assert.equal(UpsertGoldDetailsSchema.safeParse({ form: "sgb", purityKarat: 24 }).success, false);
  // 18K exists as jewellery but isn't an investment grade we track.
  assert.equal(UpsertGoldDetailsSchema.safeParse({ form: "physical", purityKarat: 18 }).success, false);
});

test("only SGBs mature", () => {
  assert.equal(
    UpsertGoldDetailsSchema.safeParse({ form: "sgb", maturityDate: "2032-08-05" }).success,
    true,
  );
  assert.equal(
    UpsertGoldDetailsSchema.safeParse({ form: "physical", maturityDate: "2032-08-05" }).success,
    false,
  );
  assert.equal(
    UpsertGoldDetailsSchema.safeParse({ form: "etf", maturityDate: "2032-08-05" }).success,
    false,
  );
});

test("retirement rate is basis points, capped at 100%", () => {
  assert.equal(UpsertRetirementDetailsSchema.safeParse({ annualRateBps: 710 }).success, true);
  assert.equal(UpsertRetirementDetailsSchema.safeParse({ annualRateBps: 10000 }).success, true);
  assert.equal(UpsertRetirementDetailsSchema.safeParse({ annualRateBps: 10001 }).success, false);
  assert.equal(UpsertRetirementDetailsSchema.safeParse({ annualRateBps: -1 }).success, false);
  // 7.1 would be a percent — silently truncating it to 7bps would understate by 100x.
  assert.equal(UpsertRetirementDetailsSchema.safeParse({ annualRateBps: 7.1 }).success, false);
});
