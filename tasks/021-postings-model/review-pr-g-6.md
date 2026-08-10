# PR-G plan — review-6/7/8 (Codex, iteration 6 convergence)

Three short confirmation passes over iteration 6, each fixing one remaining gap.

## Pass 1 (iteration 6, first cut)
- §1 merge/unmerge contract — **PARTIAL**: covers remapping, conflicts, metadata and
  dates, but never says which leg survives or how unmerge allocates fields and
  references.
- §2 read-only CI gate — **RESOLVED**.
- §3 primary-real-posting projection + global/account totals split — **RESOLVED**.
- §4 recreation before first boot — **RESOLVED**.
- Also required: the startup check must reject non-zero
  `accounts.opening_balance_paise`, or stale non-transaction openings are silently
  omitted from every balance.

## Pass 2
- (a) Survivor = the outflow (negative) leg — **YES**, matches current sign
  validation and auto-linking.
- (b) Unmerge allocation — **NO**: re-pointing `import_rows.transaction_id` at the
  survivor lets `rollbackImport` hard-delete a merged transaction containing another
  batch's leg (`imports.ts:827`). Genuine data-loss path.
- (c) Startup check — **PRESENT but inconsistent**: reader gate 4 forbade the very
  `opening_balance_paise` read the boot check performs.

## Pass 3
- (b) — 409 prevents the data loss, but unlink left both batches' `import_rows` on
  the survivor, so rollback stayed blocked: the remediation was a dead end. Unmerge
  must repartition those references by leg.
- (c) — **RESOLVED**: the path-scoped boot-check exemption permits the required
  `opening_balance_paise` / `transfer_links` reads while keeping reader code gated.

## Final verdict

> Confirmed: §3a now includes the required repartition; it is correct because every
> import has one immutable, non-null `accountId`, and commit/reconciliation use that
> account.
>
> **APPROVED — PR-G1 is buildable under the stated recreate premise without silent
> data loss or wrong readers.**
