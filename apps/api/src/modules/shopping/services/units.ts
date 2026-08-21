/**
 * The normalized-unit vocabulary the API publishes (task 9.1).
 *
 * One base unit per measurement kind — grams, millilitres, pieces — so
 * unit-price comparison across pack sizes is exact integer arithmetic. The
 * server owns this list because the `normalized_unit` Postgres enum is the
 * real constraint; `units.test.ts` pins the two in sync.
 */

import type { NormalizedUnitInfo } from "@compass/shared";

export const NORMALIZED_UNITS: readonly NormalizedUnitInfo[] = [
  { unit: "g", kind: "mass", label: "gram" },
  { unit: "ml", kind: "volume", label: "millilitre" },
  { unit: "piece", kind: "count", label: "piece" },
];
