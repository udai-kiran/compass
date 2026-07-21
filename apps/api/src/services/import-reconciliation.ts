export type StatementTransaction = {
  id: string;
  date: string;
  amountPaise: number;
  merchant: string;
  notes: string;
};

export type ExistingTransaction = StatementTransaction;

export type Reconciliation =
  | { action: "matched"; row: StatementTransaction; transactionId: string }
  | { action: "update"; row: StatementTransaction; transactionId: string }
  | { action: "create"; row: StatementTransaction }
  | { action: "conflict"; row: StatementTransaction };

function merchantKey(value: string): string {
  return value.trim().toLocaleLowerCase("en-IN");
}

function dayNumber(value: string): number {
  return Math.floor(Date.parse(`${value}T00:00:00Z`) / 86_400_000);
}

/**
 * Reconcile statement rows against active transactions from the same card.
 * Exact rows are consumed one-for-one. A mismatch is updated only when there
 * is exactly one unclaimed same-direction, same-merchant candidate within
 * three days; ambiguity is never guessed.
 */
export function reconcileStatementTransactions(
  rows: StatementTransaction[],
  existing: ExistingTransaction[],
): Reconciliation[] {
  const claimed = new Set<string>();
  return rows.map((row) => {
    const exact = existing.find(
      (candidate) =>
        !claimed.has(candidate.id) &&
        candidate.date === row.date &&
        candidate.amountPaise === row.amountPaise &&
        merchantKey(candidate.merchant) === merchantKey(row.merchant),
    );
    if (exact) {
      claimed.add(exact.id);
      return { action: "matched", row, transactionId: exact.id };
    }

    const nearby = existing.filter((candidate) => {
      if (claimed.has(candidate.id)) return false;
      if (Math.sign(candidate.amountPaise) !== Math.sign(row.amountPaise)) return false;
      const sameMerchant = merchantKey(candidate.merchant) === merchantKey(row.merchant);
      const nearbyMerchant =
        sameMerchant && Math.abs(dayNumber(candidate.date) - dayNumber(row.date)) <= 3;
      const samePosting = candidate.date === row.date && candidate.amountPaise === row.amountPaise;
      return nearbyMerchant || samePosting;
    });
    if (nearby.length === 1) {
      claimed.add(nearby[0]!.id);
      return { action: "update", row, transactionId: nearby[0]!.id };
    }
    if (nearby.length > 1) return { action: "conflict", row };
    return { action: "create", row };
  });
}
