## Review verdict

The investments migration itself is correctly implemented. I found no production regression, security defect, missing import, unexplained handler change, or SIP-split error.

However, under TASK.md’s literal gate, it is not yet possible to say that every acceptance criterion passed: AC5/T3 requires `npm run test` to exit successfully across all workspaces, while both supplied reports record exit code 1 because the extractor workspace lacked `DATABASE_URL`. That failure is unrelated to this migration and does not call for code changes, but the formal gate remains unsatisfied.

My recommendation is therefore: no further implementation changes are needed, but do not mark the task COMPLETE until the root test suite is rerun with the extractor environment configured and exits 0, or the coordinator explicitly waives that pre-existing environmental failure.

## Findings

No blocking implementation findings.

One minor documentation/convention issue: a broad textual grep—not an import-resolution check—finds six stale comments naming old flat service locations:

- [imports.ts](/home/udai/PennyPilot/apps/api/src/services/imports.ts:812): `services/sips.ts`
- [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:380): `services/holdings.ts`
- [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:1243): `services/tax-lots.ts`
- [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:1278): `services/tax-lots.ts`
- [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:1374): `services/mf-import.ts`
- [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:1394): `services/tax-lots.ts`

These are comments, not imports, so they do not violate AC7/T11 or affect runtime behavior. Nevertheless, any unqualified claim that the source tree contains “zero remaining references” to the old paths is too broad. The accurate claim is zero remaining imports resolving to the 16 deleted paths.

## Acceptance criteria

- AC1 — Pass, subject to the reported `db:generate` evidence. The canonical route test passed 7/7 and the raw table snapshot matches the current application. `route-table.snapshot.txt` has the expected 29 insertions/29 deletions; `route-surface.snapshot.txt` is unchanged in the working tree, although it is untracked. `backup.test.ts` passed 13/13 in my combined run. I did not rerun `db:generate`, because this was a strictly read-only review and that command may modify generated files; both supplied reports independently record an identical 135-file hash and “No schema changes.”

- AC2 — Pass. The four files exist and align with the required seams. The only exports present in the new combined SIP files that were not exports of old `sips.ts` are exactly `toSip`, `lastInstallmentDateFor`, and `ownedSip`. They are exported at [sip-lifecycle.ts:23](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:23), [sip-lifecycle.ts:91](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:91), and [sip-lifecycle.ts:106](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:106).

- AC3 — Pass. [networth.ts:29](/home/udai/PennyPilot/apps/api/src/modules/investments/services/networth.ts:29) retains `Record<AccountType, AccountBucket | null>`. Root typecheck passed, and the relocated net-worth tests passed.

- AC4 — Pass. `LEDGER_DAY_TZ` remains `"Etc/UTC"` at [jobs/index.ts:131](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:131), and both net-worth jobs remain in `LEDGER_DAY_SCHEDULERS` at [jobs/index.ts:141](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:141). The scheduler tests passed 7/7. The scheduler implementation itself is untouched.

- AC5 — Implementation tests pass, but the literal all-workspace gate remains unmet. My root `npm run typecheck` exited 0, root `npm run lint` exited 0, and all requested investments tests passed. Both supplied reports record `npm run test` exit 1 solely because `apps/extractor/src/statement-duplicate.test.ts` lacked `DATABASE_URL`; API itself passed 837/837. Thus the investments code satisfies the criterion’s substance, but “all workspaces green” has not been demonstrated with exit 0.

- AC6 — Pass. [investments/schema.ts](/home/udai/PennyPilot/apps/api/src/modules/investments/schema.ts:1) is a pure named re-export of exactly eight tables and ten enums. [schema.smoke.test.ts](/home/udai/PennyPilot/apps/api/src/modules/investments/schema.smoke.test.ts:1) checks object identity for all 18. `db/schema.ts` does not export from the investments schema; its only module-schema star export is for planning.

- AC7 — Pass. My independent resolver scanned all 218 TypeScript files under `apps/api/src` and found zero imports resolving to any of the 16 deleted production paths. All seven required import sites are correct, including both separate imports in `goals.ts`.

- AC8 — Pass. [plugin.test.ts](/home/udai/PennyPilot/apps/api/src/modules/investments/plugin.test.ts:14) checks one uniquely attributable route for each of the four registrations using `app.hasRoute()`, with no handler injection. It passed.

- AC9 — Pass. [01.03-migrate-investments.md:10](/home/udai/PennyPilot/tasks/01.03-migrate-investments.md:10) now says 16 holdings endpoints, includes account-NPS with the exact GET/PUT surface, and names all previously omitted services. [01.04-migrate-protection.md:10](/home/udai/PennyPilot/tasks/01.04-migrate-protection.md:10) no longer claims account-NPS.

- AC10 — Pass. [networth.route.test.ts:89](/home/udai/PennyPilot/apps/api/src/modules/investments/routes/networth.route.test.ts:89) specifically sends `POST /api/net-worth/backfill` using a demo session, asserts 403, and checks that the user has zero snapshot rows both before and after. It passed.

- AC11 — Pass. Historical comparisons of all 11 non-SIP services and all four routes found only import-depth/module-boundary changes and the two documented stale-location comment corrections. No route handler body or service behavior changed.

## Plan items

