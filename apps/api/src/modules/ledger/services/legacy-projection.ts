import type { ExpenseNecessity } from "@compass/shared";
import { classifyShape, primaryRealLeg, type PostingDraft, type SystemKind } from "./postings.ts";

// ---------------------------------------------------------------------------
// THE legacy-column projection — the ONLY module permitted to write
// transactions.{account_id, amount_paise, category_id, necessity, is_opening}.
// ---------------------------------------------------------------------------
//
// PR-G1 makes `postings` the authority for reads AND writes. These columns
// still exist because they are NOT NULL and PR-G2 is what drops them, so every
// writer must still put *something* in them. That something is computed here,
// from the postings, and is read by NOTHING: a CI gate asserts zero reads of
// these columns outside this file, the schema files and the boot check.
//
// The projection is deliberately lossy. A transfer has two real postings and
// one header, so no single `account_id`/`amount_paise` pair can represent it —
// the primary real leg (the outflow) is projected and the destination leg
// exists only in `postings`. That loss is fine precisely because nothing reads
// it; it would be a data-loss bug the moment a reader did.
//
// When PR-G2 drops the columns, this file is deleted whole. That is the point
// of concentrating the writes here rather than leaving them spread across the
// writer graph.

/** The legacy column values mirroring a posting set. */
export interface LegacyProjection {
  accountId: string;
  amountPaise: number;
  categoryId: string | null;
  necessity: ExpenseNecessity | null;
  isOpening: boolean;
}

/**
 * Projects the legacy columns from a transaction's postings.
 *
 * - `account_id` / `amount_paise` — the primary real leg (for a transfer, its
 *   outflow leg; see `primaryRealLeg`).
 * - `category_id` / `necessity` — carried by the counter posting for an
 *   ordinary transaction. A split has several counters and no single legacy
 *   category (the legacy column was never maintained for splits either, see
 *   task 023 F8), a transfer and an opening have none at all — all project
 *   null rather than an arbitrary pick.
 * - `is_opening` — true only for the opening shape.
 */
export function projectLegacyColumns(
  postings: readonly PostingDraft[],
  systemKindOf: (accountId: string) => SystemKind | null,
): LegacyProjection {
  const shape = classifyShape(postings, systemKindOf);
  const real = primaryRealLeg(postings, systemKindOf);

  let categoryId: string | null = null;
  let necessity: ExpenseNecessity | null = null;
  if (shape === "ordinary") {
    const counter = postings.find((p) => {
      const kind = systemKindOf(p.accountId);
      return kind === "expenses" || kind === "income";
    });
    categoryId = counter?.categoryId ?? null;
    necessity = counter?.necessity ?? null;
  }

  return {
    accountId: real.accountId,
    amountPaise: real.amountPaise,
    categoryId,
    necessity,
    isOpening: shape === "opening",
  };
}

/**
 * The legacy `transaction_splits` rows mirroring a posting set — one per
 * Expenses/Income counter, with the amount negated back to its signed form.
 * Empty for every shape except `split`, so a transaction that stops being a
 * split clears its rows.
 *
 * Like `projectLegacyColumns`, this is write-only: `transaction_splits` is
 * dropped in PR-G2 and the DTO's `splits` array is built from the counter
 * postings, not from these rows.
 */
export function projectLegacySplits(
  postings: readonly PostingDraft[],
  systemKindOf: (accountId: string) => SystemKind | null,
): Array<{ categoryId: string; amountPaise: number; note: string }> {
  if (classifyShape(postings, systemKindOf) !== "split") return [];
  return postings
    .filter((p) => {
      const kind = systemKindOf(p.accountId);
      return kind === "expenses" || kind === "income";
    })
    .map((p) => ({
      // A split counter always carries a category (buildSplitPostings requires
      // one); the legacy column is NOT NULL, so a null here is corrupt data
      // rather than something to paper over with a placeholder.
      categoryId: assertCategory(p.categoryId),
      amountPaise: -p.amountPaise,
      note: p.note,
    }));
}

function assertCategory(categoryId: string | null): string {
  if (categoryId === null) {
    throw new Error("split counter posting has no category — corrupt posting shape");
  }
  return categoryId;
}
