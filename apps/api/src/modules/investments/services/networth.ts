import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { AccountType, NetWorthReport, SnapshotRepair } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import type { Redis } from "ioredis";
import { HttpError } from "../../../lib/errors.ts";
import { netWorthSnapshots } from "../schema.ts";
import { users } from "../../../db/schema.ts";
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
export const ACCOUNT_BUCKET: Record<AccountType, AccountBucket | null> = {
  bank: "cashPaise",
  cash: "cashPaise",
  investment: "investmentAccountsPaise",
  // PPF/EPF/SSY balances are real, credited money — assets, same as any investment account.
  ppf: "investmentAccountsPaise",
  epf: "investmentAccountsPaise",
  ssy: "investmentAccountsPaise",
  nps: "investmentAccountsPaise",
  credit_card: "creditCardsPaise",
  loan: "loansPaise",
  overdraft: "loansPaise",
  // Overdraft home loan: the balance is what you owe (net of parked surplus),
  // so it's a liability like any other loan. The drawing power is liquidity, not
  // a separate asset — counting it would double what the surplus already offset.
  home_loan_od: "loansPaise",
  // An insurance policy is a tracking record with no balance of its own —
  // premiums are expenses on the paying account, not money held here. It
  // contributes to no bucket (null), distinct from an unclassified type.
  insurance: null,
};

/** Balance-sheet math as of a date: account balances by type + holding values. */
export async function computeNetWorth(
  db: Db,
  userId: string,
  asOf: string,
): Promise<{ assetsPaise: number; liabilitiesPaise: number; breakdown: Breakdown }> {
  const res = await db.execute(sql`
    select a.type, coalesce(a.opening_balance_paise + coalesce(t.total, 0), 0)::bigint as balance
    from accounts a
    left join (
      select account_id, sum(amount_paise) as total
      from transactions
      where user_id = ${userId} and deleted_at is null and date <= ${asOf}
      group by account_id
    ) t on t.account_id = a.id
    where a.user_id = ${userId} and a.archived_at is null
  `);
  const buckets: Record<AccountBucket, number> = {
    cashPaise: 0,
    investmentAccountsPaise: 0,
    creditCardsPaise: 0,
    loansPaise: 0,
  };
  // Classify each account by the sign of *its own* balance. Aggregating a type
  // first would let a positive bank account cancel an overdrawn one, so a real
  // liability would vanish from the totals even though net worth stayed right.
  let accountAssets = 0;
  let accountLiabilities = 0;
  for (const r of res.rows as Array<{ type: string; balance: string }>) {
    const bucket = ACCOUNT_BUCKET[r.type as AccountType];
    // A type Postgres knows but this code doesn't: skipping it would hide money.
    // (null is an explicit "no bucket", e.g. insurance — that's fine to skip.)
    if (bucket === undefined) throw new Error(`Unclassified account type in net worth: ${r.type}`);
    if (bucket === null) continue;
    const balance = Number(r.balance);
    buckets[bucket] += balance;
    accountAssets += Math.max(0, balance);
    accountLiabilities += Math.max(0, -balance);
  }
  const holdingsValue = await portfolioValue(db, userId, asOf);

  const breakdown: Breakdown = { ...buckets, holdingsPaise: holdingsValue };
  const assets = accountAssets + holdingsValue;
  const liabilities = accountLiabilities;
  return { assetsPaise: assets, liabilitiesPaise: liabilities, breakdown };
}

/**
 * The ledger day a snapshot belongs to: `toISOString()` in UTC, matching how
 * every other date in the balance sheet is derived (computeNetWorth's `asOf`,
 * getNetWorthReport's `today`). Defined once so callers cannot drift onto local
 * time and disagree about which day it is.
 */
export function snapshotDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The calendar day before `date` (a YYYY-MM-DD string).
 *
 * Derived from the date *string*, not by subtracting 86,400,000 ms from the
 * clock: under a non-UTC TZ, 00:05 local is still the previous date in UTC, so
 * subtracting a day from the timestamp lands two days back. Stepping the label
 * itself cannot drift, and `Date.UTC` normalises month and year ends.
 */
