import { eq } from "drizzle-orm";
import type { Db } from "../../../db/index.ts";
import { postings, transactions, users } from "../../../db/schema.ts";
import { computePostingDraftsForTransaction } from "./transactions.ts";
import {
  replacePostings,
  resolveSystemAccounts,
  type ResolvedSystemAccounts,
} from "./post-entry.ts";
import type { PostingDraft } from "./postings.ts";

// ---------------------------------------------------------------------------
// Compare-first full-shape posting reconciler + read-only consistency checker
// ---------------------------------------------------------------------------

/**
 * True iff `drafts` (the computed posting shape) and `stored` (the persisted
 * posting rows) are equal as multisets — same set of postings, same
 * multiplicities — regardless of order. Each posting is keyed by
 * `JSON.stringify([accountId, amountPaise, categoryId, necessity, note])`
 * (NOT a delimiter join, because a note can contain any character). Both sides
 * are counted, and equality holds iff the count maps are identical.
 */
function postingsMultisetEqual(
  drafts: PostingDraft[],
  stored: Array<{
    accountId: string;
    amountPaise: number;
    categoryId: string | null;
    necessity: string | null;
    note: string;
  }>,
): boolean {
  const count = (list: Array<{ accountId: string; amountPaise: number; categoryId: string | null; necessity: string | null; note: string }>): Map<string, number> => {
    const map = new Map<string, number>();
    for (const p of list) {
      const key = JSON.stringify([p.accountId, p.amountPaise, p.categoryId, p.necessity, p.note]);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  };

  const draftCounts = count(drafts);
  const storedCounts = count(stored);
  if (draftCounts.size !== storedCounts.size) return false;
  for (const [key, n] of draftCounts) {
    if (storedCounts.get(key) !== n) return false;
  }
  return true;
}

/**
 * Reconcile one user's posting mirror against its current derived shape.
 *
 * Seeds the user's system accounts (idempotent), resolves them once, then
 * compare-first repairs every transaction row (INCLUDING soft-deleted ones —
 * their postings are retained, so they must be reconciled too) one at a time,
 * each inside its own `db.transaction` so a compare+replace is atomic and a
 * single bad row cannot abort the rest of the user (per-row failure isolation).
 *
 * The per-row transaction gives compare+replace atomicity: if a drift is
 * detected, the deletion and re-insertion of that row's postings either fully
 * commit or fully roll back. Rows are processed sequentially to reduce
 * contention, but this does NOT lock source rows before computing drafts — a
 * concurrent mutation could theoretically change the row between compute and
 * replace within the same per-row tx. This is harmless at quiescent boot but
 * would need explicit FOR UPDATE locking if used as a live maintenance primitive.
 */
export async function reconcileUserPostings(
  db: Db,
  userId: string,
): Promise<{ checked: number; repaired: number; failures: Array<{ userId: string; transactionId?: string; error: unknown }> }> {
  let sys: ResolvedSystemAccounts;
  try {
    sys = await resolveSystemAccounts(db, userId);
  } catch (error) {
    return { checked: 0, repaired: 0, failures: [{ userId, error }] };
  }

  const ids = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.userId, userId)); // NO deleted_at filter

  let checked = 0;
  let repaired = 0;
  const failures: Array<{ userId: string; transactionId?: string; error: unknown }> = [];
  for (const { id } of ids) {
    checked++;
    try {
      const didRepair = await db.transaction(async (t) => {
        const drafts = await computePostingDraftsForTransaction(t, userId, id, sys);
        if (!drafts) return false;
        const stored = await t
          .select({
            accountId: postings.accountId,
            amountPaise: postings.amountPaise,
            categoryId: postings.categoryId,
            necessity: postings.necessity,
            note: postings.note,
          })
          .from(postings)
          .where(eq(postings.transactionId, id));
        if (!postingsMultisetEqual(drafts, stored)) {
          await replacePostings(t, id, userId, drafts);
          return true;
        }
        return false;
      });
      if (didRepair) repaired++;
    } catch (error) {
      failures.push({ userId, transactionId: id, error });
    }
  }

  return { checked, repaired, failures };
}

/**
 * Reconcile every user's posting mirror. Seeds per user, compare-first-repairs
 * each of their transactions (including soft-deleted) via per-row transactions,
 * and aggregates structured failures. A per-user failure is isolated and
 * reported, never thrown.
 */
export async function reconcileAllPostings(
  db: Db,
): Promise<{ users: number; checked: number; repaired: number; failures: Array<{ userId: string; transactionId?: string; error: unknown }> }> {
  const rows = await db.select({ id: users.id }).from(users);
  let checked = 0;
  let repaired = 0;
  const failures = [] as Array<{ userId: string; transactionId?: string; error: unknown }>;
  for (const u of rows) {
    try {
      const r = await reconcileUserPostings(db, u.id);
      checked += r.checked;
      repaired += r.repaired;
      failures.push(...r.failures);
    } catch (error) {
      failures.push({ userId: u.id, error });
    }
  }
  return { users: rows.length, checked, repaired, failures };
}

/**
 * Read-only consistency check: report every transaction whose stored postings
 * drift from the computed shape. NEVER seeds system accounts and NEVER writes —
 * this is a diagnostic, safe to run against a live database at any time. When
 * `userId` is given only that user is scanned; otherwise every user is.
 *
 * A user whose system accounts are missing is reported once with an empty
 * `transactionId`. A transaction whose shape cannot even be derived (e.g. an
 * unrepairable split-sum mismatch) is reported with its reason.
 */
export async function findInconsistentPostings(
  db: Db,
  userId?: string,
): Promise<Array<{ userId: string; transactionId: string; reason: string }>> {
  const targetUsers = userId
    ? [{ id: userId }]
    : await db.select({ id: users.id }).from(users);

  const out: Array<{ userId: string; transactionId: string; reason: string }> = [];
  for (const u of targetUsers) {
    let sys: ResolvedSystemAccounts;
    try {
      sys = await resolveSystemAccounts(db, u.id);
    } catch {
      out.push({ userId: u.id, transactionId: "", reason: "system accounts missing" });
      continue;
    }

    const ids = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.userId, u.id));
    for (const { id } of ids) {
      try {
        const drafts = await computePostingDraftsForTransaction(db, u.id, id, sys);
        if (!drafts) continue;
        const stored = await db
          .select({
            accountId: postings.accountId,
            amountPaise: postings.amountPaise,
            categoryId: postings.categoryId,
            necessity: postings.necessity,
            note: postings.note,
          })
          .from(postings)
          .where(eq(postings.transactionId, id));
        if (!postingsMultisetEqual(drafts, stored)) {
          out.push({ userId: u.id, transactionId: id, reason: "posting drift" });
        }
      } catch (error) {
        out.push({ userId: u.id, transactionId: id, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return out;
}