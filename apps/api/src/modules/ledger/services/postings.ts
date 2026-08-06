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

export type SystemKind = "expenses" | "income" | "opening";

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

// ---------------------------------------------------------------------------
// Classifiers & projections
// ---------------------------------------------------------------------------

/**
 * Classifies a set of postings into one of four shapes.
 * Throws HttpError(400) for unrecognised / degenerate shapes.
 */
export function classifyShape(
  postings: readonly PostingDraft[],
  systemKindOf: (accountId: string) => SystemKind | null,
): "ordinary" | "split" | "transfer" | "opening" {
  const kinds = postings.map((p) => systemKindOf(p.accountId));
  const systemCount = kinds.filter((k) => k !== null).length;
  const realCount = postings.length - systemCount;

  if (kinds.some((k) => k === "opening")) return "opening";
  if (systemCount === 0 && realCount >= 2) return "transfer";
  if (realCount === 1 && systemCount === 1) return "ordinary";
  if (realCount === 1 && systemCount >= 2) return "split";

  throw new HttpError(400, "unrecognized posting shape");
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