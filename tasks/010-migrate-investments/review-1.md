# Plan review — task 1.3 “Migrate investments module”

## Verdict

Not implementation-ready yet.

The central architecture is sound: the thin schema re-export, four-way SIP decomposition, single investments plugin, two route-identity gates, scheduler preservation, and `account-nps` ownership decision all follow the established ledger/credit precedent appropriately.

However, the plan contains two blocking completeness defects and several precision problems:

1. The supposedly exhaustive cross-module import inventory misses two real production importers of `sips.ts`: `services/cashflow.ts` and `services/goals.ts`. The latter directly contradicts the stated Non-Goal that `services/goals.ts` will not be touched.
2. All deletion/import-resolution counts omit the original `services/sips.ts`. There are 12 old service files and 16 old production paths, not 11 and 15.

There is also a concrete test-split error: `sips.test.ts` contains 20 section headers, not 21. The split is feasible, but “mechanically relocate each section verbatim” is not precise enough while the plan cites a nonexistent 21-row mapping and does not require name-level test accounting.

## 1. `account-nps` ownership and roadmap corrections

The ownership conflict is real.

The current roadmap files say:

- `tasks/01.03-migrate-investments.md`: Tables include `account_nps_details`, while Routes list only holdings, sips, and networth.
- `tasks/01.04-migrate-protection.md`: Routes include `account-nps`, while Tables include only `insurance_policies`, `insurance_health_cards`, and `retirement_details`.

Thus, the route/service and its table are currently assigned to different migrations.

Assigning `account-nps` to investments is well-reasoned:

- `account_nps_details` is already explicitly claimed by task 1.3.
- It uses the same `npsTier` enum and essentially the same NPS allocation fields as `nps_details`.
- Its service owns NPS account metadata; it does not participate in the protection module’s insurance-document, health-card, or retirement behavior.
- Task 1.4 has not started, so resolving the conflict now does not disturb completed work.
- Keeping the route, service, table surface, and enum in one module is materially cleaner than leaving task 1.3 with the table and task 1.4 with its API.

The proposed roadmap edits are directionally correct:

- Add `account-nps` to task 1.3’s Routes.
- Remove it from task 1.4’s Routes.
- Correct holdings from 13 to 16 endpoints.
- Name the previously omitted investments services.

The actual holdings route has 16 explicit route declarations, so the `13 → 16` correction is accurate.

One wording improvement would help: task 1.3 should identify the actual account-NPS HTTP surface, `GET/PUT /api/accounts/:accountId/nps-details`, rather than relying only on the filename `account-nps`. That makes the reassignment independently understandable from the roadmap.

## 2. Schema tables, enums, and FK inventory

The eight tables and ten enums named by the plan are correct.

### Tables

- `holdings`
- `accountNpsDetails`
- `npsDetails`
- `goldDetails`
- `holdingValuations`
- `holdingEvents`
- `sips`
- `netWorthSnapshots`

### Owned enums

- `assetClass`
- `gainsTaxClass`
- `npsTier`
- `goldForm`
- `holdingEventType`
- `holdingEventSource`
- `sipTargetKind`
- `sipStatus`
- `sipFundingSource`
- `sipFrequency`

`npsTier` is correctly counted once even though both NPS-detail tables use it.

The exact direct FK inventory in these eight tables is:

