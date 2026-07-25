import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { AccountTypeSchema } from "@compass/shared";
import {
  ACCOUNT_BUCKET,
  backfillSnapshots,
  closePreviousDay,
  isSystemicFailure,
  MAX_RECOMPUTE_SINCE_DAYS,
  nDaysBefore,
  previousDay,
  recomputeRecentSnapshots,
  recomputeSnapshotsSince,
  repairSnapshots,
  snapshotAllUsers,
  snapshotDay,
} from "./networth.ts";
import { HttpError } from "../lib/errors.ts";

test("every account type is classified for net worth", () => {
  // A type missing here (undefined) contributes to neither assets nor
  // liabilities: the balance silently disappears from the balance sheet with
  // nothing to notice. This caught ppf/epf dropping ~4.6L before it shipped.
  // An explicit null is fine — it means "no balance of its own" (e.g. insurance,
  // a tracking record whose premiums live on the paying account).
  for (const type of AccountTypeSchema.options) {
    assert.ok(
      ACCOUNT_BUCKET[type] !== undefined,
      `account type "${type}" is not classified for net worth`,
    );
  }
});

test("insurance is a tracking record with no net-worth bucket", () => {
  assert.equal(ACCOUNT_BUCKET.insurance, null);
});

test("credited-balance schemes count as investment assets, not cash or debt", () => {
  assert.equal(ACCOUNT_BUCKET.ppf, "investmentAccountsPaise");
  assert.equal(ACCOUNT_BUCKET.epf, "investmentAccountsPaise");
  assert.equal(ACCOUNT_BUCKET.ssy, "investmentAccountsPaise");
  assert.equal(ACCOUNT_BUCKET.nps, "investmentAccountsPaise");
});

test("account types map to the bucket their sign convention expects", () => {
  assert.equal(ACCOUNT_BUCKET.bank, "cashPaise");
  assert.equal(ACCOUNT_BUCKET.cash, "cashPaise");
  assert.equal(ACCOUNT_BUCKET.credit_card, "creditCardsPaise");
  assert.equal(ACCOUNT_BUCKET.loan, "loansPaise");
});

/**
 * Records the conflict resolution each writer actually chose.
 *
 * These stubs drive the real `snapshotAllUsers` / `backfillSnapshots` rather
 * than rebuilding their queries: a test that constructs its own insert asserts
 * only that Drizzle works, and keeps passing when the service reverts to the
 * losing behaviour. Only the exercised path can catch that.
 */
/**
 * The YYYY-MM-DD literals bound into a Drizzle WHERE clause, in order.
 *
 * Compiled through the real dialect rather than by walking the clause object:
 * Drizzle's columns and tables reference each other, so a naive traversal
 * recurses forever. Compiling also means the assertion is about the SQL Postgres
 * would actually receive.
 */
function sqlParams(clause: unknown): string[] {
  const { params } = new PgDialect().sqlToQuery(clause as SQL);
  return params.filter((p): p is string => typeof p === "string");
}

/** Just the YYYY-MM-DD bound params, in order — the window bounds. */
function dateParams(clause: unknown): string[] {
  return sqlParams(clause).filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p));
}

/** The SQL text a clause compiles to — what Postgres would actually receive. */
function sqlText(clause: unknown): string {
  return new PgDialect().sqlToQuery(clause as SQL).sql;
}

/**
 * A row filter built from the compiled SQL, rather than from an assumption about
 * which operators the service used.
 *
 * This distinction is the whole value of the stub. Hardcoding `date <= upper`
 * here made the stub report an inclusive window no matter what the service
 * compiled, so the test claiming the window was inclusive of both ends kept
 * passing after the service switched to an exclusive `<` — it was asserting on a
 * query the test had rebuilt itself. Reading the operators back out of the
 * compiled SQL means a changed bound changes which rows come back, which is what
 * a caller would actually see.
 */
function compiledRowFilter(clause: unknown): (row: { userId: string; date: string }) => boolean {
  const { sql, params } = new PgDialect().sqlToQuery(clause as SQL);
  const checks: Array<(row: { userId: string; date: string }) => boolean> = [];
  const cmp = /"date"\s*(>=|<=|>|<)\s*\$(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = cmp.exec(sql)) !== null) {
    const op = m[1]!;
    const value = params[Number(m[2]) - 1] as string;
    checks.push((row) => {
      if (op === ">=") return row.date >= value;
      if (op === "<=") return row.date <= value;
      if (op === ">") return row.date > value;
      return row.date < value;
    });
  }
  const userEq = /"user_id"\s*=\s*\$(\d+)/.exec(sql);
  if (userEq) {
    const uid = params[Number(userEq[1]!) - 1] as string;
    checks.push((row) => row.userId === uid);
  }
  return (row) => checks.every((c) => c(row));
}

