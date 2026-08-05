import { test } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";
import { createDb } from "../../db/index.ts";
import * as barrel from "../../db/schema.ts";
import * as planningSchema from "./schema.ts";

// Object-identity proof: modules/planning/schema.ts physically defines its
// resident tables/enums and re-exports the shared symbols that complete its
// schema surface. The test asserts the module's export is the exact same
// object as the barrel's (identity through the barrel): every one of the 6
// tables and 2 enums on the module's export surface — residents plus
// re-exported shared symbols — must be the identical object from db/schema.ts,
// not just structurally equal. Mirrors modules/credit/schema.smoke.test.ts.

const TABLE_NAMES: Record<string, string> = {
  budgets: "budgets",
  budgetLines: "budget_lines",
  budgetAlerts: "budget_alerts",
  goals: "goals",
  subscriptionDismissals: "subscription_dismissals",
  projectionSettings: "projection_settings",
} as const;

const ENUM_NAMES = ["budgetPeriod", "goalType"] as const;

test("modules/planning/schema.ts re-exports the same 6 table objects as db/schema.ts with correct SQL names", () => {
  for (const [name, sqlName] of Object.entries(TABLE_NAMES)) {
    const tableObj = (planningSchema as Record<string, unknown>)[name];
    const barrelObj = (barrel as Record<string, unknown>)[name];
    assert.strictEqual(
      tableObj,
      barrelObj,
      `${name}: modules/planning/schema.ts must re-export the identical object as db/schema.ts`,
    );
    const config = getTableConfig(tableObj as never);
    assert.equal(config.name, sqlName, `${name}: SQL table name must be "${sqlName}"`);
  }
});

test("modules/planning/schema.ts re-exports the same 2 owned enum objects as db/schema.ts", () => {
  for (const name of ENUM_NAMES) {
    assert.strictEqual(
      (planningSchema as Record<string, unknown>)[name],
      (barrel as Record<string, unknown>)[name],
      `${name}: modules/planning/schema.ts must re-export the identical enum object as db/schema.ts`,
    );
  }
});

test("a real createDb() instance (non-connecting stub pool) exposes db.query for all 6 planning tables at runtime", () => {
  // A stub pg.Pool that would throw if drizzle ever tried to use it — proving
  // no query is issued and no connection is opened during construction.
  const stubPool = {
    query: () => {
      throw new Error("stub pool must never be queried by this test");
    },
    connect: () => {
      throw new Error("stub pool must never be connected to by this test");
    },
  } as unknown as pg.Pool;

  const db = createDb(stubPool);

  for (const name of Object.keys(TABLE_NAMES)) {
    assert.ok(
      (db.query as Record<string, unknown>)[name],
      `db.query.${name} must exist on the constructed Drizzle instance`,
    );
  }
});