import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeCursor, encodeCursor, sumSigned, txDirection } from "./transactions.ts";

test("sign conventions: negative amounts are outflows (expenses)", () => {
  assert.equal(txDirection(-50000), "outflow");
  assert.equal(txDirection(120000), "inflow");
});

test("sumSigned splits income and expense by sign", () => {
  const { incomePaise, expensePaise } = sumSigned([100000, -25000, -35000, 5000]);
  assert.equal(incomePaise, 105000);
  assert.equal(expensePaise, 60000);
});

test("sumSigned of empty list is zero", () => {
  assert.deepEqual(sumSigned([]), { incomePaise: 0, expensePaise: 0 });
});

test("encodeCursor/decodeCursor round-trip the (date, createdAt, id) keyset", () => {
  const createdAt = new Date("2026-01-05T12:34:56.000Z");
  const id = "3f6b1e2a-0000-4000-8000-000000000000";
  const cursor = encodeCursor("2026-01-05", createdAt, id);
  const decoded = decodeCursor(cursor);
  assert.deepEqual(decoded, {
    date: "2026-01-05",
    createdAt: createdAt.toISOString(),
    id,
  });
});

test("encodeCursor accepts an ISO string createdAt (already-hydrated rows)", () => {
  const cursor = encodeCursor("2026-01-05", "2026-01-05T12:34:56.000Z", "3f6b1e2a-0000-4000-8000-000000000001");
  assert.deepEqual(decodeCursor(cursor), {
    date: "2026-01-05",
    createdAt: "2026-01-05T12:34:56.000Z",
    id: "3f6b1e2a-0000-4000-8000-000000000001",
  });
});

test("decodeCursor returns null (not a throw) for the older 2-part (date, id) cursor format", () => {
  const oldCursor = Buffer.from("2026-01-05|old-id-123").toString("base64url");
  assert.equal(decodeCursor(oldCursor), null);
});

test("decodeCursor returns null for garbage/non-base64url input", () => {
  assert.equal(decodeCursor("not-a-valid-cursor-!!!"), null);
});

test("decodeCursor returns null when the createdAt segment isn't a parseable date", () => {
  const cursor = Buffer.from("2026-01-05|not-a-date|some-id").toString("base64url");
  assert.equal(decodeCursor(cursor), null);
});

test("decodeCursor returns null for invalid date formats (not YYYY-MM-DD)", () => {
  const cursor1 = Buffer.from("2026-1-5|2026-01-05T12:00:00Z|3f6b1e2a-0000-4000-8000-000000000000").toString("base64url");
  assert.equal(decodeCursor(cursor1), null);
  const cursor2 = Buffer.from("26-01-05|2026-01-05T12:00:00Z|3f6b1e2a-0000-4000-8000-000000000000").toString("base64url");
  assert.equal(decodeCursor(cursor2), null);
});

test("decodeCursor returns null for invalid calendar dates (e.g. 2026-13-40)", () => {
  const cursor = Buffer.from("2026-13-40|2026-01-05T12:00:00Z|3f6b1e2a-0000-4000-8000-000000000000").toString("base64url");
  assert.equal(decodeCursor(cursor), null);
});

test("decodeCursor returns null for invalid UUID formats", () => {
  const cursor1 = Buffer.from("2026-01-05|2026-01-05T12:00:00Z|not-a-uuid").toString("base64url");
  assert.equal(decodeCursor(cursor1), null);
  const cursor2 = Buffer.from("2026-01-05|2026-01-05T12:00:00Z|3f6b1e2a00004000800000000000000").toString("base64url");
  assert.equal(decodeCursor(cursor2), null);
});

test("encodeCursor/decodeCursor preserve microsecond precision in createdAt", () => {
  // Full-precision timestamp with microseconds (matches the ISO format emitted
  // by the to_char query in listTransactions, e.g. '2026-01-05T10:20:30.465887Z')
  const createdAtPrecise = "2026-01-05T10:20:30.465887Z";
  const cursor = encodeCursor("2026-01-05", createdAtPrecise, "3f6b1e2a-0000-4000-8000-000000000000");
  const decoded = decodeCursor(cursor);
  assert.deepEqual(decoded, {
    date: "2026-01-05",
    createdAt: createdAtPrecise,
    id: "3f6b1e2a-0000-4000-8000-000000000000",
  });
  // Ensure no truncation occurred
  assert.equal(decoded?.createdAt, createdAtPrecise);
  // Verify Date.parse accepts this format (not NaN)
  assert.equal(Number.isNaN(Date.parse(createdAtPrecise)), false);
});
