/**
 * error-logging.ts — Safe error serialization for the global error handler (task 13.4 / AC7).
 *
 * Problem
 * -------
 * `DrizzleQueryError` constructs its `.message` from the bound query parameters:
 *
 *   `Failed query: ${query}\nparams: ${params}`
 *
 * (node_modules/drizzle-orm/errors.js:10-19)
 *
 * Any write that carries PAN/TAN as bound parameters (income-event create/accept)
 * would place plaintext PAN/TAN in the application log if the DB call fails and the
 * raw error is logged directly — because the global unexpected-5xx handler calls
 * `req.log.error(err)` on the raw error object, which includes `.message`.
 *
 * Fix
 * ---
 * `sanitizeErrorForLog` duck-types on the presence of `.query` and `.params`
 * (rather than on `err.name === "DrizzleQueryError"`, which is unreliable since
 * `DrizzleQueryError` does not set `this.name` in its constructor and the instance
 * inherits "Error" from `Error.prototype.name`). For a DrizzleQueryError-shaped
 * error it OMITS `.message` and replaces it with a fixed, param-free string.
 * For every other error shape `.message` is preserved so normal debuggability is
 * not regressed.
 *
 * This is a repo-wide fix surfaced concretely by AC7 of task 13.4.
 */

/**
 * Returns a log-safe plain object representing `err`.
 *
 * - Always includes `name` and `stack` (when present).
 * - For a DrizzleQueryError-shaped error (duck-typed by the presence of both
 *   `.query` and `.params`): OMITS `.message` (which bakes bound query params
 *   directly into the string) and substitutes a static placeholder. The `.cause`
 *   chain is preserved because the underlying pg driver error does not contain
 *   bound parameters in its message.
 * - For all other error shapes: includes `.message` unchanged.
 */
export function sanitizeErrorForLog(err: unknown): Record<string, unknown> {
  if (err === null || typeof err !== "object") {
    return { value: String(err) };
  }

  const e = err as Record<string, unknown>;

  // Duck-type check: DrizzleQueryError always has both `.query` (the SQL string)
  // and `.params` (the bound-parameter array) as own properties on the instance.
  // We do NOT check `e.name === "DrizzleQueryError"` because that class does not
  // set `this.name` in its constructor — instances inherit "Error" from
  // Error.prototype.name, making the name check unreliable.
  const isDrizzleQueryError = typeof e["query"] === "string" && "params" in e;

  const result: Record<string, unknown> = {};

  if (typeof e["name"] !== "undefined") result["name"] = e["name"];
  if (typeof e["stack"] !== "undefined") result["stack"] = e["stack"];

  if (isDrizzleQueryError) {
    // DO NOT include `.message` — it contains bound query parameters (PAN, TAN, etc.).
    result["message"] = "[DrizzleQueryError: message omitted to prevent bound-parameter leakage]";
    // Preserve the cause (underlying pg driver error) — it does not carry bound params.
    if (typeof e["cause"] !== "undefined") result["cause"] = e["cause"];
    // Omit `.query` and `.params` too — they are the raw SQL and its values.
  } else {
    if (typeof e["message"] !== "undefined") result["message"] = e["message"];
    // For non-Drizzle errors, preserve all own enumerable properties for debuggability.
    for (const key of Object.keys(e)) {
      if (!(key in result)) result[key] = e[key];
    }
  }

  return result;
}
