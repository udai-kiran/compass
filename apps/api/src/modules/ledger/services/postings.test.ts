import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import type { SystemKind } from "./postings.ts";
import {
  assertSafePaise,
  assertZeroSum,
  buildOpeningPostings,
  buildOrdinaryPostings,
  buildSplitPostings,
  buildTransferLegPostings,
  buildTransferPostings,
  classifyShape,
  projectCounter,
  projectRealLeg,
  projectSplits,
  sumPaise,
} from "./postings.ts";
import { HttpError } from "../../../lib/errors.ts";

/** Builds a systemKindOf projection from a map of known system accounts. */
function systemKindOf(accountKinds: Record<string, SystemKind>): (accountId: string) => SystemKind | null {
  return (accountId) => accountKinds[accountId] ?? null;
}

const balanceError = (err: unknown): boolean =>
  err instanceof HttpError &&
  err.statusCode === 400 &&
  err.message.startsWith("postings do not balance");

// ---------------------------------------------------------------------------
// (a) assertSafePaise / sumPaise / assertZeroSum property loop
// ---------------------------------------------------------------------------

test("assertSafePaise rejects non-safe integers", () => {
  assert.doesNotThrow(() => assertSafePaise(0));
  assert.doesNotThrow(() => assertSafePaise(Number.MAX_SAFE_INTEGER));
  assert.doesNotThrow(() => assertSafePaise(-Number.MAX_SAFE_INTEGER));
  assert.throws(() => assertSafePaise(Number.MAX_SAFE_INTEGER + 1), (err: unknown) => err instanceof HttpError && err.statusCode === 400);
  assert.throws(() => assertSafePaise(-(Number.MAX_SAFE_INTEGER + 1)), (err: unknown) => err instanceof HttpError && err.statusCode === 400);
  assert.throws(() => assertSafePaise(1.5), (err: unknown) => err instanceof HttpError && err.statusCode === 400);
});

test("sumPaise sums exactly via BigInt and rejects unsafe results", () => {
  assert.equal(sumPaise([]), 0);
  assert.equal(sumPaise([100, 200, 300]), 600);
  assert.equal(sumPaise([-100, 50]), -50);
  assert.equal(sumPaise([Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 5]), 5);
  // individual unsafe operand
  assert.throws(() => sumPaise([Number.MAX_SAFE_INTEGER + 1]), (err: unknown) => err instanceof HttpError && err.statusCode === 400);
  // operands safe but the sum overflows the safe range
  assert.throws(() => sumPaise([Number.MAX_SAFE_INTEGER, 1]), (err: unknown) => err instanceof HttpError && err.statusCode === 400);
});

test("assertZeroSum: random balanced sets pass, perturbed sets throw (fast-check)", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 }), { minLength: 1, maxLength: 7 }),
      fc.integer({ min: 0, max: 6 }),
      fc.boolean(),
      (rest, idxSeed, perturbPositive) => {
        let sum = 0n;
        for (const a of rest) sum += BigInt(a);
        const last = Number(-sum);
        // Skip when the balancing leg falls outside the safe-integer range.
        if (!Number.isSafeInteger(last)) return;
        const amounts = [...rest, last];
        const legs = amounts.map((amountPaise) => ({ amountPaise }));

        // k-1 random safe amounts + the negation of their sum always balances.
        assert.doesNotThrow(() => assertZeroSum(legs));

        // Perturbing one leg by ±1 must unbalance the set.
        const idx = idxSeed % amounts.length;
        const perturbed = [...legs];
        perturbed[idx] = { amountPaise: perturbed[idx]!.amountPaise + (perturbPositive ? 1 : -1) };
        assert.throws(() => assertZeroSum(perturbed), balanceError);
      },
    ),
    { numRuns: 500 },
  );
});

