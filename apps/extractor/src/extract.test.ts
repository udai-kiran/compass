import { test } from "node:test";
import assert from "node:assert/strict";
import type { AiProvider, ChatRequest, ChatTurn } from "@compass/ai";
import {
  classifyAndExtract,
  computeStatementRewardEntries,
  decideStatus,
  dedupeHashFor,
  EXTRACT_SYSTEM,
  extractStatementSummary,
  extractStatementTxns,
  hasRewardData,
  istTimestamp,
  matchAccount,
  matchCategory,
  matchLinesToLedger,
  merchantSimilarity,
  runExtraction,
  STATEMENT_SUMMARY_SYSTEM,
  STATEMENT_SYSTEM,
  statementPeriodKey,
  summarizeMatches,
  validIsoDate,
  type AccountRef,
  type CategoryRef,
  type LedgerTxn,
  type MatchableLine,
} from "./extract.ts";
import type { ParsedEmail } from "./email.ts";

/** Build an AccountRef terse-ly; last-4 and institution default to unset. */
const acct = (
  id: string,
  name: string,
  last4: string | null = null,
  institution: string | null = null,
  debitCardLast4: string | null = null,
): AccountRef => ({
  id,
  name,
  accountLast4: last4,
  debitCardLast4,
  institution,
});

