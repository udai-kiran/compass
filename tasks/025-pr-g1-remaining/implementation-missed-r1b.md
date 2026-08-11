# Implementation evidence — missed R1 fix: accountBalancesAtDate

## Files changed

- `apps/api/src/modules/ledger/services/accounts.ts`
- `apps/api/src/modules/ledger/services/account-balances.test.ts`

## Diff

### accounts.ts — accountBalancesAtDate (lines 165–191)

```diff
-    select a.type,
-           a.opening_balance_paise as opening,
-           coalesce(p.total, 0) as posting_total
+    select a.type,
+           coalesce(p.total, 0) as posting_total

-  res.rows as Array<{ type: string; opening: string; posting_total: string }>
+  res.rows as Array<{ type: string; posting_total: string }>

-    const postingTotal = Number(r.posting_total);
-    if (!Number.isSafeInteger(postingTotal)) {
-      throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
-    }
-    const balancePaise = Number(r.opening) + postingTotal;
-    if (!Number.isSafeInteger(balancePaise)) {
+    const balancePaise = Number(r.posting_total);
+    if (!Number.isSafeInteger(balancePaise)) {
```

### account-balances.test.ts — test stubs and expected values

```diff
-  { type: "bank", opening: "50000", posting_total: "100000" },
-  { type: "loan", opening: "-2500000", posting_total: "0" },
+  { type: "bank", posting_total: "100000" },
+  { type: "loan", posting_total: "0" },

-  { type: "bank", balancePaise: 150000 },
-  { type: "loan", balancePaise: -2500000 },
+  { type: "bank", balancePaise: 100000 },
+  { type: "loan", balancePaise: 0 },

-  rows: [{ type: "investment", opening: "0", posting_total: "9007199254740993" }],
+  rows: [{ type: "investment", posting_total: "9007199254740993" }],
```

## Commands and output

### npm run typecheck
```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit

> @compass/docs@0.1.0 typecheck
> tsc --noEmit

> @compass/extractor@0.1.0 typecheck
> tsc --noEmit

> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit

> @compass/web@0.1.0 typecheck
> tsc --noEmit

> @compass/ai@0.1.0 typecheck
> tsc --noEmit

> @compass/shared@0.1.0 typecheck
> tsc --noEmit

EXIT: 0
```

### npm run lint
```
> compass@0.1.0 lint
> eslint .

EXIT: 0
```

## Assumptions

- `opening_balance_paise` is always 0 post-PR-G1 (boot check enforces this),
  so removing it from the SELECT and the computation is a no-op in production.
- The `params.length === 3` assertion in test 1 is unaffected: the three bound
  params (userId, asOf, userId) remain unchanged in the SQL.

## Unresolved risks

None.
