# Final closure re-review — task 2.1 “Postings model & balance invariant”

## 1. Define transfer merge and unlink semantics, including child/reference remapping

**PARTIAL.**

Iteration 3 now makes the principal identity decisions:

- The outflow header survives a two-row merge.
- The counterpart’s attachments and transaction links move to the survivor.
- Both real postings move under the surviving header and the counterpart header is deleted.
- Unlink recreates two ordinary transactions and their system counter-postings.
- Fresh and inbox-created transfers use one header.
- Both extracted drafts receive the surviving ID.
- Card-repayment reuse follows the same merge operation.

See [TASK.md:36](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:36).

This directly addresses the current two-row behavior:

- `linkTransfer` currently only inserts a relationship between two existing headers: [transfers.ts:68](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:68), [transfers.ts:98](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:98).
- `unlinkTransfer` currently only deletes that relationship: [transfers.ts:134](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:134).
- Inbox transfer acceptance currently creates two transactions: [transfer-classification.ts:90](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:90), [transfer-classification.ts:101](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:101).
- It then stores different transaction IDs on the two extracted drafts: [transfer-classification.ts:114](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:114), [transfer-classification.ts:119](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:119).
- Card-repayment acceptance can reuse an existing paying-side transaction: [transfer-classification.ts:233](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:233), [transfer-classification.ts:256](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:256).

The remaining gap is that D16 only defines migration for attachments, `transaction_links`, and the two transfer-classification drafts. It does not define what happens to other references or header-only linkage metadata when the inbound header is deleted, nor how those references are divided again on unlink. Relevant current metadata includes:

- SIP linkage is stored directly on transaction headers and is mutated as header-only state: [sip-lifecycle.ts:501](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:501), [sip-lifecycle.ts:515](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:515).
- Reconciliation linkage is likewise explicitly classified by D18 as header-only metadata: [TASK.md:38](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:38).
- D16 says only that the outflow header survives and the counterpart header is deleted; it provides no conflict/allocation rule for metadata present on the discarded header: [TASK.md:36](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:36).

This is not asking task 2.1 to redesign those features. The plan only needs a deterministic merge/unlink rule—for example, reject incompatible linked headers, remap compatible references to the survivor, and define which recreated leg receives each leg-specific reference. Deleting a referenced header without such a rule is not implementation-ready.

## 2. Add `TransactionDrawer.tsx` and `apps/web/src/lib/queries.ts` to transfer Scope

**RESOLVED.**

Both files are now explicitly in the web Scope: [TASK.md:51](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:51). D16 also explicitly calls out their suggestion/link/unlink/record-transfer contracts: [TASK.md:36](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:36).

That covers the actual legacy two-ID consumers:

- The drawer loads transfer suggestions and matches either old leg ID: [TransactionDrawer.tsx:43](/home/udai/PennyPilot/apps/web/src/routes/transactions/TransactionDrawer.tsx:43), [TransactionDrawer.tsx:79](/home/udai/PennyPilot/apps/web/src/routes/transactions/TransactionDrawer.tsx:79).
- It currently unlinks through `transferLinkId`: [TransactionDrawer.tsx:210](/home/udai/PennyPilot/apps/web/src/routes/transactions/TransactionDrawer.tsx:210), [TransactionDrawer.tsx:215](/home/udai/PennyPilot/apps/web/src/routes/transactions/TransactionDrawer.tsx:215).
- It submits the old two-ID link contract: [TransactionDrawer.tsx:225](/home/udai/PennyPilot/apps/web/src/routes/transactions/TransactionDrawer.tsx:225), [TransactionDrawer.tsx:227](/home/udai/PennyPilot/apps/web/src/routes/transactions/TransactionDrawer.tsx:227).
- Query hooks currently encode the old link, unlink, and transfer-result contracts: [queries.ts:226](/home/udai/PennyPilot/apps/web/src/lib/queries.ts:226), [queries.ts:239](/home/udai/PennyPilot/apps/web/src/lib/queries.ts:239), [queries.ts:244](/home/udai/PennyPilot/apps/web/src/lib/queries.ts:244), [queries.ts:248](/home/udai/PennyPilot/apps/web/src/lib/queries.ts:248).
- The shared schemas currently expose two IDs and a `transferLinkId`: [ledger.ts:539](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:539), [ledger.ts:547](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:547), [ledger.ts:581](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:581).