/** An AiProvider whose chat() replays a canned response, ignoring the prompt. */
function fakeAi(reply: string): AiProvider {
  return {
    name: "fake",
    enabled: true,
    supportsVision: false,
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

/**
 * A recording-fake AiProvider: replays a canned `ChatTurn` (text + tool calls)
 * while capturing every `ChatRequest` passed to `chat()`, so a test can assert
 * on exactly what the extractor's three call sites send (tools, toolChoice,
 * system prompt, maxTokens/timeoutMs/retries) — not just what they receive
 * back. `name` defaults to a non-Ollama provider label; pass "ollama" to
 * exercise the P5 gate.
 */
function recordingAi(turn: ChatTurn, name = "fake"): { ai: AiProvider; calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    ai: {
      name,
      enabled: true,
      supportsVision: false,
      async suggestCategories() {
        return [];
      },
      async generateSummary() {
        return "";
      },
      async chat(request: ChatRequest) {
        calls.push(request);
        return turn;
      },
    },
    calls,
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
  identity: { names: [], emails: [], upiIds: [] },
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

test("matchAccount: a debit-card alert resolves to the account its card is linked to", () => {
  // savings a/c ends 5739; its linked debit card ends 8812. A card alert names 8812.
  const accounts = [acct("sav", "HDFC Savings", "5739", "HDFC", "8812")];
  assert.equal(matchAccount("spent on Debit Card ending 8812", accounts), "sav");
  // the account-number last-4 still matches too
  assert.equal(matchAccount("A/C XXXXXXX5739 debited", accounts), "sav");
  // a card last-4 the reviewer hasn't recorded → no silent guess
  assert.equal(matchAccount("Debit Card ending 0000", accounts), null);
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

// ---------- intent: field-local normalization (misc-01) ----------
//
// `intent` on ModelTxnSchema MUST be field-local normalized
// (`z.enum([...]).nullable().catch(null)`), not a bare z.enum — a bare enum
// would fail the whole ModelResultSchema.safeParse on one bad value and make
// classifyAndExtract silently return zero transactions for the entire email.
// This exercises that guarantee through the exported classifyAndExtract with
// a faked model response covering valid, absent, unknown-string, and
// wrong-typed intent values in a single extraction.

const baseTxn = {
  amount: 100,
  direction: "credit" as const,
  date: null,
  accountHint: "",
  category: "",
  bankRef: null,
  sourceQuote: "",
  confidence: 0.9,
};

test("classifyAndExtract: intent normalizes valid/absent/unknown/wrong-typed values, and one malformed intent does not discard sibling transactions", async () => {
  const ai = fakeAi(
    JSON.stringify({
      classification: "transaction_alert",
      transactions: [
        { ...baseTxn, counterparty: "Card Payment", intent: "repayment" },
        { ...baseTxn, counterparty: "Amazon Refund", intent: "refund" },
        { ...baseTxn, counterparty: "Cashback Credit", intent: "cashback" },
        { ...baseTxn, counterparty: "Dispute Reversal", intent: "chargeback" },
        { ...baseTxn, counterparty: "No Intent Field" }, // intent key absent entirely
        { ...baseTxn, counterparty: "Bogus String", intent: "not-a-real-intent" },
        { ...baseTxn, counterparty: "Wrong Type", intent: 42 },
      ],
    }),
  );
  const result = await classifyAndExtract(email("..."), ai, [], { names: [], emails: [], upiIds: [] });
  // every row survives — a malformed `intent` on one row must not discard the extraction
  assert.equal(result.transactions.length, 7);
  assert.equal(result.transactions[0]!.intent, "repayment");
  assert.equal(result.transactions[1]!.intent, "refund");
  assert.equal(result.transactions[2]!.intent, "cashback");
  assert.equal(result.transactions[3]!.intent, "chargeback");
  assert.equal(result.transactions[4]!.intent, null); // absent
  // the malformed row itself survives, with intent normalized to null
  assert.equal(result.transactions[5]!.intent, null); // unknown string
  assert.equal(result.transactions[6]!.intent, null); // wrong type
});

test("runExtraction: intent threads through toInboxRow onto the persistable InboxRow", async () => {
  const ai = fakeAi(
    JSON.stringify({
      classification: "transaction_alert",
      transactions: [
        { ...baseTxn, counterparty: "Card Payment Received", intent: "repayment" },
        { ...baseTxn, counterparty: "Ordinary Credit" }, // no intent
      ],
    }),
  );
  const out = await runExtraction(email("..."), ai, ctx());
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0]!.intent, "repayment");
  assert.equal(out.rows[1]!.intent, null);
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

test("statementPeriodKey: YYYY-MM from a valid date; null otherwise", () => {
  assert.equal(statementPeriodKey("2026-07-20"), "2026-07");
  assert.equal(statementPeriodKey("2026-12-01"), "2026-12");
  assert.equal(statementPeriodKey("2026-13-40"), null); // impossible date
  assert.equal(statementPeriodKey("2026/07/20"), null); // wrong shape
  assert.equal(statementPeriodKey(null), null);
});

test("summarizeMatches: matchedPaise sums only matched debits, so the spend delta is right", () => {
  const stats = summarizeMatches([
    { amountPaise: 10000, direction: "debit", status: "duplicate", matchedTransactionId: "t1" },
    { amountPaise: 5000, direction: "debit", status: "pending" },
    { amountPaise: 2500, direction: "credit", status: "duplicate", matchedTransactionId: "t2" },
    { amountPaise: 900, direction: "debit" }, // no status → unmatched
  ]);
  assert.equal(stats.lineCount, 4);
  assert.equal(stats.lineDebitPaise, 15900); // 10000 + 5000 + 900 (credit excluded)
  // The matched credit (t2) is still counted and stamped, but must NOT reduce the
  // spend delta — only the matched debit (t1) counts toward matchedPaise.
  assert.equal(stats.matchedCount, 2);
  assert.equal(stats.matchedPaise, 10000); // debit t1 only, not the 2500 credit
  assert.equal(stats.unmatchedCount, 2);
  assert.deepEqual(stats.matchedTxnIds, ["t1", "t2"]);
  // delta = listed spend not yet cleared = 15900 − 10000 = 5900 (the 5000 + 900
  // unmatched debits); the old all-matched sum wrongly gave 15900 − 12500 = 3400.
  assert.equal(Math.max(0, stats.lineDebitPaise - stats.matchedPaise), 5900);
});

test("summarizeMatches: a duplicate without a matched id is not counted matched", () => {
  const stats = summarizeMatches([
    { amountPaise: 10000, direction: "debit", status: "duplicate", matchedTransactionId: null },
  ]);
  assert.equal(stats.matchedCount, 0);
  assert.equal(stats.unmatchedCount, 1);
  assert.deepEqual(stats.matchedTxnIds, []);
});

// ---- prompt date-format guidance ----

test("EXTRACT_SYSTEM includes day-first date guidance for Indian emails", () => {
  assert.ok(/day-first|day-month-year/i.test(EXTRACT_SYSTEM), "missing day-first guidance");
  assert.ok(/all-numeric dates/i.test(EXTRACT_SYSTEM), "missing all-numeric scoping");
  assert.ok(/DD-MM-YY|DD-MM-YYYY|DD\/MM\/YYYY/.test(EXTRACT_SYSTEM), "missing format examples");
  assert.ok(/24-07-26.*24 July 2026.*2026-07-24/.test(EXTRACT_SYSTEM), "missing example conversion");
  assert.ok(/2-digit year.*20YY/i.test(EXTRACT_SYSTEM), "missing 2-digit year expansion");
  assert.ok(/already.*ISO YYYY-MM-DD.*unchanged/i.test(EXTRACT_SYSTEM), "missing ISO passthrough guidance");
  assert.ok(/textual date with a month name/i.test(EXTRACT_SYSTEM), "missing textual date guidance");
});

test("STATEMENT_SYSTEM includes day-first date guidance for Indian statements", () => {
  assert.ok(/day-first|day-month-year/i.test(STATEMENT_SYSTEM), "missing day-first guidance");
  assert.ok(/all-numeric dates/i.test(STATEMENT_SYSTEM), "missing all-numeric scoping");
  assert.ok(/DD-MM-YY|DD-MM-YYYY|DD\/MM\/YYYY/.test(STATEMENT_SYSTEM), "missing format examples");
  assert.ok(/24-07-26.*24 July 2026.*2026-07-24/.test(STATEMENT_SYSTEM), "missing example conversion");
  assert.ok(/2-digit year.*20YY/i.test(STATEMENT_SYSTEM), "missing 2-digit year expansion");
  assert.ok(/already.*ISO YYYY-MM-DD.*unchanged/i.test(STATEMENT_SYSTEM), "missing ISO passthrough guidance");
  assert.ok(/textual date with a month name/i.test(STATEMENT_SYSTEM), "missing textual date guidance");
});

// ---------------------------------------------------------------------------
// Forced named tool-call structured output (extractor-structured-output task)
// ---------------------------------------------------------------------------

const identity = { names: [], emails: [], upiIds: [] };

// ---- request wiring: exactly one named tool + matching toolChoice per call site ----

test("classifyAndExtract: request wiring — record_transactions tool, matching toolChoice, unchanged system/maxTokens/timeoutMs", async () => {
  const { ai, calls } = recordingAi({
    text: JSON.stringify({ classification: "transaction_alert", transactions: [] }),
    toolCalls: [],
  });
  await classifyAndExtract(email("..."), ai, [{ id: "shop", name: "Shopping", kind: "expense" }], identity);
  assert.equal(calls.length, 1);
  const req = calls[0]!;
  assert.equal(req.tools.length, 1);
  assert.equal(req.tools[0]!.name, "record_transactions");
  assert.equal(req.toolChoice, "record_transactions");
  assert.equal(req.system, EXTRACT_SYSTEM);
  assert.equal(req.maxTokens, 2048);
  assert.equal(req.timeoutMs, 90_000);
  assert.equal(req.retries, undefined);
});

test("extractStatementTxns: request wiring — record_statement_transactions tool, matching toolChoice, unchanged system/maxTokens/timeoutMs/retries", async () => {
  const { ai, calls } = recordingAi({ text: JSON.stringify({ transactions: [] }), toolCalls: [] });
  await extractStatementTxns("<statement>", ai, {
    receivedDate: "2026-06-24",
    categories: [{ id: "food", name: "Food", kind: "expense" }],
    accountId: "card-1",
  });
  assert.equal(calls.length, 1);
  const req = calls[0]!;
  assert.equal(req.tools.length, 1);
  assert.equal(req.tools[0]!.name, "record_statement_transactions");
  assert.equal(req.toolChoice, "record_statement_transactions");
  assert.equal(req.system, STATEMENT_SYSTEM);
  assert.equal(req.maxTokens, 4096);
  assert.equal(req.timeoutMs, 180_000);
  assert.equal(req.retries, 1);
  // Category-list behavior is unchanged — the user message still carries it.
  const userMsg = req.messages[0]!;
  assert.equal(userMsg.role, "user");
  assert.match(userMsg.content as string, /Food/);
});

test("extractStatementSummary: request wiring — record_statement_summary tool, matching toolChoice, unchanged system/maxTokens/timeoutMs/retries", async () => {
  const { ai, calls } = recordingAi({ text: "{}", toolCalls: [] });
  await extractStatementSummary("<statement>", ai);
  assert.equal(calls.length, 1);
  const req = calls[0]!;
  assert.equal(req.tools.length, 1);
  assert.equal(req.tools[0]!.name, "record_statement_summary");
  assert.equal(req.toolChoice, "record_statement_summary");
  assert.equal(req.system, STATEMENT_SUMMARY_SYSTEM);
  assert.equal(req.maxTokens, 512);
  assert.equal(req.timeoutMs, 120_000);
  assert.equal(req.retries, 1);
});

// ---- Ollama gate: no tools/toolChoice; prompt still unchanged ----

test("Ollama gate: classifyAndExtract hands Ollama an empty tools array, no toolChoice, unchanged system prompt", async () => {
  const { ai, calls } = recordingAi(
    { text: JSON.stringify({ classification: "other", transactions: [] }), toolCalls: [] },
    "ollama",
  );
  await classifyAndExtract(email("..."), ai, [], identity);
  const req = calls[0]!;
  assert.deepEqual(req.tools, []);
  assert.equal(req.toolChoice, undefined);
  assert.equal(req.system, EXTRACT_SYSTEM);
});

test("Ollama gate: extractStatementTxns hands Ollama an empty tools array, no toolChoice, unchanged system prompt", async () => {
  const { ai, calls } = recordingAi({ text: JSON.stringify({ transactions: [] }), toolCalls: [] }, "ollama");
  await extractStatementTxns("<statement>", ai, { receivedDate: null, categories: [], accountId: "card-1" });
  const req = calls[0]!;
  assert.deepEqual(req.tools, []);
  assert.equal(req.toolChoice, undefined);
  assert.equal(req.system, STATEMENT_SYSTEM);
});

test("Ollama gate: extractStatementSummary hands Ollama an empty tools array, no toolChoice, unchanged system prompt", async () => {
  const { ai, calls } = recordingAi({ text: "no json here", toolCalls: [] }, "ollama");
  await extractStatementSummary("<statement>", ai);
  const req = calls[0]!;
  assert.deepEqual(req.tools, []);
  assert.equal(req.toolChoice, undefined);
  assert.equal(req.system, STATEMENT_SUMMARY_SYSTEM);
});

// ---- Tool-call-present success path (per call site) ----

test("classifyAndExtract: a correctly-named tool call with valid input is parsed directly, not the fallback text", async () => {
  const { ai } = recordingAi({
    text: "not JSON at all — this would fail extractJson if mistakenly read",
    toolCalls: [
      {
        id: "1",
        name: "record_transactions",
        input: { classification: "transaction_alert", transactions: [{ amount: 500, direction: "debit" }] },
      },
    ],
  });
  const result = await classifyAndExtract(email("..."), ai, [], identity);
  assert.equal(result.classification, "transaction_alert");
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0]!.amount, 500);
});

test("extractStatementTxns: a correctly-named tool call with valid input is parsed directly, not the fallback text", async () => {
  const { ai } = recordingAi({
    text: "not JSON at all — this would fail extractJson if mistakenly read",
    toolCalls: [
      { id: "1", name: "record_statement_transactions", input: { transactions: [{ amount: 450, direction: "debit" }] } },
    ],
  });
  const rows = await extractStatementTxns("<statement>", ai, {
    receivedDate: "2026-06-24",
    categories: [],
    accountId: "card-1",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.amountPaise, 45000);
  assert.equal(rows[0]!.suggestedAccountId, "card-1");
});

test("extractStatementSummary: a correctly-named tool call with valid input is parsed directly, not the fallback text", async () => {
  const { ai } = recordingAi({
    text: "not JSON at all — this would fail extractJson if mistakenly read",
    toolCalls: [
      {
        id: "1",
        name: "record_statement_summary",
        input: {
          totalAmountDue: 15230.5,
          minimumAmountDue: 763,
          statementDate: "2026-07-20",
          rewardPoints: { opening: 400, earned: 250, redeemed: 100, closing: 550 },
        },
      },
    ],
  });
  const s = await extractStatementSummary("<statement>", ai);
  assert.equal(s?.totalDuePaise, 1523050);
  assert.equal(s?.minDuePaise, 76300);
  assert.equal(s?.statementDate, "2026-07-20");
  assert.deepEqual(s?.rewards, { opening: 400, earned: 250, redeemed: 100, closing: 550 });
});

// ---- Fail-closed, exact-name selection policy (classifyAndExtract as the representative site — identical branch shape at all three) ----

test("classifyAndExtract: a wrong-name-only tool call falls back to extractJson(text)", async () => {
  const { ai } = recordingAi({
    text: JSON.stringify({ classification: "bill", transactions: [{ amount: 200, direction: "debit" }] }),
    toolCalls: [{ id: "1", name: "wrong_tool", input: { classification: "other", transactions: [] } }],
  });
  const result = await classifyAndExtract(email("..."), ai, [], identity);
  assert.equal(result.classification, "bill");
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0]!.amount, 200);
});

test("classifyAndExtract: wrong-name-first, correct-name-second — the correct-named call is found by filter, not index-0", async () => {
  const { ai } = recordingAi({
    text: "not JSON — invalid fallback text",
    toolCalls: [
      { id: "1", name: "wrong_tool", input: { classification: "other", transactions: [] } },
      {
        id: "2",
        name: "record_transactions",
        input: { classification: "bill", transactions: [{ amount: 300, direction: "credit" }] },
      },
    ],
  });
  const result = await classifyAndExtract(email("..."), ai, [], identity);
  assert.equal(result.classification, "bill");
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0]!.amount, 300);
});