| Table | FK |
|---|---|
| `holdings` | `user_id → users.id` |
| `holdings` | `goal_id → goals.id`, `ON DELETE SET NULL` |
| `account_nps_details` | `account_id → accounts.id`, `ON DELETE CASCADE` |
| `account_nps_details` | `user_id → users.id` |
| `nps_details` | `holding_id → holdings.id`, `ON DELETE CASCADE` |
| `nps_details` | `user_id → users.id` |
| `gold_details` | `holding_id → holdings.id`, `ON DELETE CASCADE` |
| `gold_details` | `user_id → users.id` |
| `holding_valuations` | `holding_id → holdings.id`, `ON DELETE CASCADE` |
| `holding_events` | `holding_id → holdings.id`, `ON DELETE CASCADE` |
| `holding_events` | `sip_id → sips.id`, `ON DELETE SET NULL` |
| `sips` | `user_id → users.id` |
| `sips` | `goal_id → goals.id`, `ON DELETE CASCADE` |
| `sips` | `source_account_id → accounts.id` |
| `sips` | `target_holding_id → holdings.id`, `ON DELETE CASCADE` |
| `sips` | `target_account_id → accounts.id`, `ON DELETE CASCADE` |
| `net_worth_snapshots` | `user_id → users.id` |

The plan’s narrower statement about four outbound FK columns to still-flat non-core tables is correct:

- `holdings.goalId`
- `accountNpsDetails.accountId`
- `sips.goalId`
- `sips.sourceAccountId`
- `sips.targetAccountId`

That is actually five columns total, although the prose says “4 outbound FK columns” and then lists `holdings.goalId`, three SIP columns, and `accountNpsDetails.accountId`. The parenthetical says “3 to accounts/goals, plus accountNpsDetails,” but the SIP group itself contains three and `holdings.goalId` is another, yielding five.

This count should be corrected. The architectural conclusion is unaffected: physical relocation would still create cross-file FK dependencies, so the thin re-export is appropriate.

The one inbound FK from a still-flat table is also correct:

- `transactions.sip_id → sips.id`, `ON DELETE SET NULL`

`holding_events.sip_id → sips.id` is internal to the investments-owned table set, so it is not another inbound cross-module FK.

### Schema smoke-test convention

The planned `schema.smoke.test.ts` is weaker than the two precedents it claims to mirror.

Both existing smoke tests assert object identity for:

- every table, and
- every owned enum.

The investments plan repeatedly says “object-identity test for all 8 tables,” but does not require identity checks for the ten enums. Since `schema.ts` explicitly owns an 8-table plus 10-enum export surface and claims to mirror the ledger/credit pattern, the smoke test should cover all 18 bindings. AC6, T6, and the Scope description should be updated accordingly.

## 3. Four-way `sips.ts` split and internal exports

The four production seams are real and sensible:

- `sip-lifecycle.ts`: lifecycle/CRUD
- `sip-installments.ts`: installment recording and matching
- `sip-commitments.ts`: committed monthly goal-plan calculations
- `sip-schedule.ts`: date/cadence/cash-flow calculations

The fourth commitments seam is materially distinct from lifecycle, installment matching, and schedule math. It is better to identify it explicitly than to force it into one of the roadmap’s three named categories.

### Cross-seam calls

Against the actual `sips.ts`, the internal cross-seam export requirement is correct:

From `sip-installments.ts` to `sip-lifecycle.ts`:

- `toSip` — currently private, must become exported
- `lastInstallmentDateFor` — currently private, must become exported
- `ownedSip` — currently private, must become exported
- `isArchived` — already exported
- `isUniqueViolation` — already exported

From `sip-lifecycle.ts` to `sip-schedule.ts`:

- `dueInstallmentDate` — already exported

I found no additional currently-private function that must become exported between the four new production files. Seam B’s own constants and helpers remain internal to B, and the commitments and schedule seams are internally self-contained.

Thus the plan’s exact three-function new-export list is correct.

However, investigation-2’s “exhaustive” label should be qualified. It is exhaustive for calls among the four proposed seam ranges, but it was not exhaustive for consumers outside `sips.ts`; it explicitly left `committedForGoal` callers outside its scoped importer check. That limitation led directly to the missing production importers described below.

## 4. Blocking: missing cross-module import updates

The plan correctly identifies these importers:

- `routes/sips.ts`
- `modules/ledger/services/transactions.ts`
- `modules/credit/services/reconciliation-writes.ts`
- `jobs/index.ts`
- the other three moved investments route files

