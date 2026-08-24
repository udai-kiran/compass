Implemented all three requested fixes. Only these files were modified:

- `apps/api/src/modules/shopping/services/cart-draft-generator.ts`
- `apps/api/src/modules/shopping/routes/cart-drafts.ts`
- `apps/api/src/modules/shopping/services/cart-draft-generator.test.ts`

Changes:

```diff
--- a/cart-draft-generator.ts
+++ b/cart-draft-generator.ts
@@
     habitProfile?.consumptionBasePerMonth === null ||
     habitProfile?.consumptionBasePerMonth === undefined ||
+    habitProfile.consumptionBasePerMonth === 0 ||
     habitProfile.unit === null ||
@@
-      deltaPaise: usual.pricePaise - price.pricePaise,
+      deltaPaise: usualUnitPrice - candidateUnitPrice,
```

```diff
--- a/cart-drafts.ts
+++ b/cart-drafts.ts
@@
-        if (!item.isRemoved && req.body.isRemoved && item.catalogItemId) {
+        const teachItemId = item.substitutionForItemId ?? item.catalogItemId;
+        if (!item.isRemoved && req.body.isRemoved && teachItemId) {
           const habit = await tx.query.habitProfiles.findFirst({
-            where: and(eq(habitProfiles.userId, userId), eq(habitProfiles.catalogItemId, item.catalogItemId)),
+            where: and(eq(habitProfiles.userId, userId), eq(habitProfiles.catalogItemId, teachItemId)),
           });
```

```diff
--- a/cart-draft-generator.test.ts
+++ b/cart-draft-generator.test.ts
@@
   it("skips an item without a learned consumption rate", () => {
     ...
   });
+
+  it("skips an item with a zero consumption rate", () => {
+    assert.equal(
+      shouldReplenish(
+        { quantityBase: null, unit: null, expectedDepletionAt: null },
+        { consumptionBasePerMonth: 0, unit: "g" as const },
+        now,
+      ),
+      false,
+    );
+  });
```

Verification commands and output:

```text
$ node --test apps/api/src/modules/shopping/services/cart-draft-generator.test.ts
▶ shouldReplenish
  ✔ replenishes stock expected to deplete in three days
  ✔ does not replenish stock expected to deplete in ten days
  ✔ replenishes when stock quantity is unknown
  ✔ skips an item without a learned consumption rate
  ✔ skips an item with a zero consumption rate
✔ shouldReplenish
▶ suggestQuantity
  ✔ returns one integer month of supply
✔ suggestQuantity
▶ price spike calculation
  ✔ flags a current price at 125% of the average
  ✔ does not flag a current price at 110% of the average
  ✔ does not flag a missing price history
✔ price spike calculation
▶ calculateDraftTotalPaise
  ✔ sums only non-removed priced lines, treating missing prices as zero
✔ calculateDraftTotalPaise
▶ teaching signal
  ✔ clamps a decremented observation count at zero
✔ teaching signal
ℹ tests 11
ℹ suites 5
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 332.841077
Exit code: 0
```

```text
$ npm run typecheck

> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit
...
> @compass/shared@0.1.0 typecheck
> tsc --noEmit
Exit code: 0
```

```text
$ npm run lint

> compass@0.1.0 lint
> eslint .
Exit code: 0
```

The new zero-rate test was run before the implementation and failed as intended with `true !== false` (exit code 1), then passed after the guard was added.

Issues/risks/deviations:

- None in the requested changes.
- The worktree contained numerous pre-existing unrelated changes. I did not modify them. `git diff --check` reports pre-existing trailing whitespace in `tasks/075-reward-aware-checkout/review-3.md`, outside this task’s permitted files.