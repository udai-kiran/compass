# Sonnet Worker Delegation — iteration 1

## Task
003-demo-monthday-utc-fix: fix a real timezone-rollover bug in `services/demo.ts`'s `monthDay`/`monthKey`.

Read `tasks/003-demo-monthday-utc-fix/TASK.md` in full first (Codex-approved plan, `review-1.md`) — it is the source of truth.

## Approved Plan
- P1: In `apps/api/src/services/demo.ts`, rewrite `monthDay(monthsAgo, day)` and `monthKey(monthsAgo)` (currently lines 34-48) to derive "today" from UTC calendar fields and construct the target date via `Date.UTC(...)`, eliminating the local/UTC serialization gap that causes `toISOString().slice(0,10)` to report the wrong calendar date when the server's local wall-clock time is in the 00:00-05:29 IST window (or the equivalent window in any positive-UTC-offset timezone). Concretely:
  ```ts
  /** YYYY-MM-DD for a date `monthsAgo` months back, on day `day`. Uses UTC
   * calendar fields throughout (matching this app's LEDGER_DAY_TZ=UTC
   * convention, e.g. services/recurring.ts's todayIso()) so the result is
   * deterministic regardless of the server's local wall-clock time-of-day or
   * timezone — a local-time/UTC-serialization mismatch here previously
   * produced the wrong date in positive-UTC-offset timezones near midnight. */
  function monthDay(monthsAgo: number, day: number): string {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, day))
      .toISOString()
      .slice(0, 10);
  }

  /** "YYYY-MM" period key for `monthsAgo` months back. Same UTC-based approach as monthDay. */
  function monthKey(monthsAgo: number): string {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1))
      .toISOString()
      .slice(0, 7);
  }
  ```
  (You may phrase the doc comments differently, but the underlying computation — UTC fields for "now", `Date.UTC(...)` for the target, no intermediate local-time mutation — must match exactly.)
- P2: In `apps/api/src/services/demo.test.ts`, update the "monthDay steps whole months back without day overflow" test (currently ~lines 24-31) to stop comparing local-time fields. Per Codex review-1's recommendation, use an exact string comparison (verifies year/month/day together, simpler than comparing two UTC getter fields):
  ```ts
  test("monthDay steps whole months back without day overflow", () => {
    const now = new Date();
    const expected = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 15))
      .toISOString()
      .slice(0, 10);
    assert.equal(monthDay(3, 15), expected);
  });
  ```
  Also update or remove the test's stale comment about "anchoring to day 1 before shifting the month" — the new implementation doesn't use that mutation technique, so the comment no longer describes what's being tested.
- P3: Do not change `_demoDates`'s exported shape, `monthDay`/`monthKey`'s call signatures, or any of the 30+ call sites in `demo.ts` that invoke them — this is an internal-implementation-only fix. Do not touch `services/recurring.ts`, `services/bills.ts`, or any other UTC-day-boundary code — out of scope.

## Files and Symbols
- `apps/api/src/services/demo.ts` — `monthDay`, `monthKey` functions only (lines ~34-48)
- `apps/api/src/services/demo.test.ts` — the "steps whole months back" test only (lines ~24-31); leave the other three tests (`rupeesToPaise`, `monthDay produces a valid YYYY-MM-DD`, `monthKey is the YYYY-MM prefix...`) untouched unless they fail after your change (they shouldn't — reason through why before touching them if one does)

## Must Not Change
- Any other file. This is a two-function, one-test fix.
- `_demoDates`'s exported keys/shape (`monthDay`, `monthKey`, `rupeesToPaise`).
- Any call site of `monthDay`/`monthKey` inside `demo.ts` (their arguments/usage don't need to change — only the internal implementation of the two functions).

## Acceptance Criteria
Copy verbatim from `tasks/003-demo-monthday-utc-fix/TASK.md` — AC1 through AC5.

## Commands
1. `npm run typecheck`
2. `npx eslint apps/api/src/services/demo.ts apps/api/src/services/demo.test.ts`
3. `npm run test -w apps/api` — export `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET` from the repo root `.env` first (`set -a && source .env && set +a`); Postgres/Redis at `192.168.2.196` are reachable. Run once and report the full literal tally and exit code — this suite currently passes 793/793 on `main`/other branches, so it should be the same here (this fix touches only `demo.ts`/`demo.test.ts`).
4. `node --test apps/api/src/services/demo.test.ts` on its own — report literal output, all 4 tests should show `✔`.

## Required Evidence
- Complete diff of both files
- Literal command output and exit codes for all four commands above
- Explicit reasoning (a few sentences is fine) confirming the fix actually closes the original bug — e.g. walk through what `monthDay(0, 1)` would compute if the server's local time were `2026-08-02 02:00 IST` under both the old and new implementations, showing the old one would return `2026-07-31` and the new one returns `2026-08-01`
- Confirmation that no other file was touched (`git status --porcelain`)
