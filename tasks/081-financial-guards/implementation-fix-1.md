Implemented the four requested review-3 fixes.

Files modified:

- `packages/shared/src/schemas/shopping.ts`
  - Caps EMI principal at ₹100 crore.
  - Converts malformed `emiOffers` JSON into a Zod validation issue.

- `apps/api/src/modules/planning/services/goals.ts`
  - Reuses already-loaded progress data for projection; removes duplicate DB reads.

- `apps/api/src/modules/shopping/services/financial-guards.test.ts`
  - Uses the capped large-fee value.
  - Adds malformed `emiOffers` JSON coverage.

Complete requested diff:

```diff
diff --git a/packages/shared/src/schemas/shopping.ts b/packages/shared/src/schemas/shopping.ts
@@
 export const EmiOfferInputSchema = z.object({
-  principalPaise: z.number().int().nonnegative().safe(),
+  /** Max ₹100 crore — keeps all derived EMI values within safe-integer range. */
+  principalPaise: z.number().int().nonnegative().max(10_000_000_000),
@@
   emiOffers: z
     .string()
     .optional()
-    .transform((s) => {
+    .transform((s, ctx) => {
       if (!s) return undefined;
-      return z.array(EmiOfferInputSchema).max(10).parse(JSON.parse(s));
+      let parsed: unknown;
+      try {
+        parsed = JSON.parse(s);
+      } catch {
+        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "emiOffers must be valid JSON" });
+        return z.NEVER;
+      }
+      return z.array(EmiOfferInputSchema).max(10).parse(parsed);
     }),
 });
diff --git a/apps/api/src/modules/planning/services/goals.ts b/apps/api/src/modules/planning/services/goals.ts
@@
-  // Keep the progress path aligned with the side-effect-free advisory loader.
-  const projectionInputs = await getGoalProjectionInputs(db, userId, id);
-  const proj = projectGoal(projectionInputs);
+  const proj = projectGoal({
+    assets: assets.map((a) => ({ valuePaise: a.valuePaise, annualReturnBps: a.annualReturnBps })),
+    targetPaise: target,
+    monthsToTarget,
+    monthlyInflowPaise,
+  });
diff --git a/apps/api/src/modules/shopping/services/financial-guards.test.ts b/apps/api/src/modules/shopping/services/financial-guards.test.ts
@@
-  const largeFee = decomposeEmi(900_000_000_000_000, 1, 0, 10_000);
+  const largeFee = decomposeEmi(9_000_000_000, 1, 0, 10_000);
@@
-  assert.equal(largeFee.processingFeePaise, 900_000_000_000_000);
+  assert.equal(largeFee.processingFeePaise, 9_000_000_000);
@@
 test("FinancialGuardsQuerySchema coerces GET query values and parses EMI offers", () => {
@@
 });
+
+test("FinancialGuardsQuerySchema rejects malformed emiOffers JSON with a validation error", () => {
+  const result = FinancialGuardsQuerySchema.safeParse({
+    cartTotalPaise: "100000",
+    emiOffers: "{bad",
+  });
+  assert.equal(result.success, false);
+});
```

Commands and outputs:

```text
$ node --import tsx --test apps/api/src/modules/shopping/services/financial-guards.test.ts
Before implementation: exit 1
- 5 passed, 1 failed
- Failure: SyntaxError from JSON.parse for emiOffers: "{bad"

After implementation: exit 0
- 6 passed, 0 failed
```

```text
$ npm run typecheck
Exit code: 0
All workspaces completed `tsc --noEmit`.
```

```text
$ npm run lint
Exit code: 0

> compass@0.1.0 lint
> eslint .
```

```text
$ npm run test -w packages/shared
Exit code: 0
351 passed, 0 failed.
```

```text
$ npm run test -w apps/api
Exit code: 1
979 passed, 33 failed, 1 skipped.

All financial-guards tests passed, including:
- FinancialGuardsQuerySchema rejects malformed emiOffers JSON with a validation error

Failure cause: `.env` and `DATABASE_URL` are unavailable. The 33 failures are existing DB-backed suites that explicitly require a real Postgres/Redis environment, e.g. `app.test.ts`, automation, credit, ledger, planning, shopping route, and system tests.
```

```text
$ git diff --check
Exit code: 1
Blocked by pre-existing trailing whitespace in unrelated file:
tasks/075-reward-aware-checkout/review-3.md:3
```

No files were created or deleted. No requested-out-of-scope application files were changed.