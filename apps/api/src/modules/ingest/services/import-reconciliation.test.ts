import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileStatementTransactions,
  type ExistingTransaction,
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
/** An existing ledger transaction; imported by default. */
const exist = (id: string, overrides: Partial<ExistingTransaction> = {}): ExistingTransaction => ({
  ...tx(id),
  source: "import",
  ...overrides,
});

test("an exact statement row matches instead of creating a transaction", () => {
  assert.deepEqual(reconcileStatementTransactions([tx("row")], [exist("existing")]), [
    { action: "matched", row: tx("row"), transactionId: "existing" },
  ]);
});

test("an exact row matches a hand-entered transaction too (no duplicate)", () => {
  const result = reconcileStatementTransactions([tx("row")], [exist("manual", { source: "manual" })]);
  assert.deepEqual(result, [{ action: "matched", row: tx("row"), transactionId: "manual" }]);
});

test("exact duplicate occurrences are consumed one-for-one", () => {
  const result = reconcileStatementTransactions(
    [tx("row-1"), tx("row-2")],
    [exist("existing-1"), exist("existing-2")],
  );
  assert.deepEqual(
    result.map((item) => item.action),
    ["matched", "matched"],
  );
});

test("a unique nearby merchant mismatch is updated from the statement", () => {
  const statement = tx("row", { date: "2026-07-12", amountPaise: -1_250, notes: "statement" });
  const result = reconcileStatementTransactions([statement], [exist("existing")]);
  assert.deepEqual(result, [{ action: "update", row: statement, transactionId: "existing" }]);
});

test("a nearby MANUAL/recurring transaction is never mutated — it's created instead", () => {
  const statement = tx("row", { date: "2026-07-12", amountPaise: -1_250 });
  assert.equal(
    reconcileStatementTransactions([statement], [exist("manual", { source: "manual" })])[0]!.action,
    "create",
  );
  assert.equal(
    reconcileStatementTransactions([statement], [exist("rec", { source: "recurring" })])[0]!.action,
    "create",
  );
});

test("a wrong merchant is corrected when date and amount uniquely identify an imported row", () => {
  const statement = tx("row", { merchant: "Correct merchant" });
  const result = reconcileStatementTransactions(
    [statement],
    [exist("existing", { merchant: "Wrong merchant" })],
  );
  assert.deepEqual(result, [{ action: "update", row: statement, transactionId: "existing" }]);
});

test("ambiguous nearby transactions are not overwritten", () => {
  const result = reconcileStatementTransactions(
    [tx("row", { amountPaise: -1_250 })],
    [exist("one"), exist("two", { date: "2026-07-11" })],
  );
  assert.equal(result[0]!.action, "conflict");
});

test("opposite-direction transactions are not reconciliation candidates", () => {
  const result = reconcileStatementTransactions(
    [tx("row")],
    [exist("credit", { amountPaise: 1_100 })],
  );
  assert.equal(result[0]!.action, "create");
});
