# Revision 2 import-completeness audit

## Verdict

**Not implementation-ready. Another revision is required.**

The production-file count and the 20-row SIP section table are now substantially corrected, and the requested precision fixes are visibly present. However, the independent source audit found:

1. An eighth old colocated test file, `services/xirr.test.ts`, omitted from the plan.
2. Several imports of moved files absent from the supposedly full Root Cause §5(b)/(c) inventories.
3. Incorrect test-path and resulting-test counts caused by the missing `xirr.test.ts`.
4. An arithmetic error immediately below the otherwise accurate 20-row SIP mapping.

The cross-module production consumers highlighted by the requester—both `goals.ts` imports and the `inbox.ts` import—are now included. I found no additional still-flat production consumer comparable to those omissions. The remaining completeness defects concern in-domain production imports, tests, and `app.ts` route imports.

## 1. Independent import inventory

I searched the entire `apps/api/src` tree using:

- Broad searches for every one of the 16 bare filenames.
- Searches covering `./`, `../`, `../../`, and `../../../` relative depths.
- A source-aware scan of static imports, type imports, re-exports, and dynamic `import(...)`, resolving every relative specifier to the exact target path.

This produced **40 import statements** resolving to one of the 16 files.

Classification below uses:

- **Accounted §5(a)/(b):** explicitly represented in those Root Cause lists.
- **Accounted elsewhere:** covered by another visible plan section, but not §5(a)/(b).
- **Newly found:** absent from the claimed full Root Cause inventories.

### Route-file imports

| Importer | Imported old path | Classification |
|---|---|---|
| `apps/api/src/app.ts:27` | `./routes/sips.ts` | Accounted elsewhere in Scope/P7, but absent from §5(a)/(b) |
| `apps/api/src/app.ts:32` | `./routes/account-nps.ts` | Accounted elsewhere in Scope/P7, but absent from §5(a)/(b) |
| `apps/api/src/app.ts:34` | `./routes/holdings.ts` | Accounted elsewhere in Scope/P7, but absent from §5(a)/(b) |
| `apps/api/src/app.ts:35` | `./routes/networth.ts` | Accounted elsewhere in Scope/P7, but absent from §5(a)/(b) |

These four are not implementation omissions because `app.ts` is explicitly modified by P7. But a check literally limited to Root Cause §5(a)/(b) would not contain them.

### Route-to-service imports

| Importer | Imported old path | Classification |
|---|---|---|
| `routes/account-nps.ts:5` | `../services/account-nps.ts` | Accounted §5(a) |
| `routes/holdings.ts:22` | `../services/capital-gains.ts` | Accounted §5(a) |
| `routes/holdings.ts:23` | `../services/holding-details.ts` | Accounted §5(a) |
| `routes/holdings.ts:29` | `../services/holdings.ts` | Accounted §5(a) |
| `routes/holdings.ts:40` | `../services/mf-import.ts` | Accounted §5(a) |
| `routes/networth.ts:9` | `../services/networth.ts` | Accounted §5(a) |
| `routes/networth.ts:10` | `../services/goal-networth.ts` | Accounted §5(a) |
| `routes/sips.ts:14` | `../services/sips.ts` | Accounted §5(a) |

### External production consumers

| Importer | Imported old path | Classification |
|---|---|---|
| `jobs/index.ts:10` | `../services/networth.ts` | Accounted §5(a) |
| `modules/credit/services/reconciliation-writes.ts:9` | `../../../services/networth.ts` | Accounted §5(a) |
| `modules/ledger/services/transactions.ts:18` | `../../../services/sips.ts` | Accounted §5(a) |
| `services/cashflow.ts:12` | `./sips.ts` | Accounted §5(a) |
| `services/goals.ts:15` | `./holdings.ts` | Accounted §5(a) |
| `services/goals.ts:23` | `./sips.ts` | Accounted §5(a) |
| `services/inbox.ts:20` | `./sips.ts` | Accounted §5(a) |