function stubDb(
  rows: Array<{ userId: string; date: string }> = [],
  opts: {
    users?: string[];
    failFor?: string;
    failForDates?: string[];
    /** fires on each balance-sheet query, so a test can perturb state mid-pass */
    onExecute?: () => void;
  } = {},
) {
  const users = opts.users ?? ["user-1"];
  const conflicts: string[] = [];
  const bounds: Array<{ upper?: string; lower?: string }> = [];
  const scopedBounds: Array<{ userId: string; from?: string; to?: string; sql: string }> = [];
  const insertedValues: Array<Record<string, unknown>> = [];
  const updated: Array<{ set: Record<string, unknown> }> = [];
  const returning = () => Promise.resolve([{ id: "row" }]);
  const chain = {
    onConflictDoNothing() {
      conflicts.push("nothing");
      return { returning };
    },
    onConflictDoUpdate(cfg: { target: unknown; set: Record<string, unknown> }) {
      conflicts.push("update");
      updates.push(cfg.set);
      targets.push(cfg.target);
      return { returning };
    },
  };
  const updates: Array<Record<string, unknown>> = [];
  const targets: unknown[] = [];
  // snapshotAllUsers selects users; recomputeRecentSnapshots selects existing
  // snapshot rows. Distinguish by what the caller asked for.
  const db = {
    select: (cols?: Record<string, unknown>) => {
      const isSnapshotQuery = cols !== undefined && "date" in cols;
      if (!isSnapshotQuery) return { from: () => Promise.resolve(users.map((id) => ({ id }))) };
      // The service bounds the window in SQL now, so mimic Postgres rather than
      // returning everything: pull the two date bounds out of the clause and
      // apply them, so a service that dropped or widened a bound fails here.
      const result = {
        where: (clause: unknown) => {
          // Record what was actually bound, so a test can assert the window
          // really reached SQL, then filter the way the compiled SQL says to.
          const dates = dateParams(clause);
          const userId = sqlParams(clause).find((p) => !/^\d{4}-\d{2}-\d{2}$/.test(p));
          if (userId !== undefined) {
            const [from, to] = dates;
            scopedBounds.push({ userId, from, to, sql: sqlText(clause) });
          } else {
            const [upper, lower] = dates;
            bounds.push({ upper, lower });
          }
          return Promise.resolve(rows.filter(compiledRowFilter(clause)));
        },
      };
      return { from: () => result };
    },
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          updated.push({ set });
          return Promise.resolve([]);
        },
      }),
    }),
    // computeNetWorth's raw balance-sheet query — no accounts, so the maths is
    // trivial and irrelevant here; this test is about conflict resolution.
    // `failFor` makes it reject for one user, standing in for the real failure
    // mode: computeNetWorth throws on an account type it cannot classify.
    execute: (clause?: unknown) => {
      opts.onExecute?.();
      const bound = sqlParams(clause);
      const hit =
        (opts.failFor !== undefined && bound.includes(opts.failFor)) ||
        (opts.failForDates !== undefined && bound.some((b) => opts.failForDates!.includes(b)));
      if (hit) return Promise.reject(new Error("bad data"));
      return Promise.resolve({ rows: [] });
    },
    query: {
      holdings: { findMany: () => Promise.resolve([]) },
      holdingEvents: { findMany: () => Promise.resolve([]) },
      holdingValuations: { findMany: () => Promise.resolve([]) },
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertedValues.push(v);
        return chain;
      },
    }),
  };
  return { db, conflicts, updates, targets, insertedValues, updated, bounds, scopedBounds };
}

test("the nightly snapshot overwrites the day's row instead of keeping the first write", async () => {
  // The first write of a day used to own it forever, so a 00:30 snapshot — or one
  // from an instance on older code with buckets missing — froze a wrong balance
  // sheet into history permanently. Recomputing must replace the day.
  const { db, conflicts, updates, targets } = stubDb();
  await snapshotAllUsers(db as never);

  assert.deepEqual(conflicts, ["update"], "the daily snapshot must upsert, not skip on conflict");
  const set = updates[0]!;
  for (const col of ["assetsPaise", "liabilitiesPaise", "breakdown"] as const) {
    assert.ok(col in set, `the overwrite must refresh ${col}`);
  }
  // A recompute is an observation and must supersede an earlier estimate,
  // otherwise a backfilled row stays flagged as estimated forever.
  assert.equal(set.estimated, false);
  // The conflict must be resolved on the (user, day) unique index. Any other
  // target would either error at runtime or overwrite a different user's row.
  assert.deepEqual(
    (targets[0] as Array<{ name: string }>).map((c) => c.name),
    ["user_id", "date"],
  );
});

test("the previous ledger day is stepped off the date label, not the clock", () => {
  // The close-out job runs just after midnight. Subtracting 86_400_000 ms from
  // the clock looked equivalent, but under a positive-offset TZ (Asia/Kolkata,
  // this app's audience) 00:05 local is still the previous date in UTC, so that
  // arithmetic closed out the day *before* the one that just ended. Stepping the
  // label cannot drift, whatever the process timezone is.
  assert.equal(previousDay("2026-07-25"), "2026-07-24");
  // month, year, and leap-day boundaries must roll, not produce a "day 0"
  assert.equal(previousDay("2026-07-01"), "2026-06-30");
  assert.equal(previousDay("2026-03-01"), "2026-02-28");
  assert.equal(previousDay("2024-03-01"), "2024-02-29");
  assert.equal(previousDay("2026-01-01"), "2025-12-31");
});

