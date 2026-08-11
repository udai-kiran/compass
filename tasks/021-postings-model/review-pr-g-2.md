# PR-G staging plan — review-2 (Codex, plan iteration 2)

# CHANGES REQUIRED

## Prior six blockers

1. **RESOLVED — validator split and writer-switch timing.**
   Iteration 2 separates `validateBiShape` from `validateCanonical` and gives them
   distinct G2/G4 roles (PLAN-pr-g.md:125). It explicitly switches all transfer
   writers in G1b (PLAN-pr-g.md:155). This fixes the original impossible
   precondition and unspecified cutover.

2. **PARTIAL — readers and account-perspective DTO.**
   The plan now covers the twelve aggregate predicates and defines source/global
   versus account-relative projection (PLAN-pr-g.md:164, :179). But it still omits
   known two-real-posting consumers:
   - Search joins every real posting, so Shape B produces two identical transaction
     results (`ledger/services/search.ts:13`).
   - AI categorization similarly offers the transfer twice and still selects by
     `t.category_id` (`automation/services/categorize.ts:51,55`).
   - CSV and user-task hydration choose an arbitrary real posting by `p.id`, not the
     source or an account perspective (`system/services/backup.ts:157`,
     `ledger/services/user-tasks.ts:99`).
   - Bills and extractor history continue reading legacy `t.category_id`
     (`planning/services/bills.ts:94`, `ingest/services/review-queue.ts:176`)
     despite the plan's "read by nothing" claim.

3. **PARTIAL — writer mutation graph.**
   The previously listed writers and `absorbCarryover` are now named, with the
   correct requirement to mutate the Opening transaction (PLAN-pr-g.md:190, :201);
   current code confirms the direct column write being replaced
   (`credit/services/reconciliation-writes.ts:297`). However, the graph omits
   extractor transfer workflows whose post-link behavior becomes invalid after link
   collapse; see blocker 1 below.

4. **PARTIAL — reference-safe G2 collapse.**
   G2 now preflights and remaps most references and rejects conflicts
   (PLAN-pr-g.md:252). That resolves the core migration design, but:
   - `extracted_transactions.matched_transaction_id` is another set-null FK and is
     not explicitly included (`ingest/schema.ts:203`).
   - The same safety policy is not explicitly imposed on runtime `linkTransfer`.
   - Non-reference header provenance — especially distinct dates/timestamps — is
     still silently discarded.

5. **RESOLVED — restore authority and G4 compatibility.**
   G1a now restores archived postings authoritatively with system-account remapping
   and validation (PLAN-pr-g.md:215). G4 explicitly version-bumps and rejects
   pre-G4 archives (PLAN-pr-g.md:318). This directly replaces current behavior that
   skips postings (`restore-user.ts:149`).

6. **PARTIAL — canonical and temporal G3 gate.**
   Exact shapes, tenant ownership, reference checks, snapshot parity, and the G4
   rerun are now present (PLAN-pr-g.md:281, :300). Remaining gaps include the
   insufficient date domain, incomplete shape-field checks, duplicate openings for
   zero-column accounts, soft-deleted rows, list cardinality, and post-G2 Shape-A
   restores.

## Blocking changes required

1. **Define a safe runtime Shape-B merge and its contracts.**
   `linkTransfer` presently validates only sign, account, opening, and existing-link
   state (`transfers.ts:113`). Converting its two inputs into one header has exactly
   G2's reference-loss hazard. It must reuse an explicitly reference-safe
   preflight/remap operation or reject unsafe rows.

   It must also return the surviving transaction ID and update all callers.
   `acceptTransfer` assigns the deleted IN id after linking
   (`ingest/services/transfer-classification.ts:112,120`); repayment does likewise
   (`transfer-classification.ts:285,289`). `TransferResult` still promises two
   transaction IDs and a link ID (`packages/shared/src/schemas/ledger.ts:581`).

   Shape B can satisfy the legacy NOT NULL columns using the planned
   negative-posting projection. Shape-A unlink by either leg ID and Shape-B unlink
   by survivor ID are conceptually well-defined, but the lookup, survivor/new-ID
   policy, and Shape-A projection/link rule must be explicit.

2. **Complete every two-real-posting reader and make list cardinality testable.**
   Account-perspective pagination is implementable, but not with the current
   `account_id` header predicate (`transactions.ts:66`). Require a header-grain
   query:
   - global: one row per header, source projection;
   - account-scoped: `EXISTS`/single lateral posting for that account;
   - cursor remains the header `(date, created_at, id)`;
   - totals use the same projected row set.

   Add acceptance tests proving Shape B appears once globally, once in each account
   ledger, and exactly once across cursor boundaries. Include search, AI categorize,
   CSV, user tasks, SIP hydration, remaining legacy category readers, and
   transfer-edit controls. Attachments themselves remain valid once their
   transaction IDs are safely remapped (`attachments.ts:23`).

3. **Resolve transfer-date loss before claiming snapshot parity.**
   Month-end plus today cannot detect a one-day error (PLAN-pr-g.md:248). Current
   links allow legs up to three days apart (`transfers.ts:31`); keeping the OUT
   header moves the destination posting to the OUT date. Therefore per-account
   balances necessarily change between the original dates.

   Either preserve posting-level effective dates, reject/remediate different-date
   pairs, or explicitly approve that historical behavior change. Then enumerate
   every relevant boundary date and define all period ranges. The opening behavior
   is stated correctly: today the column is an unconditional addend
   (`balances.ts:37`), so dating its replacement at account creation intentionally
   changes only pre-creation as-of results.

4. **Add a mandatory final legacy→postings reconciliation gate before G1a.**
   Current boot repairs missing or drifted postings from legacy
   (`reconcile-postings.ts:89,101`). The app explicitly notes failed restore
   reconciliation can leave postings absent indefinitely (`app.ts:182`). G1a's
   validator would merely report that damage after authority has flipped.

   Require a quiescent, successful final reconciliation/backfill immediately before
   activation, followed by a zero-drift assertion. The migration-only helper cannot
   remain optional.

5. **Finish the canonical gate and post-G2 restore policy.**
   `validateCanonical` must additionally:
   - validate correct Expenses/Income kind, category/necessity placement, and null
     category/necessity on real transfer postings;
   - validate canonical shapes for soft-deleted transactions, which can later be
     restored;
   - enforce at most one Opening transaction for every account, including accounts
     whose old column was zero;
   - assert global/account/list cardinality and cursor parity.

   Finally, define how a Shape-A archive restored after G2 becomes Shape B. Merely
   rerunning `validateCanonical` at G4 detects the problem but provides no path to
   proceed.
