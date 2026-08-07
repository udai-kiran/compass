import { sql } from "drizzle-orm";
import {
  LIABILITY_ACCOUNT_TYPES,
  type BudgetPeriod,
  type CategoryKind,
  type ExpenseNecessity,
} from "@compass/shared";
import type { Db } from "../db/index.ts";
import { HttpError } from "./errors.ts";

/**
 * SQL list of the liability account types. A positive amount on one of these (a
 * credit-card / loan payment, or a refund) is a repayment or reversal — never
 * income — so income sums exclude inflows on these accounts. Shared by the
 * income aggregations.
 */
export const LIABILITY_TYPES_SQL = sql.join(
  LIABILITY_ACCOUNT_TYPES.map((t) => sql`${t}`),
  sql`, `,
);

/** "2026-07" → { from: "2026-07-01", to: "2026-07-31" }; "2026" → whole year. */
export function periodRange(period: BudgetPeriod, key: string): { from: string; to: string } {
  if (period === "annual") {
    return { from: `${key}-01-01`, to: `${key}-12-31` };
  }
  const [y, m] = key.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${String(lastDay).padStart(2, "0")}` };
}

export function prevPeriodKey(period: BudgetPeriod, key: string): string {
  if (period === "annual") return String(Number(key) - 1);
  const [y, m] = key.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function currentPeriodKey(period: BudgetPeriod, today = new Date()): string {
  const y = today.getUTCFullYear();
  return period === "annual" ? String(y) : `${y}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * Expense spend per category over a date range, the way budgets count it:
 * transfers excluded, split transactions counted by split category (parent
 * ignored), soft-deleted excluded. Key null = uncategorized.
 *
 * Reads from the `postings` mirror: expenses-system postings with a positive
 * amount represent the expense side of each spend. Transfers are detected by
 * the presence of a Clearing posting on the same transaction. Opening rows are
 * excluded because they never produce an Expenses posting.
 */
export async function spentByCategory(
  db: Db,
  userId: string,
  from: string,
  to: string,
): Promise<Map<string | null, number>> {
  const res = await db.execute(sql`
    select p.category_id as cid, sum(p.amount_paise)::bigint as spent
    from postings p
    join accounts a on a.id = p.account_id
    join transactions t on t.id = p.transaction_id
    where t.user_id = ${userId}
      and t.deleted_at is null
      and t.date >= ${from} and t.date <= ${to}
      and a.system_kind = 'expenses'
      and p.amount_paise > 0
      and not exists (
        select 1 from postings p2
        join accounts a2 on a2.id = p2.account_id
        where p2.transaction_id = t.id and a2.system_kind = 'clearing'
      )
    group by p.category_id
  `);
  const out = new Map<string | null, number>();
  for (const row of res.rows as Array<{ cid: string | null; spent: string }>) {
    const spent = Number(row.spent);
    if (!Number.isSafeInteger(spent)) {
      throw new HttpError(500, "Spend aggregate exceeded a safe integer — refusing to lose paise");
    }
    const prev = out.get(row.cid) ?? 0;
    const next = prev + spent;
    if (!Number.isSafeInteger(next)) {
      throw new HttpError(500, "Spend aggregate exceeded a safe integer — refusing to lose paise");
    }
    out.set(row.cid, next);
  }
  return out;
}

export interface NecessitySpendRow {
  /** The transaction's own override; wins when set. */
  txNecessity: ExpenseNecessity | null;
  /** The category's default, used only when `txNecessity` is null. */
  catNecessity: ExpenseNecessity | null;
  /**
   * Null for uncategorized spend, and for a category that fails tenant scoping.
   * Income categories' defaults are ignored — see `effectiveNecessity`.
   */
  catKind: CategoryKind | null;
  spentPaise: number;
}

/**
 * Expense spend over a date range, tagged with everything needed to resolve each
 * slice's necessity. The filters mirror `spentByCategory` exactly — same
 * transfer, opening-row, and soft-delete handling — so the necessity buckets and
 * the category breakdown reconcile against the same underlying spend for any
 * consistent snapshot.
 *
 * Issues a single statement against the `postings` mirror: transfers are
 * detected by the presence of a Clearing posting on the same transaction,
 * expenses-system postings with positive amounts represent spend.
 *
 * A transaction-level override applies to all of that transaction's splits; with
 * no override each split falls back to its OWN category, so a bill split across
 * Groceries and Wine can land in two different buckets.
 *
 * The category join is tenant-scoped and a LEFT join. Scoping matters because a
 * transaction can reference another user's category id through a hand-crafted
 * restore archive, which would otherwise let that category's necessity decide
 * how this user's spend is classified. It is a LEFT join so a failed match
 * leaves the spend counted but unclassified: an inner join would drop it
 * entirely, and the buckets would stop summing to the category breakdown, which
 * is the invariant this function exists to preserve.
 *
 * Deliberately pre-aggregated by the (override, default, kind) triple instead of
 * resolving precedence in SQL: that keeps the rule itself in one unit-testable
 * place (`effectiveNecessity`) rather than duplicating it in a query no test can
 * reach without a database.
 */
export async function spendByNecessity(
  db: Db,
  userId: string,
  from: string,
  to: string,
): Promise<NecessitySpendRow[]> {
  const res = await db.execute(sql`
    select t.necessity as tx_necessity, c.necessity as cat_necessity, c.kind as cat_kind,
           sum(p.amount_paise)::bigint as spent
    from postings p
    join accounts a on a.id = p.account_id
    join transactions t on t.id = p.transaction_id
    left join categories c on c.id = p.category_id and c.user_id = t.user_id
    where t.user_id = ${userId}
      and t.deleted_at is null
      and t.date >= ${from} and t.date <= ${to}
      and a.system_kind = 'expenses'
      and p.amount_paise > 0
      and not exists (
        select 1 from postings p2
        join accounts a2 on a2.id = p2.account_id
        where p2.transaction_id = t.id and a2.system_kind = 'clearing'
      )
    group by t.necessity, c.necessity, c.kind
  `);
  type Row = {
    tx_necessity: ExpenseNecessity | null;
    cat_necessity: ExpenseNecessity | null;
    cat_kind: CategoryKind | null;
    spent: string;
  };
  const mapRow = (row: Row): NecessitySpendRow => {
    const spentPaise = Number(row.spent);
    if (!Number.isSafeInteger(spentPaise)) {
      throw new HttpError(500, "Spend aggregate exceeded a safe integer — refusing to lose paise");
    }
    return {
      txNecessity: row.tx_necessity,
      catNecessity: row.cat_necessity,
      catKind: row.cat_kind,
      spentPaise,
    };
  };
  return (res.rows as unknown as Row[]).map(mapRow);
}

/**
 * Income/expense totals over a range, transfers excluded.
 *
 * Anchors on the REAL posting (`a.system_kind IS NULL`) so mixed-sign splits
 * (e.g. parent -70, splits [-100, +30]) count the parent amount (-70 → expense
 * 70), not the individual split amounts. Opening rows and Clearing legs are
 * excluded via the `system_kind IN ('clearing', 'opening')` NOT EXISTS guard.
 */
export async function incomeExpense(
  db: Db,
  userId: string,
  from: string,
  to: string,
): Promise<{ incomePaise: number; expensePaise: number }> {
  const res = await db.execute(sql`
    select
      coalesce(sum(case
        when p.amount_paise > 0
             and a.type not in (${LIABILITY_TYPES_SQL})
        then p.amount_paise
        else 0
      end), 0)::bigint as income,
      coalesce(sum(case
        when p.amount_paise < 0
        then -p.amount_paise
        else 0
      end), 0)::bigint as expense
    from postings p
    join accounts a on a.id = p.account_id
    join transactions t on t.id = p.transaction_id
    where t.user_id = ${userId}
      and t.deleted_at is null
      and t.date >= ${from} and t.date <= ${to}
      and a.system_kind is null
      and not exists (
        select 1 from postings p2
        join accounts a2 on a2.id = p2.account_id
        where p2.transaction_id = t.id
          and a2.system_kind in ('clearing', 'opening')
      )
  `);
  const row = res.rows[0] as { income: string; expense: string };
  const incomePaise = Number(row.income);
  const expensePaise = Number(row.expense);
  if (!Number.isSafeInteger(incomePaise) || !Number.isSafeInteger(expensePaise)) {
    throw new HttpError(500, "Income/expense aggregate exceeded a safe integer — refusing to lose paise");
  }
  return { incomePaise, expensePaise };
}
