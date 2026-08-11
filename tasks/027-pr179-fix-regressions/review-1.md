## Review result

No BLOCKING findings. The three proposed production fixes are technically sound. One implementation detail for B2 should be explicit: match `HttpError` by class, status, and exact message.

## IMPORTANT

### B2 — use the full `HttpError` shape, not status alone

Current code catches a constraint that `linkTransfer` no longer writes:

[transfer-classification.ts:306](/home/udai/common/compass/apps/api/src/modules/ingest/services/transfer-classification.ts:306)

```ts
} catch (err) {
  if (isUniqueViolation(err, "transfer_links_out_transaction_id_unique")) {
    throw new HttpError(
      409,
      "That payment was linked to another transfer just now — reload and try again.",
    );
  }
  throw err;
}
```

The replacement should be:

```ts
if (
  err instanceof HttpError &&
  err.statusCode === 409 &&
  err.message === "Transaction is already part of a transfer"
)
```

Checking only `statusCode === 409` would incorrectly relabel other conflicts thrown inside the transaction, including the ambiguous-candidate error at [transfer-classification.ts:261](/home/udai/common/compass/apps/api/src/modules/ingest/services/transfer-classification.ts:261) and identity conflicts from `remapReferences`.

The exact losing-race signal is confirmed at [transfers.ts:153](/home/udai/common/compass/apps/api/src/modules/ledger/services/transfers.ts:153):

```ts
for (const stored of [outPostings, inPostings]) {
  const shape = classifyShape(stored, systemKindOf);
  if (shape === "transfer") throw new HttpError(409, "Transaction is already part of a transfer");
```

After waiting for the `FOR UPDATE` lock, the losing request sees the already-merged survivor’s two-real-posting shape. `classifyShape` identifies that shape at [postings.ts:303](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.ts:303):

```ts
if (realCount === 2 && systemCount === 0) return "transfer";
```

The outflow transaction is guaranteed to survive by [collapse-transfer.ts:32](/home/udai/common/compass/apps/api/src/modules/ledger/services/collapse-transfer.ts:32):

```ts
export function survivorOf(
  outTransactionId: string,
  inTransactionId: string,
): { survivorId: string; absorbedId: string } {
  return { survivorId: outTransactionId, absorbedId: inTransactionId };
}
```

`HttpError` has no domain discriminator beyond class, `statusCode`, and `message`:

[errors.ts:1](/home/udai/common/compass/apps/api/src/lib/errors.ts:1)

```ts
export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}
```

Matching the literal is somewhat coupled, but it is acceptably narrow here: the repository contains only this one occurrence of that exact message. Adding a domain error code would be cleaner architecturally, but would expand the planned scope into `lib/errors.ts` for little immediate benefit.

The stale comment at [transfer-classification.ts:173](/home/udai/common/compass/apps/api/src/modules/ingest/services/transfer-classification.ts:173) definitely needs replacement:

```ts
The real atomic claim is the `transfer_links`
insert itself — `transfer_links_out_transaction_id_unique` guarantees only
one link can ever commit for a given out-leg
```

It should instead describe the sorted `FOR UPDATE` header locks and the post-lock posting-shape validation.

## MINOR

### B2 — “zero code anywhere inserts transfer_links” needs qualification

No normal ledger or transfer path explicitly inserts `transfer_links`; `linkTransfer` instead deletes the absorbed transaction and writes two real postings at [transfers.ts:181](/home/udai/common/compass/apps/api/src/modules/ledger/services/transfers.ts:181):

```ts
await t.delete(postings).where(eq(postings.transactionId, absorbedId));
await t
  .delete(transactions)
  .where(and(eq(transactions.id, absorbedId), eq(transactions.userId, userId)));

await postTransaction(
  t,
  survivorId,
  userId,
  buildTransferPostings({
```

However, “zero code anywhere” is not literally true. Generic backup restore inserts every archived table, including `transfer_links`, through [restore-user.ts:153](/home/udai/common/compass/apps/api/src/modules/system/services/restore-user.ts:153):

```ts
for (const table of tables) {
  const rows = header.tables[table];
  ...
  await insertRow(client, table, firstPassRow(table, rewritten));
}
```

`transfer_links` remains in the restorable table list. This does not rescue the old catch: `acceptRepayment`/`linkTransfer` performs no `transfer_links` insert, so that unique constraint cannot be raised by the operation being caught.

## Confirmed fixes

### PE1 — proposed one-line filter is correct

The transaction schema exposes the column as SQL `is_opening`:

[ledger.ts:59](/home/udai/common/compass/apps/api/src/db/shared/ledger.ts:59)

```ts
isOpening: boolean("is_opening").notNull().default(false),
```

The alias `t` is `transactions`, so `t.is_opening` is valid in the raw SQL.