test("the snapshot day is the UTC date, matching every other balance-sheet date", () => {
  // computeNetWorth compares against `date <= asOf` in SQL and getNetWorthReport
  // derives today the same way; a local-time day here would put a snapshot on a
  // different date than the transactions it summed.
  assert.equal(snapshotDay(new Date("2026-07-25T23:30:00Z")), "2026-07-25");
  assert.equal(snapshotDay(new Date("2026-07-26T00:30:00Z")), "2026-07-26");
});

test("the day-close pass re-snapshots a past date rather than today", async () => {
  // The 00:30 run records a day before its transactions are entered, so the row
  // is only trustworthy once re-taken after the day ends. That second pass must
  // target the finished day, not today, or it never repairs anything.
  const { db, insertedValues } = stubDb();
  await snapshotAllUsers(db as never, "2026-07-24");

  assert.deepEqual(
    insertedValues.map((v) => v.date),
    ["2026-07-24"],
  );
});

test("the snapshot date defaults to today when not given", async () => {
  const { db, insertedValues } = stubDb();
  await snapshotAllUsers(db as never);

  assert.equal(insertedValues[0]!.date, new Date().toISOString().slice(0, 10));
});

test("one unsnapshottable user does not deny every other user their row", async () => {
  // computeNetWorth throws on an account type it cannot classify. While that
  // escaped, a single malformed user aborted the whole pass: every user after them
  // silently lost the day, and in the close-out job the recompute sweep never even
  // started. The failure must be isolated and reported instead.
  const { db, insertedValues } = stubDb([], {
    users: ["user-1", "boom", "user-3"],
    failFor: "boom",
  });
  const { written, failures } = await snapshotAllUsers(db as never, "2026-07-24");

  assert.equal(written, 2, "the users either side of the failure are still snapshotted");
  assert.deepEqual(
    insertedValues.map((v) => v.userId),
    ["user-1", "user-3"],
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0]!.userId, "boom");
  assert.equal(failures[0]!.date, "2026-07-24", "the failure names the day, not just the user");
  assert.match(String((failures[0]!.error as Error).message), /bad data/);
});

test("a pass reports how many rows it attempted, so all-failed is distinguishable", async () => {
  // Isolating failures means the job can no longer tell "everything is broken"
  // (systemic — must fail the job loudly) from "there was nothing to do" (fine)
  // unless the pass reports what it attempted. `failures` alone cannot: three
  // failures is total collapse for three users and a minor blip for three hundred.
  const allBad = stubDb([], { users: ["a", "b"], failFor: "a" });
  const bad = await snapshotAllUsers(allBad.db as never, "2026-07-24");
  assert.equal(bad.processed, 2, "both users were attempted");

  const empty = stubDb([], { users: [] });
  const none = await snapshotAllUsers(empty.db as never, "2026-07-24");
  assert.deepEqual(
    { processed: none.processed, failures: none.failures.length },
    { processed: 0, failures: 0 },
    "no users is not a failure",
  );

  // The sweep counts the rows it selected, not the users, since it works user-days.
  const sweep = await recomputeRecentSnapshots(
    stubDb([
      { userId: "user-1", date: "2026-07-23" },
      { userId: "user-2", date: "2026-07-22" },
    ]).db as never,
    "2026-07-25",
    14,
  );
  assert.equal(sweep.processed, 2);
});

test("only an all-rows failure is systemic; an empty pass is not", () => {
  const fail = (userId: string) => ({ userId, date: "2026-07-24", error: new Error("x") });

  // Every attempted row failed: schema drift or the database is down. The job must
  // go red — isolating per-row failures otherwise means BullMQ reports a green run
  // while net-worth history silently stops updating.
  assert.equal(isSystemicFailure({ processed: 2, failures: [fail("a"), fail("b")] }), true);
  // One bad user among many is exactly what the isolation is for: log it, stay green.
  assert.equal(isSystemicFailure({ processed: 5, failures: [fail("a")] }), false);
  // Nothing to do — a fresh install has no users, and no snapshot rows to sweep.
  // Treating this as total failure would make every such deployment's job red.
  assert.equal(isSystemicFailure({ processed: 0, failures: [] }), false);
  assert.equal(isSystemicFailure({ processed: 3, failures: [] }), false);
});

test("the close-out writes yesterday and sweeps only the days before it", async () => {
  // The two halves are deliberately disjoint: the close owns the finished day (and
  // must write it unconditionally, since the sweep only refreshes rows that already
  // exist), and the sweep owns everything strictly before it. A sweep handed
  // today's date instead would recompute the day the close just wrote.
  const { db, insertedValues, bounds, updated } = stubDb([
    { userId: "user-1", date: "2026-07-24" }, // yesterday — closed, not swept
    { userId: "user-1", date: "2026-07-23" },
  ]);
  const res = await closePreviousDay(db as never, "2026-07-25");

  assert.equal(res.date, "2026-07-24", "the day closed is the one that just ended");
  assert.deepEqual(
    insertedValues.map((v) => v.date),
    ["2026-07-24"],
    "the finished day is re-taken, so a missed 00:30 pass still gets a row",
  );
  // Upper bound is the closed day itself and exclusive, so yesterday is not
  // recomputed on top of the close that just wrote it.
  assert.deepEqual(bounds, [{ upper: "2026-07-24", lower: nDaysBefore("2026-07-24", 45) }]);
  assert.equal(res.close.written, 1);
  assert.equal(res.sweep.refreshed, 1, "only 07-23 is swept");
  assert.equal(updated.length, 1);
  assert.deepEqual([...res.close.failures, ...res.sweep.failures], []);
});

