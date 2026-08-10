import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPool, loadCardLedgerTxns, saveResults, type IngestionRecord } from "./db.ts";
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
// AC2-AC10: characterization tests for loadCardLedgerTxns after the
// postings-model conversion (PR-F, task 022). Each test asserts a specific
// design ruling from TASK.md to prevent regression.
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
    `insert into users (email, password_hash, display_name) values ($1, 'x', 'AC-shared test user') returning id`,
    [`ac9-test-${randomUUID()}@example.invalid`],
  );
  return res.rows[0]!.id;
}

async function createAccount(userId: string, type: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `insert into accounts (user_id, name, type, opening_balance_paise) values ($1, $2, $3, 0) returning id`,
    [userId, `AC-shared test ${type}`, type],
  );
  return res.rows[0]!.id;
}

/**
 * Insert a system account (for transfer/opening double-entry legs). Used by the
 * transfer-leg fixture (AC4/D7) to create the Clearing counter-account so the
 * D1 regression guard has something to (not) exclude.
 */
async function createSystemAccount(userId: string, systemKind: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `insert into accounts (user_id, name, type, system_kind, opening_balance_paise)
     values ($1, $2, 'system', $3, 0) returning id`,
    [userId, `test ${systemKind} account`, systemKind],
  );
  return res.rows[0]!.id;
}

/** Insert a single posting leg. Low-level helper; callers are responsible for
 *  building the full double-entry shape when the test requires it (e.g. AC4). */
async function createPosting(txnId: string, accountId: string, amountPaise: number): Promise<void> {
  await pool.query(
    `insert into postings (transaction_id, account_id, amount_paise) values ($1, $2, $3)`,
    [txnId, accountId, amountPaise],
  );
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
 *
 * Also inserts the real posting on the card account (same signed amount) so
 * that `loadCardLedgerTxns`, now postings-sourced (PR-F), can find this row.
 * Plain single-leg fixture — legal because the DB has no zero-sum trigger
 * (enforcement lives in `replacePostings`, not SQL).
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
  const id = res.rows[0]!.id;
  await createPosting(id, accountId, opts.amountPaise);
  return id;
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

// ---------------------------------------------------------------------------
// PR-F characterization tests (AC2-AC10)
// ---------------------------------------------------------------------------

test("AC2: ordinary card spend returns negative amountPaise equal to the card posting's amount", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const cardAccountId = await createAccount(userId, "credit_card");
  await createLedgerTxn(userId, cardAccountId, {
    amountPaise: -50000,
    date: "2026-05-01",
    occurredAtTs: null,
    merchant: "Coffee Shop",
  });
  const rows = await loadCardLedgerTxns(pool, userId, cardAccountId, "2026-04-01", "2026-06-30");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.amountPaise, -50000, "signed paise must be negative for a card spend");
});

test(
  "AC3: when transactions.amount_paise holds a decoy value, loadCardLedgerTxns returns " +
    "the posting's amount — proving the reader is postings-sourced",
  async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));
    const cardAccountId = await createAccount(userId, "credit_card");

    // Insert a transaction with a decoy amount_paise (-99999) that differs from
    // the real posting amount (-50000). If the reader still used the legacy
    // transactions.amount_paise column it would return -99999.
    const txnRes = await pool.query<{ id: string }>(
      `insert into transactions
         (user_id, account_id, date, occurred_at, amount_paise, merchant, category_id, notes, tags, source)
       values ($1, $2, '2026-05-01', null, -99999, 'Decoy Merchant', null, '', '{}', 'import')
       returning id`,
      [userId, cardAccountId],
    );
    const txnId = txnRes.rows[0]!.id;
    // The real posting carries the authoritative amount.
    await createPosting(txnId, cardAccountId, -50000);

    const rows = await loadCardLedgerTxns(pool, userId, cardAccountId, "2026-04-01", "2026-06-30");
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0]!.amountPaise,
      -50000,
      "must return the posting's amount (-50000), not the transactions row decoy (-99999)",
    );
  },
);

