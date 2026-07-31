import { test } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { saveResults, type IngestionRecord, type SaveRow } from "./db.ts";

// ---------------------------------------------------------------------------
// saveResults: the extracted_transactions INSERT (misc-01 AC5a).
//
// Per review-5's explicit constraint, this exercises the REAL query text and
// parameter construction `saveResults` builds — not a separate helper that
// duplicates the expected column/value mapping. A fake pg.Pool/PoolClient
// captures every query issued; no real Postgres connection is needed (this is
// a pure unit test of query construction, distinct from inbox.test.ts's
// DB-backed `listInbox` round trip which covers AC5b).
// ---------------------------------------------------------------------------

interface CapturedQuery {
  text: string;
  params: unknown[];
}

/** A fake pg.Pool whose single client records every query it's asked to run. */
function fakePool(): { pool: pg.Pool; queries: CapturedQuery[] } {
  const queries: CapturedQuery[] = [];
  const client = {
    query: async (text: string, params: unknown[] = []) => {
      queries.push({ text, params });
      const isInsert = /^insert into extracted_transactions/i.test(text.trim());
      return { rowCount: isInsert ? 1 : 0, rows: [] };
    },
    release: () => {},
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;
  return { pool, queries };
}

const ingestion: IngestionRecord = {
  id: "ing-1",
  userId: "user-1",
  subject: "Test",
  fromAddr: "alerts@bank.example",
  receivedAt: null,
  raw: "raw",
};

const baseRow: SaveRow = {
  amountPaise: 12345,
  direction: "credit",
  occurredAt: "2026-07-10",
  occurredAtTs: null,
  counterparty: "Card Payment",
  suggestedAccountId: null,
  suggestedCategoryId: null,
  bankRef: null,
  sourceQuote: "",
  confidence: 0.9,
  dedupeHash: "sig:test-intent-1",
  intent: "repayment",
};

function findInsert(queries: CapturedQuery[]): CapturedQuery {
  const q = queries.find((c) => /^insert into extracted_transactions/i.test(c.text.trim()));
  assert.ok(q, "expected an insert into extracted_transactions");
  return q!;
}

/**
 * Parse the INSERT's column list and its `values (...)` placeholder list out
 * of the captured query text, so assertions can prove the column, placeholder
 * and bound-parameter positions actually line up — rather than assuming a
 * fixed index.
 */
function parseInsertColumnsAndPlaceholders(text: string): { columns: string[]; placeholders: string[] } {
  const columnsMatch = text.match(/insert into extracted_transactions\s*\(([^)]+)\)/i);
  assert.ok(columnsMatch, "expected to find the INSERT's column list");
  const placeholdersMatch = text.match(/values\s*\(([^)]+)\)/i);
  assert.ok(placeholdersMatch, "expected to find the INSERT's values placeholder list");
  const columns = columnsMatch![1]!.split(",").map((c) => c.trim());
  const placeholders = placeholdersMatch![1]!.split(",").map((p) => p.trim());
  return { columns, placeholders };
}

/**
 * Assert that the parsed column list, placeholder list, and bound params of
 * an INSERT all line up: same length, placeholders exactly $1..$N in order
 * with no gaps or duplicates, and — for a given column name — its position in
 * the column list matches the position of its bound value in the params
 * array. The index is derived from the parsed query, never hard-coded.
 */
function assertColumnPlaceholderParamMapping(
  insertQuery: CapturedQuery,
  columnName: string,
  expectedValue: unknown,
): void {
  const { columns, placeholders } = parseInsertColumnsAndPlaceholders(insertQuery.text);

  assert.equal(columns.length, placeholders.length, "column count must match placeholder count");
  assert.equal(placeholders.length, insertQuery.params.length, "placeholder count must match bound param count");

  // Placeholders are exactly $1..$N, in order, no gaps or duplicates.
  placeholders.forEach((p, i) => {
    assert.equal(p, `$${i + 1}`, `placeholder at position ${i} must be $${i + 1}, got ${p}`);
  });

  const columnIndex = columns.indexOf(columnName);
  assert.notEqual(columnIndex, -1, `expected a \`${columnName}\` column in the INSERT`);
  const placeholder = placeholders[columnIndex]!;
  const paramIndex = Number(placeholder.slice(1)) - 1;
  assert.equal(paramIndex, columnIndex, `\`${columnName}\`'s placeholder index must match its column index`);
  assert.equal(insertQuery.params[paramIndex], expectedValue);
}

test("saveResults: the extracted_transactions INSERT carries `intent` in both its column list and its value mapping", async () => {
  const { pool, queries } = fakePool();
  const inserted = await saveResults(pool, {
    ingestion,
    classification: "transaction_alert",
    status: "extracted",
    rows: [baseRow],
  });
  assert.equal(inserted, 1);

  const insertQuery = findInsert(queries);
  assertColumnPlaceholderParamMapping(insertQuery, "intent", "repayment");
});

test("saveResults: a null intent is passed through unchanged, not coerced or dropped", async () => {
  const { pool, queries } = fakePool();
  await saveResults(pool, {
    ingestion,
    classification: "transaction_alert",
    status: "extracted",
    rows: [{ ...baseRow, dedupeHash: "sig:test-intent-2", intent: null }],
  });
  const insertQuery = findInsert(queries);
  assertColumnPlaceholderParamMapping(insertQuery, "intent", null);
});

test("saveResults: refund and cashback intents also round-trip into the INSERT params", async () => {
  const { pool, queries } = fakePool();
  await saveResults(pool, {
    ingestion,
    classification: "transaction_alert",
    status: "extracted",
    rows: [
      { ...baseRow, dedupeHash: "sig:test-intent-3", intent: "refund" },
      { ...baseRow, dedupeHash: "sig:test-intent-4", intent: "cashback" },
    ],
  });
  const inserts = queries.filter((c) => /^insert into extracted_transactions/i.test(c.text.trim()));
  assert.equal(inserts.length, 2);
  assertColumnPlaceholderParamMapping(inserts[0]!, "intent", "refund");
  assertColumnPlaceholderParamMapping(inserts[1]!, "intent", "cashback");
});
