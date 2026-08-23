# Worker Delegation — Iteration 2: Review-5 blocker fixes

## Task
13.6 PPF / SSY / NPS Contribution-Limit & Eligibility Checks (`tasks/092-scheme-limits`)

## Worker
`sonnet-worker`

## Routing Reason
The severe finding requires restructuring how the aggregate/status-code
computation is sequenced (compute real total first, decide status second)
across four different branches without breaking the already-correct status
logic; the FY-vs-wall-clock fix requires reasoning about which date each of
several classification checks should really be evaluated against; the new
real-Postgres tests require constructing genuine cross-user/wrong-owner rows.

## Approved Plan
Canonical spec = `tasks/092-scheme-limits/TASK.md` — read the WHOLE file,
especially the new "Review-5 Blockers (pending fix)" section at the end
(9 numbered items), which is authoritative.

- P1 (blocker 1 — SEVERE, do this first): In
  `apps/api/src/modules/tax/services/scheme-compliance.ts`, restructure
  `ppfCompliance`, `ssyCompliance`, and `npsTier1Compliance` so that
  `sumContributions(...)` (the real postings aggregate) is ALWAYS called and
  its result is ALWAYS used as `annualContributedPaise`, regardless of
  whether `schemeOpenedDate`/holder/DOB/age/deposit-window/NPS-detail checks
  pass. Only the `statusCode` and `notes[]` should reflect a lifecycle-data
  gap (`data_missing`/`data_invalid`/`outside_deposit_window`) — the
  contributed-amount input to `eligible80CPaise`/`npsEmployeeContributionPaise`/
  deficit/headroom must reflect real money in every case. Add tests proving:
  an account with a real ₹1L contribution but a missing `schemeOpenedDate`
  reports `annualContributedPaise: 100000` (not 0) alongside
  `statusCode: 'data_missing'`; same pattern for each of the other
  data-gap branches listed in the blocker.
- P2 (blocker 2): Add real-Postgres integration tests (new file, e.g.
  `scheme-compliance.integration.test.ts`, following
  `apps/api/src/modules/ledger/services/epf-contributions.test.ts`'s
  established pattern — `requireDatabaseUrl()` throws loudly rather than
  skipping) for: a wrong-user `accountNpsDetails` row (same `accountId`,
  different `userId`) falling through to `data_missing`; a real Tier II
  account excluded from the list results; a posting on a different user's
  transaction excluded from the aggregate; a soft-deleted transaction
  excluded; an opening-balance posting excluded via the real `NOT EXISTS`;
  SSY holder ownership verified through a real `family_members` row owned by
  the correct user. Where the pure decision logic (status classification
  given plain inputs) isn't already separated from the DB-fetching code,
  extract it so it can be unit-tested without a database, per
  `tasks/TDD.md`'s functional-core rule — use your judgment on how much
  extraction is warranted; don't over-refactor working code.
- P3 (blocker 3): Replace the bare `z.string()` FY field on the
  scheme-compliance query schema(s) in `packages/shared/src/schemas/tax.ts`
  with the existing canonical `FySchema`.
- P4 (blocker 4): Make PPF (and any other date-vs-clock comparison in this
  file) evaluate against the REQUESTED `fy`'s end date (e.g.
  `fyRange(fy)[1]`), not `new Date()`/wall clock. Update tests to inject a
  fixed evaluation date rather than relying on "today" — this directly
  resolves blocker 9 too.
- P5 (blocker 5): When SSY's 15-year deposit window ends inside the
  requested FY's date range, clamp the contribution-aggregation's upper date
  bound to the window-end date instead of the FY's end date.
- P6 (blocker 6): Remove the SSY-specific ₹55,000/"₹500 arrears" claim from
  SSY's notes and from any SSY rule data in `scheme-limits.ts` that copied
  PPF's revival constant — TASK.md never specified an SSY revival amount.
  State only that discontinued SSY accounts can be revived for a fee, without
  asserting an unverified number.
- P7 (blocker 7): Add `a2.user_id = userId` (or equivalent) to the opening-
  account structural subquery's join condition in `sumContributions`.
- P8 (blocker 8): Add shared-schema tests per the blocker text.

## Files and Symbols
`apps/api/src/modules/tax/services/scheme-compliance.ts` (+ new
`.integration.test.ts`) · `apps/api/src/lib/scheme-limits.ts` (SSY revival
constant only) · `packages/shared/src/schemas/tax.ts` (scheme-compliance
query schema only) · `packages/shared/src/schemas/tax.test.ts`

## Must Not Change
Everything already confirmed correct by review-5 (the NOT EXISTS structural
exclusion shape itself, the NPS LEFT JOIN + post-retrieval classification,
PPF maturity arithmetic, SSY exact-10th-birthday handling, absence of CCD
fields, the migration, the ledger.ts/hubs.ts/accounts.ts schemeOpenedDate
work) — do not re-touch those beyond what P1-P8 above require. Any table,
migration, or route path other than what's needed for P3.

## Commands
`npm run typecheck` · `npm run lint` ·
`node --test apps/api/src/lib/scheme-limits.test.ts` ·
`node --test apps/api/src/modules/tax/services/scheme-compliance.test.ts` ·
`node --test apps/api/src/modules/tax/services/scheme-compliance.integration.test.ts`
(report whether it could connect to Postgres) ·
`npm run test -w packages/shared` · route snapshot test(s) (should be
unaffected — confirm)

## Required Evidence
files changed · complete diff per file · literal command outputs · exit codes ·
deviations
→ report to `tasks/092-scheme-limits/implementation-2.md`
