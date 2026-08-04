# Task: Fix demo.ts's monthDay/monthKey timezone rollover bug

## Status
COMPLETE

Fixed a real timezone-rollover bug in `services/demo.ts`'s `monthDay`/`monthKey` (mixed local-time `Date` setters with UTC serialization, producing the wrong calendar date when the server's local wall-clock time was 00:00-05:29 in a positive-UTC-offset timezone like IST). Rewrote both to derive "today" from UTC calendar fields and construct via `Date.UTC(...)`, matching the project's existing `LEDGER_DAY_TZ=UTC` convention. Companion fix to `demo.test.ts`'s "steps whole months back" test to remove its own local-time dependence (would otherwise have become a narrower, rarer flake after the production fix).

**Evidence:** Codex plan review (`review-1.md`) approved with two non-blocking refinements (string-based test assertion, stale comment fix), both folded into the delegation. Implementation done by sonnet-worker. Independently verified by a separate worker, which went beyond reasoning and **actually executed both the old and new code under `TZ=Asia/Kolkata` with an injected 2026-08-02 02:00 IST instant** — confirmed old code returns `2026-07-31` (bug reproduced), new code returns `2026-08-01` (fixed) — plus a live `TZ=Asia/Kolkata node --test` run, both 4/4 pass. Codex implementation review (`review-2.md`) independently confirms the same and finds no blocking issues. Full suite: 793/793 pass, exit 0, confirmed in three separate runs (implementer, verifier, Codex reviewer).

**Also investigated as part of this same user request:** `card-due-tasks.test.ts`'s shared-dev-DB preflight guard tripping (27 failures reported by user). Confirmed this is **not a code defect** — it's a deliberate, already-documented safety guard (see the test file's own header comment) that refuses to run the real global `materializeCardDueTasks(db)` against the shared dev Postgres if any non-demo `card_details` row exists, to avoid materializing a real user's task as a side effect. Queried the table directly: 0 offending rows at investigation time — the reported 8 were transient, from the DB being shared across concurrent, non-isolated sessions. No code change made or needed; flagged as a known, accepted trade-off of this specific test file, not a regression.

Unrelated to task 002/PR #155 (confirmed neither `demo.ts` nor `demo.test.ts`, nor `card-due-tasks.test.ts`, appear in that diff).

## Objective
`services/demo.ts`'s `monthDay(monthsAgo, day)` and `monthKey(monthsAgo)` (used throughout `ensureDemoData`/`seedInto` to generate every date in the demo account's 6 months of synthetic history — transactions, EMIs, insurance renewals, goal target dates, holdings, rewards, bills) currently produce the wrong calendar date when the API process's local wall-clock time is between 00:00 and ~05:29 in a timezone ahead of UTC (e.g. IST, UTC+5:30) — confirmed reproduced: requesting day=1 returns the previous month's last day in that window. Fix it so demo-seed dates are correct and deterministic regardless of the server's local time-of-day or timezone.

## Root Cause
Confirmed by reading `apps/api/src/services/demo.ts:34-48` and reproducing directly:

```ts
function monthDay(monthsAgo: number, day: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  d.setDate(day);
  return d.toISOString().slice(0, 10);
}
```

`setDate`/`setMonth` operate on the `Date`'s **local** time components, but `toISOString()` serializes in **UTC**. The instant `d` represents keeps whatever local hour-of-day `new Date()` captured. In a positive-UTC-offset timezone (IST, +5:30), if that local hour is before 05:30, the corresponding UTC instant falls on the *previous* calendar day — so `.toISOString().slice(0,10)` reports one day earlier than the local date fields that were just set. Reproduced directly: simulating `TZ=Asia/Kolkata` at local hours 00:00-05:29 reliably reproduces the reported `'31'` instead of `'01'`; hour ≥ 06:00 is correct; `TZ=UTC` is always correct (no local/UTC gap to cross).

This is a real, if narrow-window (~5.5 hours/day, only in positive-offset timezones), production bug: any demo-data seed (`npm run db:seed`, or the first demo login via `ensureDemoData`) run in that window generates transactions/policies/goals dated in the wrong month. Not related to task 002/PR #155 — confirmed neither `demo.ts` nor `demo.test.ts` appear in that PR's diff.

