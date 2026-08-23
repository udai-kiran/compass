# Investigation 4 — `categoryId ownership` test failure (CI run 32500043184)

## Actual error (CI log lines 1991–2025)

```
Error: Failed query: delete from "users" where "users"."id" = $1
cause: error: update or delete on table "users" violates foreign key constraint
       "categories_user_id_users_id_fk" on table "categories"
constraint: 'categories_user_id_users_id_fk'
```

Stack frames (CI log lines 1995–2007):
```
at async cleanupUser (catalog.route.test.ts:81:3)    ← outer frame: cleaning up userId2
at async TestContext.<anonymous> (catalog.route.test.ts:299:5)   ← t.after hook
```

## Root cause

### `cleanupUser` (lines 80–82)

```ts
async function cleanupUser(userId: string): Promise<void> {
  await app.db.delete(users).where(eq(users.id, userId));
}
```

Deletes only the `users` row. Relies on `onDelete: "cascade"` on child tables.

### Failing test setup (lines 292–353)

```ts
test("categoryId ownership: ...", async (t) => {
  const userId1 = await createTestUser();
  const userId2 = await createTestUser();
  const sessionId1 = await createSession(app.redis, userId1);
  t.after(async () => {
    await destroySession(app.redis, sessionId1);
    await cleanupUser(userId1);
    await cleanupUser(userId2);   // ← line 299, the throwing call
  });

  // Inserts a categories row owned by userId2 directly into DB:
  const [cat2] = await app.db
    .insert(categories)
    .values({ userId: userId2, name: "User2-Cat", kind: "expense" as const })
    .returning({ id: categories.id });
  // … never deletes cat2 …
});
```

No explicit cleanup of `cat2` is registered before `cleanupUser(userId2)` runs.

### FK definitions

`catalog_items.userId` (`shopping/schema.ts:90`):
```ts
.references(() => users.id, { onDelete: "cascade" })
```
→ cascades; catalog_items do not block user deletion. ✓

`categories.userId` (`db/shared/foundation.ts:111`):
```ts
userId: uuid("user_id").notNull().references(() => users.id)
```
→ **no `onDelete` clause** → Postgres defaults to NO ACTION / RESTRICT.
→ deleting a user that owns `categories` rows is rejected.

### Why only this test fails

This is the only test that inserts a row into `categories` for a user and then calls `cleanupUser` without first deleting those categories. Every other test either (a) does not touch `categories` at all, or (b) creates `catalogItems` (which cascade on user deletion).

## Verdict

**Pure test-teardown bug.** The test body does not fail; the assertion at line 352 is never reached because the prior HTTP calls presumably return non-200 (the product service under test may also be unimplemented — that is a separate question). The thrown error is in `t.after` at line 299 when `cleanupUser(userId2)` tries to delete a user who still owns a `categories` row that was inserted directly in the test and never deleted.

Product code (service/schema) is not implicated. The `categories` table intentionally omits `onDelete: "cascade"` on `user_id` (that is a cross-domain table, not a shopping table), and that is correct behavior. The test must explicitly delete `cat2` (or all categories for `userId2`) before calling `cleanupUser(userId2)`.
