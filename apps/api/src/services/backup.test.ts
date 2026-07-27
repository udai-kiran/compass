import { test } from "node:test";
import assert from "node:assert/strict";
import { getTableColumns, getTableName, is, Table } from "drizzle-orm";
import * as schema from "../db/schema.ts";
import {
  ALL_TABLES,
  collectFileRefs,
  exportGaps,
  FILE_COLUMNS,
  LINKED_TABLES,
  USER_TABLES,
} from "./backup.ts";
import { firstPassRow } from "../db/restore.ts";
import { restorableTables } from "./restore-user.ts";

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

test("sips precedes holding_events in ALL_TABLES (holding_events.sip_id FKs sips)", () => {
  assert.ok(ALL_TABLES.indexOf("sips") < ALL_TABLES.indexOf("holding_events"));
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

test("every storage-key column in the schema is covered by FILE_COLUMNS", () => {
  // A table storing opaque storage keys must be in FILE_COLUMNS, or its files
  // silently drop out of the per-user archive and the orphan report.
  const inSchema: string[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, Table)) continue;
    const table = getTableName(value);
    for (const column of Object.values(getTableColumns(value))) {
      if (column.name === "stored_path" || column.name === "document_path") {
        inSchema.push(`${table}.${column.name}`);
      }
    }
  }
  const covered = new Set(FILE_COLUMNS.map((f) => `${f.table}.${f.column}`));
  const missing = inSchema.filter((c) => !covered.has(c));
  const stale = [...covered].filter((c) => !inSchema.includes(c));
  assert.deepEqual(missing, [], `file columns missing from FILE_COLUMNS: ${missing.join(", ")}`);
  assert.deepEqual(stale, [], `FILE_COLUMNS lists columns not in the schema: ${stale.join(", ")}`);
});

test("collectFileRefs pulls every non-empty storage key from a dump", () => {
  const refs = collectFileRefs({
    attachments: [
      { id: "a1", stored_path: "ab/one" },
      { id: "a2", stored_path: "" },
    ],
    insurance_policies: [
      { id: "p1", document_path: "cd/two" },
      { id: "p2", document_path: null },
    ],
    card_statements: [{ id: "s1", stored_path: "ef/three" }],
  });
  assert.deepEqual(
    refs.map((r) => [r.table, r.rowId, r.key]),
    [
      ["attachments", "a1", "ab/one"],
      ["insurance_policies", "p1", "cd/two"],
      ["card_statements", "s1", "ef/three"],
    ],
  );
});

test("the per-user restore covers exactly the exported tables, in parent-first order", () => {
  const tables = restorableTables();
  assert.deepEqual(
    [...tables].sort(),
    [...Object.keys(USER_TABLES), ...Object.keys(LINKED_TABLES)].sort(),
  );
  // Spot-check FK ordering the insert pass depends on.
  const at = (t: string) => tables.indexOf(t);
  assert.ok(at("accounts") < at("transactions"));
  assert.ok(at("transactions") < at("attachments"));
  assert.ok(at("accounts") < at("card_statements"));
  assert.ok(at("insurance_policies") < at("insurance_health_cards"));
  assert.ok(at("mailbox_accounts") < at("email_ingestions"));
  // sips FKs both goals and holdings (for an mf_folio target) — must restore after both.
  assert.ok(at("goals") < at("sips"));
  assert.ok(at("holdings") < at("sips"));
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
  // transactions defer policy_id (insurance_policies restores later) and drop
  // the database-generated search column.
  assert.deepEqual(
    firstPassRow("transactions", { id: "t", merchant: "Cafe", policy_id: "p", search: "'cafe':1" }),
    { id: "t", merchant: "Cafe", policy_id: null },
  );
});
