import { test } from "node:test";
import assert from "node:assert/strict";
import { detectAnomaly, sensitivityThreshold } from "./anomaly.ts";

test("sensitivityThreshold: off disables, higher sensitivity = lower z-bar", () => {
  assert.equal(sensitivityThreshold("off"), null);
  assert.ok(sensitivityThreshold("high")! < sensitivityThreshold("normal")!);
  assert.ok(sensitivityThreshold("normal")! < sensitivityThreshold("low")!);
});

test("detectAnomaly: flags a clear 3x spike over steady history", () => {
  const history = [10000, 11000, 9000, 10500, 9500, 10000]; // ~₹100 steady
  const r = detectAnomaly(30000, history, "normal"); // 3x
  assert.equal(r.anomaly, true);
  assert.equal(r.ratio, 3);
});

test("detectAnomaly: does not flag normal variation", () => {
  const history = [10000, 11000, 9000, 10500, 9500, 10000];
  assert.equal(detectAnomaly(11000, history, "normal").anomaly, false);
});

test("detectAnomaly: never flags under-spend, needs >=3 months history", () => {
  assert.equal(detectAnomaly(5000, [10000, 11000, 9000], "high").anomaly, false); // under mean
  assert.equal(detectAnomaly(99999, [10000, 11000], "high").anomaly, false); // too little history
});

test("detectAnomaly: off sensitivity never flags", () => {
  assert.equal(detectAnomaly(999999, [100, 100, 100, 100], "off").anomaly, false);
});
