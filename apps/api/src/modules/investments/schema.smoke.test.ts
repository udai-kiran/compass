import { test } from "node:test";
import assert from "node:assert/strict";
import * as barrel from "../../db/schema.ts";
import * as investmentsSchema from "./schema.ts";

// Object-identity proof: modules/investments/schema.ts is a thin re-export,
// not an accidental duplicate definition. Every one of the 8 investments
// tables (and their 10 owned enums) imported via the module path must be the
// exact same object as the one imported via the db/schema.ts barrel — not
// just structurally equal.

const TABLE_NAMES = [
  "holdings",
  "accountNpsDetails",
  "npsDetails",
  "goldDetails",
  "holdingValuations",
  "holdingEvents",
  "sips",
  "netWorthSnapshots",
] as const;

const ENUM_NAMES = [
  "assetClass",
  "gainsTaxClass",
  "npsTier",
  "goldForm",
  "holdingEventType",
  "holdingEventSource",
  "sipTargetKind",
  "sipStatus",
  "sipFundingSource",
  "sipFrequency",
] as const;

test("modules/investments/schema.ts re-exports the same 8 table objects as db/schema.ts", () => {
  for (const name of TABLE_NAMES) {
    assert.strictEqual(
      (investmentsSchema as Record<string, unknown>)[name],
      (barrel as Record<string, unknown>)[name],
      `${name}: modules/investments/schema.ts must re-export the identical object as db/schema.ts`,
    );
  }
});

test("modules/investments/schema.ts re-exports the same 10 owned enum objects as db/schema.ts", () => {
  for (const name of ENUM_NAMES) {
    assert.strictEqual(
      (investmentsSchema as Record<string, unknown>)[name],
      (barrel as Record<string, unknown>)[name],
      `${name}: modules/investments/schema.ts must re-export the identical enum object as db/schema.ts`,
    );
  }
});