test("assertZeroSum: boundary legs near ±MAX_SAFE_INTEGER", () => {
  const max = Number.MAX_SAFE_INTEGER;
  // Exactly balanced at the safe boundary — accepts.
  assert.doesNotThrow(() => assertZeroSum([{ amountPaise: max }, { amountPaise: -max }]));
  assert.doesNotThrow(() => assertZeroSum([{ amountPaise: -max }, { amountPaise: max }]));
  // Off-by-one — rejects (both legs are safe, the sum is not zero).
  assert.throws(() => assertZeroSum([{ amountPaise: max }, { amountPaise: -(max - 1) }]), balanceError);
  assert.throws(() => assertZeroSum([{ amountPaise: max - 1 }, { amountPaise: -max }]), balanceError);
});

// ---------------------------------------------------------------------------
// (b) builders — zero-sum sets with correct signs for worked examples
// ---------------------------------------------------------------------------

test("buildOrdinaryPostings: -200000 expense → asset -200000 + Expenses +200000", () => {
  const postings = buildOrdinaryPostings({
    accountId: "acc-1",
    amountPaise: -200000,
    categoryId: "cat-1",
    necessity: "essential",
    systemExpensesAccountId: "sys-exp",
    systemIncomeAccountId: "sys-inc",
  });
  assert.deepEqual(postings, [
    { accountId: "acc-1", amountPaise: -200000, categoryId: null, necessity: null, note: "" },
    { accountId: "sys-exp", amountPaise: 200000, categoryId: "cat-1", necessity: "essential", note: "" },
  ]);
  assert.doesNotThrow(() => assertZeroSum(postings));
});

test("buildOrdinaryPostings: +300000 income → asset +300000 + Income -300000", () => {
  const postings = buildOrdinaryPostings({
    accountId: "acc-1",
    amountPaise: 300000,
    categoryId: null,
    necessity: null,
    systemExpensesAccountId: "sys-exp",
    systemIncomeAccountId: "sys-inc",
  });
  assert.deepEqual(postings, [
    { accountId: "acc-1", amountPaise: 300000, categoryId: null, necessity: null, note: "" },
    { accountId: "sys-inc", amountPaise: -300000, categoryId: null, necessity: null, note: "" },
  ]);
  assert.doesNotThrow(() => assertZeroSum(postings));
});

test("buildSplitPostings: -200000 into -150000/-50000 → asset -200000 + Expenses +150000 + Expenses +50000", () => {
  const postings = buildSplitPostings({
    accountId: "acc-1",
    splits: [
      { categoryId: "cat-1", amountPaise: -150000, necessity: "essential", note: "groceries" },
      { categoryId: "cat-2", amountPaise: -50000, necessity: "non_essential", note: "snacks" },
    ],
    systemExpensesAccountId: "sys-exp",
    systemIncomeAccountId: "sys-inc",
  });
  assert.deepEqual(postings, [
    { accountId: "acc-1", amountPaise: -200000, categoryId: null, necessity: null, note: "" },
    { accountId: "sys-exp", amountPaise: 150000, categoryId: "cat-1", necessity: "essential", note: "groceries" },
    { accountId: "sys-exp", amountPaise: 50000, categoryId: "cat-2", necessity: "non_essential", note: "snacks" },
  ]);
  assert.doesNotThrow(() => assertZeroSum(postings));
});

test("buildSplitPostings: mixed-sign splits pick the correct system accounts", () => {
  const postings = buildSplitPostings({
    accountId: "acc-1",
    splits: [
      { categoryId: "cat-1", amountPaise: -150000, necessity: "essential", note: "groceries" },
      { categoryId: "cat-2", amountPaise: 50000, necessity: null, note: "cashback" },
    ],
    systemExpensesAccountId: "sys-exp",
    systemIncomeAccountId: "sys-inc",
  });
  assert.deepEqual(postings, [
    { accountId: "acc-1", amountPaise: -100000, categoryId: null, necessity: null, note: "" },
    { accountId: "sys-exp", amountPaise: 150000, categoryId: "cat-1", necessity: "essential", note: "groceries" },
    { accountId: "sys-inc", amountPaise: -50000, categoryId: "cat-2", necessity: null, note: "cashback" },
  ]);
  assert.doesNotThrow(() => assertZeroSum(postings));
});