This confirms that the revised plan now includes all four corrections emphasized in the request:

- `cashflow.ts:12`
- `goals.ts:15`
- `goals.ts:23`
- `inbox.ts:20`

I found **no further still-flat or already-migrated production consumer** of the 12 service files.

### Imports among moved production services

| Importer | Imported old path | Classification |
|---|---|---|
| `services/capital-gains.ts:5` | `./tax-lots.ts` | **Newly found: absent from §5(b)** |
| `services/goal-networth.ts:7` | `./holdings.ts` | Accounted §5(b) |
| `services/holdings.ts:18` | `./amfi.ts` | Accounted §5(b) |
| `services/holdings.ts:20` | `./tax-lots.ts` | Accounted §5(b) |
| `services/holdings.ts:21` | `./xirr.ts` | Accounted §5(b) |
| `services/mf-import.ts:6` | `./amfi.ts` | **Newly found: absent from §5(b)** |
| `services/mf-import.ts:7` | `./mf-scheme-map.ts` | Accounted §5(b) |
| `services/mf-import.ts:8` | `./holdings.ts` | **Newly found: absent from §5(b)** |
| `services/networth.ts:8` | `./holdings.ts` | **Newly found: absent from §5(b)** |
| `services/sips.ts:29` | `./holdings.ts` | Accounted §5(b) |

These four newly found imports remain valid sibling imports when all involved files move together, so they do not require different relative specifiers. Nevertheless, §5(b) labels itself a “full list” and is not complete. They should be added so implementation-time import classification covers every actual edge.

### Test imports

| Importer | Imported old path | Classification |
|---|---|---|
| `services/capital-gains.test.ts:3` | `./capital-gains.ts` | Accounted by §5(c)/Scope |
| `services/goal-networth.test.ts:4` | `./goal-networth.ts` | Accounted by §5(c)/Scope |
| `services/holdings.test.ts:3` | `./holdings.ts` | Accounted by §5(c)/Scope |
| `services/mf-import.test.ts:3` | `./mf-import.ts` | Accounted by §5(c)/Scope |
| `services/mf-import.test.ts:9` | `./mf-scheme-map.ts` | **Newly found: contradicts §5(c)’s same-named-only claim** |
| `services/mf-import.test.ts:10` | `./amfi.ts` | **Newly found: contradicts §5(c)’s same-named-only claim** |
| `services/mf-import.test.ts:11` | `./holdings.ts` | **Newly found: contradicts §5(c)’s same-named-only claim** |
| `services/networth.test.ts:8` | `./networth.ts` | Accounted by §5(c)/Scope |
| `services/sips.test.ts:5` | `./sips.ts` | Accounted by §5(c)/Scope |
| `services/tax-lots.test.ts:3` | `./tax-lots.ts` | Accounted by §5(c)/Scope |
| `services/xirr.test.ts:3` | `./xirr.ts` | **Newly found and omitted entirely from the plan** |

The `mf-import.test.ts` imports are not path-change hazards once the whole test and its dependencies move together, but the plan’s statement that every test imports only its same-named production file is false.

The `xirr.test.ts` omission is material: deleting or moving `services/xirr.ts` while leaving this test in its old location breaks its import.

### Import-completeness conclusion

The inventory is **not fully complete**.

There is no newly missed external production importer comparable to `goals.ts` or `inbox.ts`, but the plan still misses these actual imports:

- `apps/api/src/services/capital-gains.ts:5`
- `apps/api/src/services/mf-import.ts:6`
- `apps/api/src/services/mf-import.ts:8`
- `apps/api/src/services/networth.ts:8`
- `apps/api/src/services/mf-import.test.ts:9`
- `apps/api/src/services/mf-import.test.ts:10`
- `apps/api/src/services/mf-import.test.ts:11`
- `apps/api/src/services/xirr.test.ts:3`

