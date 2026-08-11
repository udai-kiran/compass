import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "../../../lib/errors.ts";
import {
  buildOpeningPostings,
  buildOrdinaryPostings,
  buildSplitPostings,
  buildTransferPostings,
  classifyShape,
  rebuildDrafts,
  type PostingDraft,
  type SystemKind,
} from "./postings.ts";

const SYSTEM: Record<string, SystemKind> = {
  "sys-exp": "expenses",
  "sys-inc": "income",
  "sys-open": "opening",
};
const kinds = (accountId: string): SystemKind | null => SYSTEM[accountId] ?? null;
const sys = { expenses: "sys-exp", income: "sys-inc", opening: "sys-open" };

const ordinary = (over: Partial<{ amountPaise: number; categoryId: string | null }> = {}) =>
  buildOrdinaryPostings({
    accountId: "acc-1",
    amountPaise: over.amountPaise ?? -200000,
    categoryId: over.categoryId === undefined ? "cat-1" : over.categoryId,
    necessity: "essential",
    systemExpensesAccountId: "sys-exp",
    systemIncomeAccountId: "sys-inc",
  });

const split = () =>
  buildSplitPostings({
    accountId: "acc-1",
    splits: [
      { categoryId: "cat-1", amountPaise: -150000, necessity: "essential", note: "groceries" },
      { categoryId: "cat-2", amountPaise: -50000, necessity: null, note: "snacks" },
    ],
    systemExpensesAccountId: "sys-exp",
    systemIncomeAccountId: "sys-inc",
  });

const counters = (drafts: PostingDraft[]) =>
  drafts.filter((p) => kinds(p.accountId) === "expenses" || kinds(p.accountId) === "income");
const real = (drafts: PostingDraft[]) => drafts.find((p) => kinds(p.accountId) === null)!;

// ---------------------------------------------------------------------------
// ordinary
// ---------------------------------------------------------------------------

test("ordinary: an empty patch is a no-op round-trip", () => {
  const out = rebuildDrafts(ordinary(), {}, sys, kinds);
  assert.deepEqual(out, ordinary());
});

test("ordinary: patching the amount moves both legs and stays zero-sum", () => {
  const out = rebuildDrafts(ordinary(), { amountPaise: -75000 }, sys, kinds);
  assert.equal(real(out).amountPaise, -75000);
  assert.equal(counters(out)[0]!.amountPaise, 75000);
});

test("ordinary: flipping sign to income moves the counter to the Income account", () => {
  const out = rebuildDrafts(ordinary(), { amountPaise: 90000 }, sys, kinds);
  assert.equal(counters(out)[0]!.accountId, "sys-inc");
  assert.equal(real(out).amountPaise, 90000);
});

test("ordinary: category and necessity live on the counter, never the real leg", () => {
  const out = rebuildDrafts(ordinary(), { categoryId: "cat-9", necessity: null }, sys, kinds);
  assert.equal(counters(out)[0]!.categoryId, "cat-9");
  assert.equal(counters(out)[0]!.necessity, null);
  assert.equal(real(out).categoryId, null);
  assert.equal(real(out).necessity, null);
});

test("ordinary: an explicit null category clears it; an absent one keeps it", () => {
  assert.equal(counters(rebuildDrafts(ordinary(), { categoryId: null }, sys, kinds))[0]!.categoryId, null);
  assert.equal(counters(rebuildDrafts(ordinary(), {}, sys, kinds))[0]!.categoryId, "cat-1");
});

test("ordinary: moving the account keeps the amount", () => {
  const out = rebuildDrafts(ordinary(), { accountId: "acc-2" }, sys, kinds);
  assert.equal(real(out).accountId, "acc-2");
  assert.equal(real(out).amountPaise, -200000);
});

// ---------------------------------------------------------------------------
// split
// ---------------------------------------------------------------------------

