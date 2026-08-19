## Verdict

The current plan is not ready to implement.

- Approach C is unavailable in installed Drizzle and remains unavailable in current upstream PostgreSQL migrator code.
- Approach A does not work: all pending migrations share one transaction.
- Casting `'self'` through `text`, moving the INSERT to a later migration, or using a subquery also does not work; no pending-file boundary commits the enum addition.
- The smallest migration-only repair is to replace `ALTER TYPE ... ADD VALUE` with a transactional enum replacement in `0001`, then retain the existing backfill.
- Production must have its migration ledger reconciled before deploying any such change. Its next migration run currently attempts `0001`–`0003` against an already-current schema and fails.
- A local disposable PostgreSQL Docker container is the practical AC1 test target.

## 1. Approach C: not supported

Installed versions are:

- `drizzle-orm` 0.45.2
- `drizzle-kit` 0.31.10

The PostgreSQL migrator creates one transaction outside the migration loop:

```js
await session.transaction(async (tx) => {
  for await (const migration of migrations) {
    if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) {
      for (const stmt of migration.sql) {
        await tx.execute(sql.raw(stmt));
      }
      // ledger INSERT
    }
  }
});
```

See [dialect.js](/home/udai/common/compass/node_modules/drizzle-orm/pg-core/dialect.js:60). The transaction begins at line 60, the migration loop is lines 61–70, and the commit can occur only after line 71.

There is no transaction option in the programmatic migrator:

- `MigrationConfig` contains only `migrationsFolder`, `migrationsTable`, and `migrationsSchema`: [migrator.d.ts](/home/udai/common/compass/node_modules/drizzle-orm/migrator.d.ts:5).
- The node-postgres entry point simply reads every journal entry and calls the same dialect migrator: [migrator.js](/home/udai/common/compass/node_modules/drizzle-orm/node-postgres/migrator.js:1).
- Its type accepts only `MigrationConfig`: [migrator.d.ts](/home/udai/common/compass/node_modules/drizzle-orm/node-postgres/migrator.d.ts:1).

There is no Drizzle Kit escape hatch either. Its config has:

```ts
breakpoints?: boolean;
migrations?: {
  table?: string;
  schema?: string;
  prefix?: Prefix;
};
```

See [index.d.ts](/home/udai/common/compass/node_modules/drizzle-kit/index.d.ts:112). There is no transaction strategy or opt-out field.

`--> statement-breakpoint` is not a transaction marker. The reader merely splits a file into statements at that string: [migrator.js](/home/udai/common/compass/node_modules/drizzle-orm/migrator.js:12). Although it records the journal’s `breakpoints` value as `bps`, the PostgreSQL dialect ignores `bps` and executes every split statement through the same `tx`: [dialect.js](/home/udai/common/compass/node_modules/drizzle-orm/pg-core/dialect.js:63).

The installed Drizzle Kit documentation describes breakpoints as sequential statement separators, primarily for MySQL/SQLite/SingleStore—not commit boundaries: [index.d.ts](/home/udai/common/compass/node_modules/drizzle-kit/index.d.ts:68).

### Newer Drizzle

There is no newer stable release: npm’s current `latest` tags remain `drizzle-orm` 0.45.2 and `drizzle-kit` 0.31.10. The current upstream PostgreSQL dialect still has the same outer transaction around the complete migration loop: [upstream `dialect.ts`](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/dialect.ts).

Drizzle has 1.0 beta/RC builds, but current upstream still does not solve this. Upgrading to a prerelease would therefore be both ineffective and disproportionate.

Approach C is definitively unavailable.

## 2. Approach A: incorrect

Approach A would not establish a commit boundary.

On a fresh database, the proposed enum migration and consumer migration would both be pending. The migrator would:

1. Begin the single transaction at [dialect.js:60](/home/udai/common/compass/node_modules/drizzle-orm/pg-core/dialect.js:60).
2. Apply the enum migration.
3. Continue directly to the consumer migration inside the same `tx`.
4. Attempt to use `self`.
5. Receive PostgreSQL’s unsafe-new-enum-value error.
6. Roll back the whole batch.

