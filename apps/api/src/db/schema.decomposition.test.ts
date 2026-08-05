/**
 * Decomposition test — verifies that the `db/schema.ts` barrel is a pure
 * re-export barrel with no inline definitions, that every table/enum is
 * `Object.is`-identical to its defining file, and that the export set is
 * exactly 50 tables + 38 enums (plus `users` from core) with no duplicates.
 *
 * Importing the barrel, all shared layers, and all module schemas also
 * exercises runtime module initialisation (ESM graph resolution, TDZ checks).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableName, type Table } from "drizzle-orm";

// All shared-layer entry points
import * as foundation from "../db/shared/foundation.ts";
import * as hubs from "../db/shared/hubs.ts";
import * as recurring from "../db/shared/recurring.ts";
import * as spines from "../db/shared/spines.ts";
import * as ledgerShared from "../db/shared/ledger.ts";

// All module schema entry points
import * as system from "../modules/system/schema.ts";
import * as ledger from "../modules/ledger/schema.ts";
import * as credit from "../modules/credit/schema.ts";
import * as investments from "../modules/investments/schema.ts";
import * as protection from "../modules/protection/schema.ts";
import * as planning from "../modules/planning/schema.ts";
import * as ingest from "../modules/ingest/schema.ts";
import * as automation from "../modules/automation/schema.ts";

// The barrel itself
import * as barrel from "../db/schema.ts";

// Core schema
import * as core from "../db/core-schema.ts";

// ── helpers ────────────────────────────────────────────────────────────────

function isPgTable(val: unknown): boolean {
  if (typeof val !== "object" || val === null) return false;
  const syms = Object.getOwnPropertySymbols(val);
  return syms.some(
    (s) => s.toString() === "Symbol(drizzle:IsDrizzleTable)" && (val as Record<PropertyKey, unknown>)[s] === true,
  );
}

function isPgEnum(val: unknown): boolean {
  return (
    val !== null &&
    val !== undefined &&
    "enumValues" in (val as Record<string, unknown>) &&
    Array.isArray((val as Record<string, unknown>).enumValues)
  );
}

// ── Expected residents per module ──────────────────────────────────────────

const systemResidents = new Set([
  "userProfiles", "familyMembers", "notifications", "alertLedger", "notificationPrefs",
  "familyRelationship", "educationStage",
]);

const ledgerResidents = new Set([
  "transactionSplits", "transferLinks", "transactionLinks", "merchantRules", "userTasks", "attachments",
]);

const creditResidents = new Set([
  "cardDetails", "cardIssuerSettings", "cardStatements", "bankDetails", "overdraftDetails",
  "rewardEntries", "emiDetails", "cardNetwork", "bankAccountSubtype",
]);

const investmentsResidents = new Set([
  "accountNpsDetails", "npsDetails", "goldDetails", "holdingValuations", "holdingEvents",
  "netWorthSnapshots", "npsTier", "goldForm", "holdingEventType", "holdingEventSource",
]);

const protectionResidents = new Set([
  "retirementDetails", "insuranceHealthCards",
]);

const planningResidents = new Set([
  "budgets", "budgetLines", "budgetAlerts", "subscriptionDismissals", "projectionSettings",
  "budgetPeriod",
]);

const ingestResidents = new Set([
  "imports", "importRows", "importPresets", "mailboxCredentials", "extractedTransactions",
  "importStatus", "extractedTxnStatus", "txnDirection", "extractedTxnIntent",
]);

const automationResidents = new Set([
  "aiSettings", "aiEvents", "aiProvider", "aiEventKind", "aiEventStatus",
]);

// ── Tests ──────────────────────────────────────────────────────────────────

describe("db/schema.ts decomposition", () => {

  // T3c: barrel exports exactly 50 tables + 38 enums + users, no duplicates
  it("exports exactly 50 tables + 38 enums + users with no duplicates", () => {
    const tables: string[] = [];
    const enums: string[] = [];
    // Postgres-level object names — JS export keys are unique by construction,
    // so a Set over `tables`/`enums` keys would be tautological. Compare the
    // actual Drizzle table/enum DB names to truly detect duplicate definitions.
    const tableDbNames: string[] = [];
    const enumDbNames: string[] = [];

    for (const [key, val] of Object.entries(barrel)) {
      if (key === "users") continue; // single core table, checked separately
      if (isPgTable(val)) {
        tables.push(key);
        tableDbNames.push(getTableName(val as Table));
      } else if (isPgEnum(val)) {
        enums.push(key);
        enumDbNames.push((val as { enumName: string }).enumName);
      }
    }

    // Real duplicate detection at the Postgres object-name level.
    assert.equal(
      new Set(tableDbNames).size,
      tableDbNames.length,
      `duplicate table DB names: ${tableDbNames.filter((n, i) => tableDbNames.indexOf(n) !== i)}`,
    );
    assert.equal(
      new Set(enumDbNames).size,
      enumDbNames.length,
      `duplicate enum DB names: ${enumDbNames.filter((n, i) => enumDbNames.indexOf(n) !== i)}`,
    );

    assert.equal(tables.length, 50, `expected 50 tables, got ${tables.length}: ${tables.join(", ")}`);
    assert.equal(enums.length, 38, `expected 38 enums, got ${enums.length}: ${enums.join(", ")}`);

    // users is also in the barrel
    assert.ok(isPgTable(barrel.users), "users should be a pgTable in the barrel");
  });

  // T3: table identity — every barrel export is Object.is to its defining file
  it("has Object.is-identical tables for all residents", () => {
    // Define a mapping: barrel key → { module, key }
    const identityMap: Record<string, { module: Record<string, unknown>; key: string }> = {};

    // System residents
    for (const k of systemResidents) {
      identityMap[k] = { module: system as unknown as Record<string, unknown>, key: k };
    }
    // Ledger residents
    for (const k of ledgerResidents) {
      identityMap[k] = { module: ledger as unknown as Record<string, unknown>, key: k };
    }
    // Credit residents
    for (const k of creditResidents) {
      identityMap[k] = { module: credit as unknown as Record<string, unknown>, key: k };
    }
    // Investments residents
    for (const k of investmentsResidents) {
      identityMap[k] = { module: investments as unknown as Record<string, unknown>, key: k };
    }
    // Protection residents
    for (const k of protectionResidents) {
      identityMap[k] = { module: protection as unknown as Record<string, unknown>, key: k };
    }
    // Planning residents
    for (const k of planningResidents) {
      identityMap[k] = { module: planning as unknown as Record<string, unknown>, key: k };
    }
    // Ingest residents
    for (const k of ingestResidents) {
      identityMap[k] = { module: ingest as unknown as Record<string, unknown>, key: k };
    }
    // Automation residents
    for (const k of automationResidents) {
      identityMap[k] = { module: automation as unknown as Record<string, unknown>, key: k };
    }

    // Shared tables in shared layers
    const sharedLayers: Array<{ name: string; mod: Record<string, unknown>; keys: string[] }> = [
      { name: "foundation", mod: foundation as unknown as Record<string, unknown>, keys: ["goals", "categories", "resources", "mailboxAccounts"] },
      { name: "hubs", mod: hubs as unknown as Record<string, unknown>, keys: ["accounts", "emailIngestions"] },
      { name: "recurring", mod: recurring as unknown as Record<string, unknown>, keys: ["recurringTemplates"] },
      { name: "spines", mod: spines as unknown as Record<string, unknown>, keys: ["holdings", "insurancePolicies", "statementReconciliations", "sips"] },
      { name: "ledger", mod: ledgerShared as unknown as Record<string, unknown>, keys: ["transactions"] },
    ];

    for (const layer of sharedLayers) {
      for (const k of layer.keys) {
        identityMap[k] = { module: layer.mod, key: k };
      }
    }

    // users
    identityMap["users"] = { module: core as unknown as Record<string, unknown>, key: "users" };

    // Check every identity
    for (const [barrelKey, { module: mod, key: modKey }] of Object.entries(identityMap)) {
      const barrelVal = (barrel as unknown as Record<string, unknown>)[barrelKey];
      const modVal = mod[modKey];
      assert.ok(barrelVal !== undefined, `barrel missing ${barrelKey}`);
      assert.ok(modVal !== undefined, `defining module missing ${modKey}`);
      assert.equal(Object.is(barrelVal, modVal), true, `${barrelKey} is not Object.is-identical to its defining module's export`);
    }
  });

  // T3b: enum identity — including cross-home expenseNecessity and mailboxProvider
  it("has Object.is-identical enums for all residents", () => {
    const enumMap: Record<string, { module: Record<string, unknown>; key: string }> = {};

    // Shared enums in shared layers
    const sharedEnumLayers: Array<{ name: string; mod: Record<string, unknown>; keys: string[] }> = [
      { name: "foundation", mod: foundation as unknown as Record<string, unknown>, keys: ["goalType", "categoryKind", "expenseNecessity", "resourceKind", "mailboxProvider", "mailboxStatus"] },
      { name: "hubs", mod: hubs as unknown as Record<string, unknown>, keys: ["accountType", "emailClass", "emailIngestStatus"] },
      { name: "recurring", mod: recurring as unknown as Record<string, unknown>, keys: ["recurringFrequency", "recurringKind"] },
      { name: "spines", mod: spines as unknown as Record<string, unknown>, keys: ["assetClass", "gainsTaxClass", "insuranceKind", "vehicleKind", "healthType", "premiumFrequency", "sipTargetKind", "sipStatus", "sipFundingSource", "sipFrequency"] },
      { name: "ledger", mod: ledgerShared as unknown as Record<string, unknown>, keys: ["transactionSource"] },
    ];

    for (const layer of sharedEnumLayers) {
      for (const k of layer.keys) {
        enumMap[k] = { module: layer.mod, key: k };
      }
    }

    // Module resident enums
    for (const k of ["familyRelationship", "educationStage"]) {
      enumMap[k] = { module: system as unknown as Record<string, unknown>, key: k };
    }
    for (const k of ["cardNetwork", "bankAccountSubtype"]) {
      enumMap[k] = { module: credit as unknown as Record<string, unknown>, key: k };
    }
    for (const k of ["npsTier", "goldForm", "holdingEventType", "holdingEventSource"]) {
      enumMap[k] = { module: investments as unknown as Record<string, unknown>, key: k };
    }
    for (const k of ["budgetPeriod"]) {
      enumMap[k] = { module: planning as unknown as Record<string, unknown>, key: k };
    }
    for (const k of ["importStatus", "extractedTxnStatus", "txnDirection", "extractedTxnIntent"]) {
      enumMap[k] = { module: ingest as unknown as Record<string, unknown>, key: k };
    }
    for (const k of ["aiProvider", "aiEventKind", "aiEventStatus"]) {
      enumMap[k] = { module: automation as unknown as Record<string, unknown>, key: k };
    }

    for (const [barrelKey, { module: mod, key: modKey }] of Object.entries(enumMap)) {
      const barrelVal = (barrel as unknown as Record<string, unknown>)[barrelKey];
      const modVal = mod[modKey];
      assert.ok(barrelVal !== undefined, `barrel missing enum ${barrelKey}`);
      assert.ok(modVal !== undefined, `defining module missing enum ${modKey}`);
      assert.equal(Object.is(barrelVal, modVal), true, `enum ${barrelKey} is not Object.is-identical`);
    }
  });
});