test("split: a category patch is IGNORED — counters keep their own categories", () => {
  // Matches the legacy split branch: a bulk re-category that catches a split
  // never rewrote its split categories.
  const out = rebuildDrafts(split(), { categoryId: "cat-9" }, sys, kinds);
  assert.deepEqual(
    counters(out).map((c) => c.categoryId),
    ["cat-1", "cat-2"],
  );
  assert.equal(classifyShape(out, kinds), "split");
});

test("split: a necessity patch applies to EVERY counter", () => {
  // Also matches the legacy branch, which stamped the parent's necessity onto
  // all split postings uniformly.
  const out = rebuildDrafts(split(), { necessity: "non_essential" }, sys, kinds);
  assert.deepEqual(
    counters(out).map((c) => c.necessity),
    ["non_essential", "non_essential"],
  );
});

test("split: an amount patch that does not match the split sum is rejected", () => {
  assert.throws(
    () => rebuildDrafts(split(), { amountPaise: -999 }, sys, kinds),
    (err: unknown) => err instanceof HttpError && err.statusCode === 409,
  );
});

test("split: an amount patch equal to the split sum is accepted", () => {
  const out = rebuildDrafts(split(), { amountPaise: -200000 }, sys, kinds);
  assert.equal(real(out).amountPaise, -200000);
  assert.equal(classifyShape(out, kinds), "split");
});

test("split: notes survive a rebuild", () => {
  const out = rebuildDrafts(split(), { accountId: "acc-2" }, sys, kinds);
  assert.deepEqual(
    counters(out).map((c) => c.note),
    ["groceries", "snacks"],
  );
});

// ---------------------------------------------------------------------------
// transfer
// ---------------------------------------------------------------------------

const transfer = () =>
  buildTransferPostings({
    fromAccountId: "acc-from",
    toAccountId: "acc-to",
    amountPaise: 250000,
    note: "savings",
  });

test("transfer: account and amount patches are rejected with a 409", () => {
  for (const patch of [{ accountId: "acc-x" }, { amountPaise: 1 }]) {
    assert.throws(
      () => rebuildDrafts(transfer(), patch, sys, kinds),
      (err: unknown) => err instanceof HttpError && err.statusCode === 409,
    );
  }
});

test("transfer: category and necessity patches leave both legs untouched", () => {
  const out = rebuildDrafts(transfer(), { categoryId: "cat-1", necessity: "essential" }, sys, kinds);
  assert.deepEqual(out, transfer());
  assert.equal(classifyShape(out, kinds), "transfer");
});

// ---------------------------------------------------------------------------
// opening
// ---------------------------------------------------------------------------

test("opening: amount is patchable and the shape is preserved", () => {
  const opening = buildOpeningPostings({
    accountId: "acc-1",
    amountPaise: 500000,
    systemOpeningAccountId: "sys-open",
  });
  const out = rebuildDrafts(opening, { amountPaise: 600000 }, sys, kinds);
  assert.equal(classifyShape(out, kinds), "opening");
  assert.equal(real(out).amountPaise, 600000);
});

test("opening: a category patch cannot turn it into an ordinary transaction", () => {
  const opening = buildOpeningPostings({
    accountId: "acc-1",
    amountPaise: 500000,
    systemOpeningAccountId: "sys-open",
  });
  const out = rebuildDrafts(opening, { categoryId: "cat-1" }, sys, kinds);
  assert.equal(classifyShape(out, kinds), "opening");
});

// ---------------------------------------------------------------------------
// invariants across every shape
// ---------------------------------------------------------------------------

test("every rebuild is zero-sum", () => {
  const cases: Array<[readonly PostingDraft[], Parameters<typeof rebuildDrafts>[1]]> = [
    [ordinary(), { amountPaise: -1 }],
    [ordinary(), { amountPaise: 123456789 }],
    [split(), { necessity: "essential" }],
    [transfer(), {}],
  ];
  for (const [current, patch] of cases) {
    const out = rebuildDrafts(current, patch, sys, kinds);
    assert.equal(
      out.reduce((acc, p) => acc + p.amountPaise, 0),
      0,
    );
  }
});
