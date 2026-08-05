import { test } from "node:test";
import assert from "node:assert/strict";
import * as barrel from "../../db/schema.ts";
import * as ledgerSchema from "./schema.ts";

// Object-identity proof: modules/ledger/schema.ts physically defines its 6
// resident tables (its enums live in the shared layers) and re-exports the
// shared symbols that complete its schema surface. The test asserts the
// module's export is the exact same object as the barrel's (identity through
// the barrel): every one of the 11 tables and 7 enums on the module's export
// surface — residents plus re-exported shared symbols — must be the identical
// object from db/schema.ts, not just structurally equal.

const TABLE_NAMES = [
  "accounts",
  "categories",
  "resources",
  "transactions",
  "transactionSplits",
  "transferLinks",
  "transactionLinks",
  "merchantRules",
  "recurringTemplates",
  "userTasks",
  "attachments",
] as const;

const ENUM_NAMES = [
  "accountType",
  "categoryKind",
  "expenseNecessity",
  "transactionSource",
  "resourceKind",
  "recurringFrequency",
  "recurringKind",
] as const;

test("modules/ledger/schema.ts re-exports the same 11 table objects as db/schema.ts", () => {
  for (const name of TABLE_NAMES) {
    assert.strictEqual(
      (ledgerSchema as Record<string, unknown>)[name],
      (barrel as Record<string, unknown>)[name],
      `${name}: modules/ledger/schema.ts must re-export the identical object as db/schema.ts`,
    );
  }
});

test("modules/ledger/schema.ts re-exports the same 7 owned enum objects as db/schema.ts", () => {
  for (const name of ENUM_NAMES) {
    assert.strictEqual(
      (ledgerSchema as Record<string, unknown>)[name],
      (barrel as Record<string, unknown>)[name],
      `${name}: modules/ledger/schema.ts must re-export the identical enum object as db/schema.ts`,
    );
  }
});
