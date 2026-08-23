Verdict: **not yet implementation-ready**. The generated-column, gross-estimate, and basic table-constraint changes are sound, but H2 is only partially resolved and H3/H4 remain blocking against the canonical task.

## High

### H1 — The derive scope still contradicts the canonical acceptance criteria

The revised plan explicitly makes derivation user-invoked and excludes automatic hooks ([TASK.md](/work/personal/compass/tasks/090-taxable-income-ledger/TASK.md:15), [TASK.md](/work/personal/compass/tasks/090-taxable-income-ledger/TASK.md:145)). Avoiding fragile cross-module writes is a reasonable architectural preference, but it does not satisfy the canonical requirement that dividends and fixed-income interest “flow in automatically” ([13.04-taxable-income-ledger.md](/work/personal/compass/tasks/13.04-taxable-income-ledger.md:20)).

The plan also has no fixed-income derivation or refresh route at all, despite listing task 13.3 as complete. It only derives payslips and holding events ([TASK.md](/work/personal/compass/tasks/090-taxable-income-ledger/TASK.md:75)). Consequently:

- Deposit interest never enters the ledger except by manual re-entry.
- Source edits or deletions leave previously derived rows stale.
- A newly created dividend is invisible until the user knows to invoke reconciliation.

Either add an idempotent refresh/materialization workflow covering dividends and deposit accrual periods, or formally revise the canonical acceptance criterion. Merely declaring user-invoked reconciliation a “scope decision” does not resolve review-1 H3.

### H2 — `source_priority` and `original_values` do not implement reconciliation or the required audit trail

The proposed unique index only deduplicates repeated derivation of the exact same `(source_kind, source_id)`. It does not prevent a manual row, transaction-derived row, holding event, and future AIS line from representing the same economic income.

Likewise, `source_priority` is passive metadata: the plan defines no reconciliation identity, matching rule, winner selection, supersession relationship, or service behavior that uses it. `original_values` records at most one mutable snapshot and cannot explain:

- Which competing source was selected and why.
- Which rows were matched or superseded.
- Whether an accepted amount was later changed.
- The sequence and time of multiple corrections.
- What happened when the source was edited or deleted.

This remains inconsistent with the canonical requirements for cross-source duplicate prevention and an audit trail explaining every included figure ([13.04-taxable-income-ledger.md](/work/personal/compass/tasks/13.04-taxable-income-ledger.md:16)). A full event-sourcing system is unnecessary, but the plan needs at least a reconciliation identity/group, explicit winning/superseded state, and append-only correction records or an equivalent immutable history. Review-1 H4 is unresolved.

### H3 — The stated conflict target is invalid for the partial unique index

The partial unique index itself is correctly shaped:

```sql
UNIQUE (user_id, source_kind, source_id)
WHERE source_id IS NOT NULL
```

However, the derive logic specifies:

```sql
ON CONFLICT (user_id, source_kind, source_id) DO NOTHING
```

([TASK.md](/work/personal/compass/tasks/090-taxable-income-ledger/TASK.md:103)). PostgreSQL cannot infer that partial index from this target without the matching predicate. The repository also documents that its current Drizzle version rejected `targetWhere` against another partial index ([post-entry.ts](/work/personal/compass/apps/api/src/modules/ledger/services/post-entry.ts:179)).

Use targetless `.onConflictDoNothing()` followed by a user-scoped fetch when `RETURNING` is empty, or use SQL/API syntax that emits the matching `WHERE source_id IS NOT NULL`. Add a concurrent derive integration test. Review-1 H2 is therefore only partially resolved.

### H4 — FY is not yet guaranteed to be derived server-side for every creation path

The table comment and finding say FY always comes from `fyOf(accrual_date)` ([TASK.md](/work/personal/compass/tasks/090-taxable-income-ledger/TASK.md:42)), but AC6 weakens this to “never accepted from client for auto-derived events” ([TASK.md](/work/personal/compass/tasks/090-taxable-income-ledger/TASK.md:132)). That leaves manual creation free to accept independent `fy` and `accrualDate` values.

The plan also fails to define `accrual_date` for payslip derivation. Payslips have a month rather than an accrual date, and accepted manual payslips may have nullable `grossPaise` and `tdsCurrentPaise`. The derive algorithm must specify:

- `CreateIncomeEventBody` does not contain `fy`.
- Every create path calls `fyOf(accrualDate)`.
- How a payslip `payMonth` maps to `accrualDate`.
- Whether missing gross/TDS rejects derivation or uses an explicitly documented fallback.
- Holding-event accrual date is `event.date`.

The existing `fyOf()` already validates real ISO dates and handles the April boundary correctly ([financial-year.ts](/work/personal/compass/apps/api/src/lib/financial-year.ts:23)). Review-1 M3 is not fully resolved.

### H5 — Derived holding events are not restricted to dividends

