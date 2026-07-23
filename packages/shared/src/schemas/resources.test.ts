import assert from "node:assert/strict";
import test from "node:test";
import { CreateResourceSchema, ResourceKindSchema } from "./resources.ts";

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