test(
  "AC4: a transfer leg on the card account (with a balancing Clearing posting, D7) " +
    "is still returned — D1 regression guard",
  async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));
    const cardAccountId = await createAccount(userId, "credit_card");
    // Same-user Clearing system account — required by D7 so the fixture proves
    // the absence of a NOT EXISTS (system_kind='clearing') filter.
    const clearingAccountId = await createSystemAccount(userId, "clearing");

    // Insert the transfer transaction row (account_id is the card, amount
    // reflects a repayment to the card).
    const txnRes = await pool.query<{ id: string }>(
      `insert into transactions
         (user_id, account_id, date, occurred_at, amount_paise, merchant, category_id, notes, tags, source)
       values ($1, $2, '2026-05-05', null, 500000, 'Card repayment', null, '', '{}', 'import')
       returning id`,
      [userId, cardAccountId],
    );
    const txnId = txnRes.rows[0]!.id;

    // Card posting: +500000 (credit to card)
    await createPosting(txnId, cardAccountId, 500000);
    // Clearing counter-posting: -500000 (debit from clearing)
    await createPosting(txnId, clearingAccountId, -500000);

    const rows = await loadCardLedgerTxns(pool, userId, cardAccountId, "2026-05-01", "2026-05-31");
    assert.equal(rows.length, 1, "transfer leg must still be returned (D1 — no system_kind exclusion)");
    assert.equal(rows[0]!.amountPaise, 500000);
  },
);

test(
  "AC5: a transaction whose posting is on a different account is not returned when querying the card account",
  async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));
    const cardAccountId = await createAccount(userId, "credit_card");
    const otherAccountId = await createAccount(userId, "bank");

    // Decoy: transactions.account_id deliberately set to the QUERIED card account
    // (same technique as AC3). Under the OLD legacy reader that filtered on
    // transactions.account_id this would have returned a row. Under the new
    // postings reader it must not, because the posting is on the OTHER account.
    const txnRes = await pool.query<{ id: string }>(
      `insert into transactions
         (user_id, account_id, date, occurred_at, amount_paise, merchant, category_id, notes, tags, source)
       values ($1, $2, '2026-05-01', null, -50000, 'Other Merchant', null, '', '{}', 'import')
       returning id`,
      [userId, cardAccountId],
    );
    const txnId = txnRes.rows[0]!.id;
    // Posting is on the other account — not the card. This is the decisive
    // difference: the legacy reader would return this row (account_id matches),
    // but the postings reader must not (no posting on cardAccountId).
    await createPosting(txnId, otherAccountId, -50000);

    const rows = await loadCardLedgerTxns(pool, userId, cardAccountId, "2026-04-01", "2026-06-30");
    assert.equal(rows.length, 0, "must return 0 rows — posting is on a different account even though transactions.account_id = cardAccountId");
  },
);

test("AC6: a soft-deleted transaction with a card posting is not returned (F8)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const cardAccountId = await createAccount(userId, "credit_card");
  const txnId = await createLedgerTxn(userId, cardAccountId, {
    amountPaise: -50000,
    date: "2026-05-01",
    occurredAtTs: null,
    merchant: "Deleted Merchant",
  });
  // Soft-delete the transaction.
  await pool.query(`update transactions set deleted_at = now() where id = $1`, [txnId]);

  const rows = await loadCardLedgerTxns(pool, userId, cardAccountId, "2026-04-01", "2026-06-30");
  assert.equal(rows.length, 0, "soft-deleted transaction must not be returned");
});

test(
  "AC7: user B's transaction carrying a cross-tenant posting referencing user A's card account " +
    "is not returned when querying as user A",
  async (t) => {
    const userA = await createUser();
    const userB = await createUser();
    t.after(async () => {
      await cleanupUser(userB);
      await cleanupUser(userA);
    });
    const cardAccountId = await createAccount(userA, "credit_card");
    // User B needs their own account so their transaction FK is satisfied.
    const userBAccountId = await createAccount(userB, "bank");

    // User B's transaction (user_id = userB, account_id = userB's own account).
    const txnRes = await pool.query<{ id: string }>(
      `insert into transactions
         (user_id, account_id, date, occurred_at, amount_paise, merchant, category_id, notes, tags, source)
       values ($1, $2, '2026-05-01', null, -50000, 'Cross-tenant', null, '', '{}', 'import')
       returning id`,
      [userB, userBAccountId],
    );
    const txnId = txnRes.rows[0]!.id;
    // Cross-tenant posting: references user A's card account but belongs to user B's transaction.
    await createPosting(txnId, cardAccountId, -50000);

    // Query as user A: t.user_id = userA, but the transaction's user_id = userB.
    const rows = await loadCardLedgerTxns(pool, userA, cardAccountId, "2026-04-01", "2026-06-30");
    assert.equal(rows.length, 0, "cross-tenant posting must not appear when querying as user A");
  },
);

