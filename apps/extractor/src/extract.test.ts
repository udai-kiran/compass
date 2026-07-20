import { test } from "node:test";
import assert from "node:assert/strict";
import type { AiProvider } from "@compass/ai";
import {
  decideStatus,
  dedupeHashFor,
  matchAccount,
  matchCategory,
  runExtraction,
  validIsoDate,
  type AccountRef,
  type CategoryRef,
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
  hasAttachments: false,
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
