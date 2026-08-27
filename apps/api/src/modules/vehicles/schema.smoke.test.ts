import { test } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";
import { createDb } from "../../db/index.ts";
import * as barrel from "../../db/schema.ts";
import * as vehiclesSchema from "./schema.ts";

// Object-identity proof: modules/vehicles/schema.ts physically defines its
// resident tables and the barrel re-exports the identical objects, not just
// structurally equal ones. Mirrors modules/ingest/schema.smoke.test.ts.

const TABLE_NAMES: Record<string, string> = {
  vehicleDetails: "vehicle_details",
  vehicleOdometerReadings: "vehicle_odometer_readings",
} as const;

test("modules/vehicles/schema.ts re-exports the same 2 table objects as db/schema.ts with correct SQL names", () => {
  for (const [name, sqlName] of Object.entries(TABLE_NAMES)) {
    const tableObj = (vehiclesSchema as Record<string, unknown>)[name];
    const barrelObj = (barrel as Record<string, unknown>)[name];
    assert.strictEqual(
      tableObj,
      barrelObj,
      `${name}: modules/vehicles/schema.ts must re-export the identical object as db/schema.ts`,
    );
    const config = getTableConfig(tableObj as never);
    assert.equal(config.name, sqlName, `${name}: SQL table name must be "${sqlName}"`);
  }
});

test("a real createDb() instance (non-connecting stub pool) exposes db.query for both vehicle tables at runtime", () => {
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