export function previousDay(date: string): string {
  return nDaysBefore(date, 1);
}

/** `date` (YYYY-MM-DD) moved back `n` days, normalised across month/year ends. */
export function nDaysBefore(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

/**
 * A user-day that could not be snapshotted. Carried out to the caller (rather
 * than swallowed) so the job can log which row failed and why — a bare count
 * tells an operator something is wrong but not what to look at.
 */
export interface SnapshotFailure {
  userId: string;
  date: string;
  error: unknown;
}

/**
 * Outcome of a snapshot pass that isolates per-row failures.
 *
 * `processed` is what makes "every single row failed" distinguishable from
 * "there was nothing to do" — both leave `failures` short of proving anything on
 * their own, and the jobs must fail loudly only in the first case. Mirrors
 * autopilot's `{ processed, errors }` fan-out shape.
 */
export interface SnapshotPassResult {
  processed: number;
  failures: SnapshotFailure[];
}

/**
 * Whether a pass failed *systemically* — every row it attempted failed — as
 * opposed to one user's bad data, which is isolated and merely logged.
 *
 * Pure and exported so the boundary is pinned: `processed === 0` is "nothing to
 * do" (a fresh install has no users) and must not be treated as total failure,
 * while all-of-N failing means schema drift or a database outage and has to fail
 * the job loudly, or BullMQ shows green while history quietly stops updating.
 *
 * Apply this per pass, never to two passes added together: `processed` counts a
 * different population in each (users for the daily snapshot, user-days for the
 * sweep), so a combined total lets a healthy half mask a collapsed one.
 */
export function isSystemicFailure(pass: SnapshotPassResult): boolean {
  return pass.processed > 0 && pass.failures.length === pass.processed;
}

/**
 * Snapshot every user's balance sheet for `asOf` (default today), recomputed from
 * the current ledger and overwriting that day's row rather than keeping whatever
 * landed first.
 *
 * Keeping the first write is what produced the sawtooth net-worth history that
 * dove toward zero. Two ways a day got frozen wrong, both unrecoverable while
 * the insert did nothing on conflict:
 *
 *  - the scheduled run happens just after midnight, so it recorded balances
 *    before the day's transactions were entered; and
 *  - an instance running older code wrote a balance sheet missing whole buckets
 *    (an account type it had no mapping for contributes nothing — see
 *    ACCOUNT_BUCKET), so days it won read far too low.
 *
 * Overwriting means the *latest* recompute wins, so the row self-heals: the
 * snapshot is re-taken at the end of the day (see the scheduler in jobs/) and on
 * every boot. It does mean an instance on stale code can overwrite a good row —
 * do not point a second, older deployment at a live database.
 *
 * `estimated` is reset to false because a recompute is an observation, and must
 * supersede any earlier estimate from backfillSnapshots.
 *
 * One user's failure is isolated and reported, not thrown: `computeNetWorth`
 * rejects an account type it cannot classify, and letting that escape meant a
 * single malformed user denied *every* later user their row — and, in the
 * close-out job, aborted the recompute sweep before it began. Same shape as
 * autopilot's fan-out reviews (`{ processed, errors }`).
 */
export async function snapshotAllUsers(
  db: Db,
  asOf: string = snapshotDay(),
): Promise<SnapshotPassResult & { written: number }> {
  const allUsers = await db.select({ id: users.id }).from(users);
  let written = 0;
  const failures: SnapshotFailure[] = [];
  for (const u of allUsers) {
    try {
      const { assetsPaise, liabilitiesPaise, breakdown } = await computeNetWorth(db, u.id, asOf);
      const rows = await db
        .insert(netWorthSnapshots)
        .values({ userId: u.id, date: asOf, assetsPaise, liabilitiesPaise, breakdown })
        .onConflictDoUpdate({
          target: [netWorthSnapshots.userId, netWorthSnapshots.date],
          set: {
            assetsPaise,
            liabilitiesPaise,
            breakdown,
            estimated: false,
          },
        })
        .returning({ id: netWorthSnapshots.id });
      // An upsert returns a row for the update branch too, so this counts rows
      // written, not rows created — callers must not report it as "created".
      written += rows.length;
    } catch (error) {
      failures.push({ userId: u.id, date: asOf, error });
    }
  }
  return { processed: allUsers.length, written, failures };
}

/**
 * How many days back the daily close-out recomputes.
 *
 * Sized to cover the realistic backdating window rather than just the finished
 * day: card statements arrive monthly, and a bank CSV import carries each row's
 * real date, so entries routinely land weeks after the day they belong to.
 *
 * A transaction dated *before* this window still leaves the days between it and
 * the window understated, since the nightly pass never revisits them. That is
 * what `recomputeSnapshotsSince` is for — an on-demand repair for one user,
 * reachable from `POST /api/net-worth/backfill`. This constant only sizes the
 * automatic nightly sweep.
 *
 * Cost is bounded but not free: each user-day runs one balance-sheet query plus
 * `portfolioValue`, which itself issues up to three more (holdings, events,
 * valuations) and re-scans them per holding. That is ~45 user-days a night, so a
 * deployment with many users or long valuation histories should measure before
 * raising this further.
 */
export const SNAPSHOT_RECOMPUTE_DAYS = 45;

/**
 * Recompute the trailing `days` of snapshots, most recent first, ending with the
 * day before `asOf` (today's row is left to the daily snapshot pass).
 *
 * A snapshot is a *derived* figure — `computeNetWorth` sums every transaction
 * dated on or before the day — so it is only as current as the ledger was when it
 * was taken. Transactions are very often backdated (bank/statement imports carry
 * their real dates), which silently invalidates the days they precede. Without a
 * rolling recompute those days keep an understated value for good, which is the
 * sawtooth this whole change exists to remove.
 *
 * Only days that already have a row are refreshed: absent rows mean the user had
 * no snapshot then, and inventing history is `backfillSnapshots`'s job, not this.
 */
export async function recomputeRecentSnapshots(
  db: Db,
  asOf: string = snapshotDay(),
  days: number = SNAPSHOT_RECOMPUTE_DAYS,
): Promise<SnapshotPassResult & { refreshed: number }> {
  const earliest = nDaysBefore(asOf, Math.max(0, days));
  // Bound the window in SQL: this table grows by one row per user per day and is
  // never pruned, so selecting it whole to filter in memory would get slower
  // forever. Today's row is excluded — the daily snapshot pass owns it.
  const targets = await db
    .select({ userId: netWorthSnapshots.userId, date: netWorthSnapshots.date })
    .from(netWorthSnapshots)
    .where(
      and(
        lt(netWorthSnapshots.date, asOf),
        gte(netWorthSnapshots.date, earliest),
      ),
    );

  return refreshSnapshotRows(db, targets);
}

/**
 * Recompute an explicit list of (user, day) snapshot rows in place.
 *
 * Shared by the nightly sweep and the on-demand repair so both cannot drift on
 * the two things that matter: `estimated` is preserved, and one bad row never
 * aborts the rest.
 */
async function refreshSnapshotRows(
  db: Db,
  targets: Array<{ userId: string; date: string }>,
): Promise<SnapshotPassResult & { refreshed: number }> {
  let refreshed = 0;
  const failures: SnapshotFailure[] = [];
  for (const t of targets) {
    try {
      const { assetsPaise, liabilitiesPaise, breakdown } = await computeNetWorth(
        db,
        t.userId,
        t.date,
      );
      await db
        .update(netWorthSnapshots)
        // `estimated` is preserved, not cleared: a recompute re-derives the figure
        // from the ledger, which is exactly what an estimate already was. Flipping
        // it to false would relabel a reconstructed month-end as something observed
        // on the day, destroying the provenance the column exists to record.
        .set({ assetsPaise, liabilitiesPaise, breakdown })
        .where(and(eq(netWorthSnapshots.userId, t.userId), eq(netWorthSnapshots.date, t.date)));
      refreshed += 1;
    } catch (error) {
      // One user's bad data must not abort the pass and leave every later row
      // stale. Record which row failed and why — a bare count tells an operator
      // something broke but not what to look at — then carry on; the next
      // nightly run retries it.
      failures.push({ userId: t.userId, date: t.date, error });
    }
  }
  return { processed: targets.length, refreshed, failures };
}

/**
 * The furthest back one on-demand recompute may reach, in days.
 *
 * Each day costs a balance-sheet query plus `portfolioValue` (up to three more),
 * all sequential inside a single HTTP request, so the ceiling is a request-budget
 * decision rather than a domain one: at ~4 queries per day, 370 days is already
 * ~1,500 queries. Two years was too many — it put a plausible request timeout and
 * a large resource-exhaustion multiplier behind one click.
 *
 * A little over a year is the right size for what this exists for: repairing an
 * import that backdated entries past the nightly sweep's window. A caller needing
 * more calls it again with an earlier `from`, and `clamped` tells them they need
 * to.
 */
export const MAX_RECOMPUTE_SINCE_DAYS = 370;

/**
 * Repair one user's snapshots from `from` (inclusive) through today.
 *
 * The nightly sweep only reaches back `SNAPSHOT_RECOMPUTE_DAYS`, so an import
 * that backdated entries further than that leaves every later day understated
 * with nothing to fix it: `backfillSnapshots` inserts `onConflictDoNothing` and
 * so skips any day that already has a row, and the daily pass only ever touches
 * today. This is the targeted repair for exactly that.
 *
 * Scoped to one `userId` — it is reached from a request, and every user-facing
 * query in this codebase filters by the session's user. Only days that already
 * have a row are refreshed; conjuring absent history remains
 * `backfillSnapshots`' job.
 *
 * Returns `clamped: true` when `from` was older than `MAX_RECOMPUTE_SINCE_DAYS`
 * and got pulled forward, so a caller can tell the user their whole range was
 * not covered rather than silently reporting success.
 */
export async function recomputeSnapshotsSince(
  db: Db,
  userId: string,
  from: string,
  today: string = snapshotDay(),
): Promise<SnapshotPassResult & { refreshed: number; from: string; clamped: boolean }> {
  const earliest = nDaysBefore(today, MAX_RECOMPUTE_SINCE_DAYS);
  const clamped = from < earliest;
  const start = clamped ? earliest : from;
  // Bounded in SQL and filtered by user: this table grows by a row per user per
  // day and is never pruned, so neither bound may be applied in memory.
  const targets = await db
    .select({ userId: netWorthSnapshots.userId, date: netWorthSnapshots.date })
    .from(netWorthSnapshots)
    .where(
      and(
        eq(netWorthSnapshots.userId, userId),
        gte(netWorthSnapshots.date, start),
        lte(netWorthSnapshots.date, today),
      ),
    );
  const pass = await refreshSnapshotRows(db, targets);
  return { ...pass, from: start, clamped };
}

/**
 * How long the per-user repair lock lives, in seconds.
 *
 * Sized to outlast the slowest plausible full-window repair — 370 days at roughly
 * four sequential queries each — with a wide margin, because an expiring lock is
 * what breaks mutual exclusion: a holder that overruns its TTL leaves a second
 * repair free to start. It still expires, so a process killed mid-repair cannot
 * lock a user out permanently.
 *
 * The margin is the safeguard, not the only one: release is ownership-checked, so
 * even an overrun cannot make one repair cancel another's lock.
 */
const REPAIR_LOCK_TTL_SECONDS = 3600;

/** Redis key for one user's in-flight repair. */
function repairLockKey(userId: string): string {
  return `nw:repair:${userId}`;
}

/**
 * Release a lock only if this holder still owns it.
 *
 * An unconditional `DEL` is unsafe: if holder A overruns the TTL, B acquires the
 * freed key, and A then deletes *B's* lock — so a third repair can start while B
 * is still running, which is precisely what the lock exists to prevent. Comparing
 * the token and deleting must also be atomic, or the same interleaving fits
 * between a GET and a DEL.
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

/**
 * Run a targeted repair for one user under a lock, and report what it did.
 *
 * The lock is the load control that makes this endpoint safe to expose. The
 * per-IP write rate limit allows 120 requests a minute, and each repair can issue
 * ~1,500 queries, so without an admission gate one caller could stack dozens of
 * overlapping full-window recomputes — all of them fighting over the same rows
 * and the same connection pool. Holding at most one repair per user bounds the
 * concurrent cost by the number of users rather than by the request rate.
 *
 * A repair where *every* day failed throws instead of returning 200: that is
 * systemic (schema drift, database down), not one day's bad data, and returning a
 * cheerful report with a fresh net-worth figure would tell the caller their
 * history was repaired when nothing was written. Partial failure does return 200,
 * with the counts, because the days that did get repaired are real progress —
 * `failed` is how the caller sees the rest.
 */
export async function repairSnapshots(
  db: Db,
  redis: Pick<Redis, "set" | "eval">,
  userId: string,
  from: string,
): Promise<SnapshotRepair> {
  const key = repairLockKey(userId);
  // A token unique to this holder, so release can prove ownership.
  const token = randomUUID();
  const acquired = await redis.set(key, token, "EX", REPAIR_LOCK_TTL_SECONDS, "NX");
  if (acquired !== "OK") {
    throw new HttpError(409, "A net-worth repair is already running — wait for it to finish");
  }
  try {
    const pass = await recomputeSnapshotsSince(db, userId, from);
    if (isSystemicFailure(pass)) {
      throw new HttpError(500, `Net-worth repair failed for all ${pass.processed} days`);
    }
    return {
      from: pass.from,
      clamped: pass.clamped,
      processed: pass.processed,
      refreshed: pass.refreshed,
      failed: pass.failures.length,
    };
  } finally {
    // Released even when the repair threw — a failed repair must not lock the user
    // out until the TTL expires — but only if this holder still owns the lock.
    await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
  }
}

/**
 * The nightly close-out: re-take the finished day, then refresh the days before it.
 *
 * Lives here rather than inline in the BullMQ handler so what it guarantees is
 * testable. Three properties matter, and each was a bug at some point:
 *
 *  - the day closed is `previousDay(snapshotDay())` — derived from the UTC date
 *    label, not `Date.now() - 86_400_000`, which under a positive-offset TZ closed
 *    out the day *before* the one that just ended;
 *  - the close re-takes that day unconditionally, so a day whose 00:30 pass never
 *    ran still gets a row (the sweep can't supply one — it only refreshes rows
 *    that already exist); and
 *  - the sweep's `asOf` is that same closed day, and the window is upper-exclusive,
 *    so the sweep never touches it and it isn't recomputed twice.
 *
 * The two halves therefore cover disjoint dates, and against a fixed database they
 * commute — so the order is not an invariant worth pinning. It is not a *general*
 * commutativity: neither half sees a consistent snapshot, so a user created (or a
 * ledger row imported) between the two calls can land in one ordering and not the
 * other. Close-first is simply the clearer read.
 *
 * Both halves are returned *separately* rather than merged. Merging them meant
 * adding a user count to a user-day count and judging the total, which let each
 * half hide the other's collapse: one user with 45 stale rows and a wholly failed
 * sweep totals 46 processed against 45 failures, so "everything failed" read as
 * healthy. They are different populations and each has to be judged on its own.
 */
export async function closePreviousDay(
  db: Db,
  today: string = snapshotDay(),
): Promise<{
  date: string;
  close: SnapshotPassResult & { written: number };
  sweep: SnapshotPassResult & { refreshed: number };
}> {
  const date = previousDay(today);
  const close = await snapshotAllUsers(db, date);
  const sweep = await recomputeRecentSnapshots(db, date);
  return { date, close, sweep };
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