test("classifyAndExtract: duplicate matching-named tool calls fail closed — no text fallback, no arbitrary pick", async () => {
  const { ai } = recordingAi({
    // Valid fallback text present — must NOT be used.
    text: JSON.stringify({ classification: "bill", transactions: [{ amount: 1, direction: "debit" }] }),
    toolCalls: [
      {
        id: "1",
        name: "record_transactions",
        input: { classification: "bill", transactions: [{ amount: 100, direction: "debit" }] },
      },
      {
        id: "2",
        name: "record_transactions",
        input: { classification: "transaction_alert", transactions: [{ amount: 200, direction: "credit" }] },
      },
    ],
  });
  const result = await classifyAndExtract(email("..."), ai, [], identity);
  assert.equal(result.classification, "other");
  assert.equal(result.transactions.length, 0);
});

test("classifyAndExtract: a correctly-named call with Zod-invalid input fails closed even with valid fallback text present", async () => {
  const { ai } = recordingAi({
    // Valid fallback text present — must NOT be used.
    text: JSON.stringify({ classification: "bill", transactions: [{ amount: 1, direction: "debit" }] }),
    toolCalls: [
      { id: "1", name: "record_transactions", input: { classification: "not_a_real_class", transactions: [] } },
    ],
  });
  const result = await classifyAndExtract(email("..."), ai, [], identity);
  assert.equal(result.classification, "other");
  assert.equal(result.transactions.length, 0);
});