The two already-migrated-module paths are correct:

```ts
// modules/ledger/services/transactions.ts
import { isUniqueViolation } from "../../investments/services/sip-lifecycle.ts";

// modules/credit/services/reconciliation-writes.ts
import { repairSnapshots } from "../../investments/services/networth.ts";
```

The jobs path is also correct:

```ts
from "../modules/investments/services/networth.ts"
```

But two real production importers are missing.

### `services/cashflow.ts`

Current code:

```ts
import { sipOccurrencesInWindow } from "./sips.ts";
```

After the split, it must become:

```ts
import { sipOccurrencesInWindow } from "../modules/investments/services/sip-schedule.ts";
```

This is a still-flat consumer importing from the new investments module.

### `services/goals.ts`

Current code:

```ts
import { committedForGoal } from "./sips.ts";
```

After the split, it must become:

```ts
import { committedForGoal } from "../modules/investments/services/sip-commitments.ts";
```

This directly contradicts the Non-Goal:

> “Not touching `services/goals.ts` ... beyond the two already-migrated-module import-path fixes”

`services/goals.ts` must be touched or it will import a deleted file. Clean typechecking would catch the unresolved import eventually, but that does not make an incomplete plan acceptable—especially where AC7 claims the Root Cause inventory is complete.

Required corrections:

- Add both files to Root Cause §5(a).
- Add both to Modified files.
- Add both to P8 or a separate cross-import step.
- Remove or rewrite the `services/goals.ts` Non-Goal.
- Include them in AC7’s expected import inventory and positive-resolution evidence.

The two missed imports also show why the positive grep described in AC7 should not be cross-checked solely against the current Root Cause inventory until that inventory is corrected.

## 5. `sips.test.ts` split

The split is feasible, but the current plan is factually and procedurally imprecise.

### There are 20 sections, not 21

Directly counting the section headers in `sips.test.ts` gives 20:

1. `committedSplit / classifySipTarget`
2. `frequency monthlyization`
3. `firstOccurrenceOnOrAfter / nextSipDate`
4. `sipOccurrencesInWindow`
5. `quarterly / yearly anchoring`
6. `resolveTargetGoalDecision`
7. `sipDateRangeValid`
8. `account target type gate`
9. `resolveSipDateRange`
10. `resolveSipFundingTarget`
11. `sipEditOrphansLinks`
12. `assertLinkRowsMatched`
13. `isArchived`
14. `laterInstallmentDate`
15. `installmentDateError`
16. `lastOccurrenceOnOrBefore`
17. `isUniqueViolation`
18. `isCheckViolation`
19. `dueInstallmentDate`
20. `linkInstallmentIssue / accountInstallmentSipIssue / candidateDateBounds`

Both TASK.md and investigation-2 repeatedly call this a “21-section” mapping. That is incorrect.

### Is mechanical relocation sound?

Broadly yes, because:

- The file contains no shared DB harness.
- The tests exercise exported pure helpers.
- Each named section can be assigned to one production seam.
- No individual test block needs to be cut across files.
- Cross-seam production calls do not imply cross-seam test dependencies here.

But “mechanically relocate each section verbatim” is still underspecified:

- Imports must be rebuilt separately for each output file.
- The two `@compass/shared`-only sections need an explicit owner; lifecycle is a reasonable choice, but it is a classification decision rather than a mechanically derived seam.
- Section boundaries must be expressed by header/name, not fragile original line ranges, since imports or formatting can shift lines during implementation.
- Test names should be accounted for, not merely sections. Moving 20 blocks of source can still drop or duplicate a `test(...)` inside a large section.
- The plan should state whether section order inside each resulting file follows original relative order. Preserving relative order is the least surprising rule.

A sound replacement is:

