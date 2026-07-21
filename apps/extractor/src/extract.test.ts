import { test } from "node:test";
import assert from "node:assert/strict";
import type { AiProvider } from "@compass/ai";
import {
  computeStatementRewardEntries,
  decideStatus,
  dedupeHashFor,
  extractStatementSummary,
  extractStatementTxns,
  hasRewardData,
  istTimestamp,
  matchAccount,
  matchCategory,
  matchLinesToLedger,
  merchantSimilarity,
  runExtraction,
  validIsoDate,
  type AccountRef,
  type CategoryRef,
  type LedgerTxn,
  type MatchableLine,
} from "./extract.ts";
import type { ParsedEmail } from "./email.ts";

/** Build an AccountRef terse-ly; last-4 and institution default to unset. */
const acct = (id: string, name: string, last4: string | null = null, institution: string | null = null): AccountRef => ({
  id,
  name,
  accountLast4: last4,
  institution,
});

/** An AiProvider whose chat() replays a canned response, ignoring the prompt. */
function fakeAi(reply: string): AiProvider {
  return {
    name: "fake",
    enabled: true,
    async suggestCategories() {
      return [];
    },
    async generateSummary() {
      return "";
    },
    async chat() {
      return { text: reply, toolCalls: [] };
    },
  };
}

const email = (body: string): ParsedEmail => ({
  subject: "Transaction alert",
  from: "alerts@bank.example",
  body,
  attachments: [],
});

const ctx = (accounts: AccountRef[] = [], categories: CategoryRef[] = []) => ({
  receivedDate: "2026-07-10",
  accounts,
  categories,
});

test("decideStatus routes each class", () => {
  assert.deepEqual(decideStatus("transaction_alert"), { status: "extracted", extract: true });
  assert.deepEqual(decideStatus("bill"), { status: "extracted", extract: true });
  assert.deepEqual(decideStatus("card_statement"), { status: "deferred", extract: false });
  assert.deepEqual(decideStatus("otp"), { status: "ignored", extract: false });
  assert.deepEqual(decideStatus("promo"), { status: "ignored", extract: false });
  assert.deepEqual(decideStatus("other"), { status: "ignored", extract: false });
});

test("matchAccount: exact last-4 field beats the name, ambiguity/no-digits yield null", () => {
  const accounts = [
    acct("a1", "HDFC Card", "1234"),
    acct("a2", "ICICI Savings", "9999"),
  ];
  // the bank alert names the last 4 — matches the stored last-4, not the label
  assert.equal(matchAccount("A/C XXXXXXX1234 debited", accounts), "a1");
  assert.equal(matchAccount("no digits here", accounts), null);
  // no account carries this last-4 → no guess
  assert.equal(matchAccount("ending 5555", accounts), null);
});

test("matchAccount: a shared last-4 is broken by the bank named in the hint", () => {
  const accounts = [
    acct("hdfc", "HDFC Card", "5739", "HDFC"),
    acct("idfc", "IDFC Card", "5739", "IDFC FIRST"),
  ];
  assert.equal(matchAccount("IDFC FIRST Bank A/C XXXXXXX5739", accounts), "idfc");
  assert.equal(matchAccount("HDFC Bank card ending 5739", accounts), "hdfc");
  // same last-4, no bank named → still ambiguous
  assert.equal(matchAccount("your account ending 5739", accounts), null);
});

test("matchAccount: falls back to a unique digit run in the name when no last-4 is set", () => {
  const accounts = [acct("a1", "HDFC ••1234"), acct("a2", "ICICI ••9999")];
  assert.equal(matchAccount("ending 1234", accounts), "a1");
  // two accounts both containing 012 in the name → ambiguous
  assert.equal(matchAccount("012", [acct("x", "Acct 012"), acct("y", "Card 012")]), null);
});

