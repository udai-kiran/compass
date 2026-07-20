import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHdfcStatement } from "./hdfc-statement.ts";
import { parseCsv, parseDateCell, parseAmountCell } from "./csv.ts";

// Build a fixed-width line the way HDFC lays the statement out: left-aligned text
// columns, right-aligned amount columns, two spaces between each.
const COLS = [
  { w: 8, right: false }, // Date
  { w: 40, right: false }, // Narration
  { w: 16, right: false }, // Chq./Ref.No.
  { w: 8, right: false }, // Value Dt
  { w: 18, right: true }, // Withdrawal Amt.
  { w: 18, right: true }, // Deposit Amt.
  { w: 18, right: true }, // Closing Balance
];
const GAP = "  ";
const fw = (vals: string[]) =>
  COLS.map((c, i) => (c.right ? (vals[i] ?? "").padStart(c.w) : (vals[i] ?? "").padEnd(c.w)))
    .join(GAP)
    .replace(/\s+$/, "");
const DASHES = COLS.map((c) => "-".repeat(c.w)).join(GAP);

const STATEMENT = [
  "HDFC BANK Ltd.                                     Page No .:   1        Statement of accounts",
  "MR.     SIRIMALLA VENKATA UDAI KIRAN               Account No     : 10311000013510   OTHER",
  "Statement From      : 01/04/2026  To: 19/07/2026",
  fw(["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"]),
  DASHES,
  "",
  fw(["01/04/26", "UPI-ACHAKALA SREENATH-ACHAKALA.SREENATH@", "0000982551223336", "01/04/26", "320.00", "", "6,394.15"]),
  fw(["", "IBL-UTIB0001628-982551223336-PAYMENT FRO", "", "", "", "", ""]),
  fw(["", "M PHONE", "", "", "", "", ""]),
  "",
  fw(["05/04/26", "NEFT CR-SALARY APRIL", "N123456789", "05/04/26", "", "50,000.00", "56,394.15"]),
  "",
  "STATEMENT SUMMARY :",
].join("\n");

test("parseHdfcStatement: returns null for an ordinary CSV", () => {
  assert.equal(parseHdfcStatement("Date,Amount,Description\n2026-07-01,-450,Swiggy\n"), null);
});

test("parseHdfcStatement: normalizes the fixed-width statement to a 7-column CSV", () => {
  const csv = parseHdfcStatement(STATEMENT);
  assert.ok(csv, "should detect the HDFC statement");
  const rows = [...parseCsv(csv!)];
  const headers = rows[0]!;
  assert.deepEqual(headers, [
    "Date",
    "Narration",
    "Chq./Ref.No.",
    "Value Dt",
    "Withdrawal Amt.",
    "Deposit Amt.",
    "Closing Balance",
  ]);
  // two transactions — the summary line and page furniture are dropped
  assert.equal(rows.length, 3);

  const idx = (name: string) => headers.indexOf(name);
  const withdrawal = rows[1]!;
  // the three narration lines are stitched into one field
  assert.equal(
    withdrawal[idx("Narration")],
    "UPI-ACHAKALA SREENATH-ACHAKALA.SREENATH@ IBL-UTIB0001628-982551223336-PAYMENT FRO M PHONE",
  );
  assert.equal(parseDateCell(withdrawal[idx("Date")]!, "DD/MM/YYYY"), "2026-04-01");
  assert.equal(parseAmountCell(withdrawal[idx("Withdrawal Amt.")]!), 32000); // 320.00 → paise
  assert.equal(withdrawal[idx("Deposit Amt.")], ""); // deposit column stays empty

  const deposit = rows[2]!;
  assert.equal(deposit[idx("Withdrawal Amt.")], "");
  assert.equal(parseAmountCell(deposit[idx("Deposit Amt.")]!), 5_000_000); // 50,000.00
});
