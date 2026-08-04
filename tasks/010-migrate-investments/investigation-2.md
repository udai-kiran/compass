# Investigation 2 — exact cross-seam call graph for `apps/api/src/services/sips.ts`

Read-only investigation. No files changed. Follow-up to `tasks/010-migrate-investments/investigation-1.md` §2's "`sips.ts` (1319 lines) — full read, seam analysis" (its four seams A/B/C/D, exact line ranges reproduced from there). This pass re-reads the full 1319-line file directly and, for every function/const body in each seam, checks every call site against every other seam's definitions — exhaustively, not by sampling — using both a manual read and a `grep -n` pass per identifier as a cross-check (both agree; grep output is quoted below).

Files inspected: `apps/api/src/services/sips.ts` (full, all 1319 lines), `apps/api/src/routes/sips.ts` (full, 122 lines), `apps/api/src/services/sips.test.ts` (import block lines 1-27, and every `test(`/section-header line via `grep -n`, 1026 lines total), `apps/api/src/modules/ledger/services/transactions.ts:18` (grep-confirmed import line only), `tasks/010-migrate-investments/investigation-1.md` (§2, full section reread).

Seam definitions (from investigation-1, reproduced for reference):
- **Seam A — Lifecycle/CRUD**, lines 1-550.
- **Seam B — Installment matching**, lines 551-1039.
- **Seam C — Committed monthly (goal-plan gap)**, lines 1041-1126.
- **Seam D — Date-math/cash-flow**, lines 1128-1319.

---

## 1. Cross-seam call graph, all 12 directed pairs

### A → B: none found
No function body in lines 1-550 calls any identifier defined in lines 551-1039 (`installmentDateError`, `accountInstallmentSipIssue`, `linkInstallmentIssue`, `candidateDateBounds`, `INSTALLMENT_CANDIDATE_LIMIT`, `recordSipInstallment`, `linkSipInstallment`, `unlinkSipInstallment`, `linkedInstallmentRows`, `unlinkedInstallmentRows`, `listSipInstallmentCandidates`). Confirmed by grepping every Seam B identifier's call sites (below, §2) — none land between lines 1-550.

### A → C: none found
No function body in lines 1-550 calls `ClassifiableSip`, `monthlyEquivalentPaise`, `committedSplit`, `classifySipTarget`, or `committedForGoal` (all confirmed by grep, §2 below — every call site of these five names is inside 1041-1126 itself, i.e. Seam C internal).

### A → D: exactly one call site
- **`toSip` (Seam A, defined 34-52) calls `dueInstallmentDate` (Seam D, defined 1243-1261) at line 50**:
  ```
  50:    dueInstallmentDate: dueInstallmentDate(s, lastInstallmentDate, today),
  ```
  This is the only Seam-A-to-Seam-D call anywhere in the file. Grepped every other Seam-D identifier (`pad`, `nextSipDate`, `firstOccurrenceOnOrAfter`, `lastOccurrenceOnOrBefore`, `sipOccurrencesInWindow`, `occurrenceMonthStart`, `monthIndex`, `dateFromMonthIndex`, `FREQUENCY_STEP_MONTHS`, `dayAfter`) — every call site of each is inside lines 1128-1319 (Seam D internal); none is called from Seam A. See §2's full per-identifier grep output for the exhaustive list of every call site of every Seam D identifier.

  Since `toSip` (Seam A) is itself called from Seam B three times (line 841, 873, 921 — see B→A below), this single A→D edge transitively means Seam B's `linkSipInstallment`/`unlinkSipInstallment` indirectly execute Seam-D logic through `toSip`, without calling any Seam-D name directly themselves.

### B → A: five distinct call sites, three distinct private targets
| Call site (Seam B) | Target (Seam A) | Target def line | Currently exported? |
|---|---|---|---|
| `recordSipInstallment` line 705: `if (isArchived(holding.archivedAt))` | `isArchived` | 128 | yes |
| `recordSipInstallment` line 763: `if (isUniqueViolation(err, "holding_events_sip_date_idx"))` | `isUniqueViolation` | 61 | yes |
| `linkSipInstallment` line 841: `return toSip(sip, await lastInstallmentDateFor(tx, sipId));` | `toSip` **and** `lastInstallmentDateFor` | 34 / 102 | **`toSip`: NO** / **`lastInstallmentDateFor`: NO** |
| `linkSipInstallment` line 863: `if (isUniqueViolation(err, "transactions_sip_date_idx"))` | `isUniqueViolation` | 61 | yes |
| `linkSipInstallment` line 873: `return toSip(sip, await lastInstallmentDateFor(tx, sipId));` | `toSip` **and** `lastInstallmentDateFor` | 34 / 102 | **NO / NO** |
| `unlinkSipInstallment` line 921: `return toSip(sip, await lastInstallmentDateFor(tx, sipId));` | `toSip` **and** `lastInstallmentDateFor` | 34 / 102 | **NO / NO** |
| `listSipInstallmentCandidates` line 1018: `const sip = await ownedSip(db, userId, sipId);` | `ownedSip` | 117 | **NO** |

