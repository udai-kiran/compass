import { test } from "node:test";
import assert from "node:assert/strict";
import { getTableName, is, Table } from "drizzle-orm";
import * as schema from "../db/schema.ts";
import { ALL_TABLES, exportGaps, LINKED_TABLES, USER_TABLES } from "./backup.ts";
import { firstPassRow } from "../db/restore.ts";

/** Every pgTable defined in the schema, by its SQL name. */
function schemaTableNames(): string[] {
  return Object.values(schema)
    .filter((v) => is(v, Table))
    .map((t) => getTableName(t as Table));
}

test("the full backup covers every table in the schema", () => {
  const inSchema = new Set(schemaTableNames());
  const inBackup = new Set<string>(ALL_TABLES);
  const missing = [...inSchema].filter((t) => !inBackup.has(t));
  const stale = [...inBackup].filter((t) => !inSchema.has(t));
  assert.deepEqual(missing, [], `tables missing from ALL_TABLES: ${missing.join(", ")}`);
  assert.deepEqual(stale, [], `ALL_TABLES lists tables not in the schema: ${stale.join(", ")}`);
});

test("the per-user export reconstructs every table (no coverage gaps)", () => {
  // Anything ALL_TABLES lists but neither USER_TABLES nor LINKED_TABLES scopes is
  // silently dropped from a user's export — exportGaps() names those. `users` is
  // the only intentional exclusion (a user does not export the owner row itself).
  assert.deepEqual(exportGaps(), []);
});

test("no table is scoped both directly and through a parent", () => {
  const both = Object.keys(USER_TABLES).filter((t) => t in LINKED_TABLES);
  assert.deepEqual(both, [], `tables scoped twice: ${both.join(", ")}`);
});

test("restore defers cyclic and self-referencing foreign keys", () => {
  assert.deepEqual(
    firstPassRow("accounts", { id: "a", goal_id: "g", name: "Bank" }),
    { id: "a", goal_id: null, name: "Bank" },
  );
  assert.deepEqual(
    firstPassRow("categories", { id: "child", parent_id: "parent", name: "Dining" }),
    { id: "child", parent_id: null, name: "Dining" },
  );
  // A table with no deferred columns passes through untouched.
  assert.deepEqual(firstPassRow("goals", { id: "g", target_paise: 100 }), {
    id: "g",
    target_paise: 100,
  });
  assert.deepEqual(
    firstPassRow("transactions", { id: "t", merchant: "Cafe", search: "'cafe':1" }),
    { id: "t", merchant: "Cafe" },
  );
});