test("classifyAndExtract: extractJson fallback handles prose-wrapped/fenced JSON, not just JSON.stringify output", async () => {
  const { ai } = recordingAi({
    text: [
      "Here you go:",
      "```json",
      JSON.stringify({ classification: "transaction_alert", transactions: [{ amount: 50, direction: "debit" }] }),
      "```",
      "Hope that helps!",
    ].join("\n"),
    toolCalls: [],
  });
  const result = await classifyAndExtract(email("..."), ai, [], identity);
  assert.equal(result.classification, "transaction_alert");
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0]!.amount, 50);
});

test("classifyAndExtract: malformed intent normalizes to null through the tool-input path", async () => {
  const { ai } = recordingAi({
    text: "not json",
    toolCalls: [
      {
        id: "1",
        name: "record_transactions",
        input: { classification: "transaction_alert", transactions: [{ ...baseTxn, intent: "bogus" }] },
      },
    ],
  });
  const result = await classifyAndExtract(email("..."), ai, [], identity);
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0]!.intent, null);
});

test("classifyAndExtract: malformed intent normalizes to null through the fallback-text path", async () => {
  const { ai } = recordingAi({
    text: JSON.stringify({
      classification: "transaction_alert",
      transactions: [{ ...baseTxn, intent: "bogus" }],
    }),
    toolCalls: [],
  });
  const result = await classifyAndExtract(email("..."), ai, [], identity);
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0]!.intent, null);
});

