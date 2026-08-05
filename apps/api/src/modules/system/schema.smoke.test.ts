import { test } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";
import { createDb } from "../../db/index.ts";
import * as barrel from "../../db/schema.ts";
import * as coreSchema from "../../db/core-schema.ts";
import * as systemSchema from "./schema.ts";

// Object-identity proof: modules/system/schema.ts now physically defines its
// resident tables and enums; the test asserts the module's export is the exact
// same object as the barrel's (identity through the barrel). Every one of the
// 6 system tables (and their 2 owned enums) imported via the module path must
// be the identical object from db/schema.ts — not just structurally equal.
// Mirrors modules/planning/schema.smoke.test.ts and
// modules/ingest/schema.smoke.test.ts.

const TABLE_NAMES: Record<string, string> = {
  users: "users",
  userProfiles: "user_profiles",
  familyMembers: "family_members",
  notifications: "notifications",
  alertLedger: "alert_ledger",
  notificationPrefs: "notification_prefs",
} as const;

const ENUM_NAMES = [
  "familyRelationship",
  "educationStage",
] as const;

test("modules/system/schema.ts re-exports the same 6 table objects as db/schema.ts with correct SQL names", () => {
  for (const [name, sqlName] of Object.entries(TABLE_NAMES)) {
    const tableObj = (systemSchema as Record<string, unknown>)[name];
    const barrelObj = (barrel as Record<string, unknown>)[name];
    assert.strictEqual(
      tableObj,
      barrelObj,
      `${name}: modules/system/schema.ts must re-export the identical object as db/schema.ts`,
    );
    const config = getTableConfig(tableObj as never);
    assert.equal(config.name, sqlName, `${name}: SQL table name must be "${sqlName}"`);
  }
});

test("users resolves through core-schema.ts to the same object as db/schema.ts", () => {
  // users is physically defined in db/core-schema.ts and re-exported through
  // both db/schema.ts and modules/system/schema.ts. All three must be the same
  // object — especially the core-schema leaf, which is the cycle-free anchor.
  const systemUsers = (systemSchema as Record<string, unknown>).users;
  const barrelUsers = (barrel as Record<string, unknown>).users;
  const coreUsers = (coreSchema as Record<string, unknown>).users;
  assert.strictEqual(systemUsers, barrelUsers, "system/schema.ts users === db/schema.ts users");
  assert.strictEqual(systemUsers, coreUsers, "system/schema.ts users === db/core-schema.ts users");
});

test("modules/system/schema.ts re-exports the same 2 owned enum objects as db/schema.ts", () => {
  for (const name of ENUM_NAMES) {
    assert.strictEqual(
      (systemSchema as Record<string, unknown>)[name],
      (barrel as Record<string, unknown>)[name],
      `${name}: modules/system/schema.ts must re-export the identical enum object as db/schema.ts`,
    );
  }
});

test("a real createDb() instance (non-connecting stub pool) exposes db.query for all 6 system tables at runtime", () => {
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

  // None of the 6 system tables have a declared `relations()` config in
  // db/schema.ts (this schema doesn't use drizzle relations anywhere), so
  // `db.query.<table>` never supports nested `with: {...}` includes here —
  // but the base table-level query API (`.findFirst`/`.findMany`) is still
  // constructed per table regardless. Verified empirically: all 6 keys are
  // present.
  for (const name of Object.keys(TABLE_NAMES)) {
    assert.ok(
      (db.query as Record<string, unknown>)[name],
      `db.query.${name} must exist on the constructed Drizzle instance`,
    );
  }
});