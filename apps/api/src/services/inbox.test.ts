import { test } from "node:test";
import assert from "node:assert/strict";
import { historyKey, pickHistoryCategories } from "./inbox.ts";

type Row = { merchant: string; categoryId: string; kind: "income" | "expense"; date: string };

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
