import assert from "node:assert/strict";
import test from "node:test";
import { CreateRecurringTemplateSchema, UpdateRecurringTemplateSchema } from "./budgets.ts";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";
const RESOURCE_ID = "33333333-3333-4333-8333-333333333333";

test("create schema still defaults optional fields (unchanged create-time behavior)", () => {
  assert.deepEqual(
    CreateRecurringTemplateSchema.parse({
      accountId: ACCOUNT_ID,
      merchant: "Landlord",
      amountPaise: -5000,
      frequency: "monthly",
      nextDueDate: "2026-08-01",
    }),
    {
      accountId: ACCOUNT_ID,
      categoryId: null,
      merchant: "Landlord",
      amountPaise: -5000,
      notes: "",
      frequency: "monthly",
      interval: 1,
      nextDueDate: "2026-08-01",
      endDate: null,
      kind: "none",
      remindDays: null,
      resourceId: null,
    },
  );
});

test("a single-field partial update returns only that field (defaults not resurrected)", () => {
  assert.deepEqual(UpdateRecurringTemplateSchema.parse({ notes: "hi" }), { notes: "hi" });
});

test("updating kind alone returns only kind (the field implicated in the EMI pause/resume bug)", () => {
  assert.deepEqual(UpdateRecurringTemplateSchema.parse({ kind: "emi" }), { kind: "emi" });
});

test("an empty partial update is accepted and returns an empty object", () => {
  assert.deepEqual(UpdateRecurringTemplateSchema.parse({}), {});
});

test("a full-object update still validates and passes every value through unchanged", () => {
  const full = {
    accountId: ACCOUNT_ID,
    categoryId: CATEGORY_ID,
    merchant: "New Landlord",
    amountPaise: -6000,
    notes: "rent increase",
    frequency: "monthly" as const,
    interval: 2,
    nextDueDate: "2026-09-01",
    endDate: "2027-09-01",
    kind: "bill" as const,
    remindDays: 5,
    resourceId: RESOURCE_ID,
    paused: true,
  };
  assert.deepEqual(UpdateRecurringTemplateSchema.parse(full), full);
});

test("an invalid value for a present field still fails validation (constraint preserved by unwrap)", () => {
  assert.throws(() => UpdateRecurringTemplateSchema.parse({ remindDays: 100 }));
});

test("explicit null clears for nullable fields still parse and pass through as null", () => {
  assert.deepEqual(UpdateRecurringTemplateSchema.parse({ categoryId: null, resourceId: null }), {
    categoryId: null,
    resourceId: null,
  });
});
