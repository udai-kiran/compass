import { test } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";
import { createDb } from "./index.ts";
import { schema } from "./index.ts";
import { users } from "./core-schema.ts";
import { projectionSettings } from "../modules/planning/schema.ts";

// Hermetic runtime schema check: no live DB connection, no query issued. See
// Root Cause item 2 in tasks/006-module-scaffold-and-route-gate/TASK.md for
// why constructing createDb() with a non-connecting stub pg.Pool is safe and
// still a genuine runtime check (drizzle(pool, { schema }) only stores the
// pool reference and builds db.query.* from the schema object itself at
// construction time — it issues no query and opens no connection).

test("schema barrel exposes users and projectionSettings exactly once, with correct table names/columns", () => {
  assert.equal(schema.users, users, "users must be the same table object re-exported from core-schema.ts");
  assert.equal(
    schema.projectionSettings,
    projectionSettings,
    "projectionSettings must be the same table object re-exported from db/schema.ts to modules/planning/schema.ts",
  );

  const usersConfig = getTableConfig(schema.users);
  assert.equal(usersConfig.name, "users");

  const projectionSettingsConfig = getTableConfig(schema.projectionSettings);
  assert.equal(projectionSettingsConfig.name, "projection_settings");
  const columnNames = projectionSettingsConfig.columns.map((c) => c.name).sort();
  assert.deepEqual(columnNames, ["created_at", "equity_return_bps", "updated_at", "user_id"]);
});

test("a real createDb() instance (non-connecting stub pool) exposes db.query.users and db.query.projectionSettings at runtime", () => {
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

  assert.ok(db.query.users, "db.query.users must exist on the constructed Drizzle instance");
  assert.ok(
    db.query.projectionSettings,
    "db.query.projectionSettings must exist on the constructed Drizzle instance",
  );
});