Exhaustive grep confirmation for the three private targets:
```
=== toSip ===
34:function toSip(s: SipRow, lastInstallmentDate: string | null, today: string = todayInIST()): Sip {
393:  return rows.map((r) => toSip(r.sip, laterInstallmentDate(r.lastHoldingEventDate, r.lastTransactionDate)));
423:    return toSip(rows[0]!, null);
539:    return toSip(rows[0]!, lastInstallmentDate);
841:      return toSip(sip, await lastInstallmentDateFor(tx, sipId));
873:    return toSip(sip, await lastInstallmentDateFor(tx, sipId));
921:    return toSip(sip, await lastInstallmentDateFor(tx, sipId));

=== lastInstallmentDateFor ===
102:async function lastInstallmentDateFor(db: DbOrTx, sipId: string): Promise<string | null> {
538:    const lastInstallmentDate = await lastInstallmentDateFor(tx, id);
841:      return toSip(sip, await lastInstallmentDateFor(tx, sipId));
873:    return toSip(sip, await lastInstallmentDateFor(tx, sipId));
921:    return toSip(sip, await lastInstallmentDateFor(tx, sipId));

=== ownedSip ===
117:async function ownedSip(db: Db, userId: string, id: string): Promise<SipRow> {
441:  const current = await ownedSip(db, userId, id);
1018:  const sip = await ownedSip(db, userId, sipId);
```
Lines 393/423/539/441 are the intra-Seam-A call sites (not cross-seam); lines 841/873/921/1018 (all inside Seam B's 551-1039 range) are the cross-seam ones.

### B → C: none found
No function in 551-1039 calls `monthlyEquivalentPaise`, `committedSplit`, `classifySipTarget`, `committedForGoal`, or references `ClassifiableSip`. Confirmed by the same per-identifier grep in §2 — all four functions' only non-definition call sites are inside 1041-1126 (Seam C internal, `committedForGoal` calling `classifySipTarget` at 1116 and `committedSplit` at 1125).

### B → D: none found
No function in 551-1039 calls any Seam D identifier (`pad`, `monthIndex`, `dateFromMonthIndex`, `firstOccurrenceOnOrAfter`, `lastOccurrenceOnOrBefore`, `occurrenceMonthStart`, `dueInstallmentDate`, `nextSipDate`, `dayAfter`, `sipOccurrencesInWindow`, `FREQUENCY_STEP_MONTHS`). `installmentDateError` (Seam B, pure) does its own inline ISO-string comparison (`date < sip.startDate`, `date > sip.endDate`) rather than calling any Seam-D date-math helper — confirmed by reading its body (559-563) and by the per-identifier grep in §2 (every Seam-D identifier's call sites are self-contained inside 1128-1319).

### C → A: none found
`committedForGoal` (1094-1126, the only DB-touching function in Seam C) queries `sips`/`holdings`/`accounts` directly via Drizzle, and calls only `classifySipTarget` (1116) and `committedSplit` (1125) — both Seam C. No call to `ownedSip`, `isArchived`, `toSip`, `lockedAccountForSip`, or any other Seam A name.

### C → B: none found
No Seam C function calls `installmentDateError`, `accountInstallmentSipIssue`, `linkInstallmentIssue`, `candidateDateBounds`, or any Seam B function.

### C → D: none found
No Seam C function calls any Seam D identifier. `monthlyEquivalentPaise` (1055-1059) does its own arithmetic (`Math.round(amountPaise / 3)` etc.) rather than delegating to any Seam-D month-math helper.

### D → A: none found
### D → B: none found
### D → C: none found
Confirmed directly (not merely inferred from investigation-1's claim): every one of Seam D's eleven names — `pad` (1130), `FREQUENCY_STEP_MONTHS` (1135), `monthIndex` (1138), `dateFromMonthIndex` (1143), `firstOccurrenceOnOrAfter` (1158), `lastOccurrenceOnOrBefore` (1187), `occurrenceMonthStart` (1215), `dueInstallmentDate` (1243), `nextSipDate` (1269), `dayAfter` (1286), `sipOccurrencesInWindow` (1299) — was grepped individually; every call site of every one of them falls between lines 1130 and 1319 (Seam D's own range), touching only other Seam D names, `String`/`Math`/`Date` built-ins, or its own parameters. **Investigation-1's claim that Seam D is fully self-contained and pure (no `db`/`tx` parameter, no cross-file dependency) is confirmed exactly, not merely restated** — see the full per-identifier grep output in §2.

---

## 2. Full per-identifier grep output (exhaustive basis for §1)

Seam A identifiers (`grep -n "\bNAME("` against the whole file):
```
=== toSip ===          34 (def), 393, 423, 539 (Seam A call sites), 841, 873, 921 (Seam B call sites)
=== isUniqueViolation ===  61 (def, exported), 763, 863 (both Seam B call sites)
=== isCheckViolation ===   74 (def, exported), 500 (Seam A call site — intra-seam)
=== laterInstallmentDate === 88 (def, exported), 111, 393 (both Seam A — intra-seam)
=== lastInstallmentDateFor === 102 (def), 538 (Seam A), 841, 873, 921 (Seam B call sites)
=== ownedSip ===        117 (def), 441 (Seam A), 1018 (Seam B call site)
=== isArchived ===      128 (def, exported), 163, 191, 215 (Seam A — intra-seam), 705 (Seam B call site)
=== lockedAccountForSip === 140 (def), 161, 189 (both Seam A — intra-seam; no cross-seam callers)
=== assertBankSource ===   160 (def), 419, 466 (both Seam A — intra-seam; no cross-seam callers)
=== assertAccountTargetType === 180 (def), 361, 484 (both Seam A — intra-seam; no cross-seam callers)
=== ownedHoldingGoal ===   207 (def), 360 (Seam A — intra-seam; no cross-seam callers)
=== resolveTargetGoalDecision === 230 (def, exported), 363 (Seam A — intra-seam)
=== resolveSipDateRange ===  244 (def, exported), 448 (Seam A — intra-seam)
=== resolveSipFundingTarget === 264 (def, exported), 456 (Seam A — intra-seam)
=== sipEditOrphansLinks === 285 (def, exported), 510 (Seam A — intra-seam)
=== assertLinkRowsMatched === 303 (def, exported), 334, 341 (both Seam A — intra-seam)
=== linkTargetToGoal ===   320 (def), 368 (Seam A — intra-seam; no cross-seam callers)
=== assertAndLinkTarget ===  351 (def), 420, 471 (both Seam A — intra-seam; no cross-seam callers)
=== listSipsWhere ===    383 (def), 397, 406 (both Seam A — intra-seam; no cross-seam callers)
=== listSipsForGoal ===   396 (def, exported; no in-file callers — used only by routes/sips.ts)
=== listAllSips ===     405 (def, exported; no in-file callers — used only by routes/sips.ts)
=== createSip ===      409 (def, exported; no in-file callers)
=== updateSip ===      439 (def, exported; no in-file callers)
=== deleteSip ===      543 (def, exported; no in-file callers)
```

Seam B identifiers:
```
=== installmentDateError ===   559 (def, exported), 627, 732 (both Seam B — intra-seam; no cross-seam callers)
=== accountInstallmentSipIssue === 572 (def, exported), 613, 1019 (both Seam B — intra-seam)
=== linkInstallmentIssue ===   602 (def, exported), 834 (Seam B — intra-seam; no cross-seam callers)
=== candidateDateBounds ===   641 (def, exported), 1033 (Seam B — intra-seam; no cross-seam callers)
=== recordSipInstallment ===   658 (def, exported; no in-file callers — used only by routes/sips.ts)
=== linkSipInstallment ===    787 (def, exported; no in-file callers)
=== unlinkSipInstallment ===   883 (def, exported; no in-file callers)
=== linkedInstallmentRows ===  944 (def), 1032 (Seam B — intra-seam; no cross-seam callers)
=== unlinkedInstallmentRows === 970 (def), 1033 (Seam B — intra-seam; no cross-seam callers)
=== listSipInstallmentCandidates === 1012 (def, exported; no in-file callers)
```

Seam C identifiers:
```
=== ClassifiableSip ===     1043 (def, exported interface), 1063, 1113 (both Seam C — intra-seam)
=== monthlyEquivalentPaise === 1055 (def, exported), 1068 (Seam C — intra-seam; no cross-seam callers)
=== committedSplit ===     1062 (def, exported), 1125 (Seam C — intra-seam; no cross-seam callers)
=== classifySipTarget ===   1077 (def, exported), 1116 (Seam C — intra-seam; no cross-seam callers)
=== committedForGoal ===    1094 (def, exported; no in-file callers — used only by callers outside sips.ts, not investigated further here as it's out of the routes/sips.ts + transactions.ts cross-import scope in §4/§5)
```

Seam D identifiers:
```
=== pad ===             1130 (def), 1146 (×2, Seam D — intra-seam; no cross-seam callers)
=== monthIndex ===        1138 (def), 1166, 1169, 1194, 1197, 1216 (all Seam D — intra-seam)
=== dateFromMonthIndex ===   1143 (def), 1174, 1201, 1216 (all Seam D — intra-seam)
=== firstOccurrenceOnOrAfter === 1158 (def, exported), 1281, 1315 (both Seam D — intra-seam)
=== lastOccurrenceOnOrBefore === 1187 (def, exported), 1257 (Seam D — intra-seam; no cross-seam callers)
=== occurrenceMonthStart ===  1215 (def), 1259 (Seam D — intra-seam; no cross-seam callers)
=== dueInstallmentDate ===   50 (Seam A call site, toSip), 1243 (def, exported)
=== nextSipDate ===       1269 (def, exported), 1311 (Seam D — intra-seam; no cross-seam callers)
=== dayAfter ===         1286 (def), 1315 (Seam D — intra-seam; no cross-seam callers)
=== sipOccurrencesInWindow === 1299 (def, exported; no in-file callers)
=== FREQUENCY_STEP_MONTHS === 1135 (def), 1164, 1192 (both Seam D — intra-seam)
```

---

## 3. Answers to the specific numbered questions

**1. Does anything in Seam A call any of the 11 named Seam-D identifiers?**
Yes, exactly one: `toSip` (Seam A, line 34-52) calls `dueInstallmentDate` (Seam D) at line 50. None of `pad`, `nextSipDate`, `firstOccurrenceOnOrAfter`, `lastOccurrenceOnOrBefore`, `sipOccurrencesInWindow`, `occurrenceMonthStart`, `monthIndex`, `dateFromMonthIndex`, `FREQUENCY_STEP_MONTHS`, `dayAfter` is called from Seam A — confirmed by the grep table in §2. `createSip`/`updateSip` themselves never call any Seam-D identifier directly; they only reach `dueInstallmentDate` transitively, through calling `toSip` (lines 423, 539).

**2. Does Seam B call anything in Seam A or Seam D?**
Seam A: yes — see the B→A table in §1 (`isArchived`, `isUniqueViolation` ×2, `toSip` ×3, `lastInstallmentDateFor` ×3, `ownedSip`). Seam D: no — confirmed none found (§1, §2).

**3. Does Seam C call anything in Seam A or Seam B?**
No to both — confirmed none found (§1, §2). `committedForGoal` is Seam C's only DB-touching function and queries `sips`/`holdings`/`accounts` directly rather than delegating to any Seam A/B helper (e.g. it does not call `ownedSip` or any ownership/lock helper — it has no single-SIP ownership check at all, it filters by `userId`+`goalId` across all matching rows).

**4. Does Seam D call anything in A, B, or C?**
No — confirmed directly by exhaustive per-identifier grep (§2), not merely by re-stating investigation-1's claim. Every Seam D function's only dependencies are other Seam D names and `String`/`Math`/`Date` built-ins. Investigation-1's "every Seam D function is pure with no `db`/`tx` parameter" claim is **confirmed**, and additionally confirmed here at the call-graph level (zero cross-seam calls in any direction touching D).

**5. Currently-private functions that must become exported for the split to compile**

Exactly **three**, all called from Seam B while defined in Seam A:
- **`toSip`** (defined line 34, `function toSip(...)`, no `export`) — called from `linkSipInstallment` (lines 841, 873) and `unlinkSipInstallment` (line 921), both Seam B.
- **`lastInstallmentDateFor`** (defined line 102, `async function lastInstallmentDateFor(...)`, no `export`) — called from the same three Seam B call sites (841, 873, 921), plus already used intra-seam at line 538 (`updateSip`).
- **`ownedSip`** (defined line 117, `async function ownedSip(...)`, no `export`) — called from `listSipInstallmentCandidates` (line 1018, Seam B), plus already used intra-seam at line 441 (`updateSip`).

No currently-private function in any other direction (B→C/D, C→A/B/D, D→A/B/C, A→B/C) needs to change export status, because every other cross-seam call target checked in §1 is either already `export`ed (`isArchived`, `isUniqueViolation`, `dueInstallmentDate`) or there is no cross-seam call at all in that direction.

**6. `apps/api/src/routes/sips.ts` import — does it span more than one seam?**

Yes — its single import statement (`apps/api/src/routes/sips.ts:14-24`) spans exactly Seam A and Seam B (not C, not D):
```ts
14	import {
15	  createSip,
16	  deleteSip,
17	  linkSipInstallment,
18	  listAllSips,
19	  listSipInstallmentCandidates,
20	  listSipsForGoal,
21	  recordSipInstallment,
22	  unlinkSipInstallment,
23	  updateSip,
24	} from "../services/sips.ts";
```
Classified: `createSip` (A), `deleteSip` (A), `listAllSips` (A), `listSipsForGoal` (A), `updateSip` (A) — 5 Seam A names; `linkSipInstallment` (B), `listSipInstallmentCandidates` (B), `recordSipInstallment` (B), `unlinkSipInstallment` (B) — 4 Seam B names. No Seam C or Seam D name is imported by the route file at all (`committedForGoal`, `sipOccurrencesInWindow`, etc. are consumed elsewhere, not by `routes/sips.ts`).

**7. Other production importers outside `sips.ts`/`sips.test.ts`/`routes/sips.ts`**

```
grep -rn "from [\"'].*services/sips\.ts[\"']" apps/api/src --include="*.ts" | grep -v "^apps/api/src/services/sips"
apps/api/src/modules/ledger/services/transactions.ts:18:import { isUniqueViolation } from "../../../services/sips.ts";
apps/api/src/routes/sips.ts:24:} from "../services/sips.ts";
```
Confirmed: the **only** production importer outside `sips.ts` itself and `routes/sips.ts` is `modules/ledger/services/transactions.ts:18`, importing `isUniqueViolation` — which is defined at line 61, inside Seam A (**confirmed**, not refuted). This matches investigation-1 §5(a) exactly; no additional cross-importer was found in this pass.

**8. `apps/api/src/services/sips.test.ts` (1026 lines) — import block and seam grouping**

Import block (lines 1-27), classified by seam:
- **Seam A (9 names)**: `assertLinkRowsMatched`, `isArchived`, `isCheckViolation`, `isUniqueViolation`, `laterInstallmentDate`, `resolveSipDateRange`, `resolveSipFundingTarget`, `resolveTargetGoalDecision`, `sipEditOrphansLinks`.
- **Seam B (4 names)**: `accountInstallmentSipIssue`, `candidateDateBounds`, `installmentDateError`, `linkInstallmentIssue`.
- **Seam C (3 names)**: `classifySipTarget`, `committedSplit`, `monthlyEquivalentPaise`.
- **Seam D (5 names)**: `dueInstallmentDate`, `firstOccurrenceOnOrAfter`, `lastOccurrenceOnOrBefore`, `nextSipDate`, `sipOccurrencesInWindow`.
- Plus two names from outside `sips.ts` entirely: `accountCanHaveGoal`, `sipDateRangeValid` (both `@compass/shared`, line 3) and `HttpError` (`../lib/errors.ts`, line 4).

Section-header comments (`// ---------- ... ----------`) and their line ranges, with seam classification:
| Lines | Section header (verbatim) | Seam |
|---|---|---|
| 29-88 | `committedSplit / classifySipTarget` | **C** |
| 89-120 | `frequency monthlyization` | **C** |
| 121-167 | `firstOccurrenceOnOrAfter / nextSipDate` | **D** |
| 168-194 | `sipOccurrencesInWindow` | **D** |
| 195-264 | `quarterly / yearly anchoring` | **D** |
| 265-278 | `resolveTargetGoalDecision (Fix 1: target-goal reconciliation)` | **A** |
| 279-293 | `sipDateRangeValid (Fix 4: endDate >= startDate)` | *shared* (`sipDateRangeValid` is `@compass/shared`, not defined in `sips.ts` at all) |
| 294-320 | `account target type gate (Fix 2: bank/cash can't be a SIP target)` | *shared* (tests `accountCanHaveGoal` from `@compass/shared`; Seam A's own `assertAccountTargetType` is un-exported and not imported by the test file at all) |
| 321-353 | `resolveSipDateRange (Fix 4: resolved-pair validation on partial update)` | **A** |
| 355-393 | `resolveSipFundingTarget (payroll+mf_folio resolved-pair validation on partial update)` | **A** |
| 394-455 | `sipEditOrphansLinks (updateSip: detach installments the edit strands)` | **A** |
| 456-468 | `assertLinkRowsMatched (Fix 2: TOCTOU-safe conditional link)` | **A** |
| 469-482 | `isArchived (Fix 1: archived source/target must be rejected by SIP validation)` | **A** |
| 483-501 | `laterInstallmentDate (merging holding_events + transactions installments)` | **A** |
| 502-533 | `installmentDateError (recordSipInstallment: date must fall within the SIP's life)` | **B** |
| 534-645 | `lastOccurrenceOnOrBefore (mirror of firstOccurrenceOnOrAfter)` | **D** |
| 646-672 | `isUniqueViolation (Drizzle wraps driver errors — see lib/errors.ts pgError)` | **A** |
| 673-699 | `isCheckViolation (Drizzle wraps driver errors — see lib/errors.ts pgError)` | **A** |
| 700-911 | `dueInstallmentDate` | **D** (by far the largest single section, ~211 lines / 22 tests) |
| 912-1026 | `linkInstallmentIssue / accountInstallmentSipIssue / candidateDateBounds` | **B** |

The seams are heavily **interleaved**, not grouped contiguously: the file's section order is C, C, D, D, D, A, (shared), (shared), A, A, A, A, A, A, B, D, A, A, D, B — Seam A alone is scattered across seven non-adjacent sections (265-278, 321-353, 355-393, 394-455, 456-468, 469-482, 483-501, 646-672, 673-699 — nine sections touch A once `isCheckViolation`/`isUniqueViolation` are counted separately), and Seam D is split three ways (121-264, 534-645, 700-911) with its largest block (`dueInstallmentDate`, 700-911) sitting *after* an intervening Seam A block (646-699) rather than adjacent to the file's other two Seam D blocks. A clean 4-way test-file split would require re-ordering these blocks by seam first; a whole-file-with-cross-file-imports split would need Seam D's test file to import `isUniqueViolation`/`isCheckViolation` (A) nowhere — those two sections are unambiguously A-only — but every other seam boundary in the test file is not simply "top half vs bottom half," it is dispersed across the full 1026 lines. No test in this file exercises `createSip`/`updateSip`/`deleteSip`/`listSipsForGoal`/`listAllSips`/`recordSipInstallment`/`linkSipInstallment`/`unlinkSipInstallment`/`listSipInstallmentCandidates`/`committedForGoal` directly (all nine are DB-touching and exported but never imported by this test file) — the whole file tests only the pure/exported helper functions from each seam, none of the seams' DB-touching functions.

---

## Summary

The split is compileable only if three currently-private Seam A functions — `toSip` (line 34), `lastInstallmentDateFor` (line 102), and `ownedSip` (line 117) — become exported, because Seam B's `linkSipInstallment`/`unlinkSipInstallment` (lines 841, 873, 921) and `listSipInstallmentCandidates` (line 1018) call them across the seam boundary. Two already-exported Seam A functions (`isArchived`, `isUniqueViolation`) are also called cross-seam from B but need no change. The only other cross-seam edge in the whole file is Seam A's `toSip` calling Seam D's `dueInstallmentDate` (line 50) — already exported, no action needed. Seam C and Seam D are both fully self-contained in every direction (confirmed exhaustively, not just re-stated from investigation-1); `routes/sips.ts`'s one import spans Seam A + Seam B only; and the only production importer outside `sips.ts` itself remains `modules/ledger/services/transactions.ts:18` (`isUniqueViolation`, Seam A), matching investigation-1 §5(a) exactly.
