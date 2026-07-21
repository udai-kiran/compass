import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileStatementTransactions,
  type StatementTransaction,
} from "./import-reconciliation.ts";

const tx = (id: string, overrides: Partial<StatementTransaction> = {}): StatementTransaction => ({
  id,
  date: "2026-07-10",
  amountPaise: -1_000,
  merchant: "Cafe",
  notes: "",
  ...overrides,
});

test("an exact statement row matches instead of creating a transaction", () => {
  assert.deepEqual(reconcileStatementTransactions([tx("row")], [tx("existing")]), [
    { action: "matched", row: tx("row"), transactionId: "existing" },
  ]);
});

test("exact duplicate occurrences are consumed one-for-one", () => {
  const result = reconcileStatementTransactions(
    [tx("row-1"), tx("row-2")],
    [tx("existing-1"), tx("existing-2")],
  );
  assert.deepEqual(
    result.map((item) => item.action),
    ["matched", "matched"],
  );
});

test("a unique nearby merchant mismatch is updated from the statement", () => {
  const statement = tx("row", { date: "2026-07-12", amountPaise: -1_250, notes: "statement" });
  const result = reconcileStatementTransactions([statement], [tx("existing")]);
  assert.deepEqual(result, [{ action: "update", row: statement, transactionId: "existing" }]);
});

test("a wrong merchant is corrected when date and amount uniquely identify the transaction", () => {
  const statement = tx("row", { merchant: "Correct merchant" });
  const result = reconcileStatementTransactions(
    [statement],
    [tx("existing", { merchant: "Wrong merchant" })],
  );
  assert.deepEqual(result, [{ action: "update", row: statement, transactionId: "existing" }]);
});

test("ambiguous nearby transactions are not overwritten", () => {
  const result = reconcileStatementTransactions(
    [tx("row", { amountPaise: -1_250 })],
    [tx("one"), tx("two", { date: "2026-07-11" })],
  );
  assert.equal(result[0]!.action, "conflict");
});

test("opposite-direction transactions are not reconciliation candidates", () => {
  const result = reconcileStatementTransactions(
    [tx("row")],
    [tx("credit", { amountPaise: 1_100 })],
  );
  assert.equal(result[0]!.action, "create");
});