The plan now clearly places all of these contracts in the atomic cutover.

## 3. Decide whether `"system"` is public or DB-internal and define narrowing

**RESOLVED.**

D17 explicitly chooses a DB-internal `"system"` account type and says not to add it to `AccountTypeSchema`: [TASK.md:37](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:37).

It also requires:

- Filtering/asserting `system_kind IS NULL` at every database-to-public boundary.
- Narrowing before casting to the public `AccountType`.
- Preventing system rows from reaching net-worth, return, or web-label exhaustive maps.

This is the correct choice given that the public schema currently contains only user-facing account types: [ledger.ts:5](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:5).

It also closes the current unsafe boundary:

- `accountBalancesAtDate` currently returns arbitrary database strings using `r.type as AccountType`: [accounts.ts:157](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:157), [accounts.ts:173](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:173).
- Net worth treats an unknown type as a correctness failure: [networth.ts:70](/home/udai/PennyPilot/apps/api/src/modules/investments/services/networth.ts:70), [networth.ts:74](/home/udai/PennyPilot/apps/api/src/modules/investments/services/networth.ts:74).

D9 includes generic-query exclusion, while D17 adds the necessary explicit boundary narrowing: [TASK.md:27](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:27), [TASK.md:37](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:37).

## 4. Specify user-restore precondition, regeneration, and old-ID remapping

**RESOLVED.**

D19 supplies the required concrete sequence: [TASK.md:39](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:39).

It explicitly covers:

1. Ignoring system accounts in the fresh-account guard.
2. Deliberately retaining or deleting seeded system accounts.
3. Regenerating exactly one account for each system kind.
4. Mapping archived system IDs to regenerated IDs by `system_kind`.
5. Rewriting `postings.account_id` before insertion.
6. Restoring real accounts and transactions before postings.
7. Never restoring archived system-account rows as ordinary accounts.

That directly resolves the current implementation conflicts:

- `accounts` is currently part of the completely-empty precondition: [restore-user.ts:13](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:13), [restore-user.ts:68](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:68).
- The same guard is repeated transactionally: [restore-user.ts:95](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:95).
- Registration-seeded rows are currently deleted generically in reverse table order: [restore-user.ts:105](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:105).
- Generic restoration only rewrites the table’s configured user column: [restore-user.ts:118](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:118), [restore-user.ts:122](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:122).

D19 correctly recognizes that postings have no `user_id`, so their account remapping requires an explicit pass rather than the generic user-column rewrite.

## 5. Separate archive round-trip, full-dump restore, and CSV verification

**RESOLVED.**

D8 now distinguishes the two backup products:

- JSON/encrypted archives round-trip posting rows.
- Transactions CSV is a human-readable, export-only projection.

See [TASK.md:26](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:26).

T7 then defines three separate verification cases:

- User archive export/restore with posting rows and system-account ID remapping.
- Full-dump restore with postings ordered after accounts and transactions.
- Human-readable CSV projection derived from postings.

See [TASK.md:67](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:67).

This is concrete and sufficient for task 2.1.

## 6. Audit `merchants.ts` and `sip-lifecycle.ts`; distinguish posting writes from header-only writes

**RESOLVED.**

D18 now draws the correct enforcement boundary:

- Every posting insertion/deletion or monetary, account, category, or necessity mutation goes through `postEntry`.
- Metadata/FK-only updates may use a clearly named header-only helper and must not touch postings.
- `merchants.ts`, `sip-lifecycle.ts`, and reconciliation header updates are explicitly classified and audited.