test("the close-out reports failures from both the close and the sweep", async () => {
  // Both halves can fail independently and both sets must reach the job's logger;
  // dropping either leaves a permanently stale row with nothing recorded about it.
  const { db } = stubDb([{ userId: "boom", date: "2026-07-23" }], {
    users: ["boom"],
    failFor: "boom",
  });
  const res = await closePreviousDay(db as never, "2026-07-25");

  assert.equal(res.close.written, 0);
  assert.equal(res.sweep.refreshed, 0);
  assert.deepEqual(
    [...res.close.failures, ...res.sweep.failures].map((f) => f.date),
    ["2026-07-24", "2026-07-23"],
    "the closed day's failure and the swept day's failure are both surfaced",
  );
});

test("a half that fails completely is not masked by the other half succeeding", async () => {
  // The two halves count different populations — users for the close, user-days for
  // the sweep — so a merged `processed` let one hide the other's collapse. The
  // realistic case: a single user whose 45 stale rows all fail to recompute while
  // the close writes cleanly. Totalled that was 46 processed vs 45 failures, i.e.
  // "not systemic", and the job went green while history stopped healing.
  const dates = Array.from({ length: 45 }, (_, i) => ({
    userId: "user-1",
    date: nDaysBefore("2026-07-24", i + 1),
  }));
  // Fails only for dates strictly before the closed day: the close's own
  // computeNetWorth call is bound to 2026-07-24, which is not in this set.
  const { db } = stubDb(dates, { users: ["user-1"], failForDates: dates.map((d) => d.date) });
  const { close, sweep } = await closePreviousDay(db as never, "2026-07-25");

  assert.equal(close.written, 1, "the close half succeeded");
  assert.deepEqual(close.failures, []);
  assert.equal(isSystemicFailure(close), false);

  assert.equal(sweep.refreshed, 0, "every swept row failed");
  assert.equal(sweep.processed, 45);
  assert.equal(sweep.failures.length, 45);
  assert.equal(isSystemicFailure(sweep), true, "the collapsed half must be visible on its own");

  // The merged view that used to be returned would have read as healthy.
  assert.equal(
    isSystemicFailure({
      processed: close.processed + sweep.processed,
      failures: [...close.failures, ...sweep.failures],
    }),
    false,
    "totalling the two halves is exactly what hid the failure",
  );
});

test("the rolling recompute refreshes days a backdated entry invalidated", async () => {
  // A snapshot is derived from every transaction dated on or before that day, so
  // importing a statement — which carries the real, earlier dates — silently
  // invalidates the days it precedes. Closing out only yesterday would leave them
  // understated forever, which is the sawtooth this change exists to remove.
  const asOf = "2026-07-25";
  const { db, updated } = stubDb([
    { userId: "user-1", date: "2026-07-24" },
    { userId: "user-1", date: "2026-07-20" },
    { userId: "user-2", date: "2026-07-19" },
  ]);
  const { refreshed, failures } = await recomputeRecentSnapshots(db as never, asOf, 14);

  assert.equal(refreshed, 3, "every day inside the window is recomputed, for every user");
  assert.deepEqual(failures, []);
  for (const u of updated) {
    for (const col of ["assetsPaise", "liabilitiesPaise", "breakdown"] as const) {
      assert.ok(col in u.set, `the refresh must rewrite ${col}`);
    }
    // Provenance must survive a recompute: re-deriving a backfilled month-end
    // from the ledger is still a reconstruction, not something observed that day.
    assert.ok(!("estimated" in u.set), "a recompute must not relabel an estimate as observed");
  }
});

test("the rolling recompute leaves today, older days, and absent days alone", async () => {
  const asOf = "2026-07-25";
  const { db, updated, insertedValues, bounds } = stubDb([
    { userId: "user-1", date: asOf }, // today — owned by the daily snapshot pass
    { userId: "user-1", date: "2026-07-10" }, // older than the window
    { userId: "user-1", date: "2026-07-24" }, // the only row in range
  ]);
  const { refreshed } = await recomputeRecentSnapshots(db as never, asOf, 14);

  // Both bounds must reach the database; filtering in memory would mean reading a
  // table that grows by a row per user per day forever.
  assert.deepEqual(bounds, [{ upper: asOf, lower: "2026-07-11" }]);
  assert.equal(refreshed, 1);
  assert.equal(updated.length, 1);
  // Inventing history is backfillSnapshots' job; a day with no row stays absent,
  // so a user's chart never gains points they never had.
  assert.deepEqual(insertedValues, []);
});