- Correct “21” to “20.”
- Provide a 20-row header-to-file mapping.
- Preserve every section verbatim and preserve original relative order within each target file.
- Require an explicit mapping of every original top-level `test(...)` name to exactly one destination file, following the credit review precedent.
- Compare the old and new test-name multisets to prove no missing or duplicated cases.
- Permit only import-block changes and, if necessary, stale file/line-reference comment corrections.

The two shared-only sections can remain in `sip-lifecycle.test.ts`, but the plan should say that this is an explicit ownership choice based on the lifecycle validation behavior they characterize.

## 6. Demo-mode 403 acceptance criterion

AC10 is a legitimate narrow exception to “move, not rewrite.”

A repository-wide search confirms:

- There is no existing investments route-level test.
- The existing route-level demo-mode 403 coverage is in ledger and planning.
- None of `holdings`, `sips`, `networth`, or `account-nps` has a corresponding route test today.

Therefore, the claim that this domain lacks its own demo-write characterization is true.

`POST /api/net-worth/backfill` is a reasonable target:

- It is unambiguously mutating.
- It is within the moved investments plugin.
- A demo rejection should happen before its database behavior.
- It exercises the security/auth hook inheritance that a plugin restructuring could accidentally disturb.

The plan should fix the endpoint rather than leave “or equivalent” to implementation-time discretion. Acceptance criteria are easier to verify when they identify the exact route, method, expected 403, and ideally the no-database-effect assertion. The ledger precedent asserts both rejection and absence of mutation; this test should mirror that strength if practical.

This remains appropriately scoped as one characterization test, not a broader rewrite or security audit.

## 7. Scheduler claims

The scheduler description is accurate.

`jobs/index.ts` currently has:

- `const LEDGER_DAY_TZ = "Etc/UTC"`
- `networth.snapshot` in `LEDGER_DAY_SCHEDULERS`
- `networth.snapshot.close` in `LEDGER_DAY_SCHEDULERS`
- `networth.snapshot` registered at `30 0 * * *` with `tz: LEDGER_DAY_TZ`
- `networth.snapshot.close` registered at `5 0 * * *` with `tz: LEDGER_DAY_TZ`

`jobs/index.test.ts` verifies:

- the literal timezone constant,
- that every declared ledger-day scheduler uses `tz: LEDGER_DAY_TZ`,
- schedule classification completeness,
- clock ordering,
- the exact 00:30 and 00:05 expectations for the two net-worth schedulers.

Only changing the net-worth service import path is the correct migration behavior.

AC4 is sound, although T13’s stronger byte-identical scheduler-region review is useful because it detects unintended edits more directly than a broad test pass.

## 8. Blocking path-count errors

The plan moves or splits 12 old service files:

1. `holdings.ts`
2. `networth.ts`
3. `goal-networth.ts`
4. `holding-details.ts`
5. `account-nps.ts`
6. `capital-gains.ts`
7. `tax-lots.ts`
8. `mf-import.ts`
9. `xirr.ts`
10. `amfi.ts`
11. `mf-scheme-map.ts`
12. `sips.ts`

The plan repeatedly counts only 11 old service files because it counts the non-SIP services but fails to add the original `sips.ts`.

Consequences:

- Scope’s Deleted files description is wrong or ambiguous.
- P9 says delete 11 original service files; it must say 12.
- T11 says 15 deleted production paths, calculated as four routes plus 11 services; it must say 16.
- T12 similarly says 15 old production files; it must say 16.
- AC7’s deleted-path resolution set must include all 16 production paths.
- The total old paths are 16 production paths plus seven old test locations = 23 paths, not 22.

This is a blocking verification defect of the same class as the old-path-count defects caught in the prior migrations. A source-aware checker initialized with the plan’s stated 15-path set could pass while an import of the deleted flat `services/sips.ts` remained.

## 9. Verification-method findings

### Source-aware import-resolution check

The proposed method is conceptually correct and avoids the task 1.1 basename-grep mistake. It must:

