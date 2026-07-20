import { test } from "node:test";
import assert from "node:assert/strict";
import { historyKey, pickHistoryCategories, pickTransferPairs } from "./inbox.ts";

type Row = { merchant: string; categoryId: string; kind: "income" | "expense"; date: string };

type Draft = {
  id: string;
  direction: "debit" | "credit";
  amountPaise: number;
  occurredAt: string | null;
  suggestedAccountId: string | null;
};
const draft = (id: string, direction: "debit" | "credit", over: Partial<Draft> = {}): Draft => ({
  id,
  direction,
  amountPaise: 500000,
  occurredAt: "2026-07-10",
  suggestedAccountId: null,
  ...over,
});

test("pickHistoryCategories: the most-used category per merchant wins", () => {
  const rows: Row[] = [
    { merchant: "Swiggy", categoryId: "food", kind: "expense", date: "2026-07-01" },
    { merchant: "Swiggy", categoryId: "food", kind: "expense", date: "2026-07-05" },
    { merchant: "Swiggy", categoryId: "misc", kind: "expense", date: "2026-07-10" }, // one-off slip
  ];
  const best = pickHistoryCategories(rows);
  assert.equal(best.get(historyKey("Swiggy", "expense")), "food"); // count beats a lone recent outlier
});

test("pickHistoryCategories: spend vs refund split by kind, independently", () => {
  const rows: Row[] = [
    { merchant: "Amazon", categoryId: "shopping", kind: "expense", date: "2026-07-02" },
    { merchant: "Amazon", categoryId: "refunds", kind: "income", date: "2026-07-03" },
  ];
  const best = pickHistoryCategories(rows);
  assert.equal(best.get(historyKey("Amazon", "expense")), "shopping");
  assert.equal(best.get(historyKey("Amazon", "income")), "refunds");
});

test("pickHistoryCategories: a tie is broken by the most recent use", () => {
  const rows: Row[] = [
    { merchant: "Uber", categoryId: "transport", kind: "expense", date: "2026-07-01" },
    { merchant: "Uber", categoryId: "travel", kind: "expense", date: "2026-07-09" },
  ];
  const best = pickHistoryCategories(rows);
  assert.equal(best.get(historyKey("Uber", "expense")), "travel"); // 1–1, newer wins
});

test("pickHistoryCategories: no history yields no suggestion", () => {
  assert.equal(pickHistoryCategories([]).size, 0);
});

test("pickTransferPairs: a debit + matching credit within the window pairs both ways", () => {
  const pairs = pickTransferPairs([
    draft("out", "debit", { suggestedAccountId: "hdfc", occurredAt: "2026-07-10" }),
    draft("in", "credit", { suggestedAccountId: "icici", occurredAt: "2026-07-11" }),
  ]);
  assert.equal(pairs.get("out"), "in");
  assert.equal(pairs.get("in"), "out");
});

test("pickTransferPairs: unequal amounts, out-of-window, or same account don't pair", () => {
  // different amount
  assert.equal(pickTransferPairs([draft("o", "debit"), draft("i", "credit", { amountPaise: 400000 })]).size, 0);
  // beyond the 3-day window
  assert.equal(
    pickTransferPairs([
      draft("o", "debit", { occurredAt: "2026-07-01" }),
      draft("i", "credit", { occurredAt: "2026-07-10" }),
    ]).size,
    0,
  );
  // same known account — a reversal, not a transfer
  assert.equal(
    pickTransferPairs([
      draft("o", "debit", { suggestedAccountId: "hdfc" }),
      draft("i", "credit", { suggestedAccountId: "hdfc" }),
    ]).size,
    0,
  );
  // a leg with no date can't be placed in the window
  assert.equal(pickTransferPairs([draft("o", "debit", { occurredAt: null }), draft("i", "credit")]).size, 0);
});

test("pickTransferPairs: an ambiguous match is left unpaired", () => {
  // one debit, two equal same-day credits → can't tell which; pair nothing
  const pairs = pickTransferPairs([
    draft("out", "debit"),
    draft("in1", "credit"),
    draft("in2", "credit"),
  ]);
  assert.equal(pairs.size, 0);
});
