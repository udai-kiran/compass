/**
 * claim-readiness.test.ts — pure waiting-period and checklist logic (task 14.1).
 * No DB, no clock, no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeWaitingPeriodEndDates, computeClaimReadiness } from "./claim-readiness.ts";

// ─── computeWaitingPeriodEndDates ──────────────────────────────────────────

describe("computeWaitingPeriodEndDates", () => {
  it("returns all-null when there's no start date", () => {
    assert.deepEqual(
      computeWaitingPeriodEndDates({
        startDate: null,
        initialWaitingDays: 30,
        preExistingWaitingMonths: 36,
        maternityWaitingMonths: 9,
      }),
      { initialWaitingEndDate: null, preExistingWaitingEndDate: null, maternityWaitingEndDate: null },
    );
  });

  it("returns null per-field when that waiting period isn't set", () => {
    assert.deepEqual(
      computeWaitingPeriodEndDates({
        startDate: "2025-01-01",
        initialWaitingDays: null,
        preExistingWaitingMonths: null,
        maternityWaitingMonths: null,
      }),
      { initialWaitingEndDate: null, preExistingWaitingEndDate: null, maternityWaitingEndDate: null },
    );
  });

  it("adds days for the initial waiting period", () => {
    const { initialWaitingEndDate } = computeWaitingPeriodEndDates({
      startDate: "2025-06-01",
      initialWaitingDays: 30,
      preExistingWaitingMonths: null,
      maternityWaitingMonths: null,
    });
    assert.equal(initialWaitingEndDate, "2025-07-01");
  });

  it("adds whole months for pre-existing-disease and maternity waiting periods", () => {
    const result = computeWaitingPeriodEndDates({
      startDate: "2024-03-15",
      initialWaitingDays: null,
      preExistingWaitingMonths: 36,
      maternityWaitingMonths: 9,
    });
    assert.equal(result.preExistingWaitingEndDate, "2027-03-15");
    assert.equal(result.maternityWaitingEndDate, "2024-12-15");
  });

  it("clamps month-end overflow instead of rolling into the next month (31-Jan + 1mo)", () => {
    const { maternityWaitingEndDate } = computeWaitingPeriodEndDates({
      startDate: "2025-01-31",
      initialWaitingDays: null,
      preExistingWaitingMonths: null,
      maternityWaitingMonths: 1,
    });
    assert.equal(maternityWaitingEndDate, "2025-02-28"); // not 2025-03-03
  });

  it("clamps across a leap-year boundary (31-Jan-2024 → 1mo, leap Feb)", () => {
    const { maternityWaitingEndDate } = computeWaitingPeriodEndDates({
      startDate: "2024-01-31",
      initialWaitingDays: null,
      preExistingWaitingMonths: null,
      maternityWaitingMonths: 1,
    });
    assert.equal(maternityWaitingEndDate, "2024-02-29");
  });
});

// ─── computeClaimReadiness ──────────────────────────────────────────────────

const baseHealthInput = {
  kind: "health" as const,
  today: "2026-08-25",
  hasDocument: true,
  healthCardCount: 1,
  tpaName: "MediAssist",
  renewalDate: "2027-01-01",
  disclosuresComplete: true,
  nominee: "Spouse",
  nomineePersonId: null,
  initialWaitingDays: 30,
  preExistingWaitingMonths: 0,
  maternityWaitingMonths: 0,
  waitingEndDates: {
    initialWaitingEndDate: "2025-01-30",
    preExistingWaitingEndDate: null,
    maternityWaitingEndDate: null,
  },
};

describe("computeClaimReadiness", () => {
  it("reports every item ready for a fully-prepared health policy", () => {
    const items = computeClaimReadiness(baseHealthInput);
    assert.ok(items.length > 0);
    for (const item of items) {
      assert.equal(item.ready, true, `expected "${item.key}" to be ready`);
      assert.equal(item.missingArtifact, null);
    }
  });

  it("names the specific missing artifact for a document-less, TPA-less policy", () => {
    const items = computeClaimReadiness({ ...baseHealthInput, hasDocument: false, tpaName: "" });
    const doc = items.find((i) => i.key === "document")!;
    assert.equal(doc.ready, false);
    assert.equal(doc.missingArtifact, "Policy document (PDF/scan)");
    const tpa = items.find((i) => i.key === "tpa-contact")!;
    assert.equal(tpa.ready, false);
    assert.equal(tpa.missingArtifact, "TPA name and contact");
  });

  it("flags an un-elapsed waiting period with its end date named", () => {
    const items = computeClaimReadiness({
      ...baseHealthInput,
      waitingEndDates: { ...baseHealthInput.waitingEndDates, initialWaitingEndDate: "2026-09-01" },
    });
    const w = items.find((i) => i.key === "waiting-initial")!;
    assert.equal(w.ready, false);
    assert.equal(w.missingArtifact, "Waiting period runs to 2026-09-01");
  });

  it("omits a waiting-period item entirely when it isn't set on the policy (not a false failure)", () => {
    const items = computeClaimReadiness(baseHealthInput); // preExisting/maternity months are 0
    assert.equal(items.some((i) => i.key === "waiting-pre-existing"), false);
    assert.equal(items.some((i) => i.key === "waiting-maternity"), false);
  });

  it("flags a lapsed renewal by name", () => {
    const items = computeClaimReadiness({ ...baseHealthInput, renewalDate: "2026-01-01" });
    const r = items.find((i) => i.key === "renewal")!;
    assert.equal(r.ready, false);
    assert.equal(r.missingArtifact, "Renewal payment (was due 2026-01-01)");
  });

  it("treats a null renewal date (single-premium policy) as always current", () => {
    const items = computeClaimReadiness({ ...baseHealthInput, renewalDate: null });
    assert.equal(items.find((i) => i.key === "renewal")!.ready, true);
  });

  it("accepts a linked family member in place of a free-text nominee", () => {
    const items = computeClaimReadiness({ ...baseHealthInput, nominee: "", nomineePersonId: "11111111-1111-1111-1111-111111111111" });
    assert.equal(items.find((i) => i.key === "nominee")!.ready, true);
  });

  it("omits health-only items (card, TPA, disclosures, waiting periods) for a life policy", () => {
    const items = computeClaimReadiness({
      kind: "life",
      today: "2026-08-25",
      hasDocument: false,
      healthCardCount: 0,
      tpaName: "",
      renewalDate: null,
      disclosuresComplete: false,
      nominee: "",
      nomineePersonId: null,
      initialWaitingDays: null,
      preExistingWaitingMonths: null,
      maternityWaitingMonths: null,
      waitingEndDates: { initialWaitingEndDate: null, preExistingWaitingEndDate: null, maternityWaitingEndDate: null },
    });
    const keys = items.map((i) => i.key);
    assert.deepEqual(keys, ["document", "nominee", "renewal"]);
  });

  it("omits health-only items for a vehicle policy the same way", () => {
    const items = computeClaimReadiness({
      kind: "vehicle",
      today: "2026-08-25",
      hasDocument: true,
      healthCardCount: 0,
      tpaName: "",
      renewalDate: "2027-01-01",
      disclosuresComplete: false,
      nominee: "Self",
      nomineePersonId: null,
      initialWaitingDays: null,
      preExistingWaitingMonths: null,
      maternityWaitingMonths: null,
      waitingEndDates: { initialWaitingEndDate: null, preExistingWaitingEndDate: null, maternityWaitingEndDate: null },
    });
    assert.deepEqual(items.map((i) => i.key), ["document", "nominee", "renewal"]);
  });
});
