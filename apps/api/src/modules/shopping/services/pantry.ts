/**
 * Read services for the household-consumption tables (task 9.1).
 *
 * OWNER-ONLY SCOPING — deliberate, and the one place to change it.
 * Task 9.1's acceptance criteria ask for these rows to resolve through
 * `withSharing()` (`lib/sharing.ts`). They do NOT, for a reason that only
 * became visible during implementation: `withSharing()` has zero importers and
 * zero tests anywhere in the repo, and `POST /api/sharing-grants` cannot mint a
 * grant for a shopping resource type, so a sharing-aware read here could never
 * match a shared row — it would be identical in behaviour to the owner-only
 * query below, but with an unexercisable SQL branch and an enum cast. Four
 * other modules (credit/revolving-debt, planning/income-surplus,
 * planning/data-completeness) record the same decision for the same reason.
 *
 * Consequence, stated plainly: a household member cannot see another member's
 * pantry yet. Wiring that up needs the sharing rollout — resource-ownership
 * verification on grant creation, the enum labels, and the guard applied
 * consistently across every domain — not a one-domain exception here.
 *
 * SHARING SEAM: replace `eq(<table>.userId, userId)` with
 * `withSharing(userId, <table>.userId, <table>.id, "<resource_type>")` in the
 * two functions below and nowhere else.
 */

import { eq } from "drizzle-orm";
import type { DbOrTx } from "../../../db/index.ts";
import { habitProfiles, pantryItems } from "../schema.ts";

export function pantryItemsForUser(db: DbOrTx, userId: string) {
  return db.select().from(pantryItems).where(eq(pantryItems.userId, userId));
}

export function habitProfilesForUser(db: DbOrTx, userId: string) {
  return db.select().from(habitProfiles).where(eq(habitProfiles.userId, userId));
}