See [TASK.md:38](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:38).

Both previously omitted files are now in Scope: [TASK.md:46](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:46).

That classification matches the real writes:

- Merchant rename changes only `transactions.merchant` and `updatedAt`: [merchants.ts:49](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/merchants.ts:49), [merchants.ts:57](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/merchants.ts:57).
- SIP lifecycle clearing changes only `sipId` and `updatedAt`: [sip-lifecycle.ts:501](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:501), [sip-lifecycle.ts:515](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:515).
- The latter predicates use header date and SIP linkage fields, not the removed money columns, in the shown mutation paths: [sip-lifecycle.ts:512](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:512), [sip-lifecycle.ts:518](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:518).

No task 2.2–2.7 work is required to resolve this amendment.

## 7. Add recurring EMI and transaction-level real-posting parity

**PARTIAL.**

The recurring EMI half is fully resolved.

D21 requires two separate ordinary posting-backed transactions:

- A negative source-account transaction that counts as expense.
- A positive liability principal transaction that counts as neither income nor expense.

See [TASK.md:41](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:41).

That preserves the real implementation, which currently inserts the source transaction separately from the positive loan-principal transaction: [recurring.ts:287](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:287), [recurring.ts:303](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:303). T6(m) verifies the exact reporting result: [TASK.md:66](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:66).

The row-level consumer rule is also mostly specified correctly. D20 says list/search/detail and large-transaction consumers select the single real posting, retain the signed amount and account filter, and exclude openings and transfers: [TASK.md:40](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:40). That matches current large-alert behavior:

- One query row and notification key per transaction: [prefs.ts:91](/home/udai/PennyPilot/apps/api/src/modules/system/services/prefs.ts:91), [prefs.ts:102](/home/udai/PennyPilot/apps/api/src/modules/system/services/prefs.ts:102).
- Threshold applies to the signed real amount: [prefs.ts:92](/home/udai/PennyPilot/apps/api/src/modules/system/services/prefs.ts:92), [prefs.ts:96](/home/udai/PennyPilot/apps/api/src/modules/system/services/prefs.ts:96).
- Openings are excluded: [prefs.ts:97](/home/udai/PennyPilot/apps/api/src/modules/system/services/prefs.ts:97).
- The account filter applies to the real account: [prefs.ts:98](/home/udai/PennyPilot/apps/api/src/modules/system/services/prefs.ts:98).
- Transfers are excluded: [prefs.ts:99](/home/udai/PennyPilot/apps/api/src/modules/system/services/prefs.ts:99).

However, D20 ends with the contradictory statement that a transfer produces “none/one, not N”: [TASK.md:40](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:40). The same looseness appears in T6(l), which requires that a transfer produce “not two” alerts rather than zero: [TASK.md:66](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:66).

Current parity is unambiguously zero alerts for a transfer, not zero-or-one. Because the new transfer has two real postings, permitting one alert would make the result dependent on arbitrary posting selection and violate both the preceding sentence in D20 and current `prefs.ts`.

## Final verdict

**STILL-BLOCKING.**

Only two genuine blockers remain:

1. Complete D16’s reference policy. It must define how references/header linkage on the discarded transaction are handled during merge and allocated or rejected during unlink, beyond attachments, transaction links, and the two extracted drafts. This is required to prevent dangling references or silent metadata loss when the counterpart header is deleted.

2. Make large-transaction transfer parity unequivocal: transfers produce **zero** alerts. Replace D20’s “none/one” and T6(l)’s “not two” with an explicit zero-alert requirement.

Everything else from review-2’s final seven amendments is resolved. Physical removal of `transfer_links`/`transaction_splits`, a DB trigger, broader multi-leg API work, and postings-native UI remain properly deferred to tasks 2.2, 2.3, 2.5, 2.6, and 2.7 rather than being blockers here.