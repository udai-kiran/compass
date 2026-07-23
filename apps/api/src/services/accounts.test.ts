import { test } from "node:test";
import assert from "node:assert/strict";
import { last4Of, openingBalanceRow } from "./accounts.ts";

test("last 4 is taken from the tail of the full number", () => {
  // Indian account numbers vary from 9 to 18 digits, so the tail is the only
  // stable place to take it from.
  assert.equal(last4Of("50100123453510"), "3510");
  assert.equal(last4Of("123456789"), "6789");
  assert.equal(last4Of("123456789012345678"), "5678");
});

test("last 4 of a leading-zero tail keeps the zeros", () => {
  // Going via Number() would turn "0042" into 42 and show •••• 42.
  assert.equal(last4Of("50100120042"), "0042");
  assert.equal(last4Of("5010012000"), "2000");
});

test("last 4 needs four digits to exist", () => {
  assert.equal(last4Of("1234"), "1234");
  assert.equal(last4Of("123"), null);
  assert.equal(last4Of(""), null);
});

test("a bank/cash opening balance becomes an 'Opening balance' ledger row", () => {
  const row = openingBalanceRow({
    userId: "u1",
    accountId: "a1",
    type: "bank",
    openingBalancePaise: 50_000_00,
    date: "2025-04-01",
  });
  assert.deepEqual(row, {
    userId: "u1",
    accountId: "a1",
    date: "2025-04-01",
    amountPaise: 50_000_00,
    merchant: "Opening balance",
    isOpening: true,
  });
  // cash too
  assert.equal(
    openingBalanceRow({ userId: "u1", accountId: "a2", type: "cash", openingBalancePaise: 6000_00, date: "2025-04-01" })?.isOpening,
    true,
  );
});

test("no opening row for a zero balance or a non bank/cash type", () => {
  const base = { userId: "u1", accountId: "a1", date: "2025-04-01" as const };
  // zero balance → nothing to seed
  assert.equal(openingBalanceRow({ ...base, type: "bank", openingBalancePaise: 0 }), null);
  // cards/loans/schemes keep their opening balance on the column, not the ledger
  assert.equal(openingBalanceRow({ ...base, type: "credit_card", openingBalancePaise: -1000_00 }), null);
  assert.equal(openingBalanceRow({ ...base, type: "ppf", openingBalancePaise: 92_000_00 }), null);
  assert.equal(openingBalanceRow({ ...base, type: "investment", openingBalancePaise: 10_000_00 }), null);
});
