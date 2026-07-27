export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

/** Postgres SQLSTATE codes are exactly five characters of `[0-9A-Z]`, e.g. 23505. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * The Postgres error fields for a failed query, or null when the error
 * didn't come from Postgres.
 *
 * Drizzle (>= 0.44, and this repo is on ^0.45.2) wraps driver errors in a
 * `DrizzleQueryError` and hangs the original pg error off `.cause`, so a
 * direct `err.code` check silently never matches and a would-be 409 leaks
 * out as a 500. This walks the `cause` chain rather than looking exactly
 * one level down, so it keeps working whether the error arrives wrapped,
 * unwrapped, or wrapped twice. The depth cap stops a self-referential
 * cause from spinning.
 *
 * Only a five-character SQLSTATE counts as a match. Node's own errors carry
 * string `code`s too (`ENOENT`, `ERR_INVALID_ARG_TYPE`), so accepting any
 * string would both break this function's stated contract and — worse — halt
 * the walk on a wrapper that happens to carry one, hiding the real Postgres
 * error further down the chain. A non-SQLSTATE code is therefore skipped
 * over, not returned.
 */
export function pgError(err: unknown): { code: string; constraint?: string } | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    const e = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof e.code === "string" && SQLSTATE.test(e.code)) {
      return {
        code: e.code,
        constraint: typeof e.constraint === "string" ? e.constraint : undefined,
      };
    }
    current = e.cause;
  }
  return null;
}
