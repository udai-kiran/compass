import { test } from "node:test";
import assert from "node:assert/strict";
import * as barrel from "../../db/schema.ts";
import * as protectionSchema from "./schema.ts";

// Object-identity proof: modules/protection/schema.ts physically defines its
// resident tables/enums and re-exports the shared symbols that complete its
// schema surface. The test asserts the module's export is the exact same
// object as the barrel's (identity through the barrel): every one of the 3
// tables and 4 enums on the module's export surface — residents plus
// re-exported shared symbols — must be the identical object from db/schema.ts,
// not just structurally equal. Mirrors modules/ledger/schema.smoke.test.ts exactly.

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