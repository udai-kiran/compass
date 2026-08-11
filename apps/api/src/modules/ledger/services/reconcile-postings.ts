import { eq, sql } from "drizzle-orm";
import type { Db } from "../../../db/index.ts";
import { transactions, users } from "../../../db/schema.ts";
import { reprojectLegacyColumns } from "./transactions.ts";
import { currentPostings, systemKindLookup } from "./post-entry.ts";
import { classifyShape } from "./postings.ts";

// ---------------------------------------------------------------------------
// Posting VALIDATOR (PR-G1) — formerly the legacy→postings reconciler
// ---------------------------------------------------------------------------
//
// Until PR-G1 this module rebuilt every transaction's postings from its legacy
// columns at boot. That direction is gone: postings are the authority, so
// nothing may overwrite them from a projection, and a boot pass that "repaired"
// a shape the columns could not express (a transfer's second real leg) was
// exactly how the collapse destroyed data.
//
// What remains is a validator. It reports what it cannot explain and repairs
// only the LEGACY PROJECTION, never a posting. A failure here means corrupt
// data that a human must look at — not something to fix by guessing.

export interface PostingProblem {
  userId: string;
  transactionId: string;
  reason: string;
}

/**
 * Read-only check: every transaction's postings must be zero-sum and match one
 * of the four canonical shapes. Never writes; safe against a live database.
 */
export async function findInconsistentPostings(
  db: Db,
  userId?: string,
): Promise<PostingProblem[]> {
  const targetUsers = userId
    ? [{ id: userId }]
    : await db.select({ id: users.id }).from(users);

  const out: PostingProblem[] = [];
  for (const u of targetUsers) {
    const systemKindOf = await systemKindLookup(db, u.id);
    const ids = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.userId, u.id));

    for (const { id } of ids) {
      const stored = await currentPostings(db, id);
      if (stored.length === 0) {
        out.push({ userId: u.id, transactionId: id, reason: "no postings" });
        continue;
      }
      const sum = stored.reduce((acc, p) => acc + BigInt(p.amountPaise), 0n);
      if (sum !== 0n) {
        out.push({ userId: u.id, transactionId: id, reason: `postings sum to ${sum} paise, not zero` });
        continue;
      }
      try {
        classifyShape(stored, systemKindOf);
      } catch (error) {
        out.push({
          userId: u.id,
          transactionId: id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return out;
}

/**
 * Re-projects every transaction's legacy columns from its postings, one row per
 * db transaction so a single bad row cannot abort the rest.
 *
 * This is the ONLY repair left, and it only ever writes the doomed columns —
 * it cannot change a posting. It exists because those columns are still NOT
 * NULL until PR-G2 drops them; after that this function goes with them.
 */
export async function reprojectAllLegacyColumns(
  db: Db,
): Promise<{ users: number; checked: number; repaired: number; failures: PostingProblem[] }> {
  const userRows = await db.select({ id: users.id }).from(users);
  let checked = 0;
  let repaired = 0;
  const failures: PostingProblem[] = [];

  for (const u of userRows) {
    const ids = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.userId, u.id));
    for (const { id } of ids) {
      checked++;
      try {
        await db.transaction(async (t) => {
          await reprojectLegacyColumns(t, u.id, id);
        });
        repaired++;
      } catch (error) {
        failures.push({
          userId: u.id,
          transactionId: id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { users: userRows.length, checked, repaired, failures };
}

/**
 * Boot gate: refuses to start against a database that predates the postings
 * recreate.
 *
 * PR-G1 is single-shape code. A database still holding the transitional
 * dual-write representation — Clearing postings, `transfer_links` rows, or a
 * non-zero `accounts.opening_balance_paise` that no reader adds any more —
 * would be SILENTLY MISREAD rather than rejected: transfers would read as
 * one-sided, and card/loan openings would simply vanish from every balance.
 * Failing to start is the only safe response, and the remedy is the recreate
 * that 2.0.0 ships with (tasks/03.02-release-2-0-0.md).
 *
 * Reading these columns is precisely why this function is on the legacy-read
 * gate's allowlist: it exists to prove they are empty.
 */
export async function assertNoLegacyShapes(db: Db): Promise<void> {
  const [clearing] = (
    await db.execute(sql`
      select count(*)::int as n from postings p
      join accounts a on a.id = p.account_id
      where a.system_kind = 'clearing'
    `)
  ).rows as Array<{ n: number }>;
  const [links] = (await db.execute(sql`select count(*)::int as n from transfer_links`))
    .rows as Array<{ n: number }>;
  const [openings] = (
    await db.execute(sql`select count(*)::int as n from accounts where opening_balance_paise <> 0`)
  ).rows as Array<{ n: number }>;

  const problems: string[] = [];
  if ((clearing?.n ?? 0) > 0) problems.push(`${clearing!.n} Clearing postings`);
  if ((links?.n ?? 0) > 0) problems.push(`${links!.n} transfer_links rows`);
  if ((openings?.n ?? 0) > 0) {
    problems.push(`${openings!.n} accounts with a non-zero opening_balance_paise`);
  }
  if (problems.length === 0) return;

  throw new Error(
    `This database predates the postings model (found ${problems.join(", ")}). ` +
      "PR-G1 reads transfers as one transaction with two postings and cannot interpret the " +
      "older two-row Clearing shape — it would misread it silently rather than fail. " +
      "2.0.0 recreates the database from scratch; see tasks/03.02-release-2-0-0.md.",
  );
}
