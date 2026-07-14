import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmountCell, parseCsv, parseDateCell } from "./csv.ts";

test("parseCsv handles quotes, escaped quotes and embedded newlines", () => {
  const rows = [...parseCsv('a,b,c\n"x,1","he said ""hi""","line1\nline2"\r\nplain,2,3\n')];
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["x,1", 'he said "hi"', "line1\nline2"],
    ["plain", "2", "3"],
  ]);
});

test("parseCsv skips blank lines and handles missing trailing newline", () => {
  const rows = [...parseCsv("a,b\n\n1,2")];
  assert.deepEqual(rows, [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("parseDateCell parses each supported format", () => {
  assert.equal(parseDateCell("2026-07-01", "YYYY-MM-DD"), "2026-07-01");
  assert.equal(parseDateCell("01/07/2026", "DD/MM/YYYY"), "2026-07-01");
  assert.equal(parseDateCell("01/07/26", "DD/MM/YYYY"), "2026-07-01");
  assert.equal(parseDateCell("07/01/2026", "MM/DD/YYYY"), "2026-07-01");
  assert.equal(parseDateCell("01-07-2026", "DD-MM-YYYY"), "2026-07-01");
  assert.equal(parseDateCell("1 Jul 2026", "DD MMM YYYY"), "2026-07-01");
  assert.equal(parseDateCell("garbage", "DD/MM/YYYY"), null);
  assert.equal(parseDateCell("", "YYYY-MM-DD"), null);
});

test("parseAmountCell handles separators, signs, parens and CR/DR", () => {
  assert.equal(parseAmountCell("1,234.56"), 123456);
  assert.equal(parseAmountCell("₹ 99"), 9900);
  assert.equal(parseAmountCell("-42.5"), -4250);
  assert.equal(parseAmountCell("(100.00)"), -10000);
  assert.equal(parseAmountCell("250.00 Cr"), 25000);
  assert.equal(parseAmountCell("250.00 Dr"), -25000);
  assert.equal(parseAmountCell("abc"), null);
  assert.equal(parseAmountCell(""), null);
});