The current activity-list query lacks the exclusion:

[cards.ts:342](/home/udai/common/compass/apps/api/src/modules/credit/services/cards.ts:342)

```sql
from postings p
join transactions t on t.id = p.transaction_id
...
where p.account_id = ${accountId}
  and t.user_id = ${userId} and t.deleted_at is null
  and t.date >= ${fromInclusive} and t.date <= ${ref}
```

Adding only:

```sql
and not t.is_opening
```

correctly prevents the opening transaction from becoming a billed or unbilled line item.

The premise that every account type now receives such a row is confirmed at [accounts.ts:18](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:18):

```ts
/** All account types carry their opening balance as a ledger transaction ... */
function carriesOpeningAsTransaction(_type: AccountType): boolean {
  return true;
}
```

The sibling balance query must remain unchanged:

[cards.ts:325](/home/udai/common/compass/apps/api/src/modules/credit/services/cards.ts:325)

```sql
select
  coalesce(sum(p.amount_paise), 0)::bigint as total,
  coalesce(sum(p.amount_paise) filter (where t.date < ${billedBefore}), 0)::bigint as at_close
from postings p
join transactions t on t.id = p.transaction_id
where p.account_id = ${accountId} ...
```

It calculates the actual card balance and statement-close due; excluding the opening posting there would understate both.

I found no second card activity-list query with the same defect:

- `listCardHolders` at [cards.ts:229](/home/udai/common/compass/apps/api/src/modules/credit/services/cards.ts:229) contains only balance/current-spend aggregates. Including opening in `total` and `at_close` is correct; its negative-only, post-close `current_spend` filter does not generally treat the opening balance as spend.
- `ledgerDuesAtDates` at [reconciliation-reads.ts:123](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-reads.ts:123) is also a balance-at-date aggregate and correctly includes opening postings.
- The generic account transaction ledger is a distinct product surface intended to expose real ledger rows, including the explicitly created “Opening balance” row; it is not another CRED-style card line-item query.

Thus PE1 is correct and narrowly scoped.

### B3 — proposed lateral ordering is correct

The current query contradicts its own documented exemption:

[sip-installments.ts:420](/home/udai/common/compass/apps/api/src/modules/investments/services/sip-installments.ts:420)

```ts
* applies — account, sign, opening-row and date window are all ignored here. A
* row that is already linked must stay visible even if a later edit moved it to
* another account, flipped its sign, or pushed it outside the SIP's date window
```

Yet the lateral join requires the current target account:

[sip-installments.ts:436](/home/udai/common/compass/apps/api/src/modules/investments/services/sip-installments.ts:436)

```sql
select p.amount_paise
from postings p
join accounts a on a.id = p.account_id
where p.transaction_id = t.id and a.system_kind is null and p.account_id = ${targetAccountId}
limit 1
```

Removing the account predicate fixes the invisibility bug. Keeping `a.system_kind is null` is necessary so the picker reports a real-account amount rather than an Expenses, Income, or Opening counter-posting.

The proposed ordering is appropriate:

```sql
order by (p.amount_paise > 0) desc, p.id
```

For an ordinary or split transaction there is exactly one real posting. A valid transfer has exactly two real postings with opposite signs, so the ordering selects its positive destination leg—the leg that could originally have qualified as an account-target SIP deposit. This is also consistent with the free-row query at [sip-installments.ts:487](/home/udai/common/compass/apps/api/src/modules/investments/services/sip-installments.ts:487):

```ts
.innerJoin(
  postings,
  and(
    eq(postings.transactionId, transactions.id),
    eq(postings.accountId, accountId),
    gt(postings.amountPaise, 0),
  ),
)
```

A split with multiple non-system postings is not a valid ledger shape: `classifyShape` permits a split only with one real posting and multiple system counters. Therefore the suggested ordering does not misrepresent a valid split. `p.id` only makes malformed/tied data deterministic.

There is no cleaner historical-account filter available. The SIP stores its current target account, not the account on which the installment was originally linked; using that value would reproduce the bug. The transaction header’s projected `account_id` is also unsuitable because a merged transfer projects its outflow leg.

Repository search confirms `linkedInstallmentRows` has one call site:

[sip-installments.ts:543](/home/udai/common/compass/apps/api/src/modules/investments/services/sip-installments.ts:543)

```ts
const [linked, unlinked] = await Promise.all([
  linkedInstallmentRows(db, userId, sipId, sip.targetAccountId!),
```

Dropping `targetAccountId` from both the function signature and this call is correct.

The difference from `unlinkedInstallmentRows` is intentional:

- Unlinked rows must still be positive postings in the SIP’s current target account, inside its date window, non-opening, and unclaimed.
- Linked rows deliberately ignore those eligibility rules so an edited or merged row remains visible for detachment.

Thus B3 is correct as proposed.