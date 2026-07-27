import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "../lib/errors.ts";
import { buildTransferLegs, isTransferPair } from "./transfers.ts";

const out = { accountId: "a", amountPaise: -50000, date: "2026-07-10" };

test("same-day opposite-sign equal amounts in different accounts match", () => {
  assert.equal(
    isTransferPair(out, { accountId: "b", amountPaise: 50000, date: "2026-07-10" }),
    true,
  );
});

test("±3-day window matches; beyond does not", () => {
  assert.equal(
    isTransferPair(out, { accountId: "b", amountPaise: 50000, date: "2026-07-13" }),
    true,
  );
  assert.equal(
    isTransferPair(out, { accountId: "b", amountPaise: 50000, date: "2026-07-07" }),
    true,
  );
  assert.equal(
    isTransferPair(out, { accountId: "b", amountPaise: 50000, date: "2026-07-14" }),
    false,
  );
});

test("same account or mismatched amounts never match", () => {
  assert.equal(
    isTransferPair(out, { accountId: "a", amountPaise: 50000, date: "2026-07-10" }),
    false,
  );
  assert.equal(
    isTransferPair(out, { accountId: "b", amountPaise: 40000, date: "2026-07-10" }),
    false,
  );
  assert.equal(
    isTransferPair(out, { accountId: "b", amountPaise: -50000, date: "2026-07-10" }),
    false,
  );
});

// ---------- buildTransferLegs ----------

test("buildTransferLegs: splits into an opposite-sign leg per account", () => {
  const legs = buildTransferLegs({
    fromAccountId: "a",
    toAccountId: "b",
    date: "2026-07-10",
    amountPaise: 50000,
    merchant: "Self transfer",
    notes: "",
    tags: [],
  });
  assert.equal(legs.out.accountId, "a");
  assert.equal(legs.out.amountPaise, -50000);
  assert.equal(legs.in.accountId, "b");
  assert.equal(legs.in.amountPaise, 50000);
  assert.equal(legs.out.date, "2026-07-10");
  assert.equal(legs.in.date, "2026-07-10");
  assert.equal(legs.out.categoryId, null);
  assert.equal(legs.in.categoryId, null);
});

test("buildTransferLegs: same account for from and to throws 400", () => {
  assert.throws(
    () =>
      buildTransferLegs({
        fromAccountId: "a",
        toAccountId: "a",
        date: "2026-07-10",
        amountPaise: 50000,
        merchant: "",
        notes: "",
        tags: [],
      }),
    (err: unknown) => err instanceof HttpError && err.statusCode === 400,
  );
});

test("buildTransferLegs: zero amount throws 400", () => {
  assert.throws(
    () =>
      buildTransferLegs({
        fromAccountId: "a",
        toAccountId: "b",
        date: "2026-07-10",
        amountPaise: 0,
        merchant: "",
        notes: "",
        tags: [],
      }),
    (err: unknown) => err instanceof HttpError && err.statusCode === 400,
  );
});

test("buildTransferLegs: negative amount throws 400", () => {
  assert.throws(
    () =>
      buildTransferLegs({
        fromAccountId: "a",
        toAccountId: "b",
        date: "2026-07-10",
        amountPaise: -50000,
        merchant: "",
        notes: "",
        tags: [],
      }),
    (err: unknown) => err instanceof HttpError && err.statusCode === 400,
  );
});

test("buildTransferLegs: non-integer paise throws 400", () => {
  assert.throws(
    () =>
      buildTransferLegs({
        fromAccountId: "a",
        toAccountId: "b",
        date: "2026-07-10",
        amountPaise: 500.5,
        merchant: "",
        notes: "",
        tags: [],
      }),
    (err: unknown) => err instanceof HttpError && err.statusCode === 400,
  );
});

test("buildTransferLegs: carries merchant, notes and tags onto both legs", () => {
  const legs = buildTransferLegs({
    fromAccountId: "a",
    toAccountId: "b",
    date: "2026-07-10",
    amountPaise: 50000,
    merchant: "Move to savings",
    notes: "monthly sweep",
    tags: ["savings"],
  });
  assert.equal(legs.out.merchant, "Move to savings");
  assert.equal(legs.in.merchant, "Move to savings");
  assert.equal(legs.out.notes, "monthly sweep");
  assert.equal(legs.in.notes, "monthly sweep");
  assert.deepEqual(legs.out.tags, ["savings"]);
  assert.deepEqual(legs.in.tags, ["savings"]);
});
