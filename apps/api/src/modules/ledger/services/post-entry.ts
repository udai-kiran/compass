import { and, eq, isNotNull } from "drizzle-orm";
import type { DbOrTx } from "../../../db/index.ts";
import { accounts, postings, transactions } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { assertOwnedAccount, assertOwnedCategory } from "../../../lib/ownership.ts";
import { isUniqueViolation } from "../../investments/services/sip-lifecycle.ts";
import { assertZeroSum, type PostingDraft, type SystemKind } from "./postings.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Return type of resolveSystemAccounts — the four system account ids. */
export interface ResolvedSystemAccounts {
  expenses: string;
  income: string;
  opening: string;
  clearing: string;
}

export interface PostEntryHeader {
  date: string;
  occurredAt?: Date | null;
  merchant?: string;
  notes?: string;
  tags?: string[];
  source?: "manual" | "import" | "recurring";
  policyId?: string | null;
  resourceId?: string | null;
  sipId?: string | null;
  recurringTemplateId?: string | null;
  reconciledStatementId?: string | null;
}

// ---------------------------------------------------------------------------
// Writer helpers
// ---------------------------------------------------------------------------

/**
 * Replace ALL postings of an existing transaction (delete + insert), operating
 * on the PASSED `db`/`tx` handle — the caller owns the outer transaction, so
 * legacy writers can mirror postings into the SAME db.transaction() that
 * writes the legacy `transactions` row (dual-write). Verifies ownership of the
 * transaction and every draft's account/category BEFORE writing anything:
 * legacy writers already own tenant scoping, but this primitive is also
 * callable from contexts (backfill, restore) where that guarantee doesn't
 * pre-exist, so it re-checks rather than trusting the caller.
 */
export async function replacePostings(
  db: DbOrTx,
  transactionId: string,
  userId: string,
  drafts: PostingDraft[],
): Promise<void> {
  assertZeroSum(drafts);

  const txRow = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, transactionId), eq(transactions.userId, userId)),
    columns: { id: true },
  });
  if (!txRow) throw new HttpError(404, "Transaction not found");

  for (const draft of drafts) {
    await assertOwnedAccount(db, userId, draft.accountId);
    await assertOwnedCategory(db, userId, draft.categoryId);
  }

  await db.delete(postings).where(eq(postings.transactionId, transactionId));

  if (drafts.length > 0) {
    await db.insert(postings).values(
      drafts.map((p) => ({
        transactionId,
        accountId: p.accountId,
        amountPaise: p.amountPaise,
        categoryId: p.categoryId,
        necessity: p.necessity,
        note: p.note,
      })),
    );
  }
}

/**
 * THE write primitive of the postings-authoritative model (PR-G2): replace a
 * transaction's postings and touch `updated_at`, in that order, on one handle.
 *
 * Every writer goes through here. Postings are the truth; the legacy columns
 * `account_id`, `amount_paise`, `category_id`, `necessity`, `is_opening` and
 * the `transaction_splits` table were dropped in PR-G2.
 */
export async function postTransaction(
  db: DbOrTx,
  transactionId: string,
  userId: string,
  drafts: PostingDraft[],
): Promise<void> {
  await replacePostings(db, transactionId, userId, drafts);
  await db
    .update(transactions)
    .set({ updatedAt: new Date() })
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));
}

/**
 * The postings currently stored for a transaction, in the `PostingDraft` shape
 * the pure shape functions consume. This is what "read the transaction's
 * current shape" means once postings are the authority.
 */
export async function currentPostings(
  db: DbOrTx,
  transactionId: string,
): Promise<PostingDraft[]> {
  const rows = await db
    .select({
      accountId: postings.accountId,
      amountPaise: postings.amountPaise,
      categoryId: postings.categoryId,
      necessity: postings.necessity,
      note: postings.note,
    })
    .from(postings)
    .where(eq(postings.transactionId, transactionId));
  return rows;
}

/**
 * Builds an accountId → systemKind lookup for one user. Cached per call site
 * rather than per query: a user has exactly four system accounts (three after
 * Clearing is retired), so this is a tiny fixed-size read.
 */