The four `app.ts` route imports are covered elsewhere but should also be included if the intended inventory is every import of every deleted production path.

## 2. Old-path count audit

### Production paths

The plan’s corrected production count is accurate:

- 12 services:
  1. `holdings.ts`
  2. `sips.ts`
  3. `networth.ts`
  4. `goal-networth.ts`
  5. `holding-details.ts`
  6. `account-nps.ts`
  7. `capital-gains.ts`
  8. `tax-lots.ts`
  9. `mf-import.ts`
  10. `xirr.ts`
  11. `amfi.ts`
  12. `mf-scheme-map.ts`
- 4 routes:
  1. `holdings.ts`
  2. `sips.ts`
  3. `networth.ts`
  4. `account-nps.ts`

Therefore, **16 old production paths is correct**.

### Test locations

The plan claims seven old test locations:

- `holdings.test.ts`
- `sips.test.ts`
- `networth.test.ts`
- `goal-networth.test.ts`
- `capital-gains.test.ts`
- `tax-lots.test.ts`
- `mf-import.test.ts`

The filesystem contains an eighth directly associated test:

- `apps/api/src/services/xirr.test.ts`

It imports the moved `./xirr.ts` and therefore must move or have its import updated.

Correct counts are consequently:

- **8 old test-file locations**, not 7.
- **24 total old paths**, not 23.
- **7 ordinary moved tests**, not 6.
- **12 resulting investments test files**, not 11:
  - 7 ordinary moved tests
  - 4 files split from `sips.test.ts`
  - 1 new demo-mode test

This affects at least Scope, P4, P9, AC5, T10, T11, and T12.

## 3. `sips.test.ts` section mapping audit

The real file contains exactly **20** section-header comments. Every line number and verbatim header in the task’s 20-row table matches the source:

| # | Source line | Header |
|---|---:|---|
| 1 | 29 | `committedSplit / classifySipTarget` |
| 2 | 89 | `frequency monthlyization` |
| 3 | 121 | `firstOccurrenceOnOrAfter / nextSipDate` |
| 4 | 168 | `sipOccurrencesInWindow` |
| 5 | 195 | `quarterly / yearly anchoring` |
| 6 | 265 | `resolveTargetGoalDecision (Fix 1: target-goal reconciliation)` |
| 7 | 279 | `sipDateRangeValid (Fix 4: endDate >= startDate)` |
| 8 | 294 | `account target type gate (Fix 2: bank/cash can't be a SIP target)` |
| 9 | 321 | `resolveSipDateRange (Fix 4: resolved-pair validation on partial update)` |
| 10 | 355 | `resolveSipFundingTarget (payroll+mf_folio resolved-pair validation on partial update)` |
| 11 | 394 | `sipEditOrphansLinks (updateSip: detach installments the edit strands)` |
| 12 | 456 | `assertLinkRowsMatched (Fix 2: TOCTOU-safe conditional link)` |
| 13 | 469 | `isArchived (Fix 1: archived source/target must be rejected by SIP validation)` |
| 14 | 483 | `laterInstallmentDate (merging holding_events + transactions installments)` |
| 15 | 502 | `installmentDateError (recordSipInstallment: date must fall within the SIP's life)` |
| 16 | 534 | `lastOccurrenceOnOrBefore (mirror of firstOccurrenceOnOrAfter)` |
| 17 | 646 | `isUniqueViolation (Drizzle wraps driver errors — see lib/errors.ts pgError)` |
| 18 | 673 | `isCheckViolation (Drizzle wraps driver errors — see lib/errors.ts pgError)` |
| 19 | 700 | `dueInstallmentDate` |
| 20 | 912 | `linkInstallmentIssue / accountInstallmentSipIssue / candidateDateBounds` |

The table’s destination assignments also align with the tested functions and the proposed four seams.

However, the “Resulting distribution” sentence after the table is wrong. Based on its own rows, the correct distribution is:

