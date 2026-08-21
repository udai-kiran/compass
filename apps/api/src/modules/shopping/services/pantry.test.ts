/**
 * DB-free query tests for the pantry service (task 9.1).
 *
 * Drizzle builds SQL lazily, so `.toSQL()` on the builder returned by each
 * service function resolves the complete SQL + params without a live Postgres
 * connection. We supply a fake pool to `drizzle()` — no connection is opened.
 *
 * The scoping test (test 3) pins the documented owner-only decision: flipping the
 * SHARING SEAM in pantry.ts will change the generated SQL to include
 * `sharing_grants`, causing that test to fail — making the change a deliberate
 * act that breaks a test, not a silent modification.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../../db/schema.ts";
import { pantryItemsForUser, habitProfilesForUser } from "./pantry.ts";

// Build a drizzle instance without connecting — Drizzle builds SQL lazily, so
// no actual pool methods are called when calling .toSQL() on the query builder.
// The schema barrel is passed so the instance's type is NodePgDatabase<typeof schema>,
// matching Db/DbOrTx exactly, with no cast needed.
const fakePool = { connect: () => {}, end: () => {}, query: () => {} } as never;
const db = drizzle(fakePool, { schema });

const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

test("pantryItemsForUser generates SQL targeting pantry_items filtered by user_id", () => {
  const { sql, params } = pantryItemsForUser(db, TEST_USER_ID).toSQL();
  assert.ok(sql.includes('"pantry_items"'), `expected "pantry_items" in SQL, got: ${sql}`);
  assert.ok(sql.toLowerCase().includes("where"), `expected WHERE clause in SQL, got: ${sql}`);
  assert.ok(sql.includes('"user_id"'), `expected "user_id" column in SQL, got: ${sql}`);
  assert.deepEqual(params, [TEST_USER_ID], `expected params to be exactly [userId], got: ${JSON.stringify(params)}`);
});

test("habitProfilesForUser generates SQL targeting habit_profiles filtered by user_id", () => {
  const { sql, params } = habitProfilesForUser(db, TEST_USER_ID).toSQL();
  assert.ok(sql.includes('"habit_profiles"'), `expected "habit_profiles" in SQL, got: ${sql}`);
  assert.ok(sql.toLowerCase().includes("where"), `expected WHERE clause in SQL, got: ${sql}`);
  assert.ok(sql.includes('"user_id"'), `expected "user_id" column in SQL, got: ${sql}`);
  assert.deepEqual(params, [TEST_USER_ID], `expected params to be exactly [userId], got: ${JSON.stringify(params)}`);
});

// Pins the owner-only scoping decision documented in pantry.ts.
// If the SHARING SEAM is flipped, the query will join sharing_grants and this
// test will fail — making the change visible rather than silent.
test("pantryItemsForUser SQL does not reference sharing_grants (owner-only scoping, not sharing-aware)", () => {
  const { sql } = pantryItemsForUser(db, TEST_USER_ID).toSQL();
  assert.ok(
    !sql.includes("sharing_grants"),
    `expected SQL to NOT reference sharing_grants (owner-only scoping), got: ${sql}`,
  );
});

test("habitProfilesForUser SQL does not reference sharing_grants (owner-only scoping, not sharing-aware)", () => {
  const { sql } = habitProfilesForUser(db, TEST_USER_ID).toSQL();
  assert.ok(
    !sql.includes("sharing_grants"),
    `expected SQL to NOT reference sharing_grants (owner-only scoping), got: ${sql}`,
  );
});
