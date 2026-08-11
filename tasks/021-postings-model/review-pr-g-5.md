# PR-G plan — review-5 (Codex, iteration 5: the recreate-from-scratch simplification)

Verdict: **CHANGES REQUIRED** (4 items, all folded into iteration 6)

1. **Live transfer collapse still needs a safe merge/unmerge contract.** Even on a
   fresh DB, linking accepts two independent headers and permits dates up to three
   days apart (`transfers.ts:21`, `routes/transfers.ts:21`). Collapsing them must
   resolve dates, metadata, attachments, tasks and extracted/import references;
   deleting one header currently cascades or nulls these (`ledger/schema.ts:78`,
   `ingest/schema.ts:195`). D-DATE and reference handling were therefore **not purely
   migration concerns**.

2. **The empty-allowlist gate is impossible as worded.** It demands zero production
   references while PR-G1 deliberately writes those columns; schema declarations also
   remain until G2 (`db/shared/ledger.ts:30`). Make it "zero reads/authority uses",
   with the projection writer structurally exempted.

3. **"Source (negative) posting" is not a valid universal projection.** For
   income/opening entries the real-account posting may be positive while the negative
   posting is a system account (`postings.ts:98,206`). Define "primary real posting";
   reserve "negative posting" for transfers. Also, global totals over the transfer's
   negative projection make the UI's net fall by the transfer amount instead of zero
   (`TransactionsPage.tsx:153`).

4. **PR-G1 works before G2 only on a freshly recreated DB.** Calling G1/G2 "ordinary
   releases" before the 2.0 recreation would expose existing Clearing-shaped data to
   single-shape code. Recreation must precede G1 application startup, or both PRs must
   activate only at the 2.0 cut.

## Confirmations

- The carried findings are substantively correct: Clearing predicates remain defects
  (`cashflow.ts:80`), posting-grain readers remain defects (`search.ts:13`), and
  `absorbCarryover` still writes the column directly (`reconciliation-writes.ts:297`).
- No DML migration or bi-shape tolerance is needed once recreation-before-boot is
  guaranteed.
- No additional `apps/extractor` break found; its card-history query is already
  account-posting scoped (`apps/extractor/src/db.ts:252`).
- Nit: V6b lists **11** predicate sites, not twelve.
