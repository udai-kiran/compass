import { test } from "node:test";
import assert from "node:assert/strict";
import type { AiProvider } from "@compass/ai";
import {
  decideStatus,
  dedupeHashFor,
  matchAccount,
  runExtraction,
  type AccountRef,
} from "./extract.ts";
import type { ParsedEmail } from "./email.ts";

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

const ctx = (accounts: AccountRef[] = []) => ({ receivedDate: "2026-07-10", accounts });

test("decideStatus routes each class", () => {
  assert.deepEqual(decideStatus("transaction_alert"), { status: "extracted", extract: true });
  assert.deepEqual(decideStatus("bill"), { status: "extracted", extract: true });
  assert.deepEqual(decideStatus("card_statement"), { status: "deferred", extract: false });
  assert.deepEqual(decideStatus("otp"), { status: "ignored", extract: false });
  assert.deepEqual(decideStatus("promo"), { status: "ignored", extract: false });
  assert.deepEqual(decideStatus("other"), { status: "ignored", extract: false });
});

test("matchAccount: last-4 hit is precise, ambiguity and no-digits yield null", () => {
  const accounts: AccountRef[] = [
    { id: "a1", name: "HDFC Card ••1234" },
    { id: "a2", name: "ICICI Savings ••9999" },
  ];
  assert.equal(matchAccount("ending 1234", accounts), "a1");
  assert.equal(matchAccount("no digits here", accounts), null);
  // two accounts both containing 12 → ambiguous
  assert.equal(
    matchAccount("012", [
      { id: "x", name: "Acct 012" },
      { id: "y", name: "Card 012" },
    ]),
    null,
  );
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
          bankRef: "TXN-7788",
          sourceQuote: "Rs 1,234.56 spent at Amazon",
          confidence: 0.9,
        },
      ],
    }),
  );
  const out = await runExtraction(email("..."), ai, ctx([{ id: "a1", name: "HDFC ••1234" }]));
  assert.equal(out.status, "extracted");
  assert.equal(out.rows.length, 1);
  const row = out.rows[0]!;
  assert.equal(row.amountPaise, 123456);
  assert.equal(row.direction, "debit");
  assert.equal(row.occurredAt, "2026-07-08");
  assert.equal(row.suggestedAccountId, "a1");
  assert.equal(row.dedupeHash, "ref:txn-7788");
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