- P1 — Complete: both roadmap corrections are exact.
- P2 — Evidenced by the reports and snapshot artifacts. A pre-migration baseline cannot be recreated from the current post-migration tree, but the canonical snapshot remains available and passes.
- P3 — Complete: schema barrel and 18-binding smoke test are correct.
- P4 — Complete: 11 non-SIP services and seven corresponding tests are colocated under the module.
- P5 — Complete: four-way production/test split. I independently counted 113 old and 113 new test names with an exact multiset match. Section distribution is 11 lifecycle, 2 installments, 2 commitments, and 5 schedule.
- P6 — Complete: four routes moved; handler comparisons are behavior-identical.
- P7 — Complete: one module plugin registers all four routes, and [app.ts:130](/home/udai/PennyPilot/apps/api/src/app.ts:130) contains the single investments registration.
- P8 — Complete: all six external consumer files/seven import statements are correct.
- P9 — Complete: all 16 old production paths and eight old test paths are absent.
- P10 — Complete: canonical surface passes; raw table snapshot was regenerated and shows structural reordering only.
- P11 — Complete: focused demo-mode test is present and correct.
- P12 — Reported complete with matching before/after Drizzle hashes; not rerun during this read-only review.
- P13 — Complete: backup tests pass without investments-specific backup changes.
- P14 — Partially complete under the literal command gate: typecheck and lint pass; implementation diff review passes; root tests do not yet have a successful all-workspace exit.

## Cross-module import completeness

The seven required current imports are:

- [transactions.ts:18](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:18) → `sip-lifecycle.ts`
- [reconciliation-writes.ts:9](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:9) → `networth.ts`
- [cashflow.ts:12](/home/udai/PennyPilot/apps/api/src/services/cashflow.ts:12) → `sip-schedule.ts`
- [goals.ts:15](/home/udai/PennyPilot/apps/api/src/services/goals.ts:15) → `holdings.ts`
- [goals.ts:23](/home/udai/PennyPilot/apps/api/src/services/goals.ts:23) → `sip-commitments.ts`
- [inbox.ts:20](/home/udai/PennyPilot/apps/api/src/services/inbox.ts:20) → `sip-lifecycle.ts`
- [jobs/index.ts:11](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:11) → `networth.ts`

The source-aware zero-import claim is true. Neither report missed an import.

Because the ledger and credit module files are untracked in this same working tree, ordinary `git diff -- <new path>` cannot show their changes. Direct comparison of ledger `transactions.ts` against its HEAD flat predecessor showed module-migration import-depth changes, the investments import fix, and an allowed stale-location comment correction. The credit file is the product of the earlier `cards.ts` split, so there is no one-to-one HEAD file for a meaningful whole-file diff; direct inspection confirms its investments-related change is the `repairSnapshots` import.

## “Move, not rewrite”

Honored.

For the 11 moved non-SIP services:

- `mf-scheme-map.ts`, `tax-lots.ts`, and `xirr.ts` are byte-identical to their old versions.
- The other eight differ only in import paths/schema-boundary imports.
- `holdings.ts` and `capital-gains.ts` additionally contain the two explicitly permitted location-comment corrections.

For the four moved routes:

- `holdings.ts`, `networth.ts`, and `account-nps.ts` are byte-identical.
- `sips.ts` differs only by routing imports to the lifecycle/installment files and adjusting the cache import depth.

No unexplained logic or security behavior changed.

## SIP exact-export requirement

Correctly implemented.

`sip-installments.ts` imports all three helpers at [sip-installments.ts:15](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-installments.ts:15). Calls occur as required:

- `toSip` and `lastInstallmentDateFor`: [sip-installments.ts:314](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-installments.ts:314), [sip-installments.ts:346](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-installments.ts:346), and [sip-installments.ts:394](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-installments.ts:394)
- `ownedSip`: [sip-installments.ts:491](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-installments.ts:491)

No other formerly private SIP symbol was newly exported.

## Test results rerun during this review

- `npm run typecheck`: exit 0 across all workspaces.
- Root `npm run lint`: exit 0.
- Fourteen investments-related test files in one run: 285 tests, 285 passed, 0 failed. This comprises the 282 tests in the 12 resulting investments test files plus two schema tests and one plugin test.
- `node --test src/app.route-snapshot.test.ts`: 7/7 passed.
- `jobs/index.test.ts` plus `backup.test.ts`: 20/20 passed.
- The demo-403 test passed and performed the database no-mutation assertion.

I did not rerun root `npm run test`, because both independent reports already establish its only failure is the extractor environment prerequisite; nor did I run `db:generate`, because the review harness prohibited any command that might write generated files.

## Report discrepancies

There are no material implementation discrepancies between `implementation-1.md`, `verification-1.md`, and the current code.

Two precision caveats should be recorded:

1. “Zero remaining references” is true only for relative imports resolving to deleted paths. Six stale prose comments still name old paths.
2. The reports describe the root test suite as substantively green except for an unrelated environment failure, but TASK.md’s literal AC5/T3 wording requires an all-workspace exit code of 0. The recorded exit code is 1.

The verifier’s warning about `route-surface.snapshot.txt` is also valid: it is untracked, so an empty `git diff` is weak evidence by itself. The passing canonical route-surface runtime test is the meaningful gate.

## Final disposition

No additional implementation round is warranted: the investments migration code is ready.

For strict process compliance, perform one final verification rerun of `npm run test` with `DATABASE_URL` available to the extractor workspace. If that exits 0, mark task 010 COMPLETE. If the coordinator formally accepts the documented extractor failure as an unrelated pre-existing environment limitation, the task can be marked COMPLETE now with that waiver explicitly recorded.