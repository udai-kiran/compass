# PR #179 squash-merge

## Title
feat(ledger): PR-G1 postings authority flip — balances, opening balances, and transfers now read exclusively from postings

## Body

### What this PR does

**Postings are now the single source of truth for all balance surfaces.**

- `accounts.opening_balance_paise` is frozen at 0 for all accounts (a boot-time check in `assertNoLegacyShapes` enforces this and refuses to start if any row is nonzero).
- Every opening balance now lives in an `is_opening = true` transaction row with a matching postings family — created by `createAccount` (new) and managed by `absorbCarryover` (updated).
- Transfer pairs now collapse into ONE survivor transaction with exactly two real postings (debit + credit legs on real accounts); the absorbed leg is hard-deleted. `transfer_links` is no longer written to (table retained for backup restore compatibility).
- `carriesOpeningAsTransaction` always returns `true`; `getCardActivity`'s `rawRows` now filters `not t.is_opening` so opening transactions don't appear in the activity list.

### Bugs fixed along the way

- **PE1** (`cards.ts`): `getCardActivity` missing `and not t.is_opening` — credit-card opening transactions leaked into the visible activity list after PR-G1 made every account type carry one.
- **B3** (`sip-installments.ts`): `linkedInstallmentRows` used `p.account_id = targetAccountId` to pin the posting leg, which broke for moved postings; replaced with `order by (p.amount_paise > 0) desc, p.id` consistent with `unlinkedInstallmentRows`'s own positive-amount rule.
- **B2** (`transfer-classification.ts`): dead catch on `transfer_links` unique violation replaced with a full-shape `HttpError` match (`instanceof HttpError && statusCode === 409 && message === "Transaction is already part of a transfer"`); stale doc comment updated to describe the real sorted-FOR-UPDATE + classifyShape mechanism.
- **Stale-snapshot race** (`absorbCarryover` + `updateAccount`): SERIALIZABLE snapshot was fixed before any concurrent `updateAccount` (READ COMMITTED) committed, creating a second opening transaction. Fixed with a session-level advisory lock (`pg_advisory_lock` via `hashtextextended`) acquired on a dedicated pool connection BEFORE starting the SERIALIZABLE transaction — the snapshot is taken after any concurrent holder commits. New `lib/account-lock.ts` helper.

### Tests updated (35 stale + several additional)

35 tests lagged correct PR-G1 production changes:
- 9 in `reconciliation-writes.test.ts` — fixture switched to real `createAccount`; assertions query the opening posting directly
- 15 in `inbox.test.ts` — redesigned around the collapsed transfer model (1 survivor, 2 real postings, 0 `transfer_links` rows); transfer reconstruction redesigned for `autoLinkTransfers`'s sweep
- 8 in 4 parity-test files — legacy "not in transfer_links" replaced with an independent postings-shape predicate; balance parity rewritten with flat per-account queries
- 2 in `backup.test.ts` — AC3 OLD-style test rewritten for the `repaired===0` reality; AC5 rewritten to assert FK rejection (SQLSTATE 23503) instead of silent skip

New test added: `sip-installments.test.ts` DB-backed case verifying a linked installment is still found after its real posting is moved to a different account.

### Follow-ups recorded (not blocking)

- F7: dormant `transfer_links` SQL in `legacySpendByNecessity` (not currently exercised by any fixture with a transfer)
- F8: 2 stale comments in `postings-balance-parity.test.ts` (functional assertions correct)
- F9: `legacy-projection.ts` doc comment claims `category_id` is "read by NOTHING" — `bulkAction` reads it
- F10: wall-clock time bomb in other tests using hardcoded past dates for `createAccount`
- F11: integration test for `updateAccount` + `absorbCarryover` concurrent advisory-lock scenario
- F12: `lockedDb` in `withAccountAdvisoryLock` typed as `Db` but `$client` is a `PoolClient` at runtime — change callback type to `Omit<Db, '$client'>` in a future PR

🤖 Generated with [Claude Code](https://claude.com/claude-code)
