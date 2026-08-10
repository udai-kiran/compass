import type { ExpenseNecessity } from "@compass/shared";
import { HttpError } from "../../../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostingDraft {
  accountId: string;
  amountPaise: number;
  categoryId: string | null;
  necessity: ExpenseNecessity | null;
  note: string;
}

export type SystemKind = "expenses" | "income" | "opening" | "clearing";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * A typed marker for an unrepairable posting shape — e.g. a split
 * transaction whose split amounts do not sum to the parent row's amount.
 * This is a data-integrity violation, not a validation error.
 */
export class PostingShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostingShapeError";
  }
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Throws HttpError(400) when `n` is not a safe integer.
 * Safe integers are in the range [-2^53 + 1, 2^53 - 1].
 */
export function assertSafePaise(n: number): void {
  if (!Number.isSafeInteger(n)) {
    throw new HttpError(400, `amount ${n} is not a safe integer`);
  }
}

/**
 * Sums amounts via BigInt, asserting each operand and the result are safe
 * integers. Returns the result as a Number.
 */
export function sumPaise(amounts: readonly number[]): number {
  let total = 0n;
  for (const a of amounts) {
    assertSafePaise(a);
    total += BigInt(a);
  }
  const result = Number(total);
  assertSafePaise(result);
  return result;
}

/**
 * Asserts that every amount is a safe integer and that the sum is exactly 0n.
 * Throws HttpError(400) on non-zero sum.
 */
