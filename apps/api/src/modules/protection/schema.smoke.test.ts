import { test } from "node:test";
import assert from "node:assert/strict";
import * as barrel from "../../db/schema.ts";
import * as protectionSchema from "./schema.ts";

// Object-identity proof: modules/protection/schema.ts is a thin re-export, not
// an accidental duplicate definition. Every one of the 3 protection tables (and
// their 4 owned enums) imported via the module path must be the exact same
// object as the one imported via the db/schema.ts barrel — not just
// structurally equal. Mirrors modules/ledger/schema.smoke.test.ts exactly.

const TABLE_NAMES = [
  "retirementDetails",
  "insurancePolicies",
  "insuranceHealthCards",
] as const;

const ENUM_NAMES = ["insuranceKind", "vehicleKind", "healthType", "premiumFrequency"] as const;

test("modules/protection/schema.ts re-exports the same 3 table objects as db/schema.ts", () => {
  for (const name of TABLE_NAMES) {
    assert.strictEqual(
      (protectionSchema as Record<string, unknown>)[name],
      (barrel as Record<string, unknown>)[name],
      `${name}: modules/protection/schema.ts must re-export the identical object as db/schema.ts`,
    );
  }
});

test("modules/protection/schema.ts re-exports the same 4 owned enum objects as db/schema.ts", () => {
  for (const name of ENUM_NAMES) {
    assert.strictEqual(
      (protectionSchema as Record<string, unknown>)[name],
      (barrel as Record<string, unknown>)[name],
      `${name}: modules/protection/schema.ts must re-export the identical enum object as db/schema.ts`,
    );
  }
});