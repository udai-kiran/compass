import { asc, eq, sql } from "drizzle-orm";
import type { AccountType, NetWorthReport } from "@compass/shared";
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

/** Account-derived buckets; holdingsPaise comes from the portfolio, not accounts. */
type AccountBucket = Exclude<keyof Breakdown, "holdingsPaise">;

/**
 * Which bucket each account type contributes to.
 *
 * Exhaustive on purpose: adding an account type without classifying it here is
 * a compile error. An unclassified type would otherwise be dropped from the
 * balance sheet entirely — the balance simply vanishes, with no error to notice.
 */
export const ACCOUNT_BUCKET: Record<AccountType, AccountBucket> = {
  bank: "cashPaise",
  cash: "cashPaise",
  investment: "investmentAccountsPaise",
  // PPF/EPF/SSY balances are real, credited money — assets, same as any investment account.
  ppf: "investmentAccountsPaise",
  epf: "investmentAccountsPaise",
  ssy: "investmentAccountsPaise",
  credit_card: "creditCardsPaise",
  loan: "loansPaise",
  // Overdraft home loan: the balance is what you owe (net of parked surplus),
  // so it's a liability like any other loan. The drawing power is liquidity, not
  // a separate asset — counting it would double what the surplus already offset.
  home_loan_od: "loansPaise",
};

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
  const buckets: Record<AccountBucket, number> = {
    cashPaise: 0,
    investmentAccountsPaise: 0,
    creditCardsPaise: 0,
    loansPaise: 0,
  };
  for (const r of res.rows as Array<{ type: string; balance: string }>) {
    const bucket = ACCOUNT_BUCKET[r.type as AccountType];
    // A type Postgres knows but this code doesn't: skipping it would hide money.
    if (!bucket) throw new Error(`Unclassified account type in net worth: ${r.type}`);
    buckets[bucket] += Number(r.balance);
  }
  const holdingsValue = await portfolioValue(db, userId, asOf);

  const breakdown: Breakdown = { ...buckets, holdingsPaise: holdingsValue };
  const accountValues = Object.values(buckets);
  const assets = accountValues.reduce((s, v) => s + Math.max(0, v), holdingsValue);
  const liabilities = accountValues.reduce((s, v) => s + Math.max(0, -v), 0);
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
