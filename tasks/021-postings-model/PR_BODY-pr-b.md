## Postings model PR-B — balance readers → postings

Second dual-write increment of the double-entry migration (roadmap 2.1), after
SP0 (v2.1.0) and PR-A dual-write shadow layer (v2.2.0). No reader was on postings
before this; PR-B converts the first group — **balance readers**.

### What changed
The real-account component of every balance now comes from the `postings` mirror
(summed on the real account, joined to its non-deleted parent transaction under
the same date cut), with `accounts.opening_balance_paise` kept as an explicit
addend:

- `balances.ts` — `bankCashBalances` / `bankCashTotal`
- `accounts.ts` — `accountBalancesAtDate`, `listAccounts`
- `average-balance.ts` — `accountAverageBalances`

### Why it's safe (parity)
Every posting builder's real-account leg equals the legacy transaction's signed
amount, so `Σ postings(real account A) ≡ Σ transactions.amount_paise(A)` over the
same non-deleted, date-cut set. Adding the opening-column addend on both sides
makes the postings balance identical to the legacy balance, given the consistent
mirror PR-A's per-transaction invariant + reconcile guarantee. System-account
postings (Clearing/Expenses/Income/Opening) are excluded (`system_kind is null`),
so no synthetic leg can enter a balance.

Downstream consumers (`networth.ts`, `cashflow.ts`, `dashboard.ts`, `prefs.ts`)
inherit postings-based numbers via these readers; under parity the numbers are
unchanged. Other direct legacy balance readers (`insights.ts`, `cards.ts`,
`reconciliation-reads.ts`) intentionally stay on legacy until PR-D/PR-E.

### Integer-paise safety
All monetary aggregates and every derived combination (opening+sum, cross-account
reduction, AMB carried-in/running/daily-closing) are range-checked before
`Number()`, refusing out-of-range results with `HttpError(500)` instead of
silently IEEE-754-rounding.

### Tests
New DB-backed `postings-balance-parity.test.ts` asserts per-account and total
parity with a legacy formula computed directly from the legacy tables (no
tautology), plus `findInconsistentPostings == []` to catch drift, across
ordinary ±, split, linked transfer (no Clearing leakage), opening rows,
soft-deleted, future-dated, zero-activity, nonzero column-opening, archived, and
two-user tenant-isolation cases, with complete AMB result comparison and both
overflow-refusal paths.

### Scope guardrails
No writer, DB schema, migration, shared contract, or web change; legacy columns
and dual-write remain. Route snapshot unchanged.

### Verification
- `npm run typecheck` (all workspaces), `npm run lint` — clean
- `npm run test -w apps/api` — 925 tests, 924 pass, 0 fail, 1 pre-existing skip
- DB-backed parity suite — 7/7, stable across repeated runs

Reviewed by Codex: plan (review-19, approved), implementation (review-20 → 6
blocking findings, all fixed → review-21, approved).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