Moving the INSERT to `0002`, `0003`, or a new `0004` also does not help on a from-scratch run: all of those files would be pending in the same transaction.

Therefore the plan’s “C if supported, else A” preference is wrong. Both C and A must be rejected.

## 3. What actually works

The problematic statements are:

```sql
ALTER TYPE "public"."family_relationship"
ADD VALUE 'self' BEFORE 'spouse';
```

at [0001_lush_grim_reaper.sql:2](/home/udai/common/compass/apps/api/drizzle/0001_lush_grim_reaper.sql:2), followed by:

```sql
INSERT INTO family_members
  (id, user_id, name, relationship, linked_user_id, sort_order, created_at, updated_at)
SELECT gen_random_uuid(), u.id, u.display_name, 'self', u.id, -1, now(), now()
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM family_members fm
  WHERE fm.user_id = u.id
    AND fm.relationship = 'self'
);
```

at [0001_lush_grim_reaper.sql:58](/home/udai/common/compass/apps/api/drizzle/0001_lush_grim_reaper.sql:58).

### Text casts and query tricks do not solve it

These still use the newly added enum label and remain forbidden:

```sql
'self'::text::family_relationship
```

```sql
CASE ... THEN 'self' ...
```

```sql
SELECT enumlabel ...
```

PostgreSQL rejects use of the newly added enum value, not merely one particular literal syntax. The destination enum column must ultimately convert a value to `family_relationship`, so casting through `text` is not an escape.

### Recommended migration-only repair

Replace the `ADD VALUE` statement in `0001` with a transactional enum replacement:

```sql
ALTER TYPE "public"."family_relationship"
  RENAME TO "family_relationship_old";

CREATE TYPE "public"."family_relationship"
  AS ENUM ('self', 'spouse', 'child', 'parent', 'sibling', 'other');

ALTER TABLE "family_members"
  ALTER COLUMN "relationship"
  TYPE "public"."family_relationship"
  USING "relationship"::text::"public"."family_relationship";

DROP TYPE "public"."family_relationship_old";
```

Then leave the existing INSERT unchanged.

This works because `CREATE TYPE ... AS ENUM(...)` creates the complete type in one operation. PostgreSQL permits immediate use of values belonging to a newly created enum; the special restriction applies to values added to an existing enum by `ALTER TYPE ... ADD VALUE`.

Only `family_members.relationship` uses this enum in the migration set:

- Type creation: [0000_nosy_lizard.sql:10](/home/udai/common/compass/apps/api/drizzle/0000_nosy_lizard.sql:10)
- Column definition: [0000_nosy_lizard.sql:211](/home/udai/common/compass/apps/api/drizzle/0000_nosy_lizard.sql:211)
- Application declaration: [persons.ts:15](/home/udai/common/compass/apps/api/src/db/shared/persons.ts:15)

The column is `NOT NULL` but has no default, so no default expression must be dropped and recreated. The existing data labels are all present in the replacement enum.

This repair preserves:

- Existing relationship values
- Enum ordering, with `self` before `spouse`
- The backfill
- Final schema content

It also works for a legitimate database at the `0000` state, unlike editing `0000` to include `self` and simply removing the ALTER from `0001`.

### Why editing `0000` is weaker

Adding `self` directly to [0000_nosy_lizard.sql:10](/home/udai/common/compass/apps/api/drizzle/0000_nosy_lizard.sql:10) and removing line 2 from `0001` would fix a fresh database, but break a genuine database that applied only `0000`: its enum would not contain `self`, while the modified `0001` would try the INSERT.

The transactional replacement in `0001` handles both fresh application and the real `0000 → 0001` upgrade path.

## 4. Other latent from-scratch failures

I found no second transaction-specific blocker in the four migration files.

### Enum operations

The only `ALTER TYPE ... ADD VALUE` is [0001_lush_grim_reaper.sql:2](/home/udai/common/compass/apps/api/drizzle/0001_lush_grim_reaper.sql:2).

