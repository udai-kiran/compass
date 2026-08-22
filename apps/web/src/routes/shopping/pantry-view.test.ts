import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chartDataFromPoints,
  formatConsumptionRate,
  formatDepletionEstimate,
  honestyVerdict,
  trendLabel,
} from "./pantry-view.ts";

test("formatDepletionEstimate formats days, weeks, past dates, and absent estimates", () => {
  const now = new Date("2026-08-22T00:00:00.000Z");

  assert.equal(formatDepletionEstimate(new Date("2026-08-25T12:00:00.000Z"), now), "3 days");
  assert.equal(formatDepletionEstimate(new Date("2026-09-05T00:00:00.000Z"), now), "2 weeks");
  assert.equal(formatDepletionEstimate(new Date("2026-08-21T23:59:59.000Z"), now), "depleted");
  assert.equal(formatDepletionEstimate(null, now), "depleted");
});

test("formatConsumptionRate formats rates and handles missing rate or unit", () => {
  assert.equal(formatConsumptionRate(500, "g"), "500 g/month");
  assert.equal(formatConsumptionRate(2, "piece"), "2 piece/month");
  assert.equal(formatConsumptionRate(null, "g"), "—");
  assert.equal(formatConsumptionRate(500, null), "—");
});

test("chartDataFromPoints sorts observations and supports empty and singleton histories", () => {
  assert.deepEqual(
    chartDataFromPoints([
      { pricePaise: 12500, observedAt: new Date("2026-03-03T00:00:00.000Z") },
      { pricePaise: 9900, observedAt: new Date("2026-01-02T00:00:00.000Z") },
    ]),
    { labels: ["2026-01-02", "2026-03-03"], values: [9900, 12500] },
  );
  assert.deepEqual(chartDataFromPoints([]), { labels: [], values: [] });
  assert.deepEqual(
    chartDataFromPoints([{ pricePaise: 100, observedAt: new Date("2026-08-22T00:00:00.000Z") }]),
    { labels: ["2026-08-22"], values: [100] },
  );
});

test("trendLabel handles every trend and confidence combination", () => {
  const expected: Record<string, string> = {
    rising: "Rising",
    falling: "Falling",
    stable: "Stable",
    insufficient_data: "Not enough data",
  };
  const confidences = ["low", "medium", "high", "insufficient_data"];

  for (const [trend, label] of Object.entries(expected)) {
    for (const confidence of confidences) {
      const suffix =
        confidence === "insufficient_data" ? "insufficient data" : `${confidence} confidence`;
      const expectedLabel =
        trend === "rising" || trend === "falling" ? `${label} (${suffix})` : label;
      assert.equal(trendLabel(trend, confidence), expectedLabel, `${trend}/${confidence}`);
    }
  }
});

test("honestyVerdict flags inflated claims and treats fair or data-less claims as fair", () => {
  assert.equal(
    honestyVerdict(true, 10000, 12500),
    "⚠ Claimed ₹125.00 is 25% above highest observed ₹100.00",
  );
  assert.equal(honestyVerdict(false, 10000, 12500), "✓ Price appears fair");
  assert.equal(honestyVerdict(false, null, 12500), "✓ Price appears fair");
  assert.equal(honestyVerdict(true, 0, 12500), "⚠ No valid price baseline to compare");
});
