## Findings

- Low — [account-balances.test.ts:31](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/account-balances.test.ts:31): the parameter assertion filters compiled parameters to strings before comparison. It proves the three required string bindings and their order, including duplicate `userId`, but would not detect an additional non-string bound parameter. This is a limited false-positive risk in the test, not an implementation defect; the real query currently contains exactly those three bindings.

- Low — [networth.ts:59](/home/udai/PennyPilot/apps/api/src/modules/investments/services/networth.ts:59): the bucket initializer was unnecessarily reformatted into one long line, and explanatory classification comments around the loop were removed. This deviates from the instruction to leave that surrounding code unchanged, but causes no runtime or net-worth behavior change.

No correctness, security, or regression findings were identified.

## Required confirmations

- [accounts.ts:162](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:162): the moved SQL template is byte-identical to the query in HEAD, including whitespace and query text. Its bindings remain exactly `[userId, asOf, userId]`, in that order, at lines 168 and 171.

- [accounts.ts:173](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:173) and [networth.ts:62](/home/udai/PennyPilot/apps/api/src/modules/investments/services/networth.ts:62): row mapping and classification reproduce the prior behavior exactly. `Number(r.balance)` still converts PostgreSQL `::bigint` strings; unknown types still throw; `insurance` still skips through the retained `bucket === null` branch; bucket, asset, and liability arithmetic is unchanged. Net-worth numbers are therefore provably preserved.

- [networth.ts:2](/home/udai/PennyPilot/apps/api/src/modules/investments/services/networth.ts:2): `sql` is genuinely unused after the move. Every remaining Drizzle import is used: `and`/`eq` at line 294 and elsewhere, `asc` at line 520, `gte` at lines 260/358, `lt` at line 259, and `lte` at line 359. No unused import was introduced.

- [networth.ts:9](/home/udai/PennyPilot/apps/api/src/modules/investments/services/networth.ts:9): the investments→ledger import resolves correctly. The same investments→`accounts.ts` dependency already exists through `goal-networth.ts`; `accounts.ts` does not import `networth.ts` or the ledger transaction service that imports investments code. No new cycle or module-initialization hazard is introduced.

- [account-balances.test.ts:10](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/account-balances.test.ts:10): the stub intercepts the real `accountBalancesAtDate` call rather than recreating its query. `PgDialect.sqlToQuery` compiles the captured real SQL object and sees all three current parameters. Lines 14–27 exercise positive, negative, and greater-than-`MAX_SAFE_INTEGER` bigint strings and verify the existing `Number()` precision behavior.

- [accounts.ts:168](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:168): both the transaction subquery and outer account query remain scoped by bound `userId` parameters. `asOf` is also bound, so user isolation and SQL-injection resistance are unchanged.

- `networth.test.ts` and `routes/networth.route.test.ts` have no diff against HEAD.

- After excluding the specified SP2b schema/shared-db work and task files, the only working-tree changes are [accounts.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts), [networth.ts](/home/udai/PennyPilot/apps/api/src/modules/investments/services/networth.ts), and [account-balances.test.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/account-balances.test.ts).

The SP1 implementation is correct, and net-worth behavior is preserved.