import { sql } from "drizzle-orm";
import {
  LIABILITY_ACCOUNT_TYPES,
  type BudgetPeriod,
  type CategoryKind,
  type ExpenseNecessity,
} from "@compass/shared";
import type { Db } from "../db/index.ts";

/**
 * SQL list of the liability account types. A positive amount on one of these (a
 * credit-card / loan payment, or a refund) is a repayment or reversal — never
 * income — so income sums exclude inflows on these accounts. The queries that use
 * it alias the accounts table as `a`. Shared by the income aggregations.
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
 */
export async function spentByCategory(
  db: Db,
  userId: string,
  from: string,
  to: string,
): Promise<Map<string | null, number>> {
  const nonSplit = await db.execute(sql`
    select t.category_id as cid, coalesce(sum(-t.amount_paise), 0)::bigint as spent
    from transactions t
    where t.user_id = ${userId} and t.deleted_at is null
      and t.date >= ${from} and t.date <= ${to}
      and t.amount_paise < 0
      and not t.is_opening
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
      and not exists (select 1 from transaction_splits s where s.transaction_id = t.id)
    group by t.category_id
  `);
  const splitParts = await db.execute(sql`
    select s.category_id as cid, coalesce(sum(-s.amount_paise), 0)::bigint as spent
    from transaction_splits s
    join transactions t on t.id = s.transaction_id
    where t.user_id = ${userId} and t.deleted_at is null
      and t.date >= ${from} and t.date <= ${to}
      and s.amount_paise < 0
      and not t.is_opening
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
    group by s.category_id
  `);
  const out = new Map<string | null, number>();
  for (const row of [...nonSplit.rows, ...splitParts.rows] as Array<{ cid: string | null; spent: string }>) {
    out.set(row.cid, (out.get(row.cid) ?? 0) + Number(row.spent));
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
 * transfer, opening-row, soft-delete and split-vs-non-split handling — so the
 * necessity buckets and the category breakdown reconcile against the same
 * underlying spend for any consistent snapshot.
 *
 * Not under concurrency, though: this runs two statements, so a split added or
 * removed between them can transiently double-count or drop one transaction.
 * `spentByCategory` has the same two-statement shape and `buildReport` runs the
 * two independently, so the race is pre-existing and inherited here rather than
 * introduced; closing it properly means snapshot isolation around the report.
 *
 * A transaction-level override applies to all of that transaction's splits; with
 * no override each split falls back to its OWN category, so a bill split across
 * Groceries and Wine can land in two different buckets.
 *
 * Both category joins are tenant-scoped and both are LEFT joins. Scoping matters
 * because a transaction can reference another user's category id through a
 * hand-crafted restore archive, which would otherwise let that category's
 * necessity decide how this user's spend is classified. They are LEFT joins so a
 * failed match leaves the spend counted but unclassified: an inner join would
 * drop it entirely, and the buckets would stop summing to the category
 * breakdown, which is the invariant this function exists to preserve.
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
  const nonSplit = await db.execute(sql`
    select t.necessity as tx_necessity, c.necessity as cat_necessity, c.kind as cat_kind,
           coalesce(sum(-t.amount_paise), 0)::bigint as spent
    from transactions t
    left join categories c on c.id = t.category_id and c.user_id = t.user_id
    where t.user_id = ${userId} and t.deleted_at is null
      and t.date >= ${from} and t.date <= ${to}
      and t.amount_paise < 0
      and not t.is_opening
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
      and not exists (select 1 from transaction_splits s where s.transaction_id = t.id)
    group by t.necessity, c.necessity, c.kind
  `);
  const splitParts = await db.execute(sql`
    select t.necessity as tx_necessity, c.necessity as cat_necessity, c.kind as cat_kind,
           coalesce(sum(-s.amount_paise), 0)::bigint as spent
    from transaction_splits s
    join transactions t on t.id = s.transaction_id
    left join categories c on c.id = s.category_id and c.user_id = t.user_id
    where t.user_id = ${userId} and t.deleted_at is null
      and t.date >= ${from} and t.date <= ${to}
      and s.amount_paise < 0
      and not t.is_opening
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
    group by t.necessity, c.necessity, c.kind
  `);
  type Row = {
    tx_necessity: ExpenseNecessity | null;
    cat_necessity: ExpenseNecessity | null;
    cat_kind: CategoryKind | null;
    spent: string;
  };
  const mapRow = (row: Row): NecessitySpendRow => ({
    txNecessity: row.tx_necessity,
    catNecessity: row.cat_necessity,
    catKind: row.cat_kind,
    spentPaise: Number(row.spent),
  });
  return [
    ...(nonSplit.rows as unknown as Row[]).map(mapRow),
    ...(splitParts.rows as unknown as Row[]).map(mapRow),
  ];
}

/** Income/expense totals over a range, transfers excluded. */
export async function incomeExpense(
  db: Db,
  userId: string,
  from: string,
  to: string,
): Promise<{ incomePaise: number; expensePaise: number }> {
  const res = await db.execute(sql`
    select
      coalesce(sum(case when t.amount_paise > 0 and a.type not in (${LIABILITY_TYPES_SQL})
        then t.amount_paise else 0 end), 0)::bigint as income,
      coalesce(sum(case when t.amount_paise < 0 then -t.amount_paise else 0 end), 0)::bigint as expense
    from transactions t
    join accounts a on a.id = t.account_id
    where t.user_id = ${userId} and t.deleted_at is null
      and t.date >= ${from} and t.date <= ${to}
      and not t.is_opening
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
  `);
  const row = res.rows[0] as { income: string; expense: string };
  return { incomePaise: Number(row.income), expensePaise: Number(row.expense) };
}