test("buildTransferPostings: 200000 → from -200000 / to +200000", () => {
  const postings = buildTransferPostings({
    fromAccountId: "from-1",
    toAccountId: "to-1",
    amountPaise: 200000,
    note: "savings",
  });
  assert.deepEqual(postings, [
    { accountId: "from-1", amountPaise: -200000, categoryId: null, necessity: null, note: "savings" },
    { accountId: "to-1", amountPaise: 200000, categoryId: null, necessity: null, note: "savings" },
  ]);
  assert.doesNotThrow(() => assertZeroSum(postings));
});

test("buildTransferPostings: rejects non-positive amounts", () => {
  const base = { fromAccountId: "from-1", toAccountId: "to-1", note: "" };
  assert.throws(() => buildTransferPostings({ ...base, amountPaise: 0 }), (err: unknown) => err instanceof HttpError && err.statusCode === 400);
  assert.throws(() => buildTransferPostings({ ...base, amountPaise: -100 }), (err: unknown) => err instanceof HttpError && err.statusCode === 400);
});

test("buildOpeningPostings: 500000 → asset +500000 / opening -500000", () => {
  const postings = buildOpeningPostings({
    accountId: "acc-1",
    amountPaise: 500000,
    systemOpeningAccountId: "sys-open",
  });
  assert.deepEqual(postings, [
    { accountId: "acc-1", amountPaise: 500000, categoryId: null, necessity: null, note: "" },
    { accountId: "sys-open", amountPaise: -500000, categoryId: null, necessity: null, note: "" },
  ]);
  assert.doesNotThrow(() => assertZeroSum(postings));
});

test("buildTransferLegPostings: outflow leg → real -X / Clearing +X, zero-sum", () => {
  const postings = buildTransferLegPostings({
    accountId: "acc-1",
    amountPaise: -200000,
    clearingAccountId: "sys-clearing",
    note: "savings",
  });
  assert.deepEqual(postings, [
    { accountId: "acc-1", amountPaise: -200000, categoryId: null, necessity: null, note: "savings" },
    { accountId: "sys-clearing", amountPaise: 200000, categoryId: null, necessity: null, note: "savings" },
  ]);
  assert.doesNotThrow(() => assertZeroSum(postings));
});

test("buildTransferLegPostings: inflow leg → real +X / Clearing -X, zero-sum", () => {
  const postings = buildTransferLegPostings({
    accountId: "acc-2",
    amountPaise: 200000,
    clearingAccountId: "sys-clearing",
    note: "savings",
  });
  assert.deepEqual(postings, [
    { accountId: "acc-2", amountPaise: 200000, categoryId: null, necessity: null, note: "savings" },
    { accountId: "sys-clearing", amountPaise: -200000, categoryId: null, necessity: null, note: "savings" },
  ]);
  assert.doesNotThrow(() => assertZeroSum(postings));
});

test("buildTransferLegPostings: safe-integer boundary value zero-sums both signs", () => {
  const max = Number.MAX_SAFE_INTEGER;
  const outflow = buildTransferLegPostings({
    accountId: "acc-1",
    amountPaise: -max,
    clearingAccountId: "sys-clearing",
    note: "",
  });
  assert.deepEqual(outflow, [
    { accountId: "acc-1", amountPaise: -max, categoryId: null, necessity: null, note: "" },
    { accountId: "sys-clearing", amountPaise: max, categoryId: null, necessity: null, note: "" },
  ]);
  assert.doesNotThrow(() => assertZeroSum(outflow));

  const inflow = buildTransferLegPostings({
    accountId: "acc-2",
    amountPaise: max,
    clearingAccountId: "sys-clearing",
    note: "",
  });
  assert.deepEqual(inflow, [
    { accountId: "acc-2", amountPaise: max, categoryId: null, necessity: null, note: "" },
    { accountId: "sys-clearing", amountPaise: -max, categoryId: null, necessity: null, note: "" },
  ]);
  assert.doesNotThrow(() => assertZeroSum(inflow));
});

