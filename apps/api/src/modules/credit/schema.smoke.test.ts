import { test } from "node:test";
import assert from "node:assert/strict";
import * as barrel from "../../db/schema.ts";
import * as creditSchema from "./schema.ts";

// Object-identity proof: modules/credit/schema.ts is a thin re-export, not an
// accidental duplicate definition. Every one of the 8 credit tables (and their
// 2 owned enums) imported via the module path must be the exact same object
// as the one imported via the db/schema.ts barrel — not just structurally
// equal. Mirrors modules/ledger/schema.smoke.test.ts exactly.

const TABLE_NAMES = [
  "cardDetails",
  "cardIssuerSettings",
  "cardStatements",
  "bankDetails",
  "overdraftDetails",
  "rewardEntries",
  "statementReconciliations",
  "emiDetails",
] as const;

const ENUM_NAMES = ["cardNetwork", "bankAccountSubtype"] as const;

test("modules/credit/schema.ts re-exports the same 8 table objects as db/schema.ts", () => {
  for (const name of TABLE_NAMES) {
    assert.strictEqual(
      (creditSchema as Record<string, unknown>)[name],
      (barrel as Record<string, unknown>)[name],
      `${name}: modules/credit/schema.ts must re-export the identical object as db/schema.ts`,
    );
  }
});

test("modules/credit/schema.ts re-exports the same 2 owned enum objects as db/schema.ts", () => {
  for (const name of ENUM_NAMES) {
    assert.strictEqual(
      (creditSchema as Record<string, unknown>)[name],
      (barrel as Record<string, unknown>)[name],
      `${name}: modules/credit/schema.ts must re-export the identical enum object as db/schema.ts`,
    );
  }
});
