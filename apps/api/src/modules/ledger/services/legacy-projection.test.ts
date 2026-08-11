import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "../../../lib/errors.ts";
import { projectLegacyColumns, projectLegacySplits } from "./legacy-projection.ts";
import {
  buildOpeningPostings,
  buildOrdinaryPostings,
  buildSplitPostings,
  buildTransferLegPostings,
  buildTransferPostings,
  type SystemKind,
} from "./postings.ts";

const SYSTEM: Record<string, SystemKind> = {
  "sys-exp": "expenses",
  "sys-inc": "income",
  "sys-open": "opening",
  "sys-clear": "clearing",
};

const kinds = (accountId: string): SystemKind | null => SYSTEM[accountId] ?? null;

const ordinary = (amountPaise: number) =>
  buildOrdinaryPostings({
    accountId: "acc-1",
    amountPaise,
    categoryId: "cat-1",
    necessity: "essential",
    systemExpensesAccountId: "sys-exp",
    systemIncomeAccountId: "sys-inc",
  });

test("ordinary expense projects account, signed amount, category and necessity", () => {
  assert.deepEqual(projectLegacyColumns(ordinary(-200000), kinds), {
    accountId: "acc-1",
    amountPaise: -200000,
    categoryId: "cat-1",
    necessity: "essential",
    isOpening: false,
  });
});

test("income projects the POSITIVE real leg, not the negative system leg", () => {
  // The bug this guards: a "project the negative posting" rule would return
  // the Income system account and a negative amount for every inflow.
  const projected = projectLegacyColumns(ordinary(200000), kinds);
  assert.equal(projected.accountId, "acc-1");
  assert.equal(projected.amountPaise, 200000);
});

test("split projects the real leg and no single category", () => {
  const postings = buildSplitPostings({
    accountId: "acc-1",
    splits: [
      { categoryId: "cat-1", amountPaise: -150000, necessity: "essential", note: "groceries" },
      { categoryId: "cat-2", amountPaise: -50000, necessity: null, note: "snacks" },
    ],
    systemExpensesAccountId: "sys-exp",
    systemIncomeAccountId: "sys-inc",
  });
  assert.deepEqual(projectLegacyColumns(postings, kinds), {
    accountId: "acc-1",
    amountPaise: -200000,
    categoryId: null,
    necessity: null,
    isOpening: false,
  });
  assert.deepEqual(projectLegacySplits(postings, kinds), [
    { categoryId: "cat-1", amountPaise: -150000, note: "groceries" },
    { categoryId: "cat-2", amountPaise: -50000, note: "snacks" },
  ]);
});

test("transfer projects its OUTFLOW leg and null category", () => {
  const postings = buildTransferPostings({
    fromAccountId: "acc-from",
    toAccountId: "acc-to",
    amountPaise: 250000,
    note: "to savings",
  });
  assert.deepEqual(projectLegacyColumns(postings, kinds), {
    accountId: "acc-from",
    amountPaise: -250000,
    categoryId: null,
    necessity: null,
    isOpening: false,
  });
});

test("transfer projection is direction-stable regardless of posting order", () => {
  const postings = buildTransferPostings({
    fromAccountId: "acc-from",
    toAccountId: "acc-to",
    amountPaise: 250000,
    note: "",
  });
  const reversed = [...postings].reverse();
  assert.deepEqual(projectLegacyColumns(reversed, kinds), projectLegacyColumns(postings, kinds));
});

test("opening projects is_opening and no category", () => {
  const postings = buildOpeningPostings({
    accountId: "acc-1",
    amountPaise: 500000,
    systemOpeningAccountId: "sys-open",
  });
  assert.deepEqual(projectLegacyColumns(postings, kinds), {
    accountId: "acc-1",
    amountPaise: 500000,
    categoryId: null,
    necessity: null,
    isOpening: true,
  });
});

test("legacy splits are empty for every non-split shape", () => {
  assert.deepEqual(projectLegacySplits(ordinary(-100), kinds), []);
  assert.deepEqual(
    projectLegacySplits(
      buildTransferPostings({ fromAccountId: "a", toAccountId: "b", amountPaise: 100, note: "" }),
      kinds,
    ),
    [],
  );
  assert.deepEqual(
    projectLegacySplits(
      buildOpeningPostings({ accountId: "acc-1", amountPaise: 100, systemOpeningAccountId: "sys-open" }),
      kinds,
    ),
    [],
  );
});

test("a Clearing leg is rejected, not projected", () => {
  // Shape A (1 real + 1 Clearing) is what a pre-recreate database holds. It
  // must fail loudly here rather than project as an ordinary transaction.
  const legacyLeg = buildTransferLegPostings({
    accountId: "acc-1",
    amountPaise: -250000,
    clearingAccountId: "sys-clear",
    note: "",
  });
  assert.throws(
    () => projectLegacyColumns(legacyLeg, kinds),
    (err: unknown) => err instanceof HttpError && err.statusCode === 400,
  );
});

test("a single-element split projects as ordinary, carrying its category", () => {
  const postings = buildSplitPostings({
    accountId: "acc-1",
    splits: [{ categoryId: "cat-1", amountPaise: -80000, necessity: "essential", note: "one" }],
    systemExpensesAccountId: "sys-exp",
    systemIncomeAccountId: "sys-inc",
  });
  assert.deepEqual(projectLegacyColumns(postings, kinds), {
    accountId: "acc-1",
    amountPaise: -80000,
    categoryId: "cat-1",
    necessity: "essential",
    isOpening: false,
  });
  assert.deepEqual(projectLegacySplits(postings, kinds), []);
});