test("matchCategory: verbatim name of the right kind, else null", () => {
  const cats: CategoryRef[] = [
    { id: "food", name: "Food & Dining", kind: "expense" },
    { id: "salary", name: "Salary", kind: "income" },
  ];
  assert.equal(matchCategory("Food & Dining", "debit", cats), "food"); // case-exact
  assert.equal(matchCategory("food & dining", "debit", cats), "food"); // case-insensitive
  assert.equal(matchCategory("Salary", "credit", cats), "salary");
  // right name, wrong kind for the direction → a debit can't take an income category
  assert.equal(matchCategory("Salary", "debit", cats), null);
  assert.equal(matchCategory("Groceries", "debit", cats), null); // off-list
  assert.equal(matchCategory("", "debit", cats), null); // no guess
});

test("dedupeHashFor prefers bankRef, else a stable signature", () => {
  const base = { amountPaise: 12345, direction: "debit" as const, occurredAt: "2026-07-10", counterparty: "Cafe" };
  assert.equal(dedupeHashFor({ ...base, bankRef: "UTR-99" }), "ref:utr-99");
  const a = dedupeHashFor({ ...base, bankRef: null });
  const b = dedupeHashFor({ ...base, bankRef: null });
  assert.equal(a, b); // deterministic
  assert.ok(a.startsWith("sig:"));
  const different = dedupeHashFor({ ...base, bankRef: null, amountPaise: 999 });
  assert.notEqual(a, different);
});

test("runExtraction: alert → one normalized row (rupees→paise, ref dedupe)", async () => {
  const ai = fakeAi(
    JSON.stringify({
      classification: "transaction_alert",
      transactions: [
        {
          amount: 1234.56,
          direction: "debit",
          date: "2026-07-08",
          counterparty: "Amazon",
          accountHint: "card ending 1234",
          category: "Shopping",
          bankRef: "TXN-7788",
          sourceQuote: "Rs 1,234.56 spent at Amazon",
          confidence: 0.9,
        },
      ],
    }),
  );
  const out = await runExtraction(
    email("..."),
    ai,
    ctx([acct("a1", "HDFC Card", "1234")], [{ id: "shop", name: "Shopping", kind: "expense" }]),
  );
  assert.equal(out.status, "extracted");
  assert.equal(out.rows.length, 1);
  const row = out.rows[0]!;
  assert.equal(row.amountPaise, 123456);
  assert.equal(row.direction, "debit");
  assert.equal(row.occurredAt, "2026-07-08");
  assert.equal(row.suggestedAccountId, "a1");
  assert.equal(row.suggestedCategoryId, "shop"); // AI's category guess resolved to the user's category
  assert.equal(row.dedupeHash, "ref:txn-7788");
});

test("validIsoDate accepts real dates, rejects impossible ones", () => {
  assert.equal(validIsoDate("2026-07-08"), "2026-07-08");
  assert.equal(validIsoDate(null), null);
  assert.equal(validIsoDate("2026-99-42"), null); // format ok, calendar nonsense
  assert.equal(validIsoDate("2026-02-30"), null); // Feb never has 30
  assert.equal(validIsoDate("08/07/2026"), null); // wrong format
});

test("runExtraction: an impossible model date falls back to the received date", async () => {
  const ai = fakeAi(
    JSON.stringify({
      classification: "transaction_alert",
      transactions: [{ amount: 100, direction: "debit", date: "2026-99-42", counterparty: "X", accountHint: "", bankRef: null, sourceQuote: "", confidence: 0.5 }],
    }),
  );
  const out = await runExtraction(email("..."), ai, ctx());
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0]!.occurredAt, "2026-07-10"); // not the bogus date
});

test("runExtraction: missing date falls back to received date; junk amount dropped", async () => {
  const ai = fakeAi(
    JSON.stringify({
      classification: "transaction_alert",
      transactions: [
        { amount: 500, direction: "credit", date: null, counterparty: "Refund", accountHint: "", bankRef: null, sourceQuote: "", confidence: 0.7 },
        { amount: 0, direction: "debit", date: null, counterparty: "Junk", accountHint: "", bankRef: null, sourceQuote: "", confidence: 0.1 },
      ],
    }),
  );
  const out = await runExtraction(email("..."), ai, ctx());
  assert.equal(out.rows.length, 1); // zero-amount row discarded
  assert.equal(out.rows[0]!.occurredAt, "2026-07-10");
  assert.equal(out.rows[0]!.direction, "credit");
});

