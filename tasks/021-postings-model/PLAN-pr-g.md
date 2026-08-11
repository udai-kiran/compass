# PR-G plan — iteration 6 (recreate-from-scratch; supersedes the G1a–G4 staging)

## Status
**APPROVED — PR-G1 is buildable** (Codex review-6, final pass: *"buildable under the
stated recreate premise without silent data loss or wrong readers"*).
**REWRITTEN after the 2026-08-10 user decision: prod data is disposable and 2.0.0
ships as a breaking release with no upgrade path.** That decision restores the policy
already recorded in `tasks/02.01-postings-model.md:22` and
`tasks/03.02-release-2-0-0.md:12`, and it deletes most of iterations 1–4: there is no
data to migrate, so there is no collapse migration, no parity gate, no maintenance
window, and no compatibility boundary.

Iterations 1–4 and their four Codex reviews (`review-pr-g-1..4.md`) are retained
below the fold as the record of *why* the deleted machinery would have been needed if
data had to survive. **The G1a / G1b / G2 / G3 / G4 numbering is retired.** PR-G is
now two PRs: **PR-G1 (postings-native) and PR-G2 (drop the legacy columns)**.

## The premise correction

`PLAN-dualwrite.md` was adopted (correctly) because the atomic cutover yielded no
green, reviewable, mergeable intermediate and this project ships on cadence. But it
also silently assumed live data had to be preserved across the conversion — which
`tasks/02.01-postings-model.md:22` had already ruled out in as many words. That
assumption is the sole parent of:

- the transfer-collapse **migration** and its one-shot preflight over historical pairs,
- the opening-balance synthesis at account-creation date,
- the snapshot staging table and the balance/period parity gate,
- the bi-shape tolerance law and its dual-shape fixtures,
- the archive ledger-epoch marker,
- the maintenance windows and the write stops.

**All of the above is deleted.** None of it survives a database that is recreated.

**What is NOT deleted, and was wrongly cut in a first pass of this rewrite (review-5
§1):** the *reference and date* semantics of collapsing two headers into one. That is
not a migration concern — `linkTransfer` performs exactly that merge **at runtime,
forever** (`transfers.ts:68`, `routes/transfers.ts:21`), on a fresh database as much
as on an old one. So the merge contract and the differing-dates rule move out of the
deleted migration and into PR-G1's writer scope, as item 3a below.

What the dual-write phase *did* buy, and keeps: PR-A…PR-F are shipped and green, the
`postings` table and its builders exist, every aggregate reader is already
postings-derived, and the conversion arrived in reviewable increments rather than one
unmergeable commit. Nothing is reverted — the transitional scaffolding is simply
removed rather than migrated.

## Verified facts (read from `main` @ 4f4e964 — still the work inventory)

These are what PR-G1 must convert. They were verified by direct read during
iterations 1–4 and are unaffected by the premise change.

- **V1.** `computePostingDraftsForTransaction` (`transactions.ts:201`) derives posting
  shape entirely from legacy state (`is_opening` → `transfer_links` →
  `transaction_splits` → ordinary). Every writer routes through it via
  `rebuildPostingsForTransaction` (`:282`). **Legacy is currently the authority.**
- **V2.** `reconcileAllPostings` runs at every boot over every transaction
  (`app.ts:188`), rebuilding postings from legacy (`reconcile-postings.ts:101-103`).
- **V3.** `transactions.account_id` / `amount_paise` are NOT NULL
  (`db/shared/ledger.ts:31-40`); `account_id` carries an FK.
- **V4.** The DTO's `transferLinkId` / `transferCounterpartAccountId` come from
  `transfer_links` (`transactions.ts:112-170`); web unlink posts the link id
  (`TransactionDrawer.tsx:215`), and `TransactionsPage.tsx:372` /
  `AccountLedgerPage.tsx:148` test `transferLinkId !== null`. `AccountLedgerPage`
  renders `txn.amountPaise` directly.
- **V5.** Only bank/cash carry openings as a ledger row (`accounts.ts:20-26`); other
  types use `accounts.opening_balance_paise`, read as an addend (`balances.ts:35-56`,
  `accounts.ts:164-185,217`) and written by `createAccount`/`updateAccount`
  (`:420-470`) **and by `absorbCarryover`** (`credit/services/reconciliation-writes.ts:296-305`).
- **V6.** Legacy-column readers surviving PR-F: the eight in
  `tasks/023-pr-f-backup-csv-postings/TASK.md:138-150`, plus `categorize.ts:55`,
  `bills.ts:94`, `review-queue.ts:176`. Two review passes each found more — use the
  gate in G1 item 4, not this list.
- **V6b.** Eleven aggregate readers identify a transfer *only* by a Clearing posting:
  `lib/periods.ts:77,159,222`, `cashflow.ts:84`, `insights.ts:148,205`,
  `reports.ts:117`, `dashboard.ts:78,95`, `bills.ts:107`, `prefs.ts:106`.
- **V6c.** Posting-grain readers that would double a two-real-posting transfer:
  `search.ts:13`, `categorize.ts:51`, `user-tasks.ts:99`, `backup.ts:157`,
  `sip-installments.ts:442-450` (the last three pick a leg via `order by p.id limit 1`).
- **V8.** `buildTransferPostings` — the canonical two-real-posting builder — exists at
  `postings.ts:167` with no production caller.
- **V9.** EMI materialization creates separate headers per family
  (`recurring.ts:288,309`), so "two real postings" is unambiguous for transfers.
- **V11.** `acceptTransfer` and the repayment path stamp
  `extracted_transactions.transaction_id` with both leg ids
  (`transfer-classification.ts:112,120,285,289`); `TransferResult` promises
  `{transferLinkId, outTransactionId, inTransactionId}` (`schemas/ledger.ts:581`).

## PR-G1 — postings-native, single shape

Postings become the authority for reads and writes. **There is no shape A and no
bi-shape tolerance**: a transfer is one header with exactly two real postings, full
stop. Any legacy-shaped data still sitting in a dev or personal instance is discarded
by the recreate, not converted.

1. **Delete the legacy-derivation path.** `computePostingDraftsForTransaction` (V1)
   and the boot reconciler's rebuild arm (V2) are removed outright — no
   migration-only helper, because there is nothing to backfill. Writers construct
   posting drafts from the request and write them; nothing derives postings from a
   legacy column ever again.
2. **Retire the Clearing account.** It was explicitly transitional
   (`PLAN-dualwrite.md` Q4). With no legacy transfers to mirror, it stops being
   created in this PR; the enum value may remain reserved.
3. **Writer graph** — every one of these currently derives postings from legacy and
   becomes postings-first: W1 `createTransaction`/`updateTransaction`/`softDelete`/
   `bulkAction`; W2 `setSplits`; W3 transfers (create/link/auto-link/unlink);
   W4 recurring incl. both EMI families (`recurring.ts:288,309,358`); W5 import
   commit/reconcile/rollback (`imports.ts:656,933`); W6 category merge
   (`categories.ts:172`); W7 account opening writers (`accounts.ts:420-470`);
   W8 `absorbCarryover` (V5 — must adjust the Opening transaction, not a column);
   W9 demo/seed (`demo.ts:216`); W10 restore; W11 the extractor transfer workflows
   (V11), which consume `linkTransfer`'s new survivor-id contract.
3a. **The merge/unmerge contract** (review-5 §1 — runtime, not migration).
   `linkTransfer`/`autoLinkTransfers` turn two headers into one and **delete a
   header**, which cascades attachments and transaction links
   (`ledger/schema.ts:78,156`), nulls user tasks and extracted-transaction links
   (`ledger/schema.ts:117`, `ingest/schema.ts:195,203`), and orphans
   `import_rows.transaction_id`/`reconciled_from`, which carry **no FK at all**
   (`ingest/schema.ts:84`). PR-G1 must therefore specify, and test:
   - **references** — every child row and no-FK reference re-pointed at the survivor
     before deletion; a conflict between the two headers' `sip_id`,
     `reconciled_statement_id`, `policy_id`, `resource_id` or `recurring_template_id`
     **fails closed** rather than silently preferring one leg, and a `sip_id` move
     must not violate `transactions_sip_date_idx` (`db/shared/ledger.ts:121`);
   - **import rollback must fail closed on a cross-batch merge** (review-6 §b).
     `rollbackImport` **hard-deletes** every transaction its batch's
     `import_rows.transaction_id` points at (`imports.ts:817-830`). Once two legs from
     *different* import batches are merged, both batches' import rows point at the one
     survivor, so rolling back either batch would destroy the other batch's leg too.
     Rollback must therefore reject (409) any transaction referenced by import rows
     from more than one batch, telling the user to unlink the transfer first — exactly
     the guard the same function already applies to a SIP-linked transaction
     (`imports.ts:805-816`), reused rather than invented.
   - **header fields** — survivor keeps its `date`, `occurred_at`, `source`,
     `created_at`; `tags` union; the other leg's differing `merchant`/`notes` are
     appended to the survivor's notes rather than dropped;
   - **dates** — the two legs may differ by up to `TRANSFER_WINDOW_DAYS` on auto-link
     and by **any amount** on manual link, which `linkTransfer` does not constrain at
     all (`transfers.ts:113-131`). The merged transfer takes the survivor's date;
     since the destination posting moves with it, that date choice is now a
     *product* rule, so it must be stated in the API docs and surfaced in the UI's
     link confirmation, not left implicit;
   - **which leg survives** — the **outflow (negative) leg**, always. It is the leg
     the primary-real-posting rule (item 5) already projects, so the merged
     transaction's header, id and date are the ones a global list was showing before
     the merge. `createTransfer` builds only one header and so has no survivor to
     choose; `linkTransfer`/`autoLinkTransfers` delete the inflow header.
   - **unmerge** — `unlinkTransfer` takes a transaction id and splits the header back
     into two ordinary transactions: the **survivor keeps its id and every reference
     and header field**; the second is a **new bare row** carrying only date,
     merchant, notes, tags and its own posting. The response returns both ids.
     This is deliberately **not** an inverse of the merge — which leg originally owned
     an attachment or a `sip_id` is destroyed at merge time and cannot be recovered —
     so the UI must present unlink as "split into two transactions", not "undo".
     **One exception, and it is required** (review-7): unmerge must **repartition
     `import_rows.transaction_id` and `reconciled_from` across the two legs**, moving
     each to the leg whose account matches that import batch's own account (import
     batches are account-scoped). Without it the rollback guard above is a dead end —
     it tells the user to unlink, but both batches' import rows would stay on the
     survivor and rollback would still refuse. Repartitioning is what makes the
     remediation actually terminate.