export async function systemKindLookup(
  db: DbOrTx,
  userId: string,
): Promise<(accountId: string) => SystemKind | null> {
  const rows = await db
    .select({ id: accounts.id, systemKind: accounts.systemKind })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNotNull(accounts.systemKind)));
  const byId = new Map(rows.map((r) => [r.id, r.systemKind as SystemKind]));
  return (accountId: string) => byId.get(accountId) ?? null;
}

/**
 * Header-only metadata/FK update. MUST NOT touch postings.
 */
export async function updateTransactionHeader(
  db: DbOrTx,
  transactionId: string,
  patch: Partial<PostEntryHeader>,
): Promise<void> {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.date !== undefined) values.date = patch.date;
  if (patch.occurredAt !== undefined) values.occurredAt = patch.occurredAt;
  if (patch.merchant !== undefined) values.merchant = patch.merchant;
  if (patch.notes !== undefined) values.notes = patch.notes;
  if (patch.tags !== undefined) values.tags = patch.tags;
  if (patch.source !== undefined) values.source = patch.source;
  if (patch.policyId !== undefined) values.policyId = patch.policyId;
  if (patch.resourceId !== undefined) values.resourceId = patch.resourceId;
  if (patch.sipId !== undefined) values.sipId = patch.sipId;
  if (patch.recurringTemplateId !== undefined) values.recurringTemplateId = patch.recurringTemplateId;
  if (patch.reconciledStatementId !== undefined) values.reconciledStatementId = patch.reconciledStatementId;

  await db.update(transactions).set(values).where(eq(transactions.id, transactionId));
}

// ---------------------------------------------------------------------------
// System accounts
// ---------------------------------------------------------------------------

const SYSTEM_ACCOUNT_NAMES: Record<SystemKind, string> = {
  expenses: "Expenses",
  income: "Income",
  opening: "Opening Balances",
  clearing: "Clearing",
};

/**
 * Idempotent: ensure one system account per kind (Expenses/Income/Opening
 * Balances/Clearing) for the user. Selects the kinds that already exist and
 * inserts only the missing ones — NOT four unconditional inserts, and not
 * `onConflictDoNothing({ targetWhere })` (rejected by this repo's Drizzle
 * version against a partial unique index).
 *
 * The select-then-insert is not by itself concurrency-safe: two concurrent
 * seeders (e.g. registration racing a demo repopulation) can both see the
 * same missing kinds and both attempt to insert, so the loser's insert can
 * hit the `accounts_system_kind_idx` partial unique index. That's tolerated
 * here — the concurrent winner already created the row, which is exactly the
 * state this function is meant to converge to — rather than surfaced as an
 * error.
 */
export async function seedSystemAccounts(
  db: DbOrTx,
  userId: string,
): Promise<void> {
  const existing = await db
    .select({ systemKind: accounts.systemKind })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNotNull(accounts.systemKind)));

  const existingKinds = new Set(existing.map((row) => row.systemKind));
  const missingKinds = (Object.keys(SYSTEM_ACCOUNT_NAMES) as SystemKind[]).filter(
    (kind) => !existingKinds.has(kind),
  );

  if (missingKinds.length === 0) return;

  try {
    await db.insert(accounts).values(
      missingKinds.map((kind) => ({
        userId,
        name: SYSTEM_ACCOUNT_NAMES[kind],
        type: "system" as const,
        systemKind: kind,
      })),
    );
  } catch (err) {
    if (isUniqueViolation(err, "accounts_system_kind_idx")) return;
    throw err;
  }
}

/**
 * Resolve the four system-account ids for a user. Auto-seeds them if not yet
 * present (idempotent — in production this is a no-op after first registration),
 * then throws if any is still missing.
 */
export async function resolveSystemAccounts(
  db: DbOrTx,
  userId: string,
): Promise<ResolvedSystemAccounts> {
  await seedSystemAccounts(db, userId);
  const rows = await db
    .select({ id: accounts.id, systemKind: accounts.systemKind })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNotNull(accounts.systemKind)));

  const result: Partial<{ expenses: string; income: string; opening: string; clearing: string }> = {};
  for (const row of rows) {
    result[row.systemKind!] = row.id;
  }

  if (!result.expenses || !result.income || !result.opening || !result.clearing) {
    throw new HttpError(500, "system accounts not seeded");
  }

  return result as ResolvedSystemAccounts;
}