- parse or otherwise find relative module specifiers,
- resolve them from each importing file,
- handle the repository’s explicit `.ts` extensions,
- compare normalized absolute resolved paths to the exact deleted-path set,
- include type-only imports,
- scan all relevant workspaces or at least all source files able to import API sources,
- fail on any specifier resolving to an old path.

It should not inspect only imports matching new `modules/investments` text, since missing or unexpected relative imports are precisely what the negative resolution check is intended to catch.

Once the deleted set is corrected to 16 production paths plus seven test paths, T11 is satisfiable.

### T5 is not a valid command as written

T5 says:

> “`node --test` on the regenerated raw-tree snapshot”

`route-table.snapshot.txt` is not a Node test file. The executable assertion lives in `app.route-snapshot.test.ts`.

T5 should name the actual test command, for example running `src/app.route-snapshot.test.ts`, and separately require review of the committed `route-table.snapshot.txt` diff. As written, it is not executable.

### Snapshot procedure

P2 and P10 are sound:

- capture/verify the pre-move canonical state,
- leave `route-surface.snapshot.txt` untouched,
- compare the post-move live surface against it,
- regenerate only the raw tree snapshot,
- review structural differences.

The plugin insertion at the earliest existing investments registration will move later investments routes earlier relative to intervening plugins. That is expected to alter tree organization/order without changing the canonical method/path set.

### Individual test accounting

T10’s “all 11 moved/split test files” phrasing is inaccurate:

- Six are moved.
- Four result from splitting one old file.
- One is newly created.

Call them 11 resulting investments test files, not 11 moved/split files. More importantly, the individual-run evidence should include the corrected test-name accounting for the four SIP test files.

## 10. Plan ordering

The broad dependency order is reasonable:

- roadmap clarification,
- baseline,
- schema,
- services,
- SIP split,
- routes,
- plugin/app registration,
- external importers,
- old-path cleanup,
- route gates,
- demo characterization,
- migration/backup/full gates.

A few refinements are warranted.

### P4/P5/P8 sequencing

Moving services before updating all consumers temporarily breaks the tree. That is acceptable if no intermediate full typecheck is promised, but P8 must include all four external consumers:

- ledger transactions,
- credit reconciliation writes,
- cashflow,
- goals,

plus jobs.

Alternatively, update each consumer immediately after its target service moves. That reduces the duration of an intentionally broken state but is not architecturally required.

### P9 is conceptually redundant after a real move

If P4–P6 use filesystem moves, the original paths disappear at those steps. P9 should be framed as old-path cleanup and explicit nonexistence confirmation rather than as the point when moved originals are first deleted. This is mostly wording, but it matters when evidence claims steps happened in a strict order.

### Demo test placement

P11 after plugin construction is sensible because it tests the final registration/hook structure. It could run before snapshot regeneration without consequence.

### Final gate

P14 is properly last.

## 11. Acceptance Criteria coverage

Most Plan items have corresponding acceptance criteria, but coverage is incomplete or inaccurate in these places:

- P1 is covered by AC9.
- P2/P10 are covered by AC1.
- P3 is covered by AC6, but the enum identity gap should be fixed.
- P4/P6/P8/P9 are intended to be covered by AC7, but AC7’s inventory and path count are currently incomplete.
- P5 is covered by AC2/AC5, but the incorrect 21-section description and lack of name-level test accounting weaken it.
- P7 is covered by AC8.
- P11 is covered by AC10.
- P12/P13 are covered by AC1.
- P14 is covered by AC5.

There is no explicit acceptance criterion requiring the four moved route handler files and eleven non-SIP service files to remain behaviorally unchanged beyond imports, although canonical routes and the full test suite provide indirect protection. Given the central “move, not rewrite” constraint, AC5 or AC7 should explicitly require full-diff review confirming no handler bodies or non-SIP service logic changed, apart from imports and stale location comments.

