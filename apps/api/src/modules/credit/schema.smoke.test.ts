import { test } from "node:test";
import assert from "node:assert/strict";
import * as barrel from "../../db/schema.ts";
import * as creditSchema from "./schema.ts";

// Object-identity proof: modules/credit/schema.ts now physically defines its
// resident tables and enums; the test asserts the module's export is the exact
// same object as the barrel's (identity through the barrel). Every one of the
// 11 credit tables (and their 5 owned enums) imported via the module path must
// be the identical object from db/schema.ts — not just structurally equal.
// Mirrors modules/ledger/schema.smoke.test.ts exactly.

const TABLE_NAMES = [
  "cardDetails",
  "cardIssuerSettings",
  "cardStatements",
  "bankDetails",
  "overdraftDetails",
  "rewardEntries",
  "statementReconciliations",
  "emiDetails",
  "cardOffers",
  "rewardRules",
  "rewardPointLots",
] as const;

const ENUM_NAMES = [
  "cardNetwork",
  "bankAccountSubtype",
  "cardOfferDiscountKind",
  "rewardRedemptionRoute",
  "rewardCapPeriod",
] as const;

test("modules/credit/schema.ts re-exports the same 11 table objects as db/schema.ts", () => {
  for (const name of TABLE_NAMES) {
    assert.strictEqual(
      (creditSchema as Record<string, unknown>)[name],
      (barrel as Record<string, unknown>)[name],
      `${name}: modules/credit/schema.ts must re-export the identical object as db/schema.ts`,
    );
  }
});

test("modules/credit/schema.ts re-exports the same 5 owned enum objects as db/schema.ts", () => {
  for (const name of ENUM_NAMES) {
    assert.strictEqual(
      (creditSchema as Record<string, unknown>)[name],
      (barrel as Record<string, unknown>)[name],
      `${name}: modules/credit/schema.ts must re-export the identical enum object as db/schema.ts`,
    );
  }
});