The enums in `0000` and `0002` are created with their complete value sets. Creating tables or inserting values using a newly created enum is valid inside the same transaction:

- `0000` enum definitions: [0000_nosy_lizard.sql:1](/home/udai/common/compass/apps/api/drizzle/0000_nosy_lizard.sql:1)
- `0002` enum definitions: [0002_messy_stepford_cuckoos.sql:1](/home/udai/common/compass/apps/api/drizzle/0002_messy_stepford_cuckoos.sql:1)

### Concurrent indexes

There is no `CREATE INDEX CONCURRENTLY` in any migration. Ordinary `CREATE INDEX` is valid in the wrapping transaction.

### Generated tsvector column

`0000` first adds the generated `transactions.search` column and then indexes it:

- Column: [0000_nosy_lizard.sql:855](/home/udai/common/compass/apps/api/drizzle/0000_nosy_lizard.sql:855)
- GIN index: [0000_nosy_lizard.sql:857](/home/udai/common/compass/apps/api/drizzle/0000_nosy_lizard.sql:857)

DDL created earlier in the same PostgreSQL transaction is visible to later statements, so this ordering is valid.

### Dependency order

Tables precede their foreign keys and indexes. `0002` depends on household/person objects from `0001`, but those objects are visible within the same transaction. `0003` adds ordinary nullable columns to `card_details`: [0003_lying_thanos.sql:1](/home/udai/common/compass/apps/api/drizzle/0003_lying_thanos.sql:1).

Task 060’s autocommit run is useful corroboration for statement ordering, though it could not prove transaction compatibility. Inspection does not reveal another transaction-incompatible statement.

## 5. Migration identity and production safety

The task’s statement that changing a shipped migration hash makes Drizzle reapply it is incorrect for this installed PostgreSQL migrator.

The reader does calculate SHA-256 over each entire SQL file:

```js
hash: crypto.createHash("sha256").update(query).digest("hex")
```

at [migrator.js:23](/home/udai/common/compass/node_modules/drizzle-orm/migrator.js:23).

The ledger stores that hash at [dialect.js:67](/home/udai/common/compass/node_modules/drizzle-orm/pg-core/dialect.js:67). But the migrator never compares the stored hash with the file hash. It reads only the most recent ledger row and decides solely by timestamp:

```js
const lastDbMigration = dbMigrations[0];

if (!lastDbMigration ||
    Number(lastDbMigration.created_at) < migration.folderMillis) {
  ...
}
```

See [dialect.js:56](/home/udai/common/compass/node_modules/drizzle-orm/pg-core/dialect.js:56) and [dialect.js:62](/home/udai/common/compass/node_modules/drizzle-orm/pg-core/dialect.js:62).

The timestamps come from `_journal.json`, not filenames or hashes: [migrator.js:22](/home/udai/common/compass/node_modules/drizzle-orm/migrator.js:22).

Therefore:

- Editing `0001` changes the hash that will be stored on future applications.
- It does not cause a database whose latest `created_at` is at or beyond `0001` to rerun `0001`.
- Drizzle does not detect or complain about a historical hash mismatch.
- Splitting or inserting a migration with an old timestamp can be skipped if the database’s latest timestamp is already newer.

### Exact production failure

Production’s only ledger row is:

```text
created_at = 1786715434888
```

That is exactly the timestamp of journal entry `0000`: [\_journal.json:8](/home/udai/common/compass/apps/api/drizzle/meta/_journal.json:8). Its recorded hash also corresponds to that row, as captured in [investigation-1.md:87](/home/udai/common/compass/tasks/060-integration-verification/investigation-1.md:87).

Consequently, the next migrator run treats these as pending:

- `0001`: `1786738245324`
- `0002`: `1786812938665`
- `0003`: `1787030012940`

See [\_journal.json:12](/home/udai/common/compass/apps/api/drizzle/meta/_journal.json:12).

