import { test } from "node:test";
import assert from "node:assert/strict";
import * as barrel from "../../db/schema.ts";
import * as ledgerSchema from "./schema.ts";

// Object-identity proof: modules/ledger/schema.ts is a thin re-export, not an
// accidental duplicate definition. Every one of the 11 ledger tables (and
// their 7 owned enums) imported via the module path must be the exact same
// object as the one imported via the db/schema.ts barrel — not just
// structurally equal.

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
