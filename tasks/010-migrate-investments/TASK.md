# Task: Migrate investments module

Corresponds to `tasks/01.03-migrate-investments.md` (roadmap id `1.3`, phase 1 — module migration,
release 2.0.0, `depends: [1.1]`). Tasks 1.1 (`tasks/007-migrate-ledger/`) and 1.2
(`tasks/008-migrate-credit/`) are both `COMPLETE` and merged, establishing the reusable template:
`modules/<domain>/{schema.ts, services/, routes/, plugin.ts}`; `schema.ts` is a **thin, named
re-export** (table definitions stay physically in `db/schema.ts` until task 1.9's FK-graph/SCC work);
a two-part route-identity gate (`route-surface.snapshot.txt` canonical method+path pairs, must never
change; `route-table.snapshot.txt` raw `printRoutes()` tree, expected to change/regenerate when
registration structure is intentionally restructured, diff reviewed not silently accepted); a
`schema.smoke.test.ts` object-identity pattern; a `plugin.test.ts` registration-completeness pattern
(route-lookup only, never `app.inject()`); a completeness-verification discipline that explicitly
avoids basename greps; and, from 1.2, precedent for splitting an oversized service file along natural
seams with an explicit cross-file export table where private functions are called across the split.
This task reuses all of that directly — none of it is re-derived here.

Two dedicated read-only investigations were run first (`investigation-1.md`: full domain survey —
routes, services, tables, FK graph, cross-imports, tests, scheduler, roadmap-accuracy check;
`investigation-2.md`: exhaustive cross-seam call graph inside `sips.ts`, the file this task must
decompose). Every claim below cites one of those two files rather than re-deriving facts.

## Status
COMPLETE

### Final disposition
`review-3.md` (Codex implementation review, independently re-derived every claim rather than trusting
`implementation-1.md`/`verification-1.md`): **no blocking findings.** Confirmed correct: all 11
acceptance criteria (AC1-AC11), all 14 plan items (P1-P14), the exact 3-function `sips.ts` cross-file
export requirement, all 7 cross-module import sites (re-derived independently a *third* time — zero
remaining references to any of the 16 deleted production paths, confirmed by three separate
independent resolvers now: the implementer's, the verifier's, and Codex's own), "move not rewrite"
honored across all 15 moved files (byte-identical or import-path-only diffs), and the new demo-403 test
correctly scoped and asserting both the 403 and the no-mutation condition.

Two non-blocking precision notes, both accepted as-is (no further action):
1. Six pre-existing comments elsewhere in the codebase (`services/imports.ts`, 4× `db/schema.ts`,
   found by a broad textual grep, not an import-resolution check) still name old flat file paths in
   prose — not imports, no runtime/compile effect, and pre-dating this task in most cases (these are
   the same class of "stale doc-comment drift" task 007 flagged and explicitly declined to chase down
   exhaustively). Not fixed here; cosmetic only.
2. **AC5/T3's literal "root `npm run test` exits 0" wording is formally waived, with evidence, rather
   than silently treated as met:** the root run exits 1 solely because `apps/extractor`'s own
   `package.json` `test` script is missing the `--env-file-if-exists=../../.env` flag every other
   workspace's script has — confirmed by a dedicated diagnostic (read-only, no files touched) that (a)
   compared `apps/extractor/package.json` against `apps/api/package.json` and found this exact one-line
   difference, (b) confirmed the repo-root `.env` already has a working `DATABASE_URL`, and (c)
   manually exported that value and re-ran `apps/extractor`'s suite directly — **63/63 pass, exit 0**,
   once the variable is present. This is a pre-existing, unrelated, one-line packaging gap in a
   workspace this task never touched (confirmed independently by the implementer, the verifier, Codex's
   review, and this final diagnostic — four separate checks, all agreeing). `apps/api` itself is
   837/837 green, including all 12 investments test files and the new demo-403 test. Not fixed as part
   of this task (out of scope — `apps/extractor` is untouched by the investments migration); worth a
   separate one-line follow-up task, flagged to the user rather than silently left undocumented.

All of AC1-AC11 verified true against the current code, independently, three times over (implementer +
verifier + Codex). Roadmap task `tasks/01.03-migrate-investments.md` and `tasks/README.md` updated to
`status: done` / "done" alongside this file.

### Changes since review-2
`review-2.md` — a narrow, independently-re-derived import-completeness audit (40 import statements to
the 16 moved files, found by re-grepping the whole tree directly rather than trusting any prior
document) — verdict: **not implementation-ready**, one more revision required. The good news first:
review-2 confirmed the **external** cross-module import inventory (the class of defect that could break
already-shipped `modules/ledger`/`modules/credit` code) is now complete — no further still-flat or
already-migrated-module production consumer was found beyond the four fixed in revision 2. All of
review-1's precision fixes (enum smoke-test scope, 5-not-4 FK count, `AC10`'s fixed endpoint + no-
mutation assertion, `T5`'s corrected command, `AC11`'s new no-behavior-change criterion) were confirmed
actually present in the visible text, not just claimed in a changelog. Remaining findings, all fixed
below:
1. **`apps/api/src/services/xirr.test.ts` (3 lines importing `./xirr.ts`) was omitted from the moved-test
   list entirely** — a real gap: left behind, it would import a deleted file. Added to Scope/P4/AC5/T10.
2. **Count corrections cascading from the missing test file**: **8** old test-file locations (not 7),
   **24** total old paths (not 23), **7** ordinary moved tests (not 6 — `xirr.test.ts` is the 7th),
   **12** resulting investments test files total (not 11 — 7 ordinary + 4 split + 1 new demo test).
   Applied to Scope, P4, P9, AC5, T10, T11, T12.
3. Root Cause §5(b) (in-domain production imports) was missing 4 real edges, added: `capital-gains.ts →
   tax-lots.ts`; `mf-import.ts → amfi.ts`; `mf-import.ts → holdings.ts`; `networth.ts → holdings.ts`.
   None require a different relative specifier than a plain sibling import once all four files move
   together, but the list is corrected for completeness since it labels itself exhaustive.
4. Root Cause §5(c) (test cross-imports) is corrected: it previously claimed every colocated test
   imports only its own same-named production file — false. `mf-import.test.ts` also imports
   `mf-scheme-map.ts` and `amfi.ts` (both in-domain, no path-target change) and `holdings.ts` (also
   in-domain). `xirr.test.ts` added to the list.
5. **Arithmetic error in the `sips.test.ts` split's "Resulting distribution" summary**, fixed: the
   20-row section→file table itself was independently re-verified correct against the real file
   (line-for-line), but the prose summary beneath it undercounted `sip-lifecycle.test.ts` at 9 sections
   when the table's own rows #17/#18 (`isUniqueViolation`/`isCheckViolation`) also route there — correct
   distribution is 11 lifecycle / 5 schedule / 2 commitments / 2 installments = 20.
6. `app.ts`'s four route-file imports (`sipRoutes`, `holdingRoutes`, `netWorthRoutes`,
   `accountNpsRoutes`) are already covered by Plan/Scope (P7, `app.ts` listed as Modified), confirmed by
   review-2 — no gap there, just not literally reachable by a check scoped only to §5(a)/(b)'s bullet
   list; no text change needed since Scope/P7 already own it.

