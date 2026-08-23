# Implementation-4: cleanupUser FK fix in catalog.route.test.ts

## Root cause
`cleanupUser` ran `DELETE FROM users WHERE id = $1`. The `categories.user_id` FK
has no `onDelete: cascade` (it's RESTRICT), so teardown of the
`categoryId ownership` test (which inserts a `categories` row for userId2)
threw a FK violation.

## Fix
Added one line to `cleanupUser` immediately before the user delete:

```ts
await app.db.delete(categories).where(eq(categories.userId, userId));
```

Both `categories` (line 25) and `eq` (line 14) were already imported — no new
import paths needed.

## Files changed
- `apps/api/src/modules/shopping/routes/catalog.route.test.ts` (one line added, line 81)

## Diff
```diff
@@ -78,6 +78,7 @@ async function createTestUser(): Promise<string> {
 }
 
 async function cleanupUser(userId: string): Promise<void> {
+  await app.db.delete(categories).where(eq(categories.userId, userId));
   await app.db.delete(users).where(eq(users.id, userId));
 }
```

## Commands run and output

### `npm run typecheck` (exit 0)
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
```

### `npm run lint` (exit 0)
```
> compass@0.1.0 lint
> eslint .
```

### `git status --porcelain`
```
M apps/api/src/modules/shopping/routes/catalog.route.test.ts
 M tasks/066-catalog-canonicalization/TASK.md
?? tasks/065-test-ci-agents/
?? tasks/066-catalog-canonicalization/implementation-3.md
...
```
(other entries are pre-existing untracked task files — not touched by this change)

### `git diff -- apps/api/src/modules/shopping/routes/catalog.route.test.ts`
```diff
diff --git a/apps/api/src/modules/shopping/routes/catalog.route.test.ts b/apps/api/src/modules/shopping/routes/catalog.route.test.ts
index 7e1984d..11a3632 100644
--- a/apps/api/src/modules/shopping/routes/catalog.route.test.ts
+++ b/apps/api/src/modules/shopping/routes/catalog.route.test.ts
@@ -78,6 +78,7 @@ async function createTestUser(): Promise<string> {
 }
 
 async function cleanupUser(userId: string): Promise<void> {
+  await app.db.delete(categories).where(eq(categories.userId, userId));
   await app.db.delete(users).where(eq(users.id, userId));
 }
```

## Assumptions
- `catalog_items.category_id` references `categories` with `onDelete: "set null"`,
  so deleting categories before the user is FK-safe (confirmed in brief).
- The test is DB-gated; no DATABASE_URL is available locally, so it was not
  executed (expected; runs in CI).

## Unresolved risks
None.
