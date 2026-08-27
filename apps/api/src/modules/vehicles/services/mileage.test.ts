import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMileageIntervals } from "./mileage.ts";

const r = (id: string, odometerKm: number, readingDate: string, amountPaise: number | null = null) => ({
  id,
  odometerKm,
  readingDate,
  amountPaise,
});

test("computeMileageIntervals: one interval per consecutive pair, oldest to newest", () => {
  const intervals = computeMileageIntervals([
    r("a", 1000, "2026-01-01"),
    r("b", 1400, "2026-01-15"),
    r("c", 1900, "2026-02-01"),
  ]);
  assert.equal(intervals.length, 2);
  assert.deepEqual(
    intervals.map((i) => [i.fromReadingId, i.toReadingId, i.kmDriven]),
    [
      ["a", "b", 400],
      ["b", "c", 500],
    ],
  );
});

test("computeMileageIntervals: sorts input by readingDate regardless of array order", () => {
  const intervals = computeMileageIntervals([
    r("b", 1400, "2026-01-15"),
    r("a", 1000, "2026-01-01"),
  ]);
  assert.deepEqual(
    intervals.map((i) => [i.fromReadingId, i.toReadingId]),
    [["a", "b"]],
  );
});

test("computeMileageIntervals: kmPer100Rupees uses the FROM reading's linked spend, full-to-full", () => {
  // ₹1000 (100000 paise) spent at the start of the interval, 400 km covered.
  const intervals = computeMileageIntervals([
    r("a", 1000, "2026-01-01", 100000),
    r("b", 1400, "2026-01-15", 120000),
  ]);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0]!.amountPaise, 100000);
  // 400 km * 10000 / 100000 paise = 40 km per ₹100
  assert.equal(intervals[0]!.kmPer100Rupees, 40);
});

test("computeMileageIntervals: a reading with no linked transaction yields a null economy for that interval", () => {
  const intervals = computeMileageIntervals([
    r("a", 1000, "2026-01-01", null),
    r("b", 1400, "2026-01-15", 100000),
  ]);
  assert.equal(intervals[0]!.amountPaise, null);
  assert.equal(intervals[0]!.kmPer100Rupees, null);
});

test("computeMileageIntervals: zero or negative km driven never divides — null economy, not Infinity/NaN", () => {
  const intervals = computeMileageIntervals([
    r("a", 1000, "2026-01-01", 100000),
    r("b", 1000, "2026-01-15", 50000), // same odometer, e.g. a correction
  ]);
  assert.equal(intervals[0]!.kmDriven, 0);
  assert.equal(intervals[0]!.kmPer100Rupees, null);
});

test("computeMileageIntervals: a zero/negative linked amount never divides", () => {
  const intervals = computeMileageIntervals([
    r("a", 1000, "2026-01-01", 0),
    r("b", 1400, "2026-01-15", 50000),
  ]);
  assert.equal(intervals[0]!.kmPer100Rupees, null);
});

test("computeMileageIntervals: 0 or 1 readings yield no intervals", () => {
  assert.deepEqual(computeMileageIntervals([]), []);
  assert.deepEqual(computeMileageIntervals([r("a", 1000, "2026-01-01")]), []);
});

test("computeMileageIntervals: same-day readings are ordered by odometer, not left ambiguous", () => {
  const intervals = computeMileageIntervals([
    r("b", 1400, "2026-01-01"),
    r("a", 1000, "2026-01-01"),
  ]);
  assert.deepEqual(
    intervals.map((i) => [i.fromReadingId, i.toReadingId]),
    [["a", "b"]],
  );
});
