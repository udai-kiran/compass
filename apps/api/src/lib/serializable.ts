import { pgError } from "./errors.ts";

/**
 * Run `fn` once; if it fails with SQLSTATE `40001` (a serialization failure —
 * Postgres detected a dependency cycle under `SERIALIZABLE` isolation and
 * picked this transaction to abort), run it exactly one more time against
 * whatever state now holds. Any other error, or a second `40001`, is
 * rethrown as-is — this is a single retry, not a backoff loop.
 *
 * This is the concurrency contract for `absorbCarryover`
 * (tasks/cc-recon-02-carryover-seed/TASK.md P6a): a caller runs its work
 * inside `db.transaction(fn, { isolationLevel: "serializable" })`, and a
 * concurrent write that would otherwise let it commit an adjustment computed
 * from a ledger snapshot that no longer holds instead forces exactly one
 * retry against fresh state, or a clean failure.
 *
 * `pgError` unwraps Drizzle's wrapped driver errors to find the real
 * Postgres SQLSTATE, so this works whether `fn` throws the raw pg error or a
 * `DrizzleQueryError` wrapping it.
 */
export async function withSerializableRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (pgError(err)?.code !== "40001") throw err;
    return fn();
  }
}