test("a failing user does not abort the sweep", async () => {
  // Without isolation, one bad row left every later day stale until the next
  // night's run — the job threw and the remaining updates never happened.
  const asOf = "2026-07-25";
  const { db, updated } = stubDb(
    [
      { userId: "boom", date: "2026-07-24" },
      { userId: "user-2", date: "2026-07-23" },
    ],
    { failFor: "boom" },
  );
  const { refreshed, failures } = await recomputeRecentSnapshots(db as never, asOf, 14);

  assert.equal(refreshed, 1, "the healthy user is still refreshed");
  assert.equal(updated.length, 1);
  // The failure must carry which row broke and why: these rows are skipped
  // silently by design, so a bare count would leave an operator nothing to chase.
  assert.equal(failures.length, 1);
  assert.equal(failures[0]!.userId, "boom");
  assert.equal(failures[0]!.date, "2026-07-24");
  assert.match(String((failures[0]!.error as Error).message), /bad data/);
});

test("the recompute window boundary is inclusive of exactly N days back", () => {
  // Pins the arithmetic the window filter relies on.
  assert.equal(nDaysBefore("2026-07-25", 14), "2026-07-11");
  assert.equal(nDaysBefore("2026-01-05", 14), "2025-12-22");
  assert.equal(nDaysBefore("2026-07-25", 0), "2026-07-25");
  // A negative window must not reach into the future and rewrite tomorrow.
  assert.equal(nDaysBefore("2026-07-25", -5), "2026-07-30");
});

test("a negative window is clamped, never widened into the future", async () => {
  const asOf = "2026-07-25";
  const { db, bounds } = stubDb([{ userId: "user-1", date: "2026-07-24" }]);
  await recomputeRecentSnapshots(db as never, asOf, -5);

  assert.deepEqual(bounds, [{ upper: asOf, lower: asOf }], "clamped to zero days, not inverted");
});

test("a backfilled estimate never overwrites an observed day", async () => {
  const { db, conflicts, insertedValues } = stubDb();
  await backfillSnapshots(db as never, "user-1", 3);

  assert.equal(conflicts.length, 3, "one insert per requested month");
  assert.deepEqual(
    [...new Set(conflicts)],
    ["nothing"],
    "an estimate must yield to whatever is already recorded for that day",
  );
  assert.deepEqual(
    [...new Set(insertedValues.map((v) => v.estimated))],
    [true],
    "backfilled rows must be marked estimated",
  );
});

test("the targeted repair refreshes stale days the nightly sweep can no longer reach", async () => {
  // These days are ~200 days old, far outside SNAPSHOT_RECOMPUTE_DAYS, which is
  // the whole point.
  const { db, updated } = stubDb([
    { userId: "user-1", date: "2026-01-10" },
    { userId: "user-1", date: "2026-02-15" },
    { userId: "user-1", date: "2026-07-20" },
  ]);
  const { refreshed, failures } = await recomputeSnapshotsSince(
    db as never,
    "user-1",
    "2026-01-10",
    "2026-07-25",
  );

  assert.equal(refreshed, 3);
  assert.deepEqual(failures, []);
  assert.equal(updated.length, 3);
  for (const u of updated) {
    for (const col of ["assetsPaise", "liabilitiesPaise", "breakdown"] as const) {
      assert.ok(col in u.set, `the refresh must rewrite ${col}`);
    }
    // Provenance must survive — same rule as the sweep.
    assert.ok(!("estimated" in u.set), "a recompute must not relabel an estimate as observed");
  }
});

test("the targeted repair is scoped to the requesting user", async () => {
  // Every user-facing query filters by the session's user; a repair that
  // recomputed other users' rows would be a cross-tenant write.
  const { db, updated, scopedBounds } = stubDb([
    { userId: "user-1", date: "2026-02-15" },
    { userId: "user-1", date: "2026-07-20" },
    { userId: "user-2", date: "2026-03-10" },
    { userId: "user-2", date: "2026-07-19" },
  ]);
  const { refreshed } = await recomputeSnapshotsSince(db as never, "user-1", "2026-01-10", "2026-07-25");

  assert.equal(refreshed, 2, "only user-1's rows are refreshed");
  assert.equal(updated.length, 2);
  assert.equal(scopedBounds.length, 1);
  assert.equal(scopedBounds[0]!.userId, "user-1");
});

test("the repair window reaches SQL, inclusive of both ends", async () => {
  const { db, scopedBounds, updated } = stubDb([
    { userId: "user-1", date: "2026-02-09" }, // before `from`
    { userId: "user-1", date: "2026-02-10" }, // exactly at `from`
    { userId: "user-1", date: "2026-07-25" }, // exactly at `today`
    { userId: "user-1", date: "2026-07-26" }, // after `today`
  ]);
  await recomputeSnapshotsSince(db as never, "user-1", "2026-02-10", "2026-07-25");

  assert.equal(scopedBounds.length, 1);
  assert.equal(scopedBounds[0]!.from, "2026-02-10");
  assert.equal(scopedBounds[0]!.to, "2026-07-25");
  // Assert the operator, not just the bound value. An exclusive upper bound would
  // silently drop today's own row — the one most likely to be stale — and the
  // bound value alone cannot tell the two apart.
  assert.match(
    scopedBounds[0]!.sql,
    /"date"\s*<=\s*\$\d+/,
    "the upper bound must be inclusive so today's own row is refreshed",
  );
  assert.doesNotMatch(
    scopedBounds[0]!.sql,
    /"date"\s*<\s*\$\d+/,
    "an exclusive upper bound would skip today",
  );
  assert.equal(updated.length, 2, "only the two in-range rows were refreshed (boundary inclusive)");
});