Not sent back for a further Codex round: every fix above is either a direct transcription of review-2's
own exact, independently-re-derived finding, or (the distribution arithmetic) a fact re-verified
directly by the coordinator against review-2's own 20-row table. No fix in this round represents a new
judgment call.

### Changes since review-1
`review-1.md` verdict: not implementation-ready. Two blocking completeness defects (missing
cross-module importers; wrong old-path counts) plus several precision problems. **The coordinator's own
independent re-verification (grepping the whole tree directly, not trusting either investigation-1 or
review-1) found the import-completeness defect was worse than review-1 itself caught**: review-1 found
`services/cashflow.ts` and `services/goals.ts` (one import) missing; direct re-grep additionally found
`services/goals.ts` has a **second**, separate missing import (`getPortfolio` from `holdings.ts`, not
just `committedForGoal` from `sips.ts`) and `services/inbox.ts` (`isUniqueViolation` from `sips.ts`) —
neither caught by review-1. All fixed below, all four confirmed by direct `grep` re-run after the fix
(no remaining unaccounted `from ".../sips.ts"` / `.../holdings.ts"` / `.../networth.ts"` reference
anywhere in `apps/api/src` outside the already-enumerated set).
1. **Blocking — 4 missing cross-module import updates, not 2.** Full corrected list, all added to Root
   Cause §5(a)/Scope/P8/AC7 below:
   - `services/cashflow.ts:12` — `import { sipOccurrencesInWindow } from "./sips.ts";` → `from
     "../modules/investments/services/sip-schedule.ts";`
   - `services/goals.ts:23` — `import { committedForGoal } from "./sips.ts";` → `from
     "../modules/investments/services/sip-commitments.ts";`
   - `services/goals.ts:15` — `import { getPortfolio } from "./holdings.ts";` → `from
     "../modules/investments/services/holdings.ts";` (a second, separate import in the same file —
     found only by the coordinator's direct re-grep, not by review-1)
   - `services/inbox.ts:20` — `import { isUniqueViolation } from "./sips.ts";` → `from
     "../modules/investments/services/sip-lifecycle.ts";` (found only by the coordinator's direct
     re-grep, not by review-1)
   The Non-Goal claiming `services/goals.ts` would not be touched is removed — it directly contradicted
   two now-confirmed required edits.
2. **Blocking — old-path counts corrected.** `sips.ts` itself was omitted from every count. Corrected:
   **12** old service files (not 11), **16** old production paths (4 routes + 12 services, not 15),
   **23** total old paths including the 7 test-file locations (not 22). P9/T11/T12/AC7 all corrected.
3. `sips.test.ts` has **20** section headers, not 21 (direct `grep -c` re-count) — the exact 20-row
   mapping is now given verbatim (below), replacing the vaguer "21-section mapping" reference. Added:
   explicit requirement to account for every individual `test(...)` name (not just sections) across the
   old file vs. the four new files, and to preserve original relative order within each destination
   file — matches the precedent task 1.2's own review set for its own test-split accounting.
4. `schema.smoke.test.ts`/AC6/T6 widened to object-identity-check all **18** bindings (8 tables + 10
   enums), matching what `modules/ledger/schema.smoke.test.ts`/`modules/credit/schema.smoke.test.ts`
   actually do (both check enums too) — the original draft only required the 8 tables.
5. FK-count prose corrected: **5** outbound FK columns to still-flat non-core tables (`holdings.goalId`,
   `accountNpsDetails.accountId`, `sips.goalId`, `sips.sourceAccountId`, `sips.targetAccountId`), not 4
   — the architectural conclusion (thin re-export required) is unchanged.
6. T5 corrected from an invalid command ("`node --test` on the ... snapshot" — a `.txt` file is not a
   test file) to the actual executable check: `node --test src/app.route-snapshot.test.ts` plus a
   separate manual diff review of the regenerated `route-table.snapshot.txt`.
7. AC10 endpoint fixed explicitly to `POST /api/net-worth/backfill` (not "or equivalent" left to
   implementation-time discretion), and strengthened to require both the 403 response and confirmation
   the endpoint's underlying mutation did not run for the demo session — mirroring the strength of
   task 1.1's own precedent.
8. New AC (AC11) added requiring a full-diff review confirming no route-handler body or non-`sips.ts`
   service logic changed beyond import paths and stale location-comment corrections — the "move, not
   rewrite" guarantee was previously only indirectly implied by the route-snapshot/test-suite gates.
9. AC3's wording corrected: a passing `typecheck` + the existing runtime test proves the current
   `Record<AccountType, ...>` mapping is exhaustive and unchanged by the move; neither actively proves a
   *hypothetical future* unclassified member would fail to compile (that guarantee is inherent to
   `Record<...>`'s type signature itself, confirmed by direct code read, not demonstrated by mutating
   the union as part of this task).
10. T10 reworded from "11 moved/split test files" to "11 resulting investments test files (6 moved
    unmodified beyond imports + 4 split from `sips.test.ts` + 1 newly created)" — more precise per
    review-1's finding.
11. Roadmap-text edit (P1) for `tasks/01.03-migrate-investments.md` now also names the exact
    account-NPS HTTP surface (`GET/PUT /api/accounts/:accountId/nps-details`), not just the filename,
    per review-1's suggestion — makes the reassignment self-explanatory from the roadmap text alone.

