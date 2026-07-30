import assert from "node:assert/strict";
import test from "node:test";
import { CreateResourceSchema, ResourceKindSchema, UpdateResourceSchema } from "./resources.ts";

test("supports vehicles and the common household connection types", () => {
  assert.deepEqual(ResourceKindSchema.options, [
    "vehicle",
    "electricity",
    "mobile",
    "internet",
    "gas",
    "water",
    "other",
  ]);
});

test("resource input keeps a friendly name and defaults optional metadata", () => {
  assert.deepEqual(CreateResourceSchema.parse({ kind: "electricity", name: "Home — Ground Floor" }), {
    kind: "electricity",
    name: "Home — Ground Floor",
    identifier: "",
    provider: "",
    planName: "",
    details: "",
  });
});

test("a single-field partial update returns only that field (defaults not resurrected)", () => {
  assert.deepEqual(UpdateResourceSchema.parse({ identifier: "abc" }), { identifier: "abc" });
});

test("updating archived alone returns only archived", () => {
  assert.deepEqual(UpdateResourceSchema.parse({ archived: true }), { archived: true });
});

test("an empty partial update is accepted and returns an empty object", () => {
  assert.deepEqual(UpdateResourceSchema.parse({}), {});
});

test("explicit values for all fields still get trim-transformed and enforce max-length bounds", () => {
  assert.deepEqual(
    UpdateResourceSchema.parse({
      kind: "mobile",
      name: "  Jio Postpaid  ",
      identifier: "  9999999999  ",
      provider: "  Jio  ",
      planName: "  Rs 399 plan  ",
      details: "  primary SIM  ",
      archived: false,
    }),
    {
      kind: "mobile",
      name: "Jio Postpaid",
      identifier: "9999999999",
      provider: "Jio",
      planName: "Rs 399 plan",
      details: "primary SIM",
      archived: false,
    },
  );

  assert.throws(() => UpdateResourceSchema.parse({ identifier: "a".repeat(121) }));
  assert.throws(() => UpdateResourceSchema.parse({ provider: "a".repeat(121) }));
  assert.throws(() => UpdateResourceSchema.parse({ planName: "a".repeat(121) }));
  assert.throws(() => UpdateResourceSchema.parse({ details: "a".repeat(501) }));
});
