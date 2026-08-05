import { test } from "node:test";
import assert from "node:assert/strict";
import * as barrel from "../../db/schema.ts";
import * as automationSchema from "./schema.ts";

// Object-identity proof: modules/automation/schema.ts is a thin re-export, not
// an accidental duplicate definition. Every one of the 2 automation tables (and
// their 3 owned enums) imported via the module path must be the exact same
// object as the one imported via the db/schema.ts barrel — not just
// structurally equal. Mirrors modules/credit/schema.smoke.test.ts exactly.

const TABLE_NAMES = ["aiSettings", "aiEvents"] as const;

const ENUM_NAMES = ["aiProvider", "aiEventKind", "aiEventStatus"] as const;

test("modules/automation/schema.ts re-exports the same 2 table objects as db/schema.ts", () => {
  for (const name of TABLE_NAMES) {
    assert.strictEqual(
      (automationSchema as Record<string, unknown>)[name],
      (barrel as Record<string, unknown>)[name],
      `${name}: modules/automation/schema.ts must re-export the identical object as db/schema.ts`,
    );
  }
});

test("modules/automation/schema.ts re-exports the same 3 owned enum objects as db/schema.ts", () => {
  for (const name of ENUM_NAMES) {
    assert.strictEqual(
      (automationSchema as Record<string, unknown>)[name],
      (barrel as Record<string, unknown>)[name],
      `${name}: modules/automation/schema.ts must re-export the identical enum object as db/schema.ts`,
    );
  }
});