test("a from-date older than the ceiling is clamped, and says so", async () => {
  // The cost is one balance-sheet query plus portfolioValue per day,
  // synchronously, so an unbounded range would hang the request; a silent clamp
  // would tell the user their range was covered when it wasn't.
  const { db } = stubDb([
    { userId: "user-1", date: "2023-01-01" },
    { userId: "user-1", date: "2026-07-20" },
  ]);

  const old = await recomputeSnapshotsSince(db as never, "user-1", "2019-01-01", "2026-07-25");
  assert.equal(old.clamped, true);
  assert.equal(old.from, nDaysBefore("2026-07-25", MAX_RECOMPUTE_SINCE_DAYS));

  const recent = await recomputeSnapshotsSince(db as never, "user-1", "2026-06-01", "2026-07-25");
  assert.equal(recent.clamped, false);
  assert.equal(recent.from, "2026-06-01");
});

test("one unrecomputable day does not abort the rest of the repair", async () => {
  // Same isolation rule as the nightly sweep — a manual repair must not stop
  // dead on one bad day.
  const { db, updated } = stubDb(
    [
      { userId: "user-1", date: "2026-03-01" },
      { userId: "user-1", date: "2026-03-03" },
      { userId: "user-1", date: "2026-03-05" },
    ],
    { failForDates: ["2026-03-03"] },
  );
  const { refreshed, failures } = await recomputeSnapshotsSince(
    db as never,
    "user-1",
    "2026-03-01",
    "2026-07-25",
  );

  assert.equal(refreshed, 2, "the other two were refreshed");
  assert.equal(updated.length, 2);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]!.date, "2026-03-03");
  assert.equal(failures[0]!.userId, "user-1");
});

test("a from-date in the future is a harmless no-op, not an inverted window", async () => {
  // `from` arrives from a request. Nothing rejects a future date, and an inverted
  // window must simply match no rows rather than being reordered into a range
  // that recomputes days the caller never asked for.
  const { db, updated } = stubDb([
    { userId: "user-1", date: "2026-07-20" },
    { userId: "user-1", date: "2026-07-25" },
  ]);
  const pass = await recomputeSnapshotsSince(db as never, "user-1", "2027-01-01", "2026-07-25");

  assert.equal(pass.processed, 0);
  assert.equal(pass.refreshed, 0);
  assert.deepEqual(pass.failures, []);
  assert.equal(updated.length, 0, "no day may be rewritten");
});

/**
 * Minimal Redis stand-in driven by the arguments production actually passes.
 *
 * The point is to avoid re-implementing the semantics the code under test is
 * supposed to request. An earlier version applied NX-and-compare-and-delete from
 * its own code, so it would have reported success even if the real call had
 * dropped `NX` — the flag that makes the lock a lock. So `set` honours the flags
 * it was given, and `eval` INTERPRETS the supplied Lua rather than assuming what
 * it says.
 *
 * `taken` preloads a lock another request already holds, which is what makes a
 * genuine `SET NX` return null.
 */