// ---- extractStatementTxns-specific: RECORD_STATEMENT_TXNS_TOOL, no classification property, both shapes ----

test("extractStatementTxns: supplies record_statement_transactions (not record_transactions), whose schema has no classification property", async () => {
  const { ai, calls } = recordingAi({ text: "", toolCalls: [] });
  await extractStatementTxns("<statement>", ai, { receivedDate: null, categories: [], accountId: "card-1" });
  const req = calls[0]!;
  assert.equal(req.tools.length, 1);
  assert.equal(req.tools[0]!.name, "record_statement_transactions");
  const schema = req.tools[0]!.inputSchema as { properties: Record<string, unknown> };
  assert.equal("classification" in schema.properties, false);
});

test("extractStatementTxns: both a tool-input {transactions:[...]} reply and a fallback-text legacy {classification,transactions} reply parse via StatementTxnResultSchema", async () => {
  const { ai: aiTool } = recordingAi({
    text: "not used — the tool call wins",
    toolCalls: [
      { id: "1", name: "record_statement_transactions", input: { transactions: [{ amount: 10, direction: "debit" }] } },
    ],
  });
  const rowsTool = await extractStatementTxns("<statement>", aiTool, {
    receivedDate: "2026-06-24",
    categories: [],
    accountId: "card-1",
  });
  assert.equal(rowsTool.length, 1);

  const { ai: aiFallback } = recordingAi({
    text: JSON.stringify({ classification: "card_statement", transactions: [{ amount: 20, direction: "credit" }] }),
    toolCalls: [],
  });
  const rowsFallback = await extractStatementTxns("<statement>", aiFallback, {
    receivedDate: "2026-06-24",
    categories: [],
    accountId: "card-1",
  });
  assert.equal(rowsFallback.length, 1);
});