test("runExtraction: OTP is ignored, statement is deferred — no rows either way", async () => {
  const otp = fakeAi(JSON.stringify({ classification: "otp", transactions: [] }));
  const otpOut = await runExtraction(email("Your OTP is 123456"), otp, ctx());
  assert.equal(otpOut.status, "ignored");
  assert.equal(otpOut.rows.length, 0);

  const stmt = fakeAi(
    JSON.stringify({
      classification: "card_statement",
      transactions: [{ amount: 100, direction: "debit", date: null, counterparty: "x", accountHint: "", bankRef: null, sourceQuote: "", confidence: 1 }],
    }),
  );
  const stmtOut = await runExtraction(email("statement attached"), stmt, ctx());
  assert.equal(stmtOut.status, "deferred");
  assert.equal(stmtOut.rows.length, 0); // v1 defers statement bodies (PDF)
});

test("runExtraction: unparseable model output degrades to 'other'/ignored", async () => {
  const out = await runExtraction(email("..."), fakeAi("I couldn't help with that."), ctx());
  assert.equal(out.classification, "other");
  assert.equal(out.status, "ignored");
  assert.equal(out.rows.length, 0);
});

test("extractStatementTxns: statement lines → normalized rows against the matched card", async () => {
  const ai = fakeAi(
    JSON.stringify({
      classification: "card_statement",
      transactions: [
        { amount: 450, direction: "debit", date: "2026-05-27", counterparty: "UPI-Cherukupalli", accountHint: "", category: "", bankRef: null, sourceQuote: "27 May 26 UPI 450.00 D", confidence: 0.9 },
        { amount: 6419.06, direction: "credit", date: "2026-05-30", counterparty: "PAYMENT RECEIVED", accountHint: "", category: "", bankRef: null, sourceQuote: "30 May 26 PAYMENT 6,419.06 C", confidence: 0.9 },
      ],
    }),
  );
  const rows = await extractStatementTxns("<statement text>", ai, {
    receivedDate: "2026-06-24",
    categories: [],
    accountId: "card-1",
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.direction, "debit"); // D = spend
  assert.equal(rows[0]!.amountPaise, 45000);
  assert.equal(rows[0]!.suggestedAccountId, "card-1"); // every row tied to the matched card
  assert.equal(rows[1]!.direction, "credit"); // C = payment/refund
  assert.equal(rows[1]!.amountPaise, 641906);
});

test("extractStatementTxns: an unparseable model reply yields no rows, not a crash", async () => {
  const rows = await extractStatementTxns("<text>", fakeAi("nope"), {
    receivedDate: "2026-06-24",
    categories: [],
    accountId: "card-1",
  });
  assert.equal(rows.length, 0);
});

// ---- statement dedupe matcher ----

const line = (
  amountPaise: number,
  direction: "debit" | "credit",
  occurredAt: string | null,
  counterparty = "",
  occurredAtTs: string | null = null,
): MatchableLine => ({ amountPaise, direction, occurredAt, occurredAtTs, counterparty });

const ledgerTxn = (
  id: string,
  amountPaise: number,
  date: string,
  merchant = "",
  occurredAtTs: string | null = null,
): LedgerTxn => ({ id, amountPaise, date, occurredAtTs, merchant });

test("merchantSimilarity: exact / substring / unknown / shared-token", () => {
  assert.equal(merchantSimilarity("Swiggy", "swiggy"), 1);
  assert.equal(merchantSimilarity("SWIGGY LIMITED", "Swiggy"), 0.9); // substring after normalize
  assert.equal(merchantSimilarity("", "Swiggy"), 0.5); // unknown → neutral
  assert.ok(merchantSimilarity("Uber India", "Uber Trips") > 0); // shared token "uber"
});

test("matchLinesToLedger: exact amount + near date matches, returns the ledger id", () => {
  const lines = [line(50000, "debit", "2026-07-10", "Swiggy")];
  const ledger = [ledgerTxn("t1", -50000, "2026-07-11", "SWIGGY LTD")];
  assert.deepEqual(matchLinesToLedger(lines, ledger), ["t1"]);
});

test("matchLinesToLedger: straddle — within window matches, beyond window carries forward", () => {
  const lines = [line(50000, "debit", "2026-07-10", "Swiggy")];
  assert.deepEqual(matchLinesToLedger(lines, [ledgerTxn("t1", -50000, "2026-07-14", "Swiggy")]), ["t1"]);
  assert.deepEqual(matchLinesToLedger(lines, [ledgerTxn("t1", -50000, "2026-07-19", "Swiggy")]), [null]);
});

test("matchLinesToLedger: credit sign matches; a debit never matches a positive ledger row", () => {
  assert.deepEqual(
    matchLinesToLedger([line(20000, "credit", "2026-07-10", "Refund")], [ledgerTxn("t1", 20000, "2026-07-10", "Refund")]),
    ["t1"],
  );
  assert.deepEqual(
    matchLinesToLedger([line(20000, "debit", "2026-07-10")], [ledgerTxn("t1", 20000, "2026-07-10")]),
    [null],
  );
});

test("matchLinesToLedger: ambiguous same-amount/day pair is left unmatched", () => {
  const lines = [line(30000, "debit", "2026-07-10", "Uber")];
  const ledger = [ledgerTxn("t1", -30000, "2026-07-10", "Uber"), ledgerTxn("t2", -30000, "2026-07-10", "Uber")];
  assert.deepEqual(matchLinesToLedger(lines, ledger), [null]); // tie → no guess
});

test("matchLinesToLedger: two same-amount lines resolve to distinct ledger rows by merchant", () => {
  const lines = [line(30000, "debit", "2026-07-10", "Uber"), line(30000, "debit", "2026-07-10", "Swiggy")];
  const ledger = [ledgerTxn("t1", -30000, "2026-07-10", "Swiggy"), ledgerTxn("t2", -30000, "2026-07-10", "Uber")];
  assert.deepEqual(matchLinesToLedger(lines, ledger), ["t2", "t1"]);
});

test("matchLinesToLedger: a dateless line never matches", () => {
  assert.deepEqual(
    matchLinesToLedger([line(50000, "debit", null, "Swiggy")], [ledgerTxn("t1", -50000, "2026-07-10", "Swiggy")]),
    [null],
  );
});

// ---- timestamp matching ----

test("istTimestamp: combines date + HH:MM as IST; null without both", () => {
  assert.equal(istTimestamp("2026-07-10", "14:32"), "2026-07-10T09:02:00.000Z"); // 14:32 IST = 09:02 UTC
  assert.equal(istTimestamp("2026-07-10", "9:05:30"), "2026-07-10T03:35:30.000Z");
  assert.equal(istTimestamp("2026-07-10", null), null);
  assert.equal(istTimestamp(null, "14:32"), null);
  assert.equal(istTimestamp("2026-07-10", "25:00"), null); // invalid hour
  assert.equal(istTimestamp("2026-07-10", "not a time"), null);
});

test("matchLinesToLedger: timestamp within tolerance locks the pair", () => {
  const lines = [line(50000, "debit", "2026-07-10", "Cafe", "2026-07-10T09:02:00.000Z")];
  const ledger = [ledgerTxn("t1", -50000, "2026-07-10", "SOMETHING ELSE", "2026-07-10T09:03:00.000Z")];
  // Different merchant text, but the printed times match → locked anyway.
  assert.deepEqual(matchLinesToLedger(lines, ledger), ["t1"]);
});

test("matchLinesToLedger: timestamps disambiguate two same-amount, same-day spends", () => {
  const lines = [
    line(30000, "debit", "2026-07-10", "Uber", "2026-07-10T08:00:00.000Z"),
    line(30000, "debit", "2026-07-10", "Uber", "2026-07-10T18:00:00.000Z"),
  ];
  const ledger = [
    ledgerTxn("t1", -30000, "2026-07-10", "Uber", "2026-07-10T18:00:30.000Z"),
    ledgerTxn("t2", -30000, "2026-07-10", "Uber", "2026-07-10T08:00:20.000Z"),
  ];
  // Identical amount/day/merchant — only the timestamp tells them apart.
  assert.deepEqual(matchLinesToLedger(lines, ledger), ["t2", "t1"]);
});

test("matchLinesToLedger: same amount but a distant time is never paired", () => {
  const lines = [line(30000, "debit", "2026-07-10", "Uber", "2026-07-10T08:00:00.000Z")];
  const ledger = [ledgerTxn("t1", -30000, "2026-07-10", "Uber", "2026-07-10T20:00:00.000Z")];
  assert.deepEqual(matchLinesToLedger(lines, ledger), [null]);
});

test("matchLinesToLedger: falls back to date-window+merchant when a side has no timestamp", () => {
  // Line has a timestamp, ledger row doesn't → fuzzy fallback still matches.
  const lines = [line(50000, "debit", "2026-07-10", "Swiggy", "2026-07-10T09:02:00.000Z")];
  const ledger = [ledgerTxn("t1", -50000, "2026-07-11", "SWIGGY LTD")];
  assert.deepEqual(matchLinesToLedger(lines, ledger), ["t1"]);
});

// ---- statement summary + rewards ----

const rewards = (
  opening: number | null,
  earned: number | null,
  redeemed: number | null,
  closing: number | null,
) => ({ opening, earned, redeemed, closing });

test("hasRewardData: true when any field is present", () => {
  assert.equal(hasRewardData(rewards(null, null, null, null)), false);
  assert.equal(hasRewardData(rewards(null, 100, null, null)), true);
  assert.equal(hasRewardData(rewards(null, null, null, 500)), true);
});

test("computeStatementRewardEntries: earned + redeemed + closing lands the sum on closing", () => {
  // base 400, earned 250, redeemed 100 → projected 550; closing 600 → +50 adjust.
  const out = computeStatementRewardEntries(400, rewards(400, 250, 100, 600), "Jul 2026");
  assert.deepEqual(out, [
    { points: 250, note: "Jul 2026: earned" },
    { points: -100, note: "Jul 2026: redeemed" },
    { points: 50, note: "Jul 2026: balance adjustment" },
  ]);
  assert.equal(400 + out.reduce((s, e) => s + e.points, 0), 600); // running sum == closing
});

test("computeStatementRewardEntries: no adjustment when deltas already reconcile", () => {
  const out = computeStatementRewardEntries(400, rewards(400, 250, 100, 550), "Jul 2026");
  assert.deepEqual(out, [
    { points: 250, note: "Jul 2026: earned" },
    { points: -100, note: "Jul 2026: redeemed" },
  ]);
});

test("computeStatementRewardEntries: closing only → a single balance adjustment", () => {
  assert.deepEqual(computeStatementRewardEntries(120, rewards(null, null, null, 500), "Jul 2026"), [
    { points: 380, note: "Jul 2026: balance adjustment" },
  ]);
  // Nothing stated → nothing recorded.
  assert.deepEqual(computeStatementRewardEntries(120, rewards(null, null, null, null), "Jul 2026"), []);
});

test("extractStatementSummary: parses totals→paise + reward points; null on junk", async () => {
  const ai = fakeAi(
    JSON.stringify({
      totalAmountDue: 15230.5,
      minimumAmountDue: 763,
      statementDate: "2026-07-20",
      rewardPoints: { opening: 400, earned: 250, redeemed: 100, closing: 550 },
    }),
  );
  const s = await extractStatementSummary("<statement>", ai);
  assert.equal(s?.totalDuePaise, 1523050);
  assert.equal(s?.minDuePaise, 76300);
  assert.equal(s?.statementDate, "2026-07-20");
  assert.deepEqual(s?.rewards, { opening: 400, earned: 250, redeemed: 100, closing: 550 });
  assert.equal(await extractStatementSummary("<statement>", fakeAi("no json here")), null);
});