## Objective
Move the investments domain — `holdings`, `sips` (split into 4 files along its natural seams),
`networth`, `goal-networth`, `holding-details`, `account-nps`, `capital-gains`, `tax-lots`,
`mf-import`, `xirr`, `amfi`, `mf-scheme-map` services, and their 4 route files (`holdings`, `sips`,
`networth`, `account-nps`) — into `modules/investments/{schema.ts, services/, routes/, plugin.ts}`,
replacing 4 flat `app.register(...)` calls with one `app.register(investmentsRoutes)`. Behaviour and
URLs stay byte-identical (this is a relocation, not a rewrite) with one narrow, explicitly-scoped
exception: adding one new demo-mode-403 characterization test, since none exists today for this domain
(see Root Cause's "Known traps" item). Update every cross-module import this move touches, including
two already-migrated files (`modules/ledger/services/transactions.ts`,
`modules/credit/services/reconciliation-writes.ts`) that import from `sips.ts`/`networth.ts` today.

## Root Cause
Not applicable — a planned refactor, not a bug fix. Investigated directly via two dedicated read-only
passes (`investigation-1.md`, `investigation-2.md`), key facts and decisions below.

### Scope decision 1 — `account-nps` belongs to this task, not task 1.4 (resolves a genuine cross-roadmap-file conflict)
`investigation-1.md` §9 item 7 found that `tasks/01.03-migrate-investments.md`'s own **Tables** line
already lists `account_nps_details`, while `tasks/01.04-migrate-protection.md`'s own **Routes** line
claims `"account-nps"` (`routes/account-nps.ts` + `services/account-nps.ts`) — the same table's
route/service pair is split across two different roadmap tasks' own text, with neither acknowledging
the other's claim. This is the same category of self-inconsistency task 1.1 found for `imports.ts` and
task 1.2 found for its endpoint count.

**Decision: `account-nps` (route + service + table, already in 1.3's own Tables list) is in scope for
this task, not deferred to 1.4.** Reasoning: `account_nps_details` is structurally identical to
`nps_details` (same shared `npsTier` enum, same equity/corporate/govt allocation-percentage shape,
`investigation-1.md` §3) — it is an NPS account variant, not protection-domain data; its own table is
already claimed by 1.3's text; and 1.4 has not started (`status: todo`), so resolving this now avoids
a real collision later rather than deferring an already-discovered conflict. `tasks/01.04-migrate-protection.md`'s
Routes line is corrected to remove `"account-nps"` (see Scope) — a factual correction of another task's
roadmap text, following the exact precedent task 1.1 set correcting its own "imports.ts" mention.

### Scope decision 2 — `goal-networth.ts` is in scope (ambiguous ownership, resolved toward investments)
`investigation-1.md` §9 item 6: `services/goal-networth.ts` (148 lines) is consumed exclusively by
`routes/networth.ts` (`netWorthByGoal`, backing `GET /api/net-worth/by-goal`) — no planning-domain file
imports it. It does read the planning-owned `goals` table and the already-migrated
`modules/ledger/services/accounts.ts`'s `listAccounts`, but that is an ordinary cross-module table/
service dependency of the same kind already accepted throughout 1.1/1.2 (documented, not fixed — see
Scope's "Explicitly not moved" precedent). **Decision: moves with investments**, because it is
structurally owned by an investments route and no other module currently imports it. Its cross-module
`goals` table read is inventoried, not resolved, exactly like 1.1/1.2's own direct-table-access
findings.

### Scope decision 3 — unnamed files that ARE in scope (roadmap prose gap, not a table/route gap)
`investigation-1.md` §2/§9 item 5: `holding-details.ts`, `capital-gains.ts`, `tax-lots.ts`,
`mf-import.ts`, `xirr.ts`, `amfi.ts`, `mf-scheme-map.ts` are all investments-domain files never named in
`01.03`'s prose, but every table/route they back (`nps_details`, `gold_details`, the `/api/holdings/*`
capital-gains and MF-import endpoints) is already in scope. Same category of gap as task 1.2's
`card-statements.ts`/`card-due-tasks.ts` — a missing filename, not a missing table. All are moved.

### Scope exclusion confirmed — `retirement.ts`/`retirement_details` stays with protection (1.4)
`investigation-1.md` §2/§9 item 8: despite the tempting name, `services/retirement.ts` (73 lines) and
its table `retirement_details` are protection-owned per `01.04`'s own Tables list, and no investments
file references either. Confirmed out of scope, no action needed.

### The central design decision: schema definitions do NOT physically move (same as 1.1/1.2)
`modules/investments/schema.ts` is a thin, named re-export of the 8 tables (`holdings`,
`accountNpsDetails`, `npsDetails`, `goldDetails`, `holdingValuations`, `holdingEvents`, `sips`,
`netWorthSnapshots`) + their 10 owned enums (`assetClass`, `gainsTaxClass`, `npsTier` — shared by both
`accountNpsDetails` and `npsDetails`, `goldForm`, `holdingEventType`, `holdingEventSource`,
`sipTargetKind`, `sipStatus`, `sipFundingSource`, `sipFrequency` — exact list from
`investigation-1.md` §3) from `../../db/schema.ts`, mirroring `modules/ledger/schema.ts` and
`modules/credit/schema.ts` exactly. Not physically relocated, for the same FK-cycle reason established
in 1.1: `investigation-1.md` §4, corrected per review-1 (the original draft's "4" undercounted by one),
found **5** outbound FK columns to still-flat tables — `holdings.goalId`, `accountNpsDetails.accountId`
(cascade), `sips.goalId`, `sips.sourceAccountId`, `sips.targetAccountId` — and exactly 1 inbound FK from a still-flat table
(`transactions.sipId → sips.id`, already flagged from the ledger side in task 007's own investigation
and re-confirmed here from the investments side). `db/schema.ts` does **not** `export *` back from
`modules/investments/schema.ts` — same reasoning as ledger/credit, avoids recreating a cycle.

**`schema.smoke.test.ts` scope, corrected per review-1**: both `modules/ledger/schema.smoke.test.ts`
and `modules/credit/schema.smoke.test.ts` assert object identity for every re-exported table **and**
every re-exported enum, not tables alone. This task's smoke test must do the same: object-identity
assertions for all **18** bindings (8 tables + 10 enums), not 8.

### `sips.ts` (1319 lines) — the 4-seam split, with the exact cross-file export requirement
The roadmap's own AC says "decomposed along date-math / lifecycle / installment-matching seams" — a
3-way split. `investigation-1.md` §2 found the file actually has **4** natural seams (its own
section-comment structure), the 4th ("committed monthly / goal-plan gap") not named by the roadmap's
3-way description:

| New file | Seam | Lines (orig.) | Approx. lines |
|---|---|---|---|
| `sip-lifecycle.ts` | Lifecycle/CRUD | 1-550 | ~550 |
| `sip-installments.ts` | Installment matching | 551-1039 | ~490 |
| `sip-commitments.ts` | Committed monthly (goal-plan gap) — **the 4th, roadmap-unnamed seam** | 1041-1126 | ~86 |
| `sip-schedule.ts` | Date-math / cash-flow | 1128-1319 | ~192 |

No file exceeds ~550 lines; the roadmap's AC for this task states no explicit per-file line ceiling
(unlike 1.2's task-specific "~500 lines" instruction for `cards.ts`), so `sip-lifecycle.ts`'s ~550 is
not further split.

**Exact cross-file export requirement, from `investigation-2.md`'s exhaustive per-identifier call-graph
check (§1, §2, "Summary") — must be applied verbatim or the split will not compile:**
- **`toSip`** (currently private, defined original line 34) — called from `sip-installments.ts`'s
  `linkSipInstallment` (orig. lines 841, 873) and `unlinkSipInstallment` (orig. line 921). **Must become
  exported** from `sip-lifecycle.ts`.
- **`lastInstallmentDateFor`** (currently private, orig. line 102) — called from the same three
  `sip-installments.ts` call sites. **Must become exported** from `sip-lifecycle.ts`.
- **`ownedSip`** (currently private, orig. line 117) — called from `sip-installments.ts`'s
  `listSipInstallmentCandidates` (orig. line 1018). **Must become exported** from `sip-lifecycle.ts`.
- `isArchived` and `isUniqueViolation` are also called cross-seam from `sip-installments.ts` but are
  **already exported** — no change needed, just a new import path.
- `sip-lifecycle.ts`'s own `toSip` calls `dueInstallmentDate` (already exported, `sip-schedule.ts`) —
  the only Seam-A→Seam-D edge in the file (`investigation-2.md` §1, "A → D").
- **No other cross-seam call exists in any of the other 9 directed pairs** — `sip-commitments.ts` and
  `sip-schedule.ts` are both fully self-contained in every direction, confirmed exhaustively by
  per-identifier grep, not inferred (`investigation-2.md` §1, D→A/B/C, C→A/B/D).

This gives the exact import list for `sip-installments.ts`: `toSip`, `lastInstallmentDateFor`,
`ownedSip`, `isArchived`, `isUniqueViolation` from `./sip-lifecycle.ts`. `sip-lifecycle.ts` itself
imports `dueInstallmentDate` from `./sip-schedule.ts`. `sip-commitments.ts` and `sip-schedule.ts`
import nothing from any other seam file.

`routes/sips.ts`'s single import (`investigation-2.md` §3, question 6) spans exactly `sip-lifecycle.ts`
(`createSip`, `deleteSip`, `listAllSips`, `listSipsForGoal`, `updateSip`) and `sip-installments.ts`
(`linkSipInstallment`, `listSipInstallmentCandidates`, `recordSipInstallment`,
`unlinkSipInstallment`) — split into two import statements when moved.

### `sips.test.ts` (1026 lines) — split follows the same 4 files, not kept whole
Unlike task 1.2's `cards.test.ts` (49 tests concentrated in only 3 of 6 production seams, which argued
against a blind mirror split), `sips.test.ts` has real, non-trivial test coverage in **all four** seams
— no seam is untested. The file's section-comment blocks are heavily **interleaved** by seam (not
grouped), but each section is internally self-contained (tests one named function/group), so each
section can be **mechanically relocated verbatim** to its matching new test file without reordering
logic or changing assertions — only cross-file import statements change.

**Section count corrected per review-1, re-verified directly by the coordinator (`grep -c "// ----------
"` against the real file): exactly 20 section headers, not 21** (`investigation-2.md`'s "21-section"
label was wrong — every other claim in that file was independently re-verified accurate). Exact
20-row section→file mapping, in original file order (line numbers are the section-header line, not the
full section range — use the header-name boundary, not a fixed line range, since imports/formatting
can shift lines during implementation, per review-1):

| # | Line | Section header (verbatim) | Destination file |
|---|---|---|---|
| 1 | 29 | `committedSplit / classifySipTarget` | `sip-commitments.test.ts` |
| 2 | 89 | `frequency monthlyization` | `sip-commitments.test.ts` |
| 3 | 121 | `firstOccurrenceOnOrAfter / nextSipDate` | `sip-schedule.test.ts` |
| 4 | 168 | `sipOccurrencesInWindow` | `sip-schedule.test.ts` |
| 5 | 195 | `quarterly / yearly anchoring` | `sip-schedule.test.ts` |
| 6 | 265 | `resolveTargetGoalDecision (Fix 1: target-goal reconciliation)` | `sip-lifecycle.test.ts` |
| 7 | 279 | `sipDateRangeValid (Fix 4: endDate >= startDate)` | `sip-lifecycle.test.ts` (tests only `@compass/shared`'s `sipDateRangeValid`, not a `sips.ts` export — placed here as an explicit ownership choice, since it characterizes lifecycle/update validation behavior, not because it imports a lifecycle-seam name) |
| 8 | 294 | `account target type gate (Fix 2: bank/cash can't be a SIP target)` | `sip-lifecycle.test.ts` (same reasoning — tests only `@compass/shared`'s `accountCanHaveGoal`) |
| 9 | 321 | `resolveSipDateRange (Fix 4: resolved-pair validation on partial update)` | `sip-lifecycle.test.ts` |
| 10 | 355 | `resolveSipFundingTarget (payroll+mf_folio resolved-pair validation on partial update)` | `sip-lifecycle.test.ts` |
| 11 | 394 | `sipEditOrphansLinks (updateSip: detach installments the edit strands)` | `sip-lifecycle.test.ts` |
| 12 | 456 | `assertLinkRowsMatched (Fix 2: TOCTOU-safe conditional link)` | `sip-lifecycle.test.ts` |
| 13 | 469 | `isArchived (Fix 1: archived source/target must be rejected by SIP validation)` | `sip-lifecycle.test.ts` |
| 14 | 483 | `laterInstallmentDate (merging holding_events + transactions installments)` | `sip-lifecycle.test.ts` |
| 15 | 502 | `installmentDateError (recordSipInstallment: date must fall within the SIP's life)` | `sip-installments.test.ts` |
| 16 | 534 | `lastOccurrenceOnOrBefore (mirror of firstOccurrenceOnOrAfter)` | `sip-schedule.test.ts` |
| 17 | 646 | `isUniqueViolation (Drizzle wraps driver errors — see lib/errors.ts pgError)` | `sip-lifecycle.test.ts` |
| 18 | 673 | `isCheckViolation (Drizzle wraps driver errors — see lib/errors.ts pgError)` | `sip-lifecycle.test.ts` |
| 19 | 700 | `dueInstallmentDate` | `sip-schedule.test.ts` (by far the largest single block, ~211 lines/22 tests) |
| 20 | 912 | `linkInstallmentIssue / accountInstallmentSipIssue / candidateDateBounds` | `sip-installments.test.ts` |

**Resulting distribution, corrected per review-2 (the original draft undercounted lifecycle by omitting
#17/#18 and mislabeled schedule's count):** `sip-lifecycle.test.ts` (**11** sections: #6-14, #17, #18 —
#17/#18 are `isUniqueViolation`/`isCheckViolation`, both destined for lifecycle per the table above, not
previously included in this summary sentence), `sip-schedule.test.ts` (**5** sections: #3, #4, #5, #16,
#19 — note #19 is non-adjacent to the file's other Seam-D sections, sitting after an intervening
lifecycle block), `sip-commitments.test.ts` (2 sections: #1, #2), `sip-installments.test.ts` (2
sections: #15, #20). Total: 11+5+2+2 = 20, matching the table.

**Additional requirements per review-1 (not just section relocation):**
- Every individual `test(...)`-name inside the old file must be mapped to exactly one destination file
  — a name-level accounting (old file's full test-name list vs. the four new files' combined test-name
  list, compared as multisets) proving zero tests dropped or duplicated, not just "20 sections moved."
- Original relative order is preserved **within** each destination file (the least-surprising rule,
  per review-1) — i.e. a destination file's sections appear in the same relative order they did in the
  original file, even though sections from other seams are skipped over.
- Only import-block changes and stale file/line-reference comment corrections are permitted — zero
  assertion changes.

**Known, pre-existing test gap, not introduced or worsened by this move** (`investigation-2.md` §3,
end of question 8): `sips.test.ts` tests only pure/exported helper functions from each seam — none of
the seams' DB-touching functions (`createSip`, `updateSip`, `deleteSip`, `listSipsForGoal`,
`listAllSips`, `recordSipInstallment`, `linkSipInstallment`, `unlinkSipInstallment`,
`listSipInstallmentCandidates`, `committedForGoal`) has direct test coverage today. Not fixed here —
same "preserve existing coverage exactly, don't close pre-existing gaps" rule task 1.1 stated
explicitly in its own Non-Goals.

### `networth.ts` (581 lines) — not decomposed, exhaustiveness mechanism confirmed
The roadmap's AC only requires the `ACCOUNT_BUCKET` exhaustiveness property survive the move and the
scheduler stay wired — no decomposition AC exists for this file (unlike `sips.ts`). `investigation-1.md`
§2 quotes the exact mechanism: `export const ACCOUNT_BUCKET: Record<AccountType, AccountBucket |
null> = {...}` (`networth.ts:19-48`) — TypeScript's `Record<AccountType, ...>` requires every union
member have a key, so a new `AccountType` added to `@compass/shared` without a corresponding entry here
fails to compile. This property is preserved automatically by a pure file move (the type-level
guarantee doesn't depend on the file's location) — proven by `schema.smoke.test.ts`-adjacent means: a
direct post-move read of the type declaration, plus the existing runtime test at
`networth.test.ts:24-36` continuing to pass unmodified from its new location.

### Net-worth daily scheduler — exact registration, must survive unchanged
`investigation-1.md` §7 quotes `jobs/index.ts:141-149` (`LEDGER_DAY_SCHEDULERS` array, includes
`"networth.snapshot"` and `"networth.snapshot.close"`) and `jobs/index.ts:188-203` (the two
`system.upsertJobScheduler(...)` calls, cron `"30 0 * * *"`/`"5 0 * * *"`, both `tz: LEDGER_DAY_TZ`,
`LEDGER_DAY_TZ = "Etc/UTC"` at line 131). `jobs/index.test.ts` source-text-regexes both the
`LEDGER_DAY_TZ` constant and every `LEDGER_DAY_SCHEDULERS` entry's registration string. This task only
changes `jobs/index.ts`'s **import path** for `closePreviousDay`/`isSystemicFailure`/`snapshotAllUsers`/
`SnapshotPassResult` (currently `from "../services/networth.ts"`, becomes
`from "../modules/investments/services/networth.ts"`) — the scheduler registration code itself,
`LEDGER_DAY_SCHEDULERS` array, and `LEDGER_DAY_TZ` constant are untouched.

### Cross-service imports that must be updated, both directions (`investigation-1.md` §5, corrected —
see "Changes since review-1" items 1-2 for what was missing in the first draft)
**(a) Files importing FROM an investments service today, non-test — full corrected list:** the 4 route
files themselves (`routes/holdings.ts` ← `services/{holdings,holding-details,capital-gains,
mf-import}.ts`; `routes/sips.ts` ← `services/sips.ts`; `routes/networth.ts` ← `services/{networth,
goal-networth}.ts`; `routes/account-nps.ts` ← `services/account-nps.ts`); `jobs/index.ts:10-15` (4
names from `networth.ts`); and **six** files outside the routes/jobs that need an import-path update —
two already-migrated modules, and four still-flat files (three of the four found only after review-1's
first pass, by the coordinator's own direct re-grep of the whole tree):
- `modules/ledger/services/transactions.ts:17-18` — `import { isUniqueViolation } from
  "../../../services/sips.ts";` (used in `updateTransaction`'s catch block, `transactions.ts:320`, to
  turn a `transactions_sip_date_idx` collision into a 409 instead of an unhandled 500). Becomes
  `import { isUniqueViolation } from "../../investments/services/sip-lifecycle.ts";` (same relative
  depth, `modules/X/services/` → `modules/Y/services/`, no `../../../` needed since both are two levels
  under `modules/`).
- `modules/credit/services/reconciliation-writes.ts:9` — `import { repairSnapshots } from
  "../../../services/networth.ts";` (used in `absorbCarryover`'s post-commit step). Becomes `import {
  repairSnapshots } from "../../investments/services/networth.ts";`, same reasoning.
- `services/cashflow.ts:12` — `import { sipOccurrencesInWindow } from "./sips.ts";` → `from
  "../modules/investments/services/sip-schedule.ts";` (still-flat file, stays flat — this task only
  updates its import path).
- `services/goals.ts:23` — `import { committedForGoal } from "./sips.ts";` → `from
  "../modules/investments/services/sip-commitments.ts";` (still-flat, stays flat).
- `services/goals.ts:15` — a **second, separate** import in the same file — `import { getPortfolio }
  from "./holdings.ts";` → `from "../modules/investments/services/holdings.ts";`.
- `services/inbox.ts:20` — `import { isUniqueViolation } from "./sips.ts";` → `from
  "../modules/investments/services/sip-lifecycle.ts";` (still-flat, stays flat).

Confirmed exhaustive for **external** (outside-the-domain) production consumers by two independent
passes: the coordinator's own direct `grep -rn` across `apps/api/src`, and `review-2.md`'s independent
40-import-statement re-derivation (its own separate grep strategy, covering bare-relative/`../`/`../../`
/`../../../` depths plus a source-aware static/type/dynamic-import scan) — both agree: no further
still-flat or already-migrated-module external consumer exists beyond the six listed here.

**(b) Investments files importing a still-flat sibling, a still-flat table, or infra** (corrected per
review-2 — 4 in-domain edges were missing from the original list; none require a different relative
specifier than a plain sibling import since all involved files move together, but the inventory must be
accurate since it labels itself full): `goal-networth.ts` → `listAccounts` from the already-moved
`modules/ledger/services/accounts.ts` (depth-adjust only) and `goals` from `db/schema.ts` (planning
table, stays flat, no path change — cross-module table reference, documented not fixed); `sips.ts`
(split files) → mixed `accounts`/`transactions` (ledger, stays flat) + `holdingEvents`/`holdings`/
`sips` (investments-owned, moves) from `db/schema.ts` — **split import required**, and must be
attributed to the correct new seam file(s) at implementation time (not assumed uniform); `sips.ts` →
`goal-allocation.ts` (shared, still-flat utility also used by planning's `goals.ts`/`goal-returns.ts` —
not moved, depth-adjust only) and `ownership.ts` (shared, still-flat, already consumed by 2
already-migrated modules — not moved, depth-adjust only); `holdings.ts` → `amfi.ts`, `tax-lots.ts`,
`xirr.ts` (all in-domain, move together, no path-target change beyond directory) and `ownership.ts`
(shared, not moved); `mf-import.ts` → `mf-scheme-map.ts` (in-domain); `account-nps.ts` →
`accountNpsDetails` (investments-owned, moves) + `accounts` (ledger, stays flat) — **split import**;
`sips.ts:29` → `nextSeqForDate` from `./holdings.ts` (in-domain, both files move into
`modules/investments/services/`, so this becomes a plain sibling import with the target's new location,
no cross-module split needed). **Four additional in-domain edges, found by `review-2.md`'s independent
re-grep, not in the original draft:** `capital-gains.ts:5` → `realizeGains` from `./tax-lots.ts`;
`mf-import.ts:6` → `fetchNavByCode`-adjacent helpers from `./amfi.ts`; `mf-import.ts:8` → a helper from
`./holdings.ts`; `networth.ts:8` → `portfolioValue` from `./holdings.ts`. All four are in-domain,
same-directory sibling imports once moved — no path-target change beyond the new shared directory.

**(c) Test files, corrected per review-2 (the original draft's "each imports only from its own
same-named production file" claim was false):** 7 ordinary colocated investments test files move
essentially unmodified beyond import paths — `holdings.test.ts`, `networth.test.ts`,
`goal-networth.test.ts`, `capital-gains.test.ts`, `tax-lots.test.ts`, `mf-import.test.ts`, and
**`xirr.test.ts`** (omitted from the original draft entirely — a real gap, since leaving it in place
while `xirr.ts` moves/deletes breaks its import) — plus `sips.test.ts`, split 4 ways (see below). Not
every one of the 7 imports only its own same-named file: `mf-import.test.ts` also imports
`MF_SCHEME_MAP`/`resolveScheme` from `./mf-scheme-map.ts` and `parseAmfiDate`/`parseNavAll` from
`./amfi.ts` (both in-domain siblings, no path-target change) plus a helper from `./holdings.ts` — all
three are in-domain, unaffected by relative depth once the whole domain moves together, but the
inventory must state this accurately rather than claim same-named-only.

### Demo-mode 403 — a real gap, not just a relocation-and-verify
`investigation-1.md` §8: `tasks/README.md`'s Known-traps entry (added by task 0.3, standing on every
1.1-1.8 migration) requires each module task verify demo-write protection survives its own plugin
restructuring "as their own acceptance criterion." Tasks 1.1/1.2 both satisfied this by proving an
**already-existing** route test still passes from its new location. **No such test exists today for
holdings/sips/networth/account-nps** — `find ... -iname "*.route.test.ts"` returns none for this
domain. This task therefore must **add** one new demo-mode-403 characterization test (not merely
relocate an existing one) — a narrow, explicitly-scoped exception to the "move, not rewrite" rule,
required by the standing Known-traps obligation rather than invented scope. **Target fixed per
review-1 (not left to implementation-time discretion): `POST /api/net-worth/backfill`** — unambiguously
mutating, sits inside the moved investments plugin, and a demo-session 403 must fire before the
endpoint's underlying `backfillSnapshots` mutation runs, exercising exactly the security/auth-hook
inheritance a plugin restructuring could accidentally disturb. The test must assert both (a) the 403
response itself and (b) that no `net_worth_snapshots` row was written/changed for the demo session as a
result of the attempted call — mirroring the strength of task 1.1's own `user-tasks.route.test.ts`
"AC12" precedent (reject + no-mutation), not just the status code alone.

## Scope

**New files:**
- `apps/api/src/modules/investments/schema.ts` — thin named re-export of the 8 tables + 10 enums (exact
  list in Root Cause) from `../../db/schema.ts`
- `apps/api/src/modules/investments/schema.smoke.test.ts` — object-identity test for all **18**
  bindings (8 tables + 10 enums, corrected per review-1), mirroring
  `modules/ledger/schema.smoke.test.ts`/`modules/credit/schema.smoke.test.ts`
- `apps/api/src/modules/investments/plugin.ts` — `investmentsRoutes(app)` registering all 4 route
  plugins (`holdings`, `sips`, `networth`, `account-nps`) internally, no prefix
- `apps/api/src/modules/investments/plugin.test.ts` — hermetic registration-completeness test, one
  uniquely-attributable (method, path) pair from **each** of the 4 internal route registrations, via
  route-lookup introspection only (never `app.inject()`), mirroring `modules/credit/plugin.test.ts`.
  Candidate pairs (per review-1): `GET /api/holdings` or `GET /api/portfolio` (holdings), `GET
  /api/sips` (sips), `GET /api/net-worth` (networth), `GET /api/accounts/:accountId/nps-details`
  (account-nps — proves the ownership correction actually landed in plugin registration)
- `apps/api/src/modules/investments/services/{holdings,networth,goal-networth,holding-details,
  account-nps,capital-gains,tax-lots,mf-import,xirr,amfi,mf-scheme-map}.ts` — 11 files, moved verbatim,
  imports reclassified/repointed per Root Cause
- `apps/api/src/modules/investments/services/{sip-lifecycle,sip-installments,sip-commitments,
  sip-schedule}.ts` — the 12th original service file (`sips.ts`) split along its 4 seams, with the
  exact 3-function export change from Root Cause applied
- `apps/api/src/modules/investments/routes/{holdings,sips,networth,account-nps}.ts` — moved verbatim,
  same URLs/handler bodies/status codes
- Colocated tests moved alongside: `holdings.test.ts`, `networth.test.ts`, `goal-networth.test.ts`,
  `capital-gains.test.ts`, `tax-lots.test.ts`, `mf-import.test.ts`, and **`xirr.test.ts`** (**7** files,
  unmodified beyond import paths — corrected per review-2, which found `xirr.test.ts` omitted entirely
  from the original draft), plus `sips.test.ts` split into `sip-lifecycle.test.ts`,
  `sip-installments.test.ts`, `sip-commitments.test.ts`, `sip-schedule.test.ts` per the exact **20-row**
  section mapping and name-level test accounting requirement in Root Cause (corrected from an earlier,
  wrong "21-section" claim)
- One new demo-mode-403 route test targeting `POST /api/net-worth/backfill` (exact file name decided at
  implementation time — see Root Cause's final section), asserting both the 403 and no underlying
  mutation

**Modified files:**
- `apps/api/src/app.ts` — 4 separate registrations (`sipRoutes`, `holdingRoutes`, `netWorthRoutes`,
  `accountNpsRoutes`) replaced by one `await app.register(investmentsRoutes)` at the position of the
  earliest of the four (`sipRoutes`, line 112)
- `apps/api/src/app.route-snapshot.test.ts` — no structural change (both gates already exist from 1.1);
  only the live comparison runs against the post-move `registerRoutes(app)`
- `apps/api/src/route-table.snapshot.txt` — regenerated (expected to change — 4 interleaved
  registrations collapse into 1 contiguous plugin call; diff reviewed in evidence, not silently
  accepted, exactly per 1.1/1.2's precedent)
- `apps/api/src/modules/ledger/services/transactions.ts` — import path for `isUniqueViolation` updated
  (Root Cause)
- `apps/api/src/modules/credit/services/reconciliation-writes.ts` — import path for `repairSnapshots`
  updated (Root Cause)
- `apps/api/src/services/cashflow.ts` — import path for `sipOccurrencesInWindow` updated (Root Cause;
  found only after review-1's first pass)
- `apps/api/src/services/goals.ts` — import paths for `committedForGoal` **and** (a separate import in
  the same file) `getPortfolio` both updated (Root Cause; found only after review-1's first pass — the
  original draft's Non-Goal claiming this file untouched is removed, see Non-Goals)
- `apps/api/src/services/inbox.ts` — import path for `isUniqueViolation` updated (Root Cause; found
  only after review-1's first pass)
- `apps/api/src/jobs/index.ts` — import path for `closePreviousDay`/`isSystemicFailure`/
  `snapshotAllUsers`/`SnapshotPassResult` updated; `LEDGER_DAY_SCHEDULERS`/`LEDGER_DAY_TZ`/scheduler
  registration code itself untouched
- `tasks/01.03-migrate-investments.md` — corrected: endpoint count "13" → "16"; Routes line gains
  `account-nps` and names its exact HTTP surface (`GET/PUT /api/accounts/:accountId/nps-details`);
  prose names the previously-unlisted files (`holding-details.ts`, `capital-gains.ts`, `tax-lots.ts`,
  `mf-import.ts`, `xirr.ts`, `amfi.ts`, `mf-scheme-map.ts`, `goal-networth.ts`)
- `tasks/01.04-migrate-protection.md` — Routes line corrected to remove `account-nps` (resolves the
  cross-task conflict identified in Root Cause; its Tables line already excluded
  `account_nps_details`, so this is a one-word Routes-line removal, not a rescoping of that task's own
  work)

**Deleted files:** the 4 original `apps/api/src/routes/{holdings,sips,networth,account-nps}.ts` and
**12** original `apps/api/src/services/*.ts` files listed above (`sips.ts` included — corrected per
review-1, the original draft undercounted this at 11) — moved, not duplicated — **16 production paths
total**, plus their **8** original colocated test-file locations (`xirr.test.ts` included — corrected
per review-2, the previous revision undercounted this at 7) — **24 old paths total**, corrected across
two revisions from an original "22".

**Not moved, and why (documented technical debt, same category as 1.1/1.2's own findings):**
- `services/goal-allocation.ts`, `services/ownership.ts` — shared still-flat utilities also consumed by
  planning-candidate files (`goals.ts`, `goal-returns.ts`) and, for `ownership.ts`, by two
  already-migrated modules. Stay flat; investments files' imports get depth-adjusted only.
- `services/retirement.ts`, `routes/retirement.ts`, `retirement_details` — confirmed protection-domain
  (1.4), out of scope (Root Cause).
- Direct/raw-SQL cross-module table access outside the moved services remains unchanged and
  out of scope, same as 1.1/1.2's own "Explicitly not moved" sections — not re-audited exhaustively
  here; task 1.9 owns that.

## Dependencies
- 1.1 (`tasks/007-migrate-ledger/`) — COMPLETE, merged (roadmap `depends: [1.1]`)
- 1.2 (`tasks/008-migrate-credit/`) — COMPLETE, merged (not a roadmap dependency, but this task's cross-
  import fixes touch its already-migrated files, so it must exist first — it does)

## Plan
- P1: Correct `tasks/01.03-migrate-investments.md`'s and `tasks/01.04-migrate-protection.md`'s prose
  (Root Cause's scope decisions 1/2/3) — done first so the rest of the plan is unambiguous.
- P2: Baseline — capture `printRoutes()` output and the canonical (method,url) list from the
  unmodified `registerRoutes()` (mirrors 1.1's P2 discipline; canonical list is expected identical to
  the current committed `route-surface.snapshot.txt`, since the surface itself doesn't change).
- P3: Create `modules/investments/schema.ts` (8 tables + 10 enums) + `schema.smoke.test.ts` (18
  object-identity assertions). Typecheck + smoke test pass with zero other changes.
- P4: Move the 11 non-`sips.ts` service files into `modules/investments/services/`, classifying and
  repointing every import per Root Cause §5b. Move their 7 colocated tests alongside (includes
  `xirr.test.ts`, corrected per review-2).
- P5: Split `sips.ts` into the 4 seam files per Root Cause's exact table and cross-file export list;
  split `sips.test.ts` into the 4 matching test files per Root Cause's exact 20-row section mapping,
  with the required name-level test-name accounting (old vs. new multiset comparison), zero assertion
  changes.
- P6: Move the 4 route files into `modules/investments/routes/`, same classify-and-repoint discipline,
  same URLs/handler bodies.
- P7: Create `modules/investments/plugin.ts` (registers all 4) + `plugin.test.ts` (one
  uniquely-attributable route per registration, route-lookup only). Update `app.ts`.
- P8: Update **all six** external cross-module imports (not just the two already-migrated modules):
  `modules/ledger/services/transactions.ts`, `modules/credit/services/reconciliation-writes.ts`,
  `services/cashflow.ts`, `services/goals.ts` (both its `committedForGoal` and `getPortfolio` imports),
  `services/inbox.ts`, and `jobs/index.ts`'s networth import — Root Cause's exact new paths for each.
- P9: Confirm the 4 original route files, 12 original service files, and 8 original test-file locations
  (includes `xirr.test.ts`) are gone (already removed as a byproduct of P4-P6's moves if done via `mv`;
  this step is nonexistence-confirmation and cleanup, not the first point of deletion, per review-1's
  wording correction).
- P10: Compare (not regenerate) the canonical snapshot against the untouched P2 baseline; separately
  regenerate `route-table.snapshot.txt`, diff pasted in evidence with the same 3-part reviewer checklist
  1.1/1.2 used (leaf content matches canonical set; only ordering/grouping/glyphs/nesting differs; no
  unexpected constraint/duplicate branch).
- P11: Add the one new demo-mode-403 characterization test targeting `POST /api/net-worth/backfill`
  (Root Cause's final section) — may run before or after P10 with no consequence (per review-1).
- P12: `npm run db:generate` — zero diff, content-hash manifest of `apps/api/drizzle/` before/after.
- P13: `backup.test.ts` — passes unmodified (all 8 tables already correctly classified per
  `investigation-1.md` §10, no `backup.ts` change needed).
- P14: Full gate — `npm run typecheck`, `npm run lint`, `npm run test` (all workspaces). Full `git diff`
  read directly to confirm every moved route/service file's behavior is unchanged beyond import paths
  and stale location-comment fixes (AC11).

## Acceptance Criteria
- AC1 (roadmap): canonical route-surface snapshot byte-identical before/after; raw
  `route-table.snapshot.txt` regenerated with diff reviewed in evidence (registration structure
  legitimately restructures); `npm run db:generate` zero diff (content-hash manifest); `backup.test.ts`
  green
- AC2 (roadmap, reinterpreted per Root Cause's 4-seam finding): `sips.ts` decomposed into
  `sip-lifecycle.ts`/`sip-installments.ts`/`sip-commitments.ts`/`sip-schedule.ts`, matching the
  roadmap's named date-math/lifecycle/installment-matching seams plus the 4th roadmap-unnamed
  committed-monthly seam, documented as such rather than silently added; the exact 3-function
  (`toSip`/`lastInstallmentDateFor`/`ownedSip`) export change applied, proven by clean `typecheck`
  (a missed export is a compile error) and a direct read of the final files
- AC3 (roadmap, wording corrected per review-1): `ACCOUNT_BUCKET`'s declaration remains
  `Record<AccountType, AccountBucket | null>`, unchanged by the move, confirmed by a direct read of the
  moved file plus a clean `typecheck` and `networth.test.ts`'s existing runtime test passing unmodified
  from its new location. This proves the current mapping is exhaustive and unchanged — the
  compile-time guarantee that a *future* unclassified `AccountType` member would fail to build is
  inherent to the `Record<...>` type signature itself (not something this task separately demonstrates
  by mutating the union)
- AC4 (roadmap): `networth.snapshot`/`networth.snapshot.close` still present in `LEDGER_DAY_SCHEDULERS`,
  still `tz: LEDGER_DAY_TZ`, `LEDGER_DAY_TZ` still `"Etc/UTC"` — proven by `jobs/index.test.ts`'s
  existing source-text-regex test passing unmodified (only the networth import line inside
  `jobs/index.ts` changes, not the scheduler code itself)
- AC5 (roadmap, count corrected per review-2): `npm run typecheck`/`lint`/`test` green across all
  workspaces, including every one of the **12** resulting investments test files (**7** moved
  unmodified beyond imports, `xirr.test.ts` included + 4 split from `sips.test.ts` + the new demo-403
  test) passing from its new location
- AC6 (this task, schema safety): no circular import — `modules/investments/schema.ts` only re-exports
  named bindings from `db/schema.ts`; `db/schema.ts` does not `export *` back; proven at runtime by
  `schema.smoke.test.ts`'s object-identity assertions for all **18** bindings (8 tables + 10 enums,
  corrected per review-1 — not tables alone)
- AC7 (this task, completeness — corrected per review-1's blocking finding): every cross-module import
  in Root Cause is updated, including all **six** external consumers (the two already-migrated modules
  plus `services/cashflow.ts`, `services/goals.ts` — both its imports — and `services/inbox.ts`,
  the four found only after the first review pass); proven by clean `typecheck` + a source-aware
  resolution check (not a basename grep — same corrected method 1.1's review-2 established) confirming
  no remaining relative import resolves to one of the **16** deleted flat production paths; positive
  grep for `from ".*modules/investments/(services|routes)/"` cross-checked against Root Cause's
  corrected file inventory as corroborating evidence only
- AC8 (this task, plugin completeness): `plugin.test.ts` asserts one uniquely-attributable route from
  each of the 4 internal route registrations via route-lookup introspection, not handler execution
- AC9 (this task, roadmap-text accuracy): `tasks/01.03-migrate-investments.md`'s endpoint count and
  file list corrected, and names the account-NPS HTTP surface explicitly;
  `tasks/01.04-migrate-protection.md`'s Routes line no longer claims `account-nps`
- AC10 (this task, demo-mode — standing Known-traps obligation, not previously satisfied for this
  domain, endpoint fixed per review-1 rather than left to implementation-time discretion): a new route
  test proves a demo session gets 403 on `POST /api/net-worth/backfill`, and that no
  `net_worth_snapshots` row was written/changed as a result — since no such test existed before this
  task
- AC11 (this task, "move not rewrite" guarantee, added per review-1 — previously only indirect):
  full-diff review confirms no route-handler body or non-`sips.ts` service logic changed beyond import
  paths and stale location-comment corrections; pasted in evidence, not merely asserted

## Verification
- T1: `npm run typecheck` — zero errors, all workspaces
- T2: `npm run lint` — zero errors
- T3: `npm run test` (root, all workspaces) — full pass, literal summary + exit code
- T4: Canonical-surface assertion in `app.route-snapshot.test.ts` — passes, byte-identical to P2's
  untouched baseline
- T5 (corrected per review-1 — the original wording named an invalid, non-executable command): `node
  --test src/app.route-snapshot.test.ts` — passes; separately, the regenerated raw-tree
  `route-table.snapshot.txt` is manually diff-reviewed against its pre-move capture, pasted in evidence
  with the 3-part reviewer checklist (leaf content matches canonical set; only
  ordering/grouping/glyphs/nesting differs; no unexpected constraint/duplicate branch)
- T6: `node --test src/modules/investments/schema.smoke.test.ts` — passes, all 18 bindings (8 tables +
  10 enums)
- T7: `node --test src/modules/investments/plugin.test.ts` — passes, all 4 registrations resolve
- T8: Content-hash manifest of `apps/api/drizzle/` before/after `db:generate` — identical
- T9: `backup.test.ts` — passes
- T10 (reworded per review-1, count corrected per review-2): all **12** resulting investments test
  files (**7** moved unmodified beyond imports, `xirr.test.ts` included + 4 split from `sips.test.ts` +
  1 newly created) run individually from their new `modules/investments/` location, plus the
  name-level test-name accounting for the 4 split files (old file's full test-name list vs. combined
  new-file test-name list, as multisets, zero dropped/duplicated) pasted in evidence
- T11 (corrected per review-1's blocking finding): source-aware import-resolution check (script, not
  grep) — zero remaining references to the **16** deleted flat production paths (4 routes + **12**
  services, `sips.ts` included) or their **8** original test locations (`xirr.test.ts` included,
  corrected per review-2); the checker's deleted-path set must be built from the corrected Root Cause
  inventory (all 6 external consumers plus the in-domain/test edges from §5b/§5c), not the original
  undercounted list
- T12: Direct confirmation the **16** old production files + **8** old test-file locations (**24**
  total) no longer exist on disk
- T13: Full `git diff` reviewed: no table definition in `db/schema.ts` changed (only re-exported);
  `tasks/01.03-migrate-investments.md` and `tasks/01.04-migrate-protection.md` changes match exactly
  what Root Cause/Scope describe; `jobs/index.ts`'s scheduler-registration code and
  `LEDGER_DAY_SCHEDULERS`/`LEDGER_DAY_TZ` are byte-identical, only the import line changed;
  `services/cashflow.ts`/`services/goals.ts`/`services/inbox.ts` show only their documented import-path
  line(s) changed, nothing else
- T14: New demo-403 test passes against `POST /api/net-worth/backfill`; both the 403 response and the
  no-mutation assertion pasted in evidence

## Non-Goals
- Not adding a Fastify route prefix — same standing deferral as 1.1/1.2.
- Not physically relocating the 8 tables' `pgTable(...)` definitions — task 1.9's job.
- Not fixing the pre-existing test gap that no `sips.ts` DB-touching function has direct test coverage
  (Root Cause) — preserves existing coverage exactly, doesn't close gaps, same rule task 1.1 stated.
- Not moving `goal-allocation.ts`, `ownership.ts`, `retirement.ts`/`routes/retirement.ts` — Root Cause/
  Scope explain why each stays.
- Not moving `services/goals.ts`, `services/cashflow.ts`, `services/inbox.ts`, or
  `services/goal-returns.ts` (all stay flat, all are planning/ingest-candidate files for later tasks) —
  but **not** "not touching" them: `goals.ts`, `cashflow.ts`, and `inbox.ts` each get a one- or
  two-line import-path fix per Root Cause/Scope (corrected from the original draft, which wrongly
  claimed `goals.ts` would be untouched — a real defect review-1 caught). Beyond those import-path
  fixes, no logic in any of the four files changes, and the `goals`-table read from `goal-networth.ts`
  remains documented, unchanged cross-module access.
- Not auditing or fixing direct/raw-SQL cross-module table access beyond what Root Cause documents —
  task 1.9's job, same as 1.1/1.2.
- Not adding demo-mode/auth characterization beyond the one new AC10 test — full security-scope
  characterization across all of 1.1-1.8 remains `tasks/README.md`'s standing obligation, not
  discharged in full by this one task.
