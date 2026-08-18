/**
 * credit-schemas.test.ts — parity assertion + runtime safeParse tests for
 * the revolving-debt response schema from packages/shared/src/schemas/credit.ts.
 *
 * Tier B (DB-backed): HouseholdRevolvingDebt — build a satisfies-annotated
 * fixture using derivePaymentState and estimateMonthlyCharge (pure helpers),
 * no fake Db.
 *
 * Compile-time parity: 1 bidirectional Assert<Equal<z.output<...>, ServiceType>>
 * assertion (the remaining 6 are in planning-schemas.test.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// Service imports — aliased to avoid same-name collision with schema type aliases.
import type { HouseholdRevolvingDebt as ServiceHouseholdRevolvingDebt } from "./revolving-debt.ts";
import { derivePaymentState, estimateMonthlyCharge } from "./revolving-debt.ts";

// Schema imports from the shared package.
import {
  PaymentStateSchema,
  StatementPaymentStatusSchema,
  CardRevolvingStatusSchema,
  HouseholdRevolvingDebtSchema,
} from "@compass/shared";

// ---------------------------------------------------------------------------
// Parity helpers — compile-time bidirectional equality check.
// ---------------------------------------------------------------------------

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

// 7. HouseholdRevolvingDebt
type _HouseholdRevolvingDebtParity = Assert<
  Equal<z.output<typeof HouseholdRevolvingDebtSchema>, ServiceHouseholdRevolvingDebt>
>;

// ---------------------------------------------------------------------------
// Barrel smoke test — credit schema names importable from @compass/shared
// ---------------------------------------------------------------------------

test("barrel smoke: all required credit schema names are importable from @compass/shared", () => {
  const names = [
    PaymentStateSchema,
    StatementPaymentStatusSchema,
    CardRevolvingStatusSchema,
    HouseholdRevolvingDebtSchema,
  ];
  for (const schema of names) {
    assert.ok(schema !== undefined, "schema must be defined");
  }
});

// ---------------------------------------------------------------------------
// Tier B — fixture built from exported pure helpers, satisfies-annotated
// ---------------------------------------------------------------------------

test("HouseholdRevolvingDebtSchema: parses satisfies-checked fixture with revolving card", () => {
  // Build statement payment status using pure helpers
  const totalDuePaise = 50_000_00;  // ₹50k
  const minDuePaise = 5_000_00;     // ₹5k
  const paidByDueDatePaise = 10_000_00; // ₹10k — paid more than min, but less than total
  const aprBps = 3600; // 36% APR

  const state = derivePaymentState(totalDuePaise, minDuePaise, paidByDueDatePaise);
  const revolvingBalancePaise = Math.max(0, totalDuePaise - paidByDueDatePaise);
  const estimatedMonthlyChargePaise = estimateMonthlyCharge(revolvingBalancePaise, aprBps);

  // Build fixture BEFORE asserting state value to avoid TypeScript narrowing 'state'
  // to a literal type that makes isRevolving's comparison appear vacuous.
  const fixture = {
    cards: [
      {
        accountId: "card-001",
        accountName: "HDFC Regalia",
        latestStatement: {
          accountId: "card-001",
          period: "2026-07",
          totalDuePaise,
          minDuePaise,
          paidByDueDatePaise,
          state,
          revolvingBalancePaise,
          estimatedMonthlyChargePaise,
        },
        isRevolving: state !== "paid_in_full",
        revolvingBalancePaise,
      },
    ],
    totalRevolvingPaise: revolvingBalancePaise,
    hasRevolvingDebt: true,
    totalMonthlyChargePaise: estimatedMonthlyChargePaise ?? 0,
  } satisfies ServiceHouseholdRevolvingDebt;

  assert.equal(state, "minimum_only");

  const result = HouseholdRevolvingDebtSchema.safeParse(fixture);
  assert.equal(result.success, true, `safeParse failed: ${JSON.stringify(result.success ? undefined : result.error.issues)}`);
  assert.equal(result.data!.hasRevolvingDebt, true);
  assert.ok((result.data!.cards[0]!.latestStatement!.estimatedMonthlyChargePaise ?? 0) > 0);
});

test("HouseholdRevolvingDebtSchema: parses fixture with no cards (empty household)", () => {
  const fixture = {
    cards: [],
    totalRevolvingPaise: 0,
    hasRevolvingDebt: false,
    totalMonthlyChargePaise: 0,
  } satisfies ServiceHouseholdRevolvingDebt;

  const result = HouseholdRevolvingDebtSchema.safeParse(fixture);
  assert.equal(result.success, true, `safeParse failed: ${JSON.stringify(result.success ? undefined : result.error.issues)}`);
});

test("HouseholdRevolvingDebtSchema: parses fixture with null latestStatement", () => {
  const fixture = {
    cards: [
      {
        accountId: "card-002",
        accountName: "SBI Credit Card",
        latestStatement: null,
        isRevolving: false,
        revolvingBalancePaise: 0,
      },
    ],
    totalRevolvingPaise: 0,
    hasRevolvingDebt: false,
    totalMonthlyChargePaise: 0,
  } satisfies ServiceHouseholdRevolvingDebt;

  const result = HouseholdRevolvingDebtSchema.safeParse(fixture);
  assert.equal(result.success, true, `safeParse failed: ${JSON.stringify(result.success ? undefined : result.error.issues)}`);
  assert.equal(result.data!.cards[0]!.latestStatement, null);
});

test("HouseholdRevolvingDebtSchema: parses fixture with null totalDuePaise and null estimatedMonthlyChargePaise", () => {
  const state = derivePaymentState(null, null, 0);
  const fixture = {
    cards: [
      {
        accountId: "card-003",
        accountName: "Axis Ace",
        latestStatement: {
          accountId: "card-003",
          period: "2026-08",
          totalDuePaise: null,
          minDuePaise: null,
          paidByDueDatePaise: 0,
          state,
          revolvingBalancePaise: 0,
          estimatedMonthlyChargePaise: null,
        },
        isRevolving: false,
        revolvingBalancePaise: 0,
      },
    ],
    totalRevolvingPaise: 0,
    hasRevolvingDebt: false,
    totalMonthlyChargePaise: 0,
  } satisfies ServiceHouseholdRevolvingDebt;

  const result = HouseholdRevolvingDebtSchema.safeParse(fixture);
  assert.equal(result.success, true, `safeParse failed: ${JSON.stringify(result.success ? undefined : result.error.issues)}`);
  assert.equal(result.data!.cards[0]!.latestStatement!.totalDuePaise, null);
  assert.equal(result.data!.cards[0]!.latestStatement!.estimatedMonthlyChargePaise, null);
});

// ---------------------------------------------------------------------------
// Negative tests — required-nullable fields must be present
// ---------------------------------------------------------------------------

test("negative: omitting latestStatement (nullable) from CardRevolvingStatus fails", () => {
  const valid = {
    accountId: "card-001",
    accountName: "Test Card",
    latestStatement: null,
    isRevolving: false,
    revolvingBalancePaise: 0,
  };
  const withoutField = { ...valid };
  delete (withoutField as Partial<typeof withoutField>).latestStatement;
  const result = CardRevolvingStatusSchema.safeParse(withoutField);
  assert.equal(result.success, false, "omitting latestStatement must fail");
});

test("negative: omitting totalDuePaise (nullable) from StatementPaymentStatus fails", () => {
  const valid = {
    accountId: "card-001",
    period: "2026-08",
    totalDuePaise: null,
    minDuePaise: null,
    paidByDueDatePaise: 0,
    state: "unknown" as const,
    revolvingBalancePaise: 0,
    estimatedMonthlyChargePaise: null,
  };
  const withoutField = { ...valid };
  delete (withoutField as Partial<typeof withoutField>).totalDuePaise;
  const result = StatementPaymentStatusSchema.safeParse(withoutField);
  assert.equal(result.success, false, "omitting totalDuePaise must fail");
});

test("negative: omitting estimatedMonthlyChargePaise (nullable) from StatementPaymentStatus fails", () => {
  const valid = {
    accountId: "card-001",
    period: "2026-08",
    totalDuePaise: null,
    minDuePaise: null,
    paidByDueDatePaise: 0,
    state: "unknown" as const,
    revolvingBalancePaise: 0,
    estimatedMonthlyChargePaise: null,
  };
  const withoutField = { ...valid };
  delete (withoutField as Partial<typeof withoutField>).estimatedMonthlyChargePaise;
  const result = StatementPaymentStatusSchema.safeParse(withoutField);
  assert.equal(result.success, false, "omitting estimatedMonthlyChargePaise must fail");
});

// ---------------------------------------------------------------------------
// Enum rejection tests
// ---------------------------------------------------------------------------

test("negative: invalid PaymentState value fails", () => {
  const result = PaymentStateSchema.safeParse("fully_paid");
  assert.equal(result.success, false);
});

test("negative: invalid period format in StatementPaymentStatus fails", () => {
  const result = StatementPaymentStatusSchema.safeParse({
    accountId: "card-001",
    period: "2026-08-01",  // YYYY-MM-DD not accepted for YYYY-MM field
    totalDuePaise: null,
    minDuePaise: null,
    paidByDueDatePaise: 0,
    state: "unknown" as const,
    revolvingBalancePaise: 0,
    estimatedMonthlyChargePaise: null,
  });
  assert.equal(result.success, false, "YYYY-MM-DD must not match YYYY-MM format");
});

test("negative: invalid period month (13) in StatementPaymentStatus fails", () => {
  const result = StatementPaymentStatusSchema.safeParse({
    accountId: "card-001",
    period: "2026-13",
    totalDuePaise: null,
    minDuePaise: null,
    paidByDueDatePaise: 0,
    state: "unknown" as const,
    revolvingBalancePaise: 0,
    estimatedMonthlyChargePaise: null,
  });
  assert.equal(result.success, false, "month 13 must be rejected");
});

// ---------------------------------------------------------------------------
// Table-driven fractional money rejection — proves .int() is enforced
// ---------------------------------------------------------------------------

test("fractional money: HouseholdRevolvingDebt rejects 123.5 in every money field", () => {
  const baseStmt = {
    accountId: "card-001",
    period: "2026-08",
    totalDuePaise: 50_000,
    minDuePaise: 5_000,
    paidByDueDatePaise: 10_000,
    state: "minimum_only" as const,
    revolvingBalancePaise: 40_000,
    estimatedMonthlyChargePaise: 1_200,
  };
  const baseCard = {
    accountId: "card-001",
    accountName: "Test Card",
    latestStatement: baseStmt,
    isRevolving: true,
    revolvingBalancePaise: 40_000,
  };
  const base = {
    cards: [baseCard],
    totalRevolvingPaise: 40_000,
    hasRevolvingDebt: true,
    totalMonthlyChargePaise: 1_200,
  };

  const cases: Array<[string, unknown]> = [
    ["cards[0].latestStatement.totalDuePaise", { ...base, cards: [{ ...baseCard, latestStatement: { ...baseStmt, totalDuePaise: 123.5 } }] }],
    ["cards[0].latestStatement.minDuePaise", { ...base, cards: [{ ...baseCard, latestStatement: { ...baseStmt, minDuePaise: 123.5 } }] }],
    ["cards[0].latestStatement.paidByDueDatePaise", { ...base, cards: [{ ...baseCard, latestStatement: { ...baseStmt, paidByDueDatePaise: 123.5 } }] }],
    ["cards[0].latestStatement.revolvingBalancePaise", { ...base, cards: [{ ...baseCard, latestStatement: { ...baseStmt, revolvingBalancePaise: 123.5 } }] }],
    ["cards[0].latestStatement.estimatedMonthlyChargePaise", { ...base, cards: [{ ...baseCard, latestStatement: { ...baseStmt, estimatedMonthlyChargePaise: 123.5 } }] }],
    ["cards[0].revolvingBalancePaise", { ...base, cards: [{ ...baseCard, revolvingBalancePaise: 123.5 }] }],
    ["totalRevolvingPaise", { ...base, totalRevolvingPaise: 123.5 }],
    ["totalMonthlyChargePaise", { ...base, totalMonthlyChargePaise: 123.5 }],
  ];

  for (const [field, input] of cases) {
    const result = HouseholdRevolvingDebtSchema.safeParse(input);
    assert.equal(result.success, false, `HouseholdRevolvingDebt.${field} must reject 123.5`);
  }
});

// ---------------------------------------------------------------------------
// Non-finite rejection tests
// ---------------------------------------------------------------------------

test("non-finite: totalRevolvingPaise rejects NaN", () => {
  const result = HouseholdRevolvingDebtSchema.safeParse({
    cards: [],
    totalRevolvingPaise: NaN,
    hasRevolvingDebt: false,
    totalMonthlyChargePaise: 0,
  });
  assert.equal(result.success, false, "NaN must be rejected");
});

test("non-finite: totalMonthlyChargePaise rejects Infinity", () => {
  const result = HouseholdRevolvingDebtSchema.safeParse({
    cards: [],
    totalRevolvingPaise: 0,
    hasRevolvingDebt: false,
    totalMonthlyChargePaise: Infinity,
  });
  assert.equal(result.success, false, "Infinity must be rejected");
});
