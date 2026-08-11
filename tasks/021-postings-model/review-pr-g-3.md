# PR-G staging plan — review-3 (Codex, plan iteration 3)

Verdict: **CHANGES REQUIRED** (all remaining items narrow and mechanical)

1. **PARTIAL — safe runtime Shape-B merge.** Shared `collapseTransferPair`,
   survivor-ID return, extractor callers, and unlink identity policy are now
   specified (PLAN-pr-g.md:184-202,331-350), addressing current unsafe behavior
   (`transfers.ts:113-138`). However, merge policy remains undefined for
   non-reference header data — `occurred_at`, merchant, notes, tags, source, and
   timestamps — which exist independently on both headers
   (`db/shared/ledger.ts:33-58,98-100`). Sharing the primitive is correct; its
   contract is incomplete.

2. **PARTIAL — readers/cardinality.** Header-grain global/account queries and cursor
   tests are specified (PLAN-pr-g.md:238-259). But Gate 2 proves only cardinality,
   not correct projection. CSV, user tasks, and SIP hydration can still pass while
   arbitrarily choosing `order by p.id limit 1` (`system/services/backup.ts:157-165`,
   `ledger/services/user-tasks.ts:99-105`,
   `investments/services/sip-installments.ts:442-450`). Require source/
   account-relevant projection tests for every such reader.

3. **PARTIAL — transfer-date loss.** D-DATE is correctly and completely escalated:
   unrestricted manual linking is real (`transfers.ts:113-131`), the historical
   consequence and three options are stated, and G2 is explicitly blocked pending the
   decision (PLAN-pr-g.md:359-383). However, the earlier requirement to define
   period-total ranges remains unmet; step 1 defines balance dates but merely says
   "period totals" (PLAN-pr-g.md:322-330,410-412).

4. **RESOLVED — final reconciliation.** G1a now requires a write stop, mandatory
   final legacy-derived reconciliation, zero drift, and zero posting-less
   transactions before the authority flip (PLAN-pr-g.md:156-169,300-305), correctly
   covering the current restore/boot repair hazard (`app.ts:182-195`).

5. **PARTIAL — canonical gate and post-G2 restore.** Canonical field placement,
   soft-deleted rows, opening uniqueness, and list cardinality are covered
   (PLAN-pr-g.md:390-416). The archive policy is not effective: G1b archives created
   before G2 can still contain historical Shape A, yet carry the new G1b version and
   therefore pass the proposed post-G2 version check. The current archive header
   contains only a format version, not a canonical-ledger epoch
   (`lib/backup-archive.ts:25-32,90-93`).

## New blockers

- **Legacy-silence grep is not achievable literally.** `validateBiShape` and Shape-A
  unlink still require `transfer_links`, while the gate permits it only inside the
  projection writer (`ledger/schema.ts:57-75`). The opening-balance addend is also
  intentionally still read (`balances.ts:35-56`, `accounts.ts:164-185,217`). Define
  an explicit compatibility-module/line allowlist; call it "no unauthorized legacy
  reads", not silence.
- **Parity domain is not executable as written.** Postings contain no date; dates
  belong to transaction headers (`db/shared/ledger.ts:33,132-146`). Because the
  snapshot is taken first, projected post-collapse dates — including newly introduced
  destination-account and opening dates — must be precomputed before snapshotting.
  Period ranges must also be enumerated.
- **Archive epoch:** bump at/after successful G2/G3, or encode and validate a
  canonical-shape epoch/content marker; a G1b format bump alone cannot distinguish
  pre-collapse archives.