4. **Reader conversion, enforced by a gate rather than a list.** Two review passes
   each found readers the previous enumeration missed, so G1 ships a CI check
   asserting **zero READS** of `transactions.{account_id, amount_paise, category_id,
   necessity, is_opening}`, `transaction_splits`, `transfer_links`,
   `accounts.opening_balance_paise` — Drizzle and raw SQL alike. **Reads, not
   references** (review-5 §2): PR-G1 still *writes* these columns to satisfy NOT NULL,
   and the schema still declares them until PR-G2 (`db/shared/ledger.ts:30`), so the
   gate exempts, by path so the exemption cannot spread: the schema files, the single
   projection-writer module, and **the boot check** — which must read
   `accounts.opening_balance_paise` and `transfer_links` precisely in order to refuse
   to start on stale data (see Deployment). All three exemptions disappear with the
   columns in PR-G2.
   Starting points: V6 (legacy-column), V6b (Clearing predicates → "exactly two real
   postings"), V6c (posting-grain duplication).
5. **One row per header, with a defined projection.** Every reader joining `postings`
   to produce transaction-level rows must emit one row per header and project a
   *specified* posting — never `order by p.id limit 1` (V6c).
   **The projection is the "primary real posting", not "the negative posting"**
   (review-5 §3): for income and for an opening on an asset account the real-account
   posting is *positive* and the negative one is a system account
   (`postings.ts:98,206`), so a sign rule projects the wrong leg. Definition: the
   posting on a non-system account (`system_kind is null`); for a transfer, which has
   two, the **outflow (negative)** leg. CSV/search/AI categorize → the primary real
   posting; account-scoped readers (`user-tasks.ts`, `sip-installments.ts`) → the
   posting on the account being reported.
   `listTransactions` becomes header-grain: global lists project the primary real
   posting; account-scoped lists filter on `EXISTS (posting on that account)` and
   project that account's posting via a lateral; the cursor stays
   `(date, created_at, id)`.
   **Totals need their own rule** (review-5 §3): summing a transfer's projected
   outflow leg makes the list's net drop by the transfer amount instead of netting to
   zero, which is what the header shows the user (`TransactionsPage.tsx:153`).
   Transfers are therefore excluded from `sum`/`inflow`/`outflow` in a global list —
   matching what the aggregate readers already do via their Clearing guard — while an
   account-scoped list includes that account's own leg, because from one account's
   perspective a transfer really is an inflow or an outflow.
6. **DTO and web.** `Transaction` exposes `isTransfer` + `transferCounterpartAccountId`,
   both postings-derived; `transferLinkId` is removed; unlink takes a **transaction
   id** and splits a transfer back into two ordinary transactions; `TransferResult`
   becomes `{ transactionId }` (V11 call sites updated). `AccountLedgerPage.tsx:148`
   must adopt the account projection or a destination ledger renders an inflow as an
   outflow.
7. **Restore.** It currently discards archived postings and re-derives them from
   legacy (`restore-user.ts:149-151,203`) — with the derivation gone, restore must
   insert archived postings directly, remapping `account_id` through the old→new
   system-account map by `system_kind`. **Pre-2.0 archives are rejected** with a
   clear, actionable error pointing at export-then-reimport, per
   `tasks/03.02-release-2-0-0.md:12`.

Legacy columns still exist at the end of PR-G1 (they are NOT NULL), so writers keep
projecting a value into them: `account_id`/`amount_paise` from the source posting,
`category_id`/`necessity` null, `is_opening` false. Nothing reads them — gate 4
proves it. This is the only reason PR-G1 and PR-G2 are separate PRs.

## PR-G2 — drop

Drop `transaction_splits`, `transfer_links`, `is_opening`,
`accounts.opening_balance_paise`, `transactions.{account_id, amount_paise,
category_id, necessity}`; delete the projection writer and the opening-balance addend
arms (`balances.ts:35-56`, `accounts.ts:164-185,217`); remove the two dropped tables
from `ALL_TABLES`/`USER_TABLES`/`LINKED_TABLES` in the same change or the
backup-coverage test fails. The schema then matches what
`tasks/02.01-postings-model.md` specified from the start: *"`transactions` becomes a
header… **No `account_id`, no `amount_paise`.**"*

## Invariants — defer to task 2.6, do not re-invent

Iterations 1–4 grew a bespoke `validateCanonical` (I1–I9). Most of it duplicates
`tasks/02.06-double-entry-invariants.md`, which already owns continuous enforcement:
per-transaction zero-sum, whole-ledger zero-sum, balance-equals-`sum(postings)`, no
orphan postings, soft-delete removing all legs together, as **property tests over
generated data** plus an operator-facing integrity report. PR-G1 asserts shape
closure (ordinary / split / transfer / opening, exact posting counts, category and
necessity only on counter postings) and leaves the rest to 2.6.

## Deployment

No maintenance window, no write stop, no rollback protocol — but **not "ordinary
releases" either** (review-5 §4). PR-G1 is single-shape code: it reads a transfer as
one header with two real postings and understands nothing else. Any database still
holding PR-A…PR-F Clearing-shaped transfers would be *silently misread* by it, not
rejected. So the recreate is a **precondition of PR-G1's first boot**, not a later
step at the 2.0.0 cut:

- on the personal/prod instance, recreate before starting the PR-G1 binary;
- in dev, `db:migrate` onto an empty database and `db:seed` — a stale dev DB carrying
  legacy transfers gives wrong answers with no error;
- to make that fail loudly instead of silently, PR-G1's boot check (replacing the
  reconciler removed in item 1) aborts startup if any Clearing posting or
  `transfer_links` row exists, **or if any account still carries a non-zero
  `accounts.opening_balance_paise`** — PR-G1's readers no longer add that column
  (item 4 forbids reading it), so a stale card/loan/scheme opening would otherwise be
  silently omitted from every balance rather than reported.

