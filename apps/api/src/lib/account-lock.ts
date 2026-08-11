import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import * as schema from "../db/schema.ts";
import type { Db } from "../db/index.ts";

/**
 * Acquires a PostgreSQL session-level advisory lock keyed by
 * `hashtextextended(accountId, 0)` (64-bit) on a DEDICATED pool connection,
 * then calls `fn` with a Drizzle instance bound to that same connection.
 *
 * Because the lock acquisition blocks until any concurrent holder releases
 * (and holders commit their changes before releasing), any SERIALIZABLE
 * transaction started inside `fn` takes its snapshot AFTER the previous
 * holder committed — eliminating the stale-snapshot race described in
 * tasks/027-pr179-fix-regressions/TASK.md §"Failure 3".
 *
 * `fn` should start a transaction via `lockedDb.transaction(...)`. The lock
 * is released after `fn` returns or throws. On unlock failure the connection
 * is destroyed rather than returned to the pool (session advisory locks
 * survive normal `COMMIT`/`ROLLBACK` and would contaminate pool reuse).
 *
 * Only accepts a pool-backed `Db` (not a Drizzle transaction handle), because
 * a transaction handle has no pool from which to reserve an independent session.
 */
export async function withAccountAdvisoryLock<T>(
  db: Db,
  accountId: string,
  fn: (lockedDb: Omit<Db, '$client'>) => Promise<T>,
): Promise<T> {
  const pool = db.$client;
  const client: pg.PoolClient = await pool.connect();
  // Create a Drizzle instance on this dedicated connection.
  // drizzle() with a pg.PoolClient runs all statements on that exact client.
  const lockedDb = drizzle(client, { schema }) as unknown as Db;
  // Acquire the advisory lock. If this fails the client has not been released yet;
  // destroy it and rethrow. The outer try covers ONLY lock acquisition — fn, unlock,
  // and release are handled in the separate block below to avoid a double-release.
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended($1, 0))",
      [accountId],
    );
  } catch (err) {
    client.release(true);
    throw err;
  }
  // Advisory lock is held. Run fn and always release afterward.
  // On unlock failure (throw or unlocked !== true), destroy the connection so
  // the session-level lock cannot leak into the next pool checkout.
  let destroyClient = false;
  try {
    return await fn(lockedDb);
  } finally {
    try {
      const result = await client.query(
        "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
        [accountId],
      );
      if ((result.rows as Array<{ unlocked: boolean }>)[0]?.unlocked !== true) {
        destroyClient = true;
      }
    } catch {
      destroyClient = true;
    }
    client.release(destroyClient);
  }
}