But production already has the schema from all four files. The next `make update` one-shot calls programmatic `migrate()` before owner provisioning: [bootstrap.ts:51](/home/udai/common/compass/apps/api/src/db/bootstrap.ts:51). It will attempt `0001` first against existing objects.

With either the current or proposed rewritten `0001`, it will fail immediately at:

```sql
CREATE TYPE "public"."household_role" AS ENUM('owner', 'member');
```

because that type already exists: [0001_lush_grim_reaper.sql:1](/home/udai/common/compass/apps/api/drizzle/0001_lush_grim_reaper.sql:1).

Because all pending files are transactional, the failure rolls back their ledger writes. It should not partially reapply later DDL or mutate financial rows, but the migration container exits nonzero and the API remains gated behind it: [docker-compose.yml:20](/home/udai/common/compass/docker-compose.yml:20).

This danger exists today, independently of task 061.

### Required production prerequisite

Do not deploy the migration edit until production’s ledger has been reconciled under a separately approved operational procedure.

At minimum, that procedure must verify production’s schema against the expected `0003` state and then record the correct migration horizon. Because Drizzle uses only the greatest `created_at`, a correctly reviewed `0003` ledger row would make all four existing journal entries non-pending. That is a live-database write and rightly remains outside this task.

AC6 should be a release gate, not merely documentation: deployment is prohibited until ledger reconciliation is completed or the deploy migrator is otherwise made safe.

## 6. Empty-database testing feasibility

### Staging schema

The recorded evidence establishes only that `compass` has `USAGE` and `CREATE` on `compass-staging.public`: [investigation-2.md:73](/home/udai/common/compass/tasks/060-integration-verification/investigation-2.md:73). It does not establish that `compass` owns the `public` schema.

Having `CREATE` does not grant authority to `DROP SCHEMA public`. Therefore the plan must not assume that:

```sql
DROP SCHEMA public CASCADE;
```

is available or safe.

The role owns the 58 tables it created and could probably drop its own objects individually, but that is more error-prone and would destroy task 060’s useful staging baseline. Staging should not be the first choice.

### Local availability

Read-only environment checks show:

- PostgreSQL client tools are installed (`/usr/bin/psql`).
- No local PostgreSQL server is listening on the default socket.
- Server binaries such as `postgres`, `initdb`, and `pg_ctl` are not installed in `PATH`.
- Docker is installed.
- The Docker daemon is reachable and reports version 29.6.2.
- The user belongs to the `docker` group.
- The repository does not include a Postgres service; [docker-compose.yml:1](/home/udai/common/compass/docker-compose.yml:1) explicitly says Postgres is external.
- There is no direct Testcontainers or PGlite dependency. PGlite appears only as an optional peer reference in the lockfile and would not be an equivalent real-Postgres AC1 test anyway.

### Recommendation

Use a disposable PostgreSQL Docker container, with:

- A unique container name
- A unique temporary volume or no persistent volume
- A random host port bound to `127.0.0.1`
- A purpose-created database/user owned by that user
- A PostgreSQL version matching production, ideally 18
- A readiness probe before migration
- Container and volume removal after evidence is captured

This requires no external database privileges and provides the genuinely empty PostgreSQL database AC1 needs. No user intervention appears necessary unless image pulling is restricted.

## 7. Acceptance criteria and tests

AC1–AC3, AC5, and AC7 are directionally sound. AC4, AC6, T4, and T6 need correction, and several checks are missing.

### AC4/T4 must test the upgrade path correctly

A completely empty database cannot contain users before `0000`, because the `users` table does not yet exist. Therefore “seed users before migrating” is not directly executable.

Use two disposable database scenarios:

1. **Fresh reconstruction:** run all real migrations from nothing and prove AC1–AC3.
2. **Historical upgrade/backfill:** establish exactly the `0000` state, including a matching `0000` ledger row, insert representative users, then run the normal migrator over the full folder. It must skip `0000`, apply `0001`–`0003`, and create exactly one `self` row per user.