// ---------------------------------------------------------------------------
// (c) classification + projection round-trips
// ---------------------------------------------------------------------------

const SYSTEM_ACCOUNTS: Record<string, SystemKind> = {
  "sys-exp": "expenses",
  "sys-inc": "income",
  "sys-open": "opening",
};

test("classifyShape + projections round-trip: ordinary", () => {
  const kinds = systemKindOf(SYSTEM_ACCOUNTS);
  const postings = buildOrdinaryPostings({
    accountId: "acc-1",
    amountPaise: -200000,
    categoryId: "cat-1",
    necessity: "essential",
    systemExpensesAccountId: "sys-exp",
    systemIncomeAccountId: "sys-inc",
  });
  assert.equal(classifyShape(postings, kinds), "ordinary");
  assert.deepEqual(projectRealLeg(postings, kinds), { accountId: "acc-1", amountPaise: -200000 });
  assert.deepEqual(projectCounter(postings, kinds), { categoryId: "cat-1", necessity: "essential" });
});

test("classifyShape + projections round-trip: split", () => {
  const kinds = systemKindOf(SYSTEM_ACCOUNTS);
  const splits = [
    { categoryId: "cat-1", amountPaise: -150000, necessity: "essential", note: "groceries" },
    { categoryId: "cat-2", amountPaise: -50000, necessity: "non_essential", note: "snacks" },
  ] as const;
  const postings = buildSplitPostings({
    accountId: "acc-1",
    splits,
    systemExpensesAccountId: "sys-exp",
    systemIncomeAccountId: "sys-inc",
  });
  assert.equal(classifyShape(postings, kinds), "split");
  assert.deepEqual(projectRealLeg(postings, kinds), { accountId: "acc-1", amountPaise: -200000 });
  // Splits are negated back to their signed amounts.
  assert.deepEqual(projectSplits(postings, kinds), [
    { categoryId: "cat-1", amountPaise: -150000, note: "groceries" },
    { categoryId: "cat-2", amountPaise: -50000, note: "snacks" },
  ]);
});

test("classifyShape + projections round-trip: mixed-sign split", () => {
  const kinds = systemKindOf(SYSTEM_ACCOUNTS);
  const splits = [
    { categoryId: "cat-1", amountPaise: -150000, necessity: "essential", note: "groceries" },
    { categoryId: "cat-2", amountPaise: 50000, necessity: null, note: "cashback" },
  ] as const;
  const postings = buildSplitPostings({
    accountId: "acc-1",
    splits,
    systemExpensesAccountId: "sys-exp",
    systemIncomeAccountId: "sys-inc",
  });
  assert.equal(classifyShape(postings, kinds), "split");
  assert.deepEqual(projectRealLeg(postings, kinds), { accountId: "acc-1", amountPaise: -100000 });
  assert.deepEqual(projectSplits(postings, kinds), [
    { categoryId: "cat-1", amountPaise: -150000, note: "groceries" },
    { categoryId: "cat-2", amountPaise: 50000, note: "cashback" },
  ]);
});

test("classifyShape + projections round-trip: opening", () => {
  const kinds = systemKindOf(SYSTEM_ACCOUNTS);
  const postings = buildOpeningPostings({
    accountId: "acc-1",
    amountPaise: 500000,
    systemOpeningAccountId: "sys-open",
  });
  assert.equal(classifyShape(postings, kinds), "opening");
  assert.deepEqual(projectRealLeg(postings, kinds), { accountId: "acc-1", amountPaise: 500000 });
  assert.deepEqual(projectSplits(postings, kinds), []);
  // No non-opening system posting → projectCounter throws.
  assert.throws(() => projectCounter(postings, kinds), (err: unknown) => err instanceof HttpError && err.statusCode === 400);
});

