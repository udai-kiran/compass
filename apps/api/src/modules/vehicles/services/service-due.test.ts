import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, checkServiceDue, SERVICE_REMIND_DAYS, SERVICE_REMIND_KM } from "./service-due.ts";

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const NONE = {
  serviceIntervalKm: null,
  serviceIntervalMonths: null,
  lastServiceOdometerKm: null,
  lastServiceDate: null,
};

test("addMonths: adds whole months, carrying the year", () => {
  assert.equal(addMonths("2026-01-15", 6), "2026-07-15");
  assert.equal(addMonths("2026-10-15", 6), "2027-04-15");
});

test("addMonths: clamps to the target month's last day instead of rolling over", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28"); // 2026 not a leap year
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29"); // 2024 is a leap year
});

test("checkServiceDue: neither interval configured is never due", () => {
  const check = checkServiceDue(NONE, 5000, "2026-06-01");
  assert.equal(check.due, false);
  assert.equal(check.dueByKm, false);
  assert.equal(check.dueByTime, false);
});

test("checkServiceDue: km-only — not due well before the interval", () => {
  const state = { ...NONE, serviceIntervalKm: 5000, lastServiceOdometerKm: 10000 };
  const check = checkServiceDue(state, 12000, "2026-06-01"); // 2000 km since service
  assert.equal(check.due, false);
  assert.equal(check.kmSinceService, 2000);
  assert.equal(check.nextServiceOdometerKm, 15000);
});

test("checkServiceDue: km-only — due once within SERVICE_REMIND_KM of the interval", () => {
  const state = { ...NONE, serviceIntervalKm: 5000, lastServiceOdometerKm: 10000 };
  const atEdge = 15000 - SERVICE_REMIND_KM;
  assert.equal(checkServiceDue(state, atEdge - 1, "2026-06-01").dueByKm, false);
  assert.equal(checkServiceDue(state, atEdge, "2026-06-01").dueByKm, true);
  assert.equal(checkServiceDue(state, 20000, "2026-06-01").dueByKm, true); // already past
});

test("checkServiceDue: time-only — due once within SERVICE_REMIND_DAYS of the interval", () => {
  const state = { ...NONE, serviceIntervalMonths: 6, lastServiceDate: "2026-01-01" };
  // next service date is 2026-07-01
  const check1 = checkServiceDue(state, null, "2026-06-01");
  assert.equal(check1.dueByTime, false);
  assert.equal(check1.nextServiceDate, "2026-07-01");

  const remindFrom = addDays("2026-07-01", -SERVICE_REMIND_DAYS);
  assert.equal(checkServiceDue(state, null, addDays(remindFrom, -1)).dueByTime, false);
  assert.equal(checkServiceDue(state, null, remindFrom).dueByTime, true);
  assert.equal(checkServiceDue(state, null, "2026-08-01").dueByTime, true); // already past
});

test("checkServiceDue: whichever comes first — km due but time not due is still overall due", () => {
  const state = {
    serviceIntervalKm: 5000,
    serviceIntervalMonths: 12,
    lastServiceOdometerKm: 10000,
    lastServiceDate: "2026-01-01",
  };
  const check = checkServiceDue(state, 15000, "2026-02-01"); // km past due, months nowhere close
  assert.equal(check.dueByKm, true);
  assert.equal(check.dueByTime, false);
  assert.equal(check.due, true);
});

test("checkServiceDue: whichever comes first — time due but km not due is still overall due", () => {
  const state = {
    serviceIntervalKm: 50000,
    serviceIntervalMonths: 6,
    lastServiceOdometerKm: 10000,
    lastServiceDate: "2026-01-01",
  };
  const check = checkServiceDue(state, 10500, "2026-07-01"); // months past due, km nowhere close
  assert.equal(check.dueByKm, false);
  assert.equal(check.dueByTime, true);
  assert.equal(check.due, true);
});

test("checkServiceDue: no current odometer reading leaves the km leg unevaluable, not falsely due", () => {
  const state = { ...NONE, serviceIntervalKm: 5000, lastServiceOdometerKm: 10000 };
  const check = checkServiceDue(state, null, "2026-06-01");
  assert.equal(check.dueByKm, false);
  assert.equal(check.kmSinceService, null);
});
