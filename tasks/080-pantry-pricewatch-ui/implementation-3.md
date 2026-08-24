Implemented both Pantry & Price Watch fixes.

Files modified:

- `apps/web/src/routes/shopping/pantry-view.ts`
  - Removed unused `dateLabel` formatter.
  - Changed chart labels to ISO `YYYY-MM-DD` strings.
  - Added a zero-price baseline guard to prevent `Infinity%`.

- `apps/web/src/routes/shopping/pantry-view.test.ts`
  - Updated chart-label expectations to ISO dates.
  - Added coverage for `maxObservedPricePaise === 0`.

Files created/deleted: none.

Diff evidence:

```diff
-const dateLabel = new Intl.DateTimeFormat("en-IN", { ... });
...
-labels: sorted.map((point) => dateLabel.format(point.observedAt)),
+labels: sorted.map((point) => point.observedAt.toISOString().slice(0, 10)),
...
 if (!flagged || maxObservedPricePaise === null) return "✓ Price appears fair";
+if (maxObservedPricePaise === 0) return "⚠ No valid price baseline to compare";
```

```diff
-{ labels: ["02 Jan", "03 Mar"], values: [9900, 12500] },
+{ labels: ["2026-01-02", "2026-03-03"], values: [9900, 12500] },
...
-{ labels: ["22 Aug"], values: [100] },
+{ labels: ["2026-08-22"], values: [100] },
...
+assert.equal(honestyVerdict(true, 0, 12500), "⚠ No valid price baseline to compare");
```

Verification commands and outputs:

```text
node --import tsx --test apps/web/src/routes/shopping/pantry-view.test.ts
# Before implementation: exit 1
# Failures:
# - localized labels ("02 Jan") differed from expected ISO labels
# - zero baseline returned "Infinity%" instead of the guard verdict

node --import tsx --test apps/web/src/routes/shopping/pantry-view.test.ts
# After implementation: exit 0
# tests 5; pass 5; fail 0

npm run test -w apps/web
# exit 0
# tests 316; pass 316; fail 0

npm run typecheck
# exit 0
# All workspaces completed `tsc --noEmit`.

npm run lint
# exit 0
# `eslint .` completed without output/errors.

npm run build -w apps/web
# exit 0
# vite v8.2.1; 356 modules transformed; built successfully in 186ms.
```

No issues, risks, or deviations. The two requested files were already untracked in the pre-existing worktree, so Git’s regular diff does not show a tracked-file patch; scoped status confirms only these two Pantry files were touched by this task.