**Also confirmed:** `services/recurring.ts`'s `todayIso()` (`new Date().toISOString().slice(0,10)`) and the project's `LEDGER_DAY_TZ = "Etc/UTC"` convention (documented in `tasks/README.md`'s "Known traps") already treat "today" as the UTC calendar date everywhere else in this codebase, with the same IST-05:30 caveat explicitly accepted for ledger-day math. Making `demo.ts` UTC-based too is consistent with existing precedent, not a new convention — and appropriate here since demo-seed dates have no India-specific business-date requirement (unlike the advance-tax/maturity-deadline cases the README explicitly calls out as needing a *different*, IST-aware treatment).

**Companion test-flake risk identified while planning:** `demo.test.ts:24-31` ("monthDay steps whole months back without day overflow") computes its own "expected" value via `new Date(now.getFullYear(), now.getMonth() - 3, 15)` — **local** calendar fields. If `monthDay` is rewritten to use UTC calendar fields for "today" (as this fix does), the two could disagree by one month during the narrow edge case where local and UTC calendar month differ (i.e., local time is in the 00:00-05:29 IST window **and** local date is the 1st of a month, so UTC is still the last day of the previous month) — trading the original bug for a rarer one confined to this test's own comparison logic. Fixing the test's "expected" computation to also use UTC fields closes this in the same change.

## Scope
- `apps/api/src/services/demo.ts` — rewrite `monthDay`/`monthKey` to compute "today" from UTC calendar fields (`getUTCFullYear()`/`getUTCMonth()`) and construct the target date via `Date.UTC(...)`, eliminating the local-vs-UTC serialization gap entirely (not just narrowing it)
- `apps/api/src/services/demo.test.ts` — update the "steps whole months back" test's "expected" computation to use UTC fields (`getUTCFullYear()`/`getUTCMonth()` on both sides), so it doesn't itself become a new, rarer flake source after the production fix

## Dependencies
- None. Unrelated to task 002/PR #155 (confirmed: neither file is in that diff).

## Plan
- P1: Rewrite `monthDay`/`monthKey` in `demo.ts` to derive "today" via `now.getUTCFullYear()`/`now.getUTCMonth()`, then build the target date with `Date.UTC(year, month - monthsAgo, day)` (for `monthDay`) or `Date.UTC(year, month - monthsAgo, 1)` (for `monthKey`), then `.toISOString().slice(...)` as before. This also drops the old "anchor to day 1 before shifting month" two-step mutation (`d.setDate(1)` before `d.setMonth(...)`) — unnecessary once `day`/`month` are passed as `Date.UTC` arguments directly, since the constructor normalizes them in one step with no intermediate day-31-into-a-30-day-month overflow risk.
- P2: Update `demo.test.ts`'s "steps whole months back" test to remove its local-timezone dependence. Per review-1's non-blocking refinement, prefer an exact string comparison over comparing two UTC getter fields — it verifies year, month, *and* day together in one assertion instead of parsing a date to compare fields:
  ```ts
  const now = new Date();
  const expected = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 15))
    .toISOString()
    .slice(0, 10);
  assert.equal(monthDay(3, 15), expected);
  ```
  Also update the test's stale comment ("Anchoring to day 1 before shifting the month avoids e.g. Mar-31 → Mar-03") since the new implementation no longer uses that mutation technique (review-1 finding).
- P3: Do not change `_demoDates`'s exported shape, `monthDay`/`monthKey`'s signatures, or any call site in `demo.ts` (30+ call sites listed via grep, all pass literal `monthsAgo`/`day` integers — behavior-compatible, only the underlying date arithmetic changes from local-then-UTC-serialize to pure-UTC).

## Acceptance Criteria
- AC1: `monthDay(monthsAgo, day)` returns a date whose day-of-month is always exactly `day` (as a zero-padded 2-digit string), regardless of the server's current wall-clock time-of-day or timezone — proven by a test that doesn't depend on real-time (e.g. still using `new Date()` internally is fine since the fix is unconditionally correct, but the existing "produces a valid YYYY-MM-DD" test must pass deterministically at any hour, not just outside the old 00:00-05:29 IST window)
- AC2: `demo.test.ts`'s "steps whole months back without day overflow" test no longer mixes local- and UTC-based date computations between the production code and the test's own expectation
- AC3: All existing `demo.test.ts` assertions continue to pass, including `monthKey(-3) > monthKey(0)` (future months) and `rupeesToPaise` (untouched)
- AC4: No call site in `demo.ts` changes its arguments or needs updating — this is an internal-implementation-only fix
- AC5: `npm run typecheck`, `npm run lint`, `npm run test -w apps/api` all pass

## Verification
- T1: `node --test apps/api/src/services/demo.test.ts` — run at least once during a live IST 00:00-05:29 window OR simulated via `TZ=Asia/Kolkata` with a mocked/system clock in that range, to prove the fix actually closes the bug (not just "happens to pass because it wasn't tested at the buggy hour") — since faking the wall clock inside `node --test` without a mocking library is awkward, acceptable alternative: verify by direct reasoning/hand-computation shown in the delegation (Date.UTC-based construction is provably immune to the local/UTC gap, independent of what hour it's run at) plus running the suite at whatever hour it happens to run
- T2: `npm run typecheck`
- T3: `npm run lint` (or scoped `npx eslint apps/api/src/services/demo.ts apps/api/src/services/demo.test.ts`)
- T4: `npm run test -w apps/api` — full suite, zero new failures

## Non-Goals
- Not building a general IST-aware business-date service (the README's "Known traps" section explicitly flags that as separate, larger work needed for advance-tax/maturity-deadline features — out of scope for demo-data seeding)
- Not touching `services/recurring.ts`'s `todayIso()` or any other UTC-day-boundary call site — this task is scoped to `demo.ts` only
- Not addressing `card-due-tasks.test.ts`'s shared-dev-DB preflight guard — investigated separately (see conversation) and confirmed to be a deliberate, already-reviewed test-safety design responding to a shared, non-isolated dev Postgres, not a code defect; the DB was independently confirmed clean (0 offending rows) at investigation time, so there is nothing to fix there
