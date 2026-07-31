import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPool, saveResults, type IngestionRecord } from "./db.ts";
import { annotateStatementDuplicates } from "./statement-duplicates.ts";
import type { InboxRow } from "./extract.ts";

// ---------------------------------------------------------------------------
// AC9 (misc-02): a later card-statement line matching the "in" (card) leg
// `acceptRepayment` created for a repayment alert must be annotated
// `status = "duplicate"` with `matchedTransactionId` set to that leg's id, and
// persisting it must not change the ledger-row count. This calls the real,
// exported `annotateStatementDuplicates` (`statement-duplicates.ts`, extracted
// from `index.ts` for exactly this reason) followed by the real `saveResults`
// (`db.ts`) — not a hand-rolled re-implementation of the status/matched-id
// mapping — so the test actually exercises the production annotation path
// instead of merely proving `saveResults` stores what it's given. It lives
// here, not in the API's inbox.test.ts, because `index.ts` itself starts a
// BullMQ worker on import and cannot be imported directly by a test.
//
// Needs a real Postgres connection (DATABASE_URL) — this repo has no
// DB-mocking infrastructure for this path (same convention as
// apps/api/src/services/inbox.test.ts's DB-backed tests): real Postgres, a
// throwaway user per test, cleanup in t.after().
// ---------------------------------------------------------------------------

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "statement-duplicate.test.ts needs DATABASE_URL set (a real Postgres connection) — " +
        "this repo has no DB-mocking infrastructure. Export it (see apps/extractor/.env) before " +
        "running `npm run test -w apps/extractor`.",
    );
  }
  return url;
}

const pool = createPool(requireDatabaseUrl());
after(async () => {
  await pool.end();
});

async function createUser(): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `insert into users (email, password_hash, display_name) values ($1, 'x', 'AC9 test user') returning id`,
    [`ac9-test-${randomUUID()}@example.invalid`],
  );
  return res.rows[0]!.id;
}

async function createAccount(userId: string, type: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `insert into accounts (user_id, name, type, opening_balance_paise) values ($1, $2, $3, 0) returning id`,
    [userId, `AC9 test ${type}`, type],
  );
  return res.rows[0]!.id;
}

async function createIngestion(userId: string): Promise<IngestionRecord> {
  const res = await pool.query<{
    id: string;
    user_id: string;
    subject: string;
    from_addr: string;
    received_at: Date | null;
    raw: string;
  }>(
    `insert into email_ingestions (user_id, message_id, from_addr, subject, raw, status)
     values ($1, $2, 'alerts@bank.example', 'Statement', 'raw', 'extracted')
     returning id, user_id, subject, from_addr, received_at, raw`,
    [userId, `ac9-test-${randomUUID()}`],
  );
  const r = res.rows[0]!;
  return {
    id: r.id,
    userId: r.user_id,
    subject: r.subject,
    fromAddr: r.from_addr,
    receivedAt: r.received_at,
    raw: r.raw,
  };
}

/**
 * Insert a ledger transaction row directly, shaped exactly the way
 * `acceptRepayment` (apps/api/src/services/inbox.ts:667-677) creates its card
 * ("in") leg: `merchant = "Card repayment from <paying account name>"`,
 * `category_id = null`, `source = 'import'`, carrying the alert's precise
 * `occurred_at` instant.
 */
async function createLedgerTxn(
  userId: string,
  accountId: string,
  opts: { amountPaise: number; date: string; occurredAtTs: string | null; merchant: string },
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `insert into transactions
       (user_id, account_id, date, occurred_at, amount_paise, merchant, category_id, notes, tags, source)
     values ($1, $2, $3, $4, $5, $6, null, '', '{}', 'import')
     returning id`,
    [userId, accountId, opts.date, opts.occurredAtTs, opts.amountPaise, opts.merchant],
  );
  return res.rows[0]!.id;
}

async function countLedgerRows(userId: string): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `select count(*)::int as count from transactions where user_id = $1`,
    [userId],
  );
  return Number(res.rows[0]!.count);
}

async function cleanupUser(userId: string): Promise<void> {
  await pool.query(`delete from extracted_transactions where user_id = $1`, [userId]);
  await pool.query(`delete from email_ingestions where user_id = $1`, [userId]);
  await pool.query(`delete from transactions where user_id = $1`, [userId]);
  await pool.query(`delete from accounts where user_id = $1`, [userId]);
  await pool.query(`delete from users where id = $1`, [userId]);
}

test(
  "AC9: a later card-statement line matching an accepted repayment's card leg is annotated " +
    "status='duplicate' with matchedTransactionId = the leg's id, and the ledger-row count recorded " +
    "before ingestion equals the count after",
  async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));
    const cardAccountId = await createAccount(userId, "credit_card");
    // The paying account: not otherwise referenced, exists only so the "in"
    // leg's merchant string below reflects a real account name, same as
    // acceptRepayment's `Card repayment from ${fromAcct.name}` (inbox.ts:672).
    await createAccount(userId, "bank");

    // The card ("in") leg acceptRepayment would have created for a repayment
    // alert already accepted — same merchant string, null category, 'import'
    // source, and occurred_at instant as inbox.ts:667-677.
    const inLegId = await createLedgerTxn(userId, cardAccountId, {
      amountPaise: 500000,
      date: "2026-02-10",
      occurredAtTs: "2026-02-10T09:15:00+05:30",
      merchant: `Card repayment from AC9 test bank`,
    });

    const ingestion = await createIngestion(userId);

    const rowsBefore = await countLedgerRows(userId);

    // A statement line re-listing the same repayment: same amount/direction and
    // a near-identical printed time (well inside the matcher's tolerance).
    const statementRow: InboxRow = {
      amountPaise: 500000,
      direction: "credit",
      occurredAt: "2026-02-10",
      occurredAtTs: "2026-02-10T09:15:30+05:30",
      counterparty: "",
      suggestedAccountId: cardAccountId,
      suggestedCategoryId: null,
      bankRef: null,
      sourceQuote: "",
      confidence: 0.9,
      dedupeHash: `ac9-test-${randomUUID()}`,
      intent: null,
    };

    // Call the real, exported production annotation path — the same function
    // index.ts's worker calls — instead of hand-rolling the status/
    // matchedTransactionId mapping.
    const annotated = await annotateStatementDuplicates(pool, [statementRow], userId);
    assert.equal(annotated.length, 1);
    assert.equal(annotated[0]!.status, "duplicate", "annotateStatementDuplicates must flag the line as a duplicate");
    assert.equal(
      annotated[0]!.matchedTransactionId,
      inLegId,
      "annotateStatementDuplicates must tie the statement line to the accepted card leg",
    );

    const inserted = await saveResults(pool, {
      ingestion,
      classification: "card_statement",
      status: "extracted",
      rows: annotated,
    });
    assert.equal(inserted, 1);

    // Assertion 1: persisted as `duplicate` with the matched transaction id.
    const draftRows = (
      await pool.query<{ status: string; matched_transaction_id: string | null }>(
        `select status, matched_transaction_id from extracted_transactions where dedupe_hash = $1`,
        [statementRow.dedupeHash],
      )
    ).rows;
    assert.equal(draftRows.length, 1);
    assert.equal(draftRows[0]!.status, "duplicate");
    // Assertion 2: matchedTransactionId = the in leg's id.
    assert.equal(draftRows[0]!.matched_transaction_id, inLegId);

    // Assertion 3: ledger-row count recorded before ingestion equals the count
    // after — persisting a duplicate must never itself post a ledger row.
    const rowsAfter = await countLedgerRows(userId);
    assert.equal(rowsAfter, rowsBefore);
  },
);