`holdingEvents` can be `buy`, `sell`, or `dividend` ([schema.ts](/work/personal/compass/apps/api/src/modules/investments/schema.ts:133)). The plan loads an arbitrary event ID and maps its amount to dividend income without saying it must reject non-dividend events ([TASK.md](/work/personal/compass/tasks/090-taxable-income-ledger/TASK.md:106)).

Require `event.type === "dividend"` after the ownership-scoped join and test that buy/sell IDs are rejected. Otherwise the route can manufacture taxable dividend income from a purchase or sale.

## Medium

### M1 — The summary is labelled correctly, but inclusion semantics and section totals remain unspecified

The response correctly uses `grossPaise`, includes every income kind including `other`, declares `isEstimate: true`, and supplies explanatory notes ([TASK.md](/work/personal/compass/tasks/090-taxable-income-ledger/TASK.md:78)). That resolves the dangerous “gross salary equals taxable salary” naming issue from review-1 H5.

However, the plan does not state that monetary totals aggregate **accepted rows only**. Pending rows should contribute only to `pendingCount`; rejected rows should contribute to neither totals nor accepted count. This must be explicit and tested so unreviewed data cannot silently enter a tax figure.

The summary also lacks totals by `section`, which review-1 requested for downstream reconciliation. This is not necessarily blocking if downstream code will aggregate the event list, but the plan should either add `bySection` or explicitly assign section aggregation to a later task.

### M2 — PAN/TAN separation is correct, but the proposed validation descriptions are too permissive

Separate nullable `payerPan` and `payerTan` fields are correct. The format rules should be precise and include uppercase normalization:

- PAN: `^[A-Z]{5}[0-9]{4}[A-Z]$`
- TAN: `^[A-Z]{4}[0-9]{5}[A-Z]$`

The plan currently says only “10-char alphanumeric” for PAN and “10-char alphanumeric starting with 4 letters” for TAN ([TASK.md](/work/personal/compass/tasks/090-taxable-income-ledger/TASK.md:19)). Those descriptions accept invalid character positions. The official Income Tax Department describes the same positional formats for [PAN](https://www.incometax.gov.in/iec/foportal/node/11593) and [TAN](https://static.incometax.gov.in/iec/foservices/assets/pdf/Instructions_for_filling_Form15G_Income_Details.pdf).

Add `.trim().toUpperCase()` normalization before validation and tests for lowercase input, invalid character positions, and redaction from logs/errors.

### M3 — Additional storage-level financial and lifecycle invariants are missing

The requested `gross_paise >= 0` and `tds_paise >= 0` checks are present ([TASK.md](/work/personal/compass/tasks/090-taxable-income-ledger/TASK.md:45)). However, the design still permits negative `afterTdsPaise` because it lacks `tds_paise <= gross_paise`.

It also leaves `status`, `income_kind`, `source_kind`, and `section` as unrestricted text and does not enforce:

- Accepted rows have `accepted_at IS NOT NULL`.
- Pending/rejected rows have `accepted_at IS NULL`.
- Manual rows have null `source_id`.
- Derived rows have non-null `source_id`.
- `source_priority` is valid for the corresponding source kind.

Use enums or check constraints for these invariants and add migration/restore-level tests, since Zod does not protect internal writes or restored data.

### M4 — The verification plan remains too broad for several promised guarantees

P8 mentions a state machine, dedup, summary, payslip derivation, and concurrent accept ([TASK.md](/work/personal/compass/tasks/090-taxable-income-ledger/TASK.md:124)), but should explicitly include:

- Concurrent duplicate derives.
- Concurrent accept versus reject.
- Cross-user payslip and holding-event IDs returning indistinguishable 404s.
- Rejection of non-dividend holding events.
- Accepted-only summary totals.
- Manual and derived FY boundary cases.
- Original-value capture in the same transaction as acceptance.
- Null payslip amount behavior.
- Exact PAN/TAN formats and normalization.
- Database check-constraint violations.

## Low

No additional Low-severity findings.

## Requested checks

1. **Generated `net_paise`: Yes, resolved.** It is removed, and `afterTdsPaise` is computed in DTOs.
2. **Partial unique index: Index yes; conflict clause no.** The index is correct, but the specified targeted `ON CONFLICT` does not match the partial predicate.
3. **User-invoked derive routes: No, not under the current canonical task.** They are reasonable architecture only if the canonical automatic-flow criterion is formally changed.
4. **`source_priority` + `original_values`: No.** They do not prevent cross-source duplicates or provide an adequate explanatory audit trail.
5. **Gross estimate summary: Yes, naming resolved.** Add accepted-only aggregation semantics; section aggregation remains open.
6. **FY always server-derived: Not yet.** AC6 only guarantees it for auto-derived events, and payslip accrual-date mapping is absent.
7. **PAN/TAN: Separated, but validation is underspecified.** Use the exact positional formats and normalization.
8. **Non-negative checks: Yes.** Both requested checks are present; `tds_paise <= gross_paise` is still needed.

Review-1 disposition: **H1 resolved; H2 partially resolved; H3 unresolved; H4 unresolved; H5’s misleading-summary issue resolved, with accepted-only and section-aggregation details still outstanding.**