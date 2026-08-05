import { test } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";
import { createDb } from "../../db/index.ts";
import * as barrel from "../../db/schema.ts";
import * as ingestSchema from "./schema.ts";

// Object-identity proof: modules/ingest/schema.ts is a thin re-export, not an
// accidental duplicate definition. Every one of the 7 ingest tables (and their
// 8 owned enums) imported via the module path must be the exact same object
// as the one imported via the db/schema.ts barrel — not just structurally
// equal. Mirrors modules/planning/schema.smoke.test.ts.

const TABLE_NAMES: Record<string, string> = {
  imports: "imports",
  importRows: "import_rows",
  importPresets: "import_presets",
  mailboxAccounts: "mailbox_accounts",
  mailboxCredentials: "mailbox_credentials",
  emailIngestions: "email_ingestions",
  extractedTransactions: "extracted_transactions",
} as const;

const ENUM_NAMES = [
  "importStatus",
  "mailboxProvider",
  "mailboxStatus",
  "emailClass",
  "emailIngestStatus",
  "extractedTxnStatus",
  "txnDirection",
  "extractedTxnIntent",
] as const;

test("modules/ingest/schema.ts re-exports the same 7 table objects as db/schema.ts with correct SQL names", () => {
  for (const [name, sqlName] of Object.entries(TABLE_NAMES)) {
    const tableObj = (ingestSchema as Record<string, unknown>)[name];
    const barrelObj = (barrel as Record<string, unknown>)[name];
    assert.strictEqual(
      tableObj,
      barrelObj,
      `${name}: modules/ingest/schema.ts must re-export the identical object as db/schema.ts`,
    );
    const config = getTableConfig(tableObj as never);
    assert.equal(config.name, sqlName, `${name}: SQL table name must be "${sqlName}"`);
  }
});

test("modules/ingest/schema.ts re-exports the same 8 owned enum objects as db/schema.ts", () => {
  for (const name of ENUM_NAMES) {
    assert.strictEqual(
      (ingestSchema as Record<string, unknown>)[name],
      (barrel as Record<string, unknown>)[name],
      `${name}: modules/ingest/schema.ts must re-export the identical enum object as db/schema.ts`,
    );
  }
});

test("a real createDb() instance (non-connecting stub pool) exposes db.query for all 7 ingest tables at runtime", () => {
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

  // Unlike some earlier module migrations, none of the 7 ingest tables have a
  // declared `relations()` config in db/schema.ts (this schema doesn't use
  // drizzle relations anywhere), so `db.query.<table>` never supports nested
  // `with: {...}` includes here — but the base table-level query API
  // (`.findFirst`/`.findMany`) is still constructed per table regardless, and
  // `modules/ingest/services/imports.ts` relies on exactly that for
  // `importRows`/`imports`/`importPresets` (e.g. `db.query.importRows.findMany`).
  // Verified empirically: all 7 keys are present, `importRows` included.
  for (const name of Object.keys(TABLE_NAMES)) {
    assert.ok(
      (db.query as Record<string, unknown>)[name],
      `db.query.${name} must exist on the constructed Drizzle instance`,
    );
  }
});