`tasks/03.02-release-2-0-0.md` already carries the pre-tag verification checklist,
including "a transfer, a split and an opening balance each verified to produce
balanced postings by hand" and "migrations apply cleanly onto an **empty** database".

## Follow-ups this creates elsewhere

- `tasks/03.01-docs-and-prd.md` already requires CLAUDE.md to lose its references to
  `transfer_links` and signed transaction amounts — PR-G2 is what makes that true.
- `PLAN-dualwrite.md`'s PR-G section is superseded by this file.

## Review log
- **Iterations 1–4 (Codex reviews 1–4, `review-pr-g-1..4.md`).** Reviewed the
  data-preserving staging to APPROVED-FOR-G1A over four passes. Superseded by the
  2026-08-10 user decision, but three of its findings survive the premise change and
  are carried into PR-G1 above, because they are code defects rather than migration
  hazards: (a) eleven aggregate readers detect transfers solely by a Clearing posting
  (V6b) and would silently count a two-real-posting transfer as both income and
  expense; (b) five posting-grain readers duplicate or arbitrarily pick a leg (V6c);
  (c) `absorbCarryover` writes `opening_balance_paise` directly (V5), outside the
  account-management writers everyone was looking at. Enumeration missed readers on
  both passes, which is why PR-G1 uses a CI gate instead of a list.