- `sip-lifecycle.test.ts`: **11 sections**, #6–14, #17, and #18
- `sip-schedule.test.ts`: **5 sections**, #3, #4, #5, #16, and #19
- `sip-commitments.test.ts`: 2 sections, #1 and #2
- `sip-installments.test.ts`: 2 sections, #15 and #20

The task currently says lifecycle has 9 and schedule has 6. Its schedule list itself names only five sections, and the stated totals sum to 18 rather than 20.

Thus:

- The **20-row mapping itself is accurate**.
- The **summary distribution immediately below it is inaccurate** and must be corrected.

## 4. Review-1 precision-fix spot checks

The requested precision fixes are present in the visible plan text, not merely claimed in the changelog.

### Schema smoke-test scope

Applied correctly in Root Cause, Scope, P3, AC6, and T6:

- 8 tables
- 10 enums
- **18 object-identity assertions total**

### Outbound FK count

Applied correctly in Root Cause:

- `holdings.goalId`
- `accountNpsDetails.accountId`
- `sips.goalId`
- `sips.sourceAccountId`
- `sips.targetAccountId`

The visible text now correctly says **five**, not four.

### AC10 endpoint and strength

Applied correctly:

- Exact endpoint: `POST /api/net-worth/backfill`
- Expected response: 403
- Also requires proof that no `net_worth_snapshots` row was written or changed

This appears in Root Cause, Scope, P11, AC10, and T14.

### Other review-1 corrections visibly applied

The following are also present:

- T5 names `node --test src/app.route-snapshot.test.ts` and separately requires raw snapshot diff review.
- AC11 explicitly requires full-diff review for “move, not rewrite.”
- The original Non-Goal forbidding changes to `goals.ts` has been replaced with wording that allows its two import-path changes.
- Name-level SIP test accounting and relative-order preservation are required.

## 5. Required revision

Before implementation, the task should:

1. Add `apps/api/src/services/xirr.test.ts` to the moved tests.
2. Correct all derived counts:
   - 8 old test locations
   - 24 total old paths
   - 7 ordinary moved tests
   - 12 resulting investments test files
3. Update P4, P9, AC5, T10, T11, T12, Scope, and any other affected count.
4. Add the omitted in-domain imports to Root Cause §5(b):
   - `capital-gains.ts → tax-lots.ts`
   - `mf-import.ts → amfi.ts`
   - `mf-import.ts → holdings.ts`
   - `networth.ts → holdings.ts`
5. Correct §5(c):
   - Include `xirr.test.ts`.
   - Remove the false claim that every test imports only its same-named production file.
   - Record `mf-import.test.ts`’s imports of `mf-scheme-map.ts`, `amfi.ts`, and `holdings.ts`.
6. Correct the SIP distribution summary to 11 lifecycle, 5 schedule, 2 commitments, and 2 installments.
7. Preferably include `app.ts`’s four route imports in the exhaustive deleted-path import inventory, even though P7 already accounts for their update.

## Final assessment

- **(a) Cross-module inventory:** The important external-production inventory is now complete; no additional still-flat production consumer was found. The overall claimed exhaustive inventory is still incomplete because it omits four in-domain production edges, test edges, and `xirr.test.ts`.
- **(b) Counts:** 16 production paths is correct. Seven test paths and 23 total paths are not; the correct figures are 8 and 24. The 20-row SIP mapping is accurate, but its distribution summary is wrong.
- **(c) Precision fixes:** The enum scope, five-FK count, fixed AC10 endpoint/no-mutation assertion, executable T5 wording, and explicit no-behavior-change criterion are visibly applied.
- **(d) Readiness:** **Not implementation-ready.** Another focused revision is required.
- **(e) New finding:** `apps/api/src/services/xirr.test.ts:3` is the material newly missed file/import. If implementation followed the current plan, it could leave that test importing the deleted flat `services/xirr.ts`.