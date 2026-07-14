import assert from "node:assert/strict";
import { test } from "node:test";
import { isTransferPair } from "./transfers.ts";

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