AC3’s exhaustiveness proof is also somewhat overstated. A passing typecheck proves the current `Record<AccountType, ...>` is exhaustive against the current union; the runtime test proves current mappings. Neither actively mutates `AccountType` to prove a hypothetical future member fails. The underlying TypeScript statement is nevertheless genuinely exhaustive, so a direct final-code read plus typecheck is reasonable evidence. The wording should say the declaration remains `Record<AccountType, AccountBucket | null>`, rather than suggesting the runtime test proves compile-time future-member failure.

## 12. Other findings

### Plugin test

One uniquely attributable route from each of four route files is consistent with the ledger/credit precedent and with AC8. Good candidate pairs would be:

- holdings: `GET /api/holdings`
- sips: `GET /api/sips`
- networth: `GET /api/net-worth`
- account-nps: `GET /api/accounts/:accountId/nps-details`

The account-NPS pair is particularly important because it proves the ownership correction was reflected in plugin registration.

### Route-surface coverage limit

The canonical route snapshot proves method/path identity, not handler identity, auth hooks, schemas, status codes, or response behavior. The plan generally respects this distinction. The demo test usefully covers one hook-inheritance case, but “URLs/handler bodies/status codes byte-identical” still depends primarily on disciplined diff review and existing tests. That limitation should remain explicit in implementation evidence.

### Comment-path updates

Several comments refer to `services/sips.ts`, `services/tax-lots.ts`, or similar flat paths. These do not affect imports, but stale architectural comments should be updated when they describe a concrete source location. This should be allowed as a location-comment correction, not treated as a behavior rewrite.

### `goal-networth.ts`

Moving `goal-networth.ts` with the networth route is reasonable. Its dependency on the planning-owned `goals` table and ledger `listAccounts` is an ordinary documented cross-module dependency. No additional route or external service importer was found for it.

## Required corrections before implementation

1. Add `services/cashflow.ts` as a consumer of `sipOccurrencesInWindow`, updated to `../modules/investments/services/sip-schedule.ts`.
2. Add `services/goals.ts` as a consumer of `committedForGoal`, updated to `../modules/investments/services/sip-commitments.ts`; remove the contradictory Non-Goal forbidding changes to `goals.ts`.
3. Correct all deleted-path counts to 12 services, four routes, and 16 production paths; with seven old test paths, the full old-path set is 23.
4. Correct the SIP test split from 21 sections to 20 and provide the actual 20-section mapping.
5. Add name-level accounting of every existing `sips.test.ts` test to exactly one resulting file, preserving relative section order and assertions.
6. Extend `schema.smoke.test.ts`, AC6, and T6 to check object identity for all ten enums as well as all eight tables.
7. Correct the outbound cross-module FK count: the listed columns total five, not four.
8. Replace T5’s invalid “`node --test` on the snapshot” wording with the actual `app.route-snapshot.test.ts` command plus a separate raw snapshot diff review.
9. Fix AC7’s “every import in Root Cause” inventory after adding the two missed consumers; ensure its source-aware checker uses the corrected exact deleted-path set.
10. Strengthen the move-not-rewrite evidence to require direct diff review of route handlers and non-SIP service bodies.
11. Prefer fixing AC10’s target to `POST /api/net-worth/backfill` and require the expected 403, rather than leaving “or equivalent” to implementation-time discretion.

## Final assessment

The architectural direction is good, and the most delicate internal decomposition—the four SIP production seams and the three newly required internal exports—is correct against the actual code. The `account-nps` ownership correction is also justified and should be made.

The plan is nevertheless not ready to implement because its completeness inventory misses two live production imports, one of which contradicts a Non-Goal, and because its old-path verification set omits `services/sips.ts` itself. Those are exactly the kinds of defects a migration plan’s import-resolution gate is supposed to prevent. Once those blockers, the 20-vs-21 test mapping, enum smoke coverage, and verification-command wording are corrected, the plan should be implementation-ready.