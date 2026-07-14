import { asc, eq, sql } from "drizzle-orm";
import type { NetWorthReport } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { netWorthSnapshots, users } from "../db/schema.ts";
import { portfolioValue } from "./holdings.ts";

interface Breakdown {
  cashPaise: number;
  investmentAccountsPaise: number;
  holdingsPaise: number;
  creditCardsPaise: number;
  loansPaise: number;
}

/** Balance-sheet math as of a date: account balances by type + holding values. */
export async function computeNetWorth(
  db: Db,
  userId: string,
  asOf: string,
): Promise<{ assetsPaise: number; liabilitiesPaise: number; breakdown: Breakdown }> {
  const res = await db.execute(sql`
    select a.type, coalesce(sum(a.opening_balance_paise + coalesce(t.total, 0)), 0)::bigint as balance
    from accounts a
    left join (
      select account_id, sum(amount_paise) as total
      from transactions
      where user_id = ${userId} and deleted_at is null and date <= ${asOf}
      group by account_id
    ) t on t.account_id = a.id
    where a.user_id = ${userId} and a.archived_at is null
    group by a.type
  `);
  const byType = new Map(
    (res.rows as Array<{ type: string; balance: string }>).map((r) => [r.type, Number(r.balance)]),
  );

  const cash = (byType.get("bank") ?? 0) + (byType.get("cash") ?? 0);
  const investmentAccounts = byType.get("investment") ?? 0;
  const creditCards = byType.get("credit_card") ?? 0;
  const loans = byType.get("loan") ?? 0;
  const holdingsValue = await portfolioValue(db, userId, asOf);

  const breakdown: Breakdown = {
    cashPaise: cash,
    investmentAccountsPaise: investmentAccounts,
    holdingsPaise: holdingsValue,
    creditCardsPaise: creditCards,
    loansPaise: loans,
  };
  const assets =
    Math.max(0, cash) + Math.max(0, investmentAccounts) + holdingsValue +
    Math.max(0, creditCards) + Math.max(0, loans);
  const liabilities =
    Math.max(0, -cash) + Math.max(0, -investmentAccounts) +
    Math.max(0, -creditCards) + Math.max(0, -loans);
  return { assetsPaise: assets, liabilitiesPaise: liabilities, breakdown };
}

/** Nightly job: one snapshot per user per day (idempotent via the unique index). */
export async function snapshotAllUsers(db: Db): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const allUsers = await db.select({ id: users.id }).from(users);
  let created = 0;
  for (const u of allUsers) {
    const { assetsPaise, liabilitiesPaise, breakdown } = await computeNetWorth(db, u.id, today);
    const inserted = await db
      .insert(netWorthSnapshots)
      .values({ userId: u.id, date: today, assetsPaise, liabilitiesPaise, breakdown })
      .onConflictDoNothing()
      .returning({ id: netWorthSnapshots.id });
    created += inserted.length;
  }
  return created;
}

/** Estimate month-end snapshots from ledger history; never overwrites observed days. */
export async function backfillSnapshots(db: Db, userId: string, months: number): Promise<number> {
  const now = new Date();
  let created = 0;
  for (let i = months; i >= 1; i -= 1) {
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0));
    const date = end.toISOString().slice(0, 10);
    const { assetsPaise, liabilitiesPaise, breakdown } = await computeNetWorth(db, userId, date);
    const inserted = await db
      .insert(netWorthSnapshots)
      .values({ userId, date, assetsPaise, liabilitiesPaise, breakdown, estimated: true })
      .onConflictDoNothing()
      .returning({ id: netWorthSnapshots.id });
    created += inserted.length;
  }
  return created;
}

function monthEnd(base: Date, offset: number): string {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset + 1, 0))
    .toISOString()
    .slice(0, 10);
}

export async function getNetWorthReport(db: Db, userId: string): Promise<NetWorthReport> {
  const today = new Date().toISOString().slice(0, 10);
  const current = await computeNetWorth(db, userId, today);
  const history = await db.query.netWorthSnapshots.findMany({
    where: eq(netWorthSnapshots.userId, userId),
    orderBy: [asc(netWorthSnapshots.date)],
    limit: 400,
  });

  const points = history.map((s) => ({
    date: s.date,
    assetsPaise: s.assetsPaise,
    liabilitiesPaise: s.liabilitiesPaise,
    netPaise: s.assetsPaise - s.liabilitiesPaise,
    estimated: s.estimated,
  }));

  // linear trend over the trailing window → 6 month-end projections
  const forecast: NetWorthReport["forecast"] = [];
  const currentNet = current.assetsPaise - current.liabilitiesPaise;
  const window = points.slice(-6);
  if (window.length >= 2) {
    const first = window[0]!;
    const last = window[window.length - 1]!;
    const days =
      (new Date(`${last.date}T00:00:00Z`).getTime() - new Date(`${first.date}T00:00:00Z`).getTime()) /
      86_400_000;
    const slopePerDay = days > 0 ? (last.netPaise - first.netPaise) / days : 0;
    const base = new Date();
    for (let i = 0; i < 6; i += 1) {
      const date = monthEnd(base, i);
      const daysOut =
        (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) /
        86_400_000;
      forecast.push({ date, netPaise: Math.round(currentNet + slopePerDay * daysOut) });
    }
  }

  return {
    current: {
      assetsPaise: current.assetsPaise,
      liabilitiesPaise: current.liabilitiesPaise,
      netPaise: currentNet,
      breakdown: current.breakdown,
    },
    history: points,
    forecast,
  };
}
