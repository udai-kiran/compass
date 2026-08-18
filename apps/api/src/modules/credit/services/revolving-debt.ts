import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../../../db/index.ts";
import { cardDetails, statementReconciliations } from "../schema.ts";
// accounts, postings, and transactions from the shared ledger barrel
import { accounts, postings, transactions } from "../../../db/schema.ts";

// ---------- Types ----------

export type PaymentState = "unpaid" | "minimum_only" | "partial" | "paid_in_full" | "unknown";

export interface StatementPaymentStatus {
  accountId: string;
  /** "YYYY-MM" */
  period: string;
  /** from statement_reconciliations; null when not stated */
  totalDuePaise: number | null;
  /** from statement_reconciliations */
  minDuePaise: number | null;
  /** sum of positive postings to this card account between close date and due date (inclusive) */
  paidByDueDatePaise: number;
  state: PaymentState;
  /** estimated revolving balance = max(0, totalDuePaise - paidByDueDatePaise) */
  revolvingBalancePaise: number;
  /**
   * Estimated monthly finance charge in paise.
   * = revolvingBalancePaise * (aprBps / 10000) / 12, rounded up.
   * null when aprBps is null.
   */
  estimatedMonthlyChargePaise: number | null;
}

export interface CardRevolvingStatus {
  accountId: string;
  accountName: string;
  /** the most recent statement's status (last 2 months) */
  latestStatement: StatementPaymentStatus | null;
  /** true when latestStatement.state is NOT paid_in_full */
  isRevolving: boolean;
  /** total unsecured revolving exposure across all recent statements */
  revolvingBalancePaise: number;
}

export interface HouseholdRevolvingDebt {
  /** per-card revolving status */
  cards: CardRevolvingStatus[];
  /** sum of all cards' revolvingBalancePaise */
  totalRevolvingPaise: number;
  /** true when ANY card is revolving — planning hard constraint flag */
  hasRevolvingDebt: boolean;
  /** estimated total monthly finance charges across all revolving cards */
  totalMonthlyChargePaise: number;
}

// ---------- Pure helpers ----------

/**
 * Derive PaymentState from payment amounts.
 * @param totalDuePaise - the statement balance
 * @param minDuePaise   - the minimum amount due; null treated as 0
 * @param paidPaise     - amount paid by/on due date
 */
export function derivePaymentState(
  totalDuePaise: number | null,
  minDuePaise: number | null,
  paidPaise: number,
): PaymentState {
  if (totalDuePaise === null) return "unknown";
  if (paidPaise >= totalDuePaise) return "paid_in_full";
  const min = minDuePaise ?? 0;
  if (min > 0 && paidPaise >= min) return "minimum_only";
  if (paidPaise > 0) return "partial";
  return "unpaid";
}

/**
 * Compute estimated monthly finance charge from revolving balance + APR.
 * Uses simple monthly interest: balance * APR / 12.
 */
export function estimateMonthlyCharge(
  revolvingBalancePaise: number,
  aprBps: number | null,
): number | null {
  if (aprBps === null || revolvingBalancePaise <= 0) return null;
  return Math.ceil((revolvingBalancePaise * aprBps) / 10_000 / 12);
}

// ---------- DB function ----------

export async function getHouseholdRevolvingDebt(
  db: Db,
  userId: string,
): Promise<HouseholdRevolvingDebt> {
  // 1. Fetch all credit card accounts with their card details for this user.
  const cards = await db
    .select({
      accountId: accounts.id,
      accountName: accounts.name,
      aprBps: cardDetails.aprBps,
      interestFreeDays: cardDetails.interestFreeDays,
    })
    .from(accounts)
    .innerJoin(cardDetails, eq(accounts.id, cardDetails.accountId))
    .where(and(eq(accounts.userId, userId), eq(accounts.type, "credit_card")));

  // 2. Compute the cutoff period (2 months ago) for recent statement filter.
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - 2);
  const cutoffPeriod = cutoffDate.toISOString().slice(0, 7); // "YYYY-MM"

  const cardStatuses: CardRevolvingStatus[] = [];

  for (const card of cards) {
    // 2. Most recent statement reconciliation in the last 2 months.
    const stmt = await db.query.statementReconciliations.findFirst({
      where: and(
        eq(statementReconciliations.accountId, card.accountId),
        eq(statementReconciliations.userId, userId),
        gte(statementReconciliations.period, cutoffPeriod),
      ),
      orderBy: [desc(statementReconciliations.period)],
    });

    if (!stmt) {
      cardStatuses.push({
        accountId: card.accountId,
        accountName: card.accountName,
        latestStatement: null,
        isRevolving: false,
        revolvingBalancePaise: 0,
      });
      continue;
    }

    // 3. Compute paidByDueDatePaise.
    let paidByDueDatePaise = 0;
    if (stmt.statementDate !== null) {
      const graceDays = card.interestFreeDays ?? 45;
      const statementDateObj = new Date(stmt.statementDate);
      const dueDateObj = new Date(statementDateObj);
      dueDateObj.setDate(dueDateObj.getDate() + graceDays);
      const statementDate = stmt.statementDate; // "YYYY-MM-DD"
      const dueDate = dueDateObj.toISOString().slice(0, 10); // "YYYY-MM-DD"

      const result = await db.execute(sql`
        SELECT coalesce(sum(p.amount_paise), 0)::bigint AS paid
        FROM ${postings} p
        JOIN ${transactions} t ON t.id = p.transaction_id
        WHERE p.account_id = ${card.accountId}
          AND t.user_id = ${userId}
          AND t.deleted_at IS NULL
          AND p.amount_paise > 0
          AND t.date > ${statementDate}
          AND t.date <= ${dueDate}
      `);
      const row = result.rows[0] as { paid: string };
      paidByDueDatePaise = Number(row.paid);
    }

    // 4. Derive state and revolving balance.
    const state = derivePaymentState(stmt.totalDuePaise, stmt.minDuePaise, paidByDueDatePaise);
    const revolvingBalancePaise = Math.max(
      0,
      (stmt.totalDuePaise ?? 0) - paidByDueDatePaise,
    );
    const estimatedMonthlyChargePaise = estimateMonthlyCharge(
      revolvingBalancePaise,
      card.aprBps,
    );

    const latestStatement: StatementPaymentStatus = {
      accountId: card.accountId,
      period: stmt.period,
      totalDuePaise: stmt.totalDuePaise,
      minDuePaise: stmt.minDuePaise,
      paidByDueDatePaise,
      state,
      revolvingBalancePaise,
      estimatedMonthlyChargePaise,
    };

    // 5. Build CardRevolvingStatus.
    cardStatuses.push({
      accountId: card.accountId,
      accountName: card.accountName,
      latestStatement,
      isRevolving: state !== "paid_in_full",
      revolvingBalancePaise,
    });
  }

  // 6. Aggregate to HouseholdRevolvingDebt.
  const totalRevolvingPaise = cardStatuses.reduce((s, c) => s + c.revolvingBalancePaise, 0);
  const hasRevolvingDebt = cardStatuses.some((c) => c.isRevolving);
  const totalMonthlyChargePaise = cardStatuses.reduce((s, c) => {
    const charge = c.latestStatement?.estimatedMonthlyChargePaise ?? 0;
    return s + charge;
  }, 0);

  return {
    cards: cardStatuses,
    totalRevolvingPaise,
    hasRevolvingDebt,
    totalMonthlyChargePaise,
  };
}
