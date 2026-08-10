# PR-G staging plan — review-4 (Codex, plan iteration 4, final confirmation)

Verdict: **APPROVED-FOR-G1A**

1. **RESOLVED** — Shared collapse now defines survivor handling for all header
   fields, unions tags, preserves differing IN values in notes, and reports
   moved/discarded fields.
2. **RESOLVED** — Gate 2 specifies source/account-relative projection per reader with
   dual-shape tests, not merely cardinality.
3. **RESOLVED** — Period parity now enumerates every calendar month and financial
   year; D-DATE remains explicitly isolated to G2.
4. **RESOLVED** — G1a requires write stop, final legacy reconciliation, zero drift,
   and zero posting-less transactions before activation.
5. **RESOLVED** — Archives now carry a migration-derived `pre-collapse`/`collapsed`
   ledger epoch, with post-G2 restore rejecting pre-collapse archives.
6. **RESOLVED** — "Legacy silence" became an explicit, stage-annotated compatibility
   allowlist that G4 empties.
7. **RESOLVED** — Snapshot dates are precomputed from current and projected
   post-collapse dates, with exact balance and enumerated period domains.
8. **RESOLVED** — The archive epoch directly distinguishes G1b archives created
   before versus after collapse.

Nothing remaining makes G1a data-losing or undeployable. D-DATE gates G2 only.