- **USER DECISION (2026-08-10):** prod data is disposable; 2.0.0 ships breaking, no
  upgrade path from 1.x, pre-2.0 archives rejected at restore. Restores the policy of
  `tasks/02.01-postings-model.md:22` and `tasks/03.02-release-2-0-0.md:12`.
- **review-6 (Codex, iteration 6 — three convergence passes): APPROVED**
  (`review-pr-g-6.md`). Fixed in order: the survivor leg and unmerge allocation were
  unspecified; the startup check had to also reject a non-zero
  `opening_balance_paise` (else stale card/loan openings vanish silently from every
  balance) while gate 4 forbade exactly that read; `rollbackImport` hard-deletes by
  `import_rows.transaction_id` (`imports.ts:817-830`), so a merged transfer spanning
  two import batches was a real data-loss path — guarded by reusing the function's
  existing SIP-link 409 precedent; and that guard was a dead end until unmerge
  **repartitions** import references by leg, which works because every import batch
  has one immutable non-null `accountId`.
- **review-5 (Codex, iteration 5 — the simplification): CHANGES REQUIRED, 4 items,
  all folded into iteration 6** (`review-pr-g-5.md`). Confirms no DML migration and
  no bi-shape tolerance are needed once recreation-before-boot is guaranteed, and
  that the three carried findings are real code defects. But: (1) **the merge/unmerge
  contract was over-deleted** — `linkTransfer` collapses two headers at runtime, so
  reference remapping and the differing-dates rule belong in PR-G1, not in the
  discarded migration; (2) the CI gate must say "zero **reads**" with the projection
  writer and schema exempted by path, since PR-G1 still writes those columns;
  (3) "source (negative) posting" is wrong as a universal projection — income and
  asset openings have a *positive* real posting — so the rule is "primary real
  posting", and global totals must exclude transfers or the list's net drops by the
  transfer amount; (4) PR-G1 is single-shape and would silently misread leftover
  Clearing data, so recreation is a precondition of its first boot, enforced by a
  startup abort. Nit taken: V6b is eleven sites, not twelve.