For the second scenario, use the installed migration reader/migrator with a temporary migration-folder fixture containing only the real `0000`, rather than manually inventing hash/timestamp values. Then seed users and run against the normal folder.

Assertions should include:

- Every pre-existing user has exactly one row with `relationship = 'self'`.
- `linked_user_id = users.id`.
- `family_members.user_id = users.id`.
- `name = users.display_name`.
- `sort_order = -1`.
- Running migrations again creates no duplicates.
- A user already possessing a `self` row does not receive another one.
- Existing non-`self` family members survive the enum replacement unchanged.

### Bootstrap-specific gap

Fresh bootstrap migrates before creating the owner:

- Migration: [bootstrap.ts:53](/home/udai/common/compass/apps/api/src/db/bootstrap.ts:53)
- Owner creation: [bootstrap.ts:55](/home/udai/common/compass/apps/api/src/db/bootstrap.ts:55)

`createUser()` inserts only into `users`: [users.ts:26](/home/udai/common/compass/apps/api/src/modules/system/services/users.ts:26). It does not create a `self` family member. Registration does create one elsewhere, but bootstrap bypasses that path.

Thus a brand-new bootstrapped owner will not benefit from the historical `0001` backfill. That is a separate existing functional gap worth recording. If the invariant is “every user has a self person,” migration AC4 alone does not prove it. Add a separate acceptance criterion or follow-up task for bootstrap owner creation.

### AC6 must be enforceable

Replace the documentation-only wording with:

> Production deployment is blocked until the live migration ledger has been reconciled to the independently verified schema horizon. Before release, prove the production migrator sees no existing migration as pending.

A dry determination can be made from the ledger and journal without running migrations; the reconciliation write itself needs explicit user approval.

### AC7

“No schema content change” is correct if interpreted as final observable schema equivalence. The recommended repair changes migration mechanics, not the final enum labels, tables, columns, constraints, or indexes.

T6 should not require only migration/journal files to change because the preferred repair needs only `0001`; snapshots and `_journal.json` should not be changed unless the migration-generation tooling specifically requires them. Hand-editing `0001` does not inherently require changing snapshot metadata because the final schema represented by the `0001` snapshot is unchanged.

Add explicit comparison of enum order, not merely enum membership:

```text
self, spouse, child, parent, sibling, other
```

### Additional required checks

Add:

- **Ledger identity test:** assert fresh application creates four rows with journal timestamps and file hashes; assert the second run leaves them unchanged.
- **Legitimate `0000` upgrade test:** this is essential because the proposed fix rewrites `0001`.
- **Existing-data preservation test:** seed every old enum label before applying `0001`, then confirm values and row counts are unchanged.
- **Enum-order fingerprint:** ensure `self BEFORE spouse` remains true.
- **Atomic failure check:** optionally inject a disposable failure later in the test fixture and prove the batch rolls back, documenting current migrator semantics.
- **Production release gate:** inspect the live ledger immediately before deployment; do not rely indefinitely on task 060’s snapshot.
- **Literal baseline comparison method:** reuse task 060’s defined column/index/constraint serialization, and also compare enum definitions and generated expressions.
- **Bootstrap invariant decision:** explicitly decide whether a newly bootstrapped owner must receive a `self` person.

## Recommended revised plan

1. Reject approaches A, C, and D.
2. Replace `ALTER TYPE ... ADD VALUE` in `0001` with the transactional rename/create/retype/drop sequence.
3. Preserve the existing INSERT unchanged.
4. Do not change `_journal.json` timestamps or add a migration file.
5. Test both a completely fresh run and a real `0000 → latest` upgrade with seeded users/data.
6. Compare full schema, enum ordering, generated expressions, constraints, and indexes against the task 060 baseline.
7. Verify four ledger rows and a second-run no-op.
8. Treat production ledger reconciliation as a mandatory pre-deployment operational prerequisite.
9. Separately decide whether bootstrap must create the owner’s `self` person.

This is the minimal route that repairs from-scratch recovery while preserving the historical upgrade behavior and final schema.