export function assertZeroSum(
  postings: readonly Pick<PostingDraft, "amountPaise">[],
): void {
  let total = 0n;
  for (const p of postings) {
    assertSafePaise(p.amountPaise);
    total += BigInt(p.amountPaise);
  }
  if (total !== 0n) {
    throw new HttpError(400, `postings do not balance (sum ${total} paise)`);
  }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Builds a pair of postings for a single-category expense or income.
 * - `amountPaise < 0` → expense (system account is Expenses).
 * - `amountPaise > 0` → income (system account is Income).
 * - `amountPaise === 0` is allowed but produces a zero-sum pair.
 */
export function buildOrdinaryPostings(input: {
  accountId: string;
  amountPaise: number;
  categoryId: string | null;
  necessity: ExpenseNecessity | null;
  systemExpensesAccountId: string;
  systemIncomeAccountId: string;
}): PostingDraft[] {
  const postings: PostingDraft[] = [
    {
      accountId: input.accountId,
      amountPaise: input.amountPaise,
      categoryId: null,
      necessity: null,
      note: "",
    },
    {
      accountId:
        input.amountPaise < 0
          ? input.systemExpensesAccountId
          : input.systemIncomeAccountId,
      amountPaise: -input.amountPaise,
      categoryId: input.categoryId,
      necessity: input.necessity,
      note: "",
    },
  ];
  assertZeroSum(postings);
  return postings;
}

/**
 * Builds a set of postings for a multi-category transaction.
 * Each split is a signed amount (negative = expense, positive = income).
 * The asset leg amount is the sum of all splits.
 */
export function buildSplitPostings(input: {
  accountId: string;
  splits: ReadonlyArray<{
    categoryId: string;
    amountPaise: number;
    necessity: ExpenseNecessity | null;
    note: string;
  }>;
  systemExpensesAccountId: string;
  systemIncomeAccountId: string;
}): PostingDraft[] {
  const assetAmount = sumPaise(input.splits.map((s) => s.amountPaise));
  const postings: PostingDraft[] = [
    {
      accountId: input.accountId,
      amountPaise: assetAmount,
      categoryId: null,
      necessity: null,
      note: "",
    },
  ];
  for (const split of input.splits) {
    postings.push({
      accountId:
        split.amountPaise < 0
          ? input.systemExpensesAccountId
          : input.systemIncomeAccountId,
      amountPaise: -split.amountPaise,
      categoryId: split.categoryId,
      necessity: split.necessity,
      note: split.note,
    });
  }
  assertZeroSum(postings);
  return postings;
}

/**
 * Builds a pair of postings for a transfer between two accounts.
 * `amountPaise` must be positive (> 0).
 */
export function buildTransferPostings(input: {
  fromAccountId: string;
  toAccountId: string;
  amountPaise: number;
  note: string;
}): PostingDraft[] {
  if (input.amountPaise <= 0) {
    throw new HttpError(400, "transfer amount must be positive");
  }
  const postings: PostingDraft[] = [
    {
      accountId: input.fromAccountId,
      amountPaise: -input.amountPaise,
      categoryId: null,
      necessity: null,
      note: input.note,
    },
    {
      accountId: input.toAccountId,
      amountPaise: input.amountPaise,
      categoryId: null,
      necessity: null,
      note: input.note,
    },
  ];
  assertZeroSum(postings);
  return postings;
}

/**
 * Builds a pair of postings for an opening balance entry.
 * `amountPaise` is the opening balance (positive for debit balance, negative
 * for credit balance).
 */
export function buildOpeningPostings(input: {
  accountId: string;
  amountPaise: number;
  systemOpeningAccountId: string;
}): PostingDraft[] {
  const postings: PostingDraft[] = [
    {
      accountId: input.accountId,
      amountPaise: input.amountPaise,
      categoryId: null,
      necessity: null,
      note: "",
    },
    {
      accountId: input.systemOpeningAccountId,
      amountPaise: -input.amountPaise,
      categoryId: null,
      necessity: null,
      note: "",
    },
  ];
  assertZeroSum(postings);
  return postings;
}

/**
 * Builds a zero-sum pair for a SINGLE leg of a dual-write Clearing transfer.
 * Each side of a legacy transfer (which is its own `transactions` row with its
 * own signed legacy `amountPaise`) gets its own real+Clearing posting pair —
 * the two legs are stitched together only via `transfer_links`, not via a
 * shared posting set. `amountPaise` is the signed legacy amount for THIS leg
 * (outflow leg negative, inflow leg positive).
 */
export function buildTransferLegPostings(input: {
  accountId: string;
  amountPaise: number;
  clearingAccountId: string;
  note: string;
}): PostingDraft[] {
  const postings: PostingDraft[] = [
    {
      accountId: input.accountId,
      amountPaise: input.amountPaise,
      categoryId: null,
      necessity: null,
      note: input.note,
    },
    {
      accountId: input.clearingAccountId,
      amountPaise: -input.amountPaise,
      categoryId: null,
      necessity: null,
      note: input.note,
    },
  ];
  assertZeroSum(postings);
  return postings;
}

// ---------------------------------------------------------------------------
// Classifiers & projections
// ---------------------------------------------------------------------------

/**
 * Classifies a set of postings into one of four shapes. Postings are the
 * AUTHORITY for a transaction's shape (PR-G1) — nothing derives it from the
 * legacy columns any more, so this function, not `transfer_links` /
 * `transaction_splits` / `is_opening`, is what decides what a transaction is.
 *
 * Counts are EXACT, and an unrecognised combination throws rather than
 * degrading to a nearby shape: a miscounted posting set is corrupt data, and
 * guessing at it is how money goes missing quietly.
 *
 *   ordinary — exactly 1 real + exactly 1 Expenses/Income counter
 *   split    — exactly 1 real + 2 or more Expenses/Income counters
 *   transfer — exactly 2 real, no system postings
 *   opening  — exactly 1 real + exactly 1 Opening counter
 *
 * A single-element split is deliberately classified `ordinary`: with postings
 * as the authority it IS an ordinary transaction with one category, and there
 * is no legacy `transaction_splits` row left to say otherwise.
 *
 * Clearing postings are rejected outright. They were the transitional
 * dual-write representation of a transfer leg (PLAN-dualwrite.md Q4), retired
 * in PR-G1 — encountering one means the database predates the recreate, which
 * the boot check refuses to start on.
 */
export function classifyShape(
  postings: readonly PostingDraft[],
  systemKindOf: (accountId: string) => SystemKind | null,
): "ordinary" | "split" | "transfer" | "opening" {
  const kinds = postings.map((p) => systemKindOf(p.accountId));
  if (kinds.some((k) => k === "clearing")) {
    throw new HttpError(
      400,
      "Clearing postings were retired in PR-G1 — this database predates the postings recreate",
    );
  }
  const systemCount = kinds.filter((k) => k !== null).length;
  const realCount = postings.length - systemCount;
  const openingCount = kinds.filter((k) => k === "opening").length;

  if (realCount === 2 && systemCount === 0) return "transfer";
  if (realCount === 1 && openingCount === 1 && systemCount === 1) return "opening";
  if (realCount === 1 && openingCount === 0) {
    if (systemCount === 1) return "ordinary";
    if (systemCount >= 2) return "split";
  }

  throw new HttpError(400, "unrecognized posting shape");
}

/**
 * The transaction's PRIMARY REAL POSTING — the one a transaction-level reader
 * projects when it must show a single account and amount.
 *
 * Deliberately not "the negative posting": for income, and for an opening on
 * an asset account, the real posting is POSITIVE and the negative one is a
 * system account, so a sign rule projects the wrong leg. The rule is "the
 * posting on a non-system account", and for a transfer — which has two — the
 * outflow (negative) leg, so a transfer reads as money leaving its source.
 *
 * Account-scoped readers must NOT use this; they want `legForAccount`, because
 * from the destination account's perspective a transfer is an inflow.
 */
export function primaryRealLeg(
  postings: readonly PostingDraft[],
  systemKindOf: (accountId: string) => SystemKind | null,
): PostingDraft {
  const reals = postings.filter((p) => systemKindOf(p.accountId) === null);
  if (reals.length === 1) return reals[0]!;
  if (reals.length === 2) {
    const outflow = reals.find((p) => p.amountPaise < 0);
    if (!outflow) {
      throw new HttpError(400, "transfer has no outflow leg");
    }
    return outflow;
  }
  throw new HttpError(400, `expected one or two real postings, found ${reals.length}`);
}

/**
 * The posting on a specific account — what an account ledger shows for this
 * transaction. Returns null when the transaction does not touch the account.
 * Throws when it touches it more than once, which no valid shape does.
 */
export function legForAccount(
  postings: readonly PostingDraft[],
  accountId: string,
): PostingDraft | null {
  const legs = postings.filter((p) => p.accountId === accountId);
  if (legs.length === 0) return null;
  if (legs.length > 1) {
    throw new HttpError(400, `transaction touches account ${accountId} ${legs.length} times`);
  }
  return legs[0]!;
}

/**
 * Returns the single real (non-system) posting leg.
 * Throws HttpError(400) if there is not exactly one.
 */
export function projectRealLeg(
  postings: readonly PostingDraft[],
  systemKindOf: (a: string) => SystemKind | null,
): { accountId: string; amountPaise: number } {
  const reals = postings.filter((p) => systemKindOf(p.accountId) === null);
  if (reals.length !== 1) {
    throw new HttpError(
      400,
      `expected exactly one real posting, found ${reals.length}`,
    );
  }
  return { accountId: reals[0]!.accountId, amountPaise: reals[0]!.amountPaise };
}

/**
 * Returns the category and necessity from the single non-opening system
 * posting (expenses or income). Throws HttpError(400) if there is not exactly
 * one.
 */
export function projectCounter(
  postings: readonly PostingDraft[],
  systemKindOf: (a: string) => SystemKind | null,
): { categoryId: string | null; necessity: ExpenseNecessity | null } {
  const counters = postings.filter((p) => {
    const kind = systemKindOf(p.accountId);
    return kind === "expenses" || kind === "income";
  });
  if (counters.length !== 1) {
    throw new HttpError(
      400,
      `expected exactly one counter posting, found ${counters.length}`,
    );
  }
  return {
    categoryId: counters[0]!.categoryId,
    necessity: counters[0]!.necessity,
  };
}

/**
 * Maps each expenses/income system posting to its category, signed amount
 * (negated back to the original sign), and note.
 */
export function projectSplits(
  postings: readonly PostingDraft[],
  systemKindOf: (a: string) => SystemKind | null,
): Array<{ categoryId: string | null; amountPaise: number; note: string }> {
  return postings
    .filter((p) => {
      const kind = systemKindOf(p.accountId);
      return kind === "expenses" || kind === "income";
    })
    .map((p) => ({
      categoryId: p.categoryId,
      amountPaise: -p.amountPaise,
      note: p.note,
    }));
}