test("extractStatementTxns: a correctly-named call with Zod-invalid input (missing amount) fails closed even with valid fallback text present", async () => {
  const { ai } = recordingAi({
    // Valid fallback text present — must NOT be used.
    text: JSON.stringify({ transactions: [{ amount: 1, direction: "debit" }] }),
    toolCalls: [{ id: "1", name: "record_statement_transactions", input: { transactions: [{ direction: "debit" }] } }],
  });
  const rows = await extractStatementTxns("<statement>", ai, {
    receivedDate: "2026-06-24",
    categories: [],
    accountId: "card-1",
  });
  assert.equal(rows.length, 0);
});

// ---- extractStatementSummary: duplicate matching-named calls fail closed to null ----

test("extractStatementSummary: duplicate matching-named tool calls fail closed to null — no text fallback, no arbitrary pick", async () => {
  const { ai } = recordingAi({
    // Valid fallback text present — must NOT be used.
    text: JSON.stringify({ totalAmountDue: 100, minimumAmountDue: 10, statementDate: "2026-07-20", rewardPoints: {} }),
    toolCalls: [
      {
        id: "1",
        name: "record_statement_summary",
        input: { totalAmountDue: 200, minimumAmountDue: 20, statementDate: "2026-07-01", rewardPoints: {} },
      },
      {
        id: "2",
        name: "record_statement_summary",
        input: { totalAmountDue: 300, minimumAmountDue: 30, statementDate: "2026-07-02", rewardPoints: {} },
      },
    ],
  });
  const s = await extractStatementSummary("<statement>", ai);
  assert.equal(s, null);
});