test("classifyShape: transfer classifies as 'transfer'", () => {
  const kinds = systemKindOf(SYSTEM_ACCOUNTS);
  const postings = buildTransferPostings({
    fromAccountId: "from-1",
    toAccountId: "to-1",
    amountPaise: 200000,
    note: "savings",
  });
  assert.equal(classifyShape(postings, kinds), "transfer");
  // Two real legs, zero system legs → no real/counter projections available.
  assert.throws(() => projectRealLeg(postings, kinds), (err: unknown) => err instanceof HttpError && err.statusCode === 400);
  assert.throws(() => projectCounter(postings, kinds), (err: unknown) => err instanceof HttpError && err.statusCode === 400);
  assert.deepEqual(projectSplits(postings, kinds), []);
});

test("classifyShape: degenerate shapes throw", () => {
  const kinds = systemKindOf(SYSTEM_ACCOUNTS);
  assert.throws(() => classifyShape([], kinds), (err: unknown) => err instanceof HttpError && err.statusCode === 400);
  assert.throws(
    () =>
      classifyShape(
        [{ accountId: "acc-1", amountPaise: -100, categoryId: null, necessity: null, note: "" }],
        kinds,
      ),
    (err: unknown) => err instanceof HttpError && err.statusCode === 400,
  );
});

// ---------------------------------------------------------------------------
// (d) builder property tests — every builder always produces zero-sum output
// ---------------------------------------------------------------------------

test("buildOrdinaryPostings: zero-sum for any safe integer input (fast-check)", () => {
  fc.assert(
    fc.property(
      fc.string(),
      fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 }),
      fc.string(),
      fc.string(),
      (accountId, amountPaise, systemExpensesAccountId, systemIncomeAccountId) => {
        const postings = buildOrdinaryPostings({
          accountId,
          amountPaise,
          categoryId: null,
          necessity: null,
          systemExpensesAccountId,
          systemIncomeAccountId,
        });
        assert.equal(
          postings.reduce((s, p) => s + p.amountPaise, 0),
          0,
        );
      },
    ),
    { numRuns: 200 },
  );
});

test("buildTransferPostings: zero-sum for any positive amount (fast-check)", () => {
  fc.assert(
    fc.property(
      fc.string(),
      fc.string(),
      fc.integer({ min: 1, max: 1_000_000_000_000 }),
      fc.string(),
      (fromAccountId, toAccountId, amountPaise, note) => {
        const postings = buildTransferPostings({
          fromAccountId,
          toAccountId,
          amountPaise,
          note,
        });
        assert.equal(
          postings.reduce((s, p) => s + p.amountPaise, 0),
          0,
        );
      },
    ),
    { numRuns: 200 },
  );
});

test("buildSplitPostings: zero-sum for any valid split set (fast-check)", () => {
  const necessity = fc.constantFrom("essential" as const, "non_essential" as const, null);
  fc.assert(
    fc.property(
      fc.string(),
      fc.array(
        fc.record({
          categoryId: fc.string(),
          amountPaise: fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 }),
          necessity,
          note: fc.string(),
        }),
        { minLength: 1, maxLength: 5 },
      ),
      fc.string(),
      fc.string(),
      (accountId, splits, systemExpensesAccountId, systemIncomeAccountId) => {
        // Skip if the split sum would overflow the safe-integer range.
        let sum = 0n;
        for (const s of splits) sum += BigInt(s.amountPaise);
        if (!Number.isSafeInteger(Number(sum))) return;
        const postings = buildSplitPostings({
          accountId,
          splits,
          systemExpensesAccountId,
          systemIncomeAccountId,
        });
        assert.equal(
          postings.reduce((s, p) => s + p.amountPaise, 0),
          0,
        );
      },
    ),
    { numRuns: 200 },
  );
});

test("buildOpeningPostings: zero-sum for any safe integer amount (fast-check)", () => {
  fc.assert(
    fc.property(
      fc.string(),
      fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 }),
      fc.string(),
      (accountId, amountPaise, systemOpeningAccountId) => {
        const postings = buildOpeningPostings({
          accountId,
          amountPaise,
          systemOpeningAccountId,
        });
        assert.equal(
          postings.reduce((s, p) => s + p.amountPaise, 0),
          0,
        );
      },
    ),
    { numRuns: 200 },
  );
});
