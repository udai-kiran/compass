## Summary

**SP0 of the double-entry ledger conversion (roadmap 2.1)** — the pure, additive, behavior-neutral foundation. It introduces the posting primitives and wires them into nothing yet, so it is inert and safe.

- **`modules/ledger/services/postings.ts`** (new, DB-free): `assertSafePaise` / `sumPaise` / `assertZeroSum` computed entirely in **BigInt** — a one-paisa imbalance is detectable even near `Number.MAX_SAFE_INTEGER`; `buildOrdinary/Split/Transfer/Opening` produce zero-sum posting sets with mechanical signs; `classifyShape` + `projectRealLeg/projectCounter/projectSplits` reconstruct the legacy transaction DTO (split notes and signed amounts preserved).
- **`postings.test.ts`** (new): 17 tests — seeded 500-case balanced/±1-perturbation property loop, `±MAX_SAFE_INTEGER` boundaries, builder sign/account-selection checks, and projection round-trips.
- **`SafePaiseSchema`** added additively in `packages/shared` (replaces no existing money field).
- **Task board:** 1.7/1.8/1.10 marked `done` (their code shipped in cfc36b5/825705d; only the frontmatter lagged); Phase-2 rescope recorded in 2.2–2.5; the full task-021 plan, investigation, and four Codex reviews live under `tasks/021-postings-model/`.

## Why this shape

The zero-sum invariant plus "DB recreated from scratch, no dual-write" make the column-removal cutover **atomic** (SP1). SP0 deliberately isolates the pure, testable core so the risky cutover lands against a proven foundation. The legacy `Transaction` API contract is preserved via the projection helpers, keeping `apps/web` largely untouched.

## Verification

- `npm run typecheck` — clean across all workspaces
- `npm run lint` — clean
- `npm run test -w apps/api` — 902 pass / 0 fail / 1 pre-existing skip
- `node --test apps/api/src/modules/ledger/services/postings.test.ts` — 17/17
- Independently verified: the only non-`tasks/` changes are the three SP0 files; Codex code review verdict *CORRECT-AND-BEHAVIOR-NEUTRAL*.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
