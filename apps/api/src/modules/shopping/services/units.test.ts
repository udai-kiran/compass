import { test } from "node:test";
import assert from "node:assert/strict";
import { NormalizedUnitInfoSchema } from "@compass/shared";
import { normalizedUnit } from "../schema.ts";
import { NORMALIZED_UNITS } from "./units.ts";

test("NORMALIZED_UNITS and normalizedUnit enum are in sync", () => {
  const enumValues = [...normalizedUnit.enumValues].sort();
  const vocabUnits = NORMALIZED_UNITS.map((e) => e.unit).sort();
  assert.deepEqual(
    vocabUnits,
    enumValues,
    "NORMALIZED_UNITS must contain exactly the same unit strings as the normalizedUnit pgEnum",
  );
});

test("every entry in NORMALIZED_UNITS parses against NormalizedUnitInfoSchema", () => {
  for (const entry of NORMALIZED_UNITS) {
    const result = NormalizedUnitInfoSchema.safeParse(entry);
    assert.ok(
      result.success,
      `entry ${JSON.stringify(entry)} failed NormalizedUnitInfoSchema: ${JSON.stringify(result.error?.issues)}`,
    );
  }
});

test("each kind appears exactly once — one base unit per measurement kind", () => {
  const kinds = NORMALIZED_UNITS.map((e) => e.kind);
  const uniqueKinds = new Set(kinds);
  assert.equal(
    uniqueKinds.size,
    NORMALIZED_UNITS.length,
    `duplicate kind found — each measurement kind must have exactly one base unit. kinds: ${kinds.join(", ")}`,
  );
});
