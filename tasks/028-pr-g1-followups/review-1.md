## Review findings

The plan is not ready as written. It has three material problems: incomplete F7 scope, contradictory F10 acceptance criteria, and an F11 test that does not prove contention.

### 1. Incorrect assumptions about existing code

- F7 overlooks another live dormant query in [postings-periods-parity.test.ts](/home/udai/common/compass/apps/api/src/lib/postings-periods-parity.test.ts:123). `legacySpentByCategory`’s split-parts query still uses `transfer_links`, exactly like the two `legacySpendByNecessity` queries. AC4 requires no live `transfer_links` query in this file, but the implementation steps mention only lines 177 and 191. P2/P3 must include line 123.

- AC5’s claim that there are “all 6 non-zero-opening ... calls across the 5 test files” is incorrect. The named cases alone include:

  - postings-periods test 8: 1
  - reconciliation tests: Diners, two overflow tests, preexisting opening: 4
  - card-due AC15: 1
  - postings-balance: bank and card: 2

  That is eight named cases before considering the numerous non-zero openings in planning parity and additional postings-balance tests.

- The postings-balance comment saying the card has a “column-based opening balance” is stale. `carriesOpeningAsTransaction()` currently returns true for every account type, including credit cards and loans. F10 changes should not perpetuate that assumption.

- “All test helpers pass a stable date when opening balance ≠ 0” is too broad and contradicts the actual fixtures. Several tests intentionally use wall-clock-relative periods and need an opening dated today.

### 2. Missing scope and edge cases

- Add the missing `legacySpentByCategory` split query at line 123 to F7 scope and acceptance criteria.

- F10 should enumerate individual call sites and intended dates rather than globally changing helper defaults. Helpers should accept and forward an optional date; only selected calls should supply one.

- The plan should specify the `createAccount` signature precisely, such as:

  ```ts
  createAccount(db, userId, input, openingDate?)
  ```

  and use:

  ```ts
  date: openingDate ?? new Date().toISOString().slice(0, 10)
  ```

- Stable dates must be chosen according to each reader’s date window:

  - periods test 8: `2020-06-01`
  - reconciliation fixed-close fixtures: before their statement close
  - postings-balance bank/card fixtures: `2020-01-01`
  - card-due AC15: `2020-01-01`
  - dynamic rolling-window fixtures: generally leave omitted or derive a relative date

- AC5 should distinguish wall-clock “bomb” fixes from semantic strengthening. Not every non-zero opening is a date bomb.

### 3. Potential regressions

- Giving a wrapper a fixed default opening date would break dynamic tests. In particular, planning test 9 only counts postings from one year before today through today; a fixed historical opening would disappear from the result.

- Other planning tests use current-month/current-day behavior. Applying a blanket historical date may move their opening outside the production reader’s window, making exclusion assertions vacuous or changing expected balances.

- Postings-balance contains other non-zero openings, including the loan and overflow-card fixtures. They should not automatically receive `2020-01-01`; their intended as-of semantics must be checked individually.

- F11’s proposed assertion—exactly one opening posting—would pass in many broken implementations. Both production functions locate and update an existing opening transaction, and the account row’s `FOR UPDATE` lock also provides some serialization. The assertion therefore does not isolate the advisory-lock contract.

### 4. Test 9 `savingsWithOpening`

Yes: `savingsWithOpening` must **not** be changed to a fixed past date.

The query explicitly restricts dates to `cutoffIso` (today minus 365 days) through `today`, and the expected total includes the opening’s `+20000`. Leaving `openingDate` omitted correctly places it at today. Setting it to `2020-01-01` would exclude it and reduce the result from `200000` to `180000`.

The plan’s omission of a direct change at line 783 is correct, but its statement that all helpers/calls with non-zero openings receive stable dates is not. AC5 must explicitly exempt test 9 and require its call to remain without an `openingDate`.

### 5. F12 type change

The proposed F12 type compiles structurally.

`Db` is:

```ts
NodePgDatabase<typeof schema> & { readonly $client: pg.Pool }
```

A `Db` is assignable to `Omit<Db, "$client">`, so passing the locally constructed `lockedDb` to `fn` is valid. The omitted type retains Drizzle methods such as `.transaction()`, which are the only relevant methods used by the two callbacks.

Thus this signature is sound:

```ts
fn: (lockedDb: Omit<Db, "$client">) => Promise<T>
```

It accurately prevents callback code from assuming that `$client` is a pool when the runtime object is backed by a `PoolClient`.

### 6. F11 `Promise.all` contention

`Promise.all()` will start both callers and, if their lock-acquisition intervals overlap, they use separate dedicated pool clients and genuinely compete for the same PostgreSQL session advisory lock.

However, the proposed test is too weak because it does not prove that overlap occurred. One operation may acquire, complete, and release the lock before the other reaches PostgreSQL. The test would still pass. “Exactly one opening posting” also does not demonstrate blocking or a particular serial order.

A reliable test should use the existing `absorbCarryover` hook:

1. Start `absorbCarryover`.
2. Pause it at `afterAggregate` while its advisory lock is held.
3. Start the real `updateAccount`.
4. Verify `updateAccount` remains pending while the hook is paused.
5. Release the hook.
6. Await both operations and assert the exact final opening amount corresponding to the enforced serial order, plus exactly one live opening posting.

That directly exercises both production callers and proves PostgreSQL-level advisory-lock contention. A timeout-only pending assertion is imperfect but materially stronger; ideally it should also inspect `pg_stat_activity`/`pg_locks` to confirm the second backend is waiting on an advisory lock.

## Verdict

F12 is correct, and the plan is correct not to re-date planning test 9. F7 scope and AC4 are inconsistent, F10’s call count and blanket wording are wrong, and F11 does not adequately verify contention. Those items should be corrected before implementation.