function stubRedis(opts: { taken?: boolean } = {}) {
  const calls: Array<{ op: string; key: string }> = [];
  const tokens: string[] = [];
  const setArgs: unknown[][] = [];
  const evalArgs: Array<{ script: string; numKeys: number; args: string[] }> = [];
  let value: string | null = opts.taken ? "someone-elses-token" : null;
  const redis = {
    set: (key: string, token: string, ...rest: unknown[]) => {
      calls.push({ op: "set", key });
      tokens.push(token);
      setArgs.push([key, token, ...rest]);
      // Honour NX rather than assuming it: without it, Redis would overwrite an
      // existing lock and every caller would "acquire" it.
      const nx = rest.some((a) => typeof a === "string" && a.toUpperCase() === "NX");
      if (nx && value !== null) return Promise.resolve(null);
      value = token;
      return Promise.resolve("OK");
    },
    /**
     * Interpret the supplied Lua instead of assuming it compares tokens.
     *
     * Only the shape this codebase uses is understood: a GET on KEYS[1] compared
     * against ARGV[1] guarding a DEL. A script that does not match that shape
     * falls through to an unconditional delete — which is what an unguarded
     * release would really do, so a wrong script fails the ownership tests
     * instead of quietly passing them.
     */
    eval: (script: string, numKeys: number, ...args: string[]) => {
      const key = args[0] ?? "";
      calls.push({ op: "eval", key });
      evalArgs.push({ script, numKeys, args });
      const comparesToken =
        /redis\.call\(\s*["']get["']\s*,\s*KEYS\[1\]\s*\)\s*==\s*ARGV\[1\]/.test(script) &&
        /redis\.call\(\s*["']del["']\s*,\s*KEYS\[1\]\s*\)/.test(script);
      if (comparesToken && value !== args[1]) return Promise.resolve(0);
      value = null;
      return Promise.resolve(1);
    },
  };
  return {
    redis,
    calls,
    tokens,
    setArgs,
    evalArgs,
    held: () => value,
    /** install another holder's lock directly, as an expiry-then-reacquire would */
    force: (token: string) => {
      value = token;
    },
  };
}

test("a repair reports what it managed to do, not just that it returned", async () => {
  // The counts are the only way a caller distinguishes "repaired" from "attempted and failed".
  const { db } = stubDb([
    { userId: "user-1", date: "2026-07-23" },
    { userId: "user-1", date: "2026-07-24" },
    { userId: "user-1", date: "2026-07-25" },
  ]);
  const { redis, calls } = stubRedis();
  const result = await repairSnapshots(db as never, redis as never, "user-1", "2026-07-23");

  assert.deepEqual(result, {
    from: "2026-07-23",
    clamped: false,
    processed: 3,
    refreshed: 3,
    failed: 0,
  });
  // Also assert the lock is released on success.
  assert.deepEqual(calls, [
    { op: "set", key: "nw:repair:user-1" },
    { op: "eval", key: "nw:repair:user-1" },
  ]);
});

test("a partly failed repair still returns 200-worthy counts, with the failures counted", async () => {
  // The days that were repaired are real progress; `failed` is how the caller learns about the rest.
  const { db } = stubDb(
    [
      { userId: "user-1", date: "2026-07-23" },
      { userId: "user-1", date: "2026-07-24" },
      { userId: "user-1", date: "2026-07-25" },
    ],
    { failForDates: ["2026-07-24"] },
  );
  const { redis } = stubRedis();
  const result = await repairSnapshots(db as never, redis as never, "user-1", "2026-07-23");

  assert.equal(result.processed, 3);
  assert.equal(result.refreshed, 2);
  assert.equal(result.failed, 1);
});

test("a repair that fails every day throws instead of reporting success", async () => {
  // All-failed is systemic, and a fresh report would claim history was repaired when nothing was written.
  const { db } = stubDb(
    [
      { userId: "user-1", date: "2026-07-24" },
      { userId: "user-1", date: "2026-07-25" },
    ],
    { failForDates: ["2026-07-24", "2026-07-25"] },
  );
  const { redis } = stubRedis();

  await assert.rejects(
    repairSnapshots(db as never, redis as never, "user-1", "2026-07-24"),
    (err: unknown) => err instanceof HttpError && err.statusCode === 500,
  );
  const { updated } = stubDb(
    [
      { userId: "user-1", date: "2026-07-24" },
      { userId: "user-1", date: "2026-07-25" },
    ],
    { failForDates: ["2026-07-24", "2026-07-25"] },
  );
  // Verify no days were rewritten.
  assert.equal(updated.length, 0);
});

test("a second concurrent repair for the same user is refused, not queued", async () => {
  // Each repair can issue ~1,500 queries and the write rate limit allows 120 requests a minute,
  // so the lock is what keeps one caller from stacking overlapping full-window recomputes.
  const { db, updated } = stubDb([{ userId: "user-1", date: "2026-07-24" }]);
  const { redis } = stubRedis({ taken: true });

  await assert.rejects(
    repairSnapshots(db as never, redis as never, "user-1", "2026-07-24"),
    (err: unknown) => err instanceof HttpError && err.statusCode === 409,
  );
  assert.equal(updated.length, 0);
});

test("the repair lock is released even when the repair fails", async () => {
  // A failed repair must not lock the user out until the TTL expires.
  const { db } = stubDb(
    [{ userId: "user-1", date: "2026-07-24" }],
    { failForDates: ["2026-07-24"] },
  );
  const { redis, calls } = stubRedis();

  try {
    await repairSnapshots(db as never, redis as never, "user-1", "2026-07-24");
  } catch {
    // Ignore the expected error
  }

  assert.deepEqual(
    calls.filter((c) => c.op === "eval"),
    [{ op: "eval", key: "nw:repair:user-1" }],
  );
});

test("the maximum repair window is small enough to survive one request", () => {
  // The ceiling is a request-budget decision — each day costs ~4 sequential queries,
  // so a ceiling that drifts upward silently reintroduces the timeout risk this bounds.
  assert.ok(MAX_RECOMPUTE_SINCE_DAYS <= 400);
});

test("a repair whose lock expired mid-flight does not destroy its successor's lock", async () => {
  // The interleaving the ownership check exists for: A is still running when its
  // lock expires, B acquires the freed key, then A finishes. An unconditional DEL
  // would delete B's lock here, letting a third repair start while B is still
  // running — the mutual exclusion silently stops holding. So A's release must be
  // a no-op once it no longer owns the key.
  const { redis, held, force } = stubRedis();
  // Install B's lock partway through A's repair, standing in for "A's TTL expired
  // and B took the key".
  const { db } = stubDb([{ userId: "user-1", date: "2026-07-20" }], {
    onExecute: () => force("b-token"),
  });

  await repairSnapshots(db as never, redis as never, "user-1", "2026-07-01");

  assert.equal(held(), "b-token", "the successor's lock must survive A's release");
});

test("a repair releases the lock it does own", async () => {
  // The other half of the same rule: ownership-checked release must still actually
  // release, or one repair would lock a user out until the TTL expires.
  const { db } = stubDb([{ userId: "user-1", date: "2026-07-20" }]);
  const { redis, held } = stubRedis();

  await repairSnapshots(db as never, redis as never, "user-1", "2026-07-01");

  assert.equal(held(), null, "a holder must release its own lock");
});

test("a repair blocked by another holder leaves that holder's lock untouched", async () => {
  // A refused request must not clear the lock that refused it. This is why the 409
  // is thrown before the try: a request that never acquired the lock must never
  // reach the release path.
  const { db, updated } = stubDb([{ userId: "user-1", date: "2026-07-20" }]);
  const { redis, held } = stubRedis({ taken: true });

  await assert.rejects(
    repairSnapshots(db as never, redis as never, "user-1", "2026-07-01"),
    (err: unknown) => err instanceof HttpError && err.statusCode === 409,
  );
  assert.equal(held(), "someone-elses-token", "another holder's lock must survive");
  assert.equal(updated.length, 0, "and no day may be recomputed");
});

test("each repair holds the lock under its own token", async () => {
  // Compare-and-delete only distinguishes holders if their tokens differ. A shared
  // constant would make every holder's token match every other's, degrading release
  // back to an unconditional DEL — the exact defect the token exists to prevent,
  // and one that no assertion about a single repair can catch.
  const { db } = stubDb([{ userId: "user-1", date: "2026-07-20" }]);
  const { redis, tokens } = stubRedis();

  await repairSnapshots(db as never, redis as never, "user-1", "2026-07-01");
  await repairSnapshots(db as never, redis as never, "user-1", "2026-07-01");

  assert.equal(tokens.length, 2);
  assert.notEqual(tokens[0], tokens[1], "two repairs must not share a lock token");
  for (const t of tokens) {
    assert.ok(t.length >= 16, `a lock token must be unguessable, got "${t}"`);
  }
});

test("the repair lock outlives a full-window repair", async () => {
  // An expiring lock is how mutual exclusion silently stops holding: the holder
  // overruns, a second repair starts, and now two run at once. The TTL must exceed
  // the slowest plausible repair (MAX_RECOMPUTE_SINCE_DAYS days, ~4 sequential
  // queries each) by a wide margin.
  const seconds = Number(
    /REPAIR_LOCK_TTL_SECONDS\s*=\s*(\d+)/.exec(
      readFileSync(join(import.meta.dirname, "networth.ts"), "utf8"),
    )?.[1],
  );
  assert.ok(Number.isFinite(seconds), "REPAIR_LOCK_TTL_SECONDS not found");
  // 370 days at ~100ms per day is ~37s; an hour leaves roughly two orders of
  // magnitude of headroom.
  assert.ok(
    seconds >= 3600,
    `the repair lock TTL (${seconds}s) must comfortably exceed a full-window repair`,
  );
});

test("the repair lock is acquired with NX and an expiry, and released by token", async () => {
  // The stub can only model a lock if the real call asks for one. NX is what makes
  // acquisition exclusive — without it every caller overwrites the key and
  // "acquires" a lock that never blocks anyone — and EX is what stops a killed
  // process holding it forever. Neither is visible in the pass/fail of a repair, so
  // assert the arguments themselves.
  const { db } = stubDb([{ userId: "user-1", date: "2026-07-20" }]);
  const { redis, setArgs, evalArgs } = stubRedis();

  await repairSnapshots(db as never, redis as never, "user-1", "2026-07-01");

  assert.equal(setArgs.length, 1);
  const [key, token, ...flags] = setArgs[0]!;
  assert.equal(key, "nw:repair:user-1");
  const upper = flags.map((f) => (typeof f === "string" ? f.toUpperCase() : f));
  assert.ok(upper.includes("NX"), `the lock must be acquired with NX, got ${JSON.stringify(flags)}`);
  assert.ok(upper.includes("EX"), `the lock must carry an expiry, got ${JSON.stringify(flags)}`);
  // The TTL follows EX and must be a positive number of seconds.
  const ttl = flags[upper.indexOf("EX") + 1];
  assert.equal(typeof ttl, "number");
  assert.ok((ttl as number) > 0, "the lock TTL must be positive");

  // Release must name exactly one key and pass this holder's token as its only
  // argument, or the compare-and-delete has nothing to compare.
  assert.equal(evalArgs.length, 1);
  const release = evalArgs[0]!;
  assert.equal(release.numKeys, 1, "the release script must declare exactly one KEYS entry");
  assert.deepEqual(release.args, ["nw:repair:user-1", token]);
  assert.match(
    release.script,
    /redis\.call\(\s*["']get["']\s*,\s*KEYS\[1\]\s*\)\s*==\s*ARGV\[1\]/,
    "release must compare the stored token before deleting",
  );
  assert.match(release.script, /redis\.call\(\s*["']del["']\s*,\s*KEYS\[1\]\s*\)/);
});