test(
  "AC7 (date-range): out-of-range transactions are excluded; BETWEEN boundaries are inclusive",
  async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));
    const cardAccountId = await createAccount(userId, "credit_card");

    // Exactly on fromDate boundary — must be included (BETWEEN is inclusive).
    await createLedgerTxn(userId, cardAccountId, {
      amountPaise: -10000,
      date: "2026-05-01",
      occurredAtTs: null,
      merchant: "On fromDate",
    });
    // Inside range.
    await createLedgerTxn(userId, cardAccountId, {
      amountPaise: -20000,
      date: "2026-05-15",
      occurredAtTs: null,
      merchant: "In Range",
    });
    // Exactly on toDate boundary — must be included (BETWEEN is inclusive).
    await createLedgerTxn(userId, cardAccountId, {
      amountPaise: -30000,
      date: "2026-05-31",
      occurredAtTs: null,
      merchant: "On toDate",
    });
    // One day before fromDate — must be excluded.
    await createLedgerTxn(userId, cardAccountId, {
      amountPaise: -40000,
      date: "2026-04-30",
      occurredAtTs: null,
      merchant: "Before Range",
    });
    // One day after toDate — must be excluded.
    await createLedgerTxn(userId, cardAccountId, {
      amountPaise: -50000,
      date: "2026-06-01",
      occurredAtTs: null,
      merchant: "After Range",
    });

    const rows = await loadCardLedgerTxns(pool, userId, cardAccountId, "2026-05-01", "2026-05-31");
    assert.equal(rows.length, 3, "exactly 3 rows: in-range + both boundary dates; pre- and post-range excluded");
    const merchants = rows.map((r) => r.merchant).sort();
    assert.deepEqual(
      merchants,
      ["In Range", "On fromDate", "On toDate"].sort(),
      "returned rows must be the in-range and boundary transactions only",
    );
  },
);

test(
  "AC8: two same-account postings for one transaction produce exactly one row whose amountPaise is their sum (D2)",
  async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));
    const cardAccountId = await createAccount(userId, "credit_card");

    // Insert the transaction directly (without createLedgerTxn) so we can add
    // two postings on the same account manually.
    const txnRes = await pool.query<{ id: string }>(
      `insert into transactions
         (user_id, account_id, date, occurred_at, amount_paise, merchant, category_id, notes, tags, source)
       values ($1, $2, '2026-05-01', null, -50000, 'Split Merchant', null, '', '{}', 'import')
       returning id`,
      [userId, cardAccountId],
    );
    const txnId = txnRes.rows[0]!.id;
    await createPosting(txnId, cardAccountId, -30000);
    await createPosting(txnId, cardAccountId, -20000);

    const rows = await loadCardLedgerTxns(pool, userId, cardAccountId, "2026-04-01", "2026-06-30");
    assert.equal(rows.length, 1, "two same-account postings must collapse to one row per transaction");
    assert.equal(rows[0]!.amountPaise, -50000, "amountPaise must be the sum of both postings");
  },
);

test(
  "AC10 (D6): two same-account postings whose sum exceeds Number.MAX_SAFE_INTEGER cause " +
    "loadCardLedgerTxns to throw a clear overflow error",
  async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));
    const cardAccountId = await createAccount(userId, "credit_card");

    const txnRes = await pool.query<{ id: string }>(
      `insert into transactions
         (user_id, account_id, date, occurred_at, amount_paise, merchant, category_id, notes, tags, source)
       values ($1, $2, '2026-05-01', null, 0, 'Overflow Test', null, '', '{}', 'import')
       returning id`,
      [userId, cardAccountId],
    );
    const txnId = txnRes.rows[0]!.id;
    // MAX_SAFE_INTEGER + 1 two-posting sum overflows JavaScript's safe-integer range.
    await createPosting(txnId, cardAccountId, Number.MAX_SAFE_INTEGER);
    await createPosting(txnId, cardAccountId, 1);

    await assert.rejects(
      () => loadCardLedgerTxns(pool, userId, cardAccountId, "2026-04-01", "2026-06-30"),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /safe integer/i);
        return true;
      },
      "must throw when the aggregate sum exceeds Number.MAX_SAFE_INTEGER",
    );
  },
);
