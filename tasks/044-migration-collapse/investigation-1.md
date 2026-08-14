# Investigation 1 — Migration Collapse

## 1. Current state of apps/api/drizzle/

- **SQL migration files:** 69 (`0000_mysterious_mockingbird.sql` … `0068_mean_sentinel.sql`)
- **Meta JSON files:** 70 — 69 snapshot files (`0000_snapshot.json` … `0068_snapshot.json`) plus `_journal.json`
- **Total directory size:** 9.0 MB (`du -sh apps/api/drizzle/`)
- **Journal entries:** 69, idx 0–68, all `"version": "7"`, all `"dialect": "postgresql"`, all `"breakpoints": true`

Timestamp range (from journal `"when"` ms values):
- Oldest: `0000` at 1783931040728 (≈ 2026-05-13)
- Newest: `0068` at 1786559909078 (≈ 2026-08-13)

---

## 2. How migrations are applied

### Two paths

**Dev path — `db:migrate`** (`apps/api/package.json`):
```
"db:migrate": "node --env-file-if-exists=../../.env ../../node_modules/drizzle-kit/bin.cjs migrate"
```
Calls the drizzle-kit CLI, which reads `drizzle.config.ts` and applies pending migrations.

**Production path — `db:bootstrap`** (`src/db/bootstrap.ts`):
```ts
import { migrate } from "drizzle-orm/node-postgres/migrator";
// …
await migrate(db, { migrationsFolder: path.join(import.meta.dirname, "../../drizzle") });
```
Uses the drizzle-orm programmatic migrator. No `migrationsTable` or `migrationsSchema` override → defaults confirmed from `node_modules/drizzle-orm/pg-core/dialect.js` lines 45–46:
```js
const migrationsTable = config.migrationsTable ?? "__drizzle_migrations";
const migrationsSchema = config.migrationsSchema ?? "drizzle";
```

### Tracking table

`drizzle.__drizzle_migrations` — schema `drizzle`, table `__drizzle_migrations`. Columns: `id SERIAL PK`, `hash text NOT NULL`, `created_at bigint`.

### Hash mismatch behavior (confirmed from dialect.js lines 56–70)

The migrator fetches only the **last** applied row (ORDER BY created_at DESC LIMIT 1) and applies any migration whose `folderMillis` (the numeric timestamp in the folder name, i.e. the journal `"when"` value) is **greater** than `lastDbMigration.created_at`. **There is no hash comparison against the tracking row.** The hash is stored but never checked on subsequent runs.

### What breaks for an existing dev DB when history is rewritten

When you delete 0000–0068 and create a new `0000_baseline.sql`, drizzle-kit assigns the current clock time as `folderMillis`. That value (~1786600000000) will be **higher** than `0068`'s recorded `created_at` (1786559909078), so the migrator will try to execute the baseline's `CREATE TABLE …` DDL on a database that already has all those tables → immediate Postgres error on the first `CREATE TABLE`. The solution is to drop the whole database (or at minimum truncate `drizzle.__drizzle_migrations`) before running `db:migrate` on the rebuilt baseline. See the collapse procedure section below.

---

## 3. How db:generate works and the correct collapse procedure

**`drizzle.config.ts`** (file inspected):
```ts
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL },
});
```

- Entry point: `apps/api/src/db/schema.ts` (re-export barrel)
- Output directory: `apps/api/drizzle/`
- Installed version: `"drizzle-kit": "^0.31.10"` (`apps/api/package.json`)

**How generate works with a clean slate:** drizzle-kit reads the last snapshot in `meta/` as the "before" state and diffs it against the current schema. If `meta/` is empty (or absent), the before-state is an empty schema, so generate produces a single migration that creates every table, enum, index, and constraint derivable from `schema.ts`.

**Correct procedure to produce a fresh 0000 baseline:**
1. Delete `apps/api/drizzle/*.sql`
2. Delete `apps/api/drizzle/meta/` (all snapshot JSONs and `_journal.json`)
3. Run `npm run db:generate -w apps/api` with DATABASE_URL set (the config throws if it is absent)
4. The result is one `0000_<random-name>.sql` + `meta/0000_snapshot.json` + `meta/_journal.json` with one entry.
5. **Manually append** the three objects that `db:generate` will NOT produce (see section 5 below).

---

## 4. References to migration files by name/count

**CI — `.github/workflows/ci.yml`:**
Runs `npm run db:migrate` against a fresh `postgres:18` container spun up per job. No reference to specific migration file names or counts. A single baseline works identically — actually better, as `npm run db:migrate` currently processes 69 files serially.

**Publish — `.github/workflows/publish.yml`:**
No migration references at all. Docker build only.

**`apps/api/Dockerfile`:**
```
COPY apps/api/drizzle ./apps/api/drizzle
```
Copies the entire `drizzle/` directory into the production image. Works with 1 or 69 files. The `migrate` compose service later runs `db:bootstrap` which calls `migrate()` against whatever is in that directory.

**`docker-compose.yml`:**
`migrate` service: `command: ["npm", "run", "db:bootstrap", "-w", "apps/api"]` — no file-level references.

**Makefile:** No Makefile found anywhere in the repository root or sub-directories.

**`apps/api/scripts/repair-table-ownership.sql`:**
PL/pgSQL loop over `pg_tables`/`pg_sequences`/`pg_type` — entirely schema-agnostic, no migration file references.

**Tests:** No test file asserts on migration file count, file names, or migration directory contents. All test files importing `drizzle-orm` use it for ORM queries, not migration introspection.

**`db:seed` (`src/db/seed.ts`):**
Inserts a demo user and seeds default categories. No dependency on migration count or files.

---

## 5. Hand-edited migrations — statements `db:generate` would NOT recreate

Only three categories matter here. The pure-DML backfills (listed below under "irrelevant") are one-time data migrations that are moot on a fresh DB.

### 5A. Objects that MUST be manually preserved in the collapsed baseline

**File: `0002_fts-and-split-check.sql`**

Three database objects that Drizzle ORM has no schema.ts counterpart for and that the runtime code depends on:

1. **PL/pgSQL trigger function** (lines 7–30):
   ```sql
   CREATE OR REPLACE FUNCTION check_split_sum() RETURNS trigger AS $$
   DECLARE
     tx_id uuid; parent_amount bigint; split_total bigint; split_count int;
   BEGIN
     IF TG_TABLE_NAME = 'transaction_splits' THEN
       tx_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
     ELSE
       tx_id := NEW.id;
     END IF;
     SELECT amount_paise INTO parent_amount FROM transactions WHERE id = tx_id;
     IF parent_amount IS NULL THEN RETURN NULL; END IF;
     SELECT coalesce(sum(amount_paise), 0), count(*) INTO split_total, split_count
       FROM transaction_splits WHERE transaction_id = tx_id;
     IF split_count > 0 AND split_total <> parent_amount THEN
       RAISE EXCEPTION 'splits (%) must sum to transaction amount (%)', split_total, parent_amount;
     END IF;
     RETURN NULL;
   END;
   $$ LANGUAGE plpgsql;
   ```

2. **Constraint trigger** `transaction_splits_sum_check` on `transaction_splits` (lines 32–35):
   ```sql
   CREATE CONSTRAINT TRIGGER transaction_splits_sum_check
     AFTER INSERT OR UPDATE OR DELETE ON "transaction_splits"
     DEFERRABLE INITIALLY DEFERRED
     FOR EACH ROW EXECUTE FUNCTION check_split_sum();
   ```

3. **Constraint trigger** `transactions_amount_split_check` on `transactions` (lines 37–40):
   ```sql
   CREATE CONSTRAINT TRIGGER transactions_amount_split_check
     AFTER UPDATE OF "amount_paise" ON "transactions"
     DEFERRABLE INITIALLY DEFERRED
     FOR EACH ROW EXECUTE FUNCTION check_split_sum();
   ```

4. **`search` tsvector generated column** on `transactions` (lines 2–3):
   ```sql
   ALTER TABLE "transactions" ADD COLUMN "search" tsvector
     GENERATED ALWAYS AS (to_tsvector('simple', coalesce("merchant", '') || ' ' || coalesce("notes", ''))) STORED;
   ```
   Verified: the `transactions` table definition in `src/db/shared/ledger.ts` does NOT declare a `search` column (only `merchant`, `notes`, and other typed columns). `src/db/restore.ts` explicitly lists `transactions: ["search"]` as a "database-generated column present in `select *` dumps but never insertable", confirming Drizzle ORM treats it as an unmanaged DB-side column. The GIN index on `search` (`CREATE INDEX "transactions_search_idx" ON "transactions" USING gin ("search")`) must also be manually preserved.
   
   Runtime code in `src/modules/ledger/services/transactions.ts` (lines 78, 311) directly queries `"transactions"."search"` via raw SQL — so the column and index are load-bearing at runtime.

### 5B. Irrelevant DML backfills (safe to lose on a fresh DB)

These were one-time data migrations against existing rows. A newly provisioned DB starts empty so they have no effect either way.

| File | Statement(s) | What it did |
|---|---|---|
| `0015_calm_spacker_dave.sql` | 2 × UPDATE | Cleared invalid `goal_id` / `maturity_date` values on pre-existing rows |
| `0017_typical_toad.sql` | 2 × UPDATE | Backfilled `seq` ordinals on holding_events, seeded `gains_tax_class` |
| `0034_early_bug.sql` | INSERT INTO card_issuer_settings | Migrated per-card settings up to per-bank level from existing rows |
| `0037_chemical_ozymandias.sql` | UPDATE card_details | Copied statement passwords back down to per-card from per-bank |
| `0045_convert_opening_balances_to_tx.sql` | INSERT + UPDATE | Converted opening balance column values to real transactions for bank/cash accounts |

### 5C. `ALTER … USING` cast (0007)

`0007_open_deathbird.sql` line 41: `ALTER TABLE "holdings" ALTER COLUMN "asset_class" SET DATA TYPE "public"."asset_class" USING "asset_class"::"public"."asset_class"`. This was needed to migrate from a text column to the final enum. In a fresh baseline, the column is created as the enum directly — no USING cast needed. Not a concern.

---

## 6. Postings backfill from PR-A..G1

Scanned all 69 `.sql` files for `INSERT INTO postings` / `UPDATE postings`: **no matches**. Migration `0067_illegal_shocker.sql` creates the `postings` table (schema DDL only — no data). The postings dual-write was a runtime change: `src/modules/ledger/services/post-entry.ts` and `src/modules/ledger/services/reconcile-postings.ts` write postings at transaction creation and statement reconciliation time. There is no historical backfill migration that populates postings from existing transactions. Nothing in the postings migration history becomes irrelevant upon collapse — the table creation DDL will appear in the regenerated baseline just like any other table.

---

## Collapse Procedure (Recommendation)

### Step 1 — Delete the migration history

```bash
cd apps/api
rm drizzle/*.sql
rm -rf drizzle/meta/
```

### Step 2 — Regenerate a single baseline

```bash
npm run db:generate -w apps/api
# requires DATABASE_URL in .env (drizzle.config.ts throws if absent; value can be dummy since
# generate is offline — but the config guard runs before drizzle-kit checks reachability)
```

This produces one file: `drizzle/0000_<random_name>.sql` and a fresh `drizzle/meta/`.

### Step 3 — Manually splice in the unrepresented objects

At the end of the generated `0000_*.sql`, append (copy verbatim from `0002_fts-and-split-check.sql`):

```sql
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce("merchant", '') || ' ' || coalesce("notes", ''))) STORED;
--> statement-breakpoint
CREATE INDEX "transactions_search_idx" ON "transactions" USING gin ("search");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_split_sum() RETURNS trigger AS $$
DECLARE
  tx_id uuid;
  parent_amount bigint;
  split_total bigint;
  split_count int;
BEGIN
  IF TG_TABLE_NAME = 'transaction_splits' THEN
    tx_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
  ELSE
    tx_id := NEW.id;
  END IF;
  SELECT amount_paise INTO parent_amount FROM transactions WHERE id = tx_id;
  IF parent_amount IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(sum(amount_paise), 0), count(*) INTO split_total, split_count
    FROM transaction_splits WHERE transaction_id = tx_id;
  IF split_count > 0 AND split_total <> parent_amount THEN
    RAISE EXCEPTION 'splits (%) must sum to transaction amount (%)', split_total, parent_amount;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transaction_splits_sum_check
  AFTER INSERT OR UPDATE OR DELETE ON "transaction_splits"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_split_sum();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transactions_amount_split_check
  AFTER UPDATE OF "amount_paise" ON "transactions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_split_sum();
```

### Step 4 — Handle dev DBs

Existing dev databases cannot absorb the new baseline because the tracking table records the old migrations. Two options, in order of preference:

**A. Drop and recreate the dev DB (cleanest):**
```bash
# As postgres superuser:
dropdb compass && createdb -O compass compass
npm run db:migrate -w apps/api
npm run db:seed -w apps/api      # optional demo user
```

**B. Truncate the tracking table only (keeps data, riskier):**
```sql
TRUNCATE drizzle.__drizzle_migrations;
```
Then `npm run db:migrate`. This will try to apply the baseline SQL on an already-populated DB and fail on every `CREATE TABLE`. Only viable if you also DROP SCHEMA public CASCADE first — effectively equivalent to option A but more steps.

Recommendation: use option A. Since the brief states "dev DBs will be recreated", this is the intended path.

### Step 5 — CI

CI already starts a fresh `postgres:18` container per job with no data. The collapsed baseline will apply cleanly. No changes to `.github/workflows/ci.yml` required.

### Step 6 — Production Docker image

The `Dockerfile` copies `apps/api/drizzle/` into the image. After collapse, the image will contain one `.sql` file instead of 69. The compose `migrate` service runs `db:bootstrap` → `migrate()` → applies the single baseline file. **No changes to the Dockerfile or compose file required.**

### Risks

| Risk | Severity | Mitigation |
|---|---|---|
| The `search` column and the `check_split_sum` trigger function/triggers are absent from `schema.ts` and will NOT appear in the drizzle-kit generated SQL. If forgotten, the app will fail at search queries and split-sum integrity checks. | High | Step 3 above; verify by checking the generated SQL for `tsvector`, `check_split_sum`, and `CONSTRAINT TRIGGER` before applying. |
| drizzle-kit `generate` needs DATABASE_URL set even though it doesn't connect (the config file throws before drizzle-kit can suppress the check). Use a syntactically valid placeholder: `DATABASE_URL=postgres://x:x@localhost/x npm run db:generate -w apps/api` | Low | Use a dummy URL if .env is not present. |
| Any future `db:generate` run will diff against the single snapshot and produce correct incremental migrations. The snapshot must accurately represent the full schema including the manually-appended objects. Since Drizzle can't serialize a PL/pgSQL function or constraint trigger into its snapshot JSON, those objects will remain untracked — i.e., a future `db:generate` won't attempt to drop/recreate them. This is the same situation as today. | Accepted | Document the trigger/function as "managed outside drizzle-kit" in a comment in the baseline SQL. |
| The ownership repair script (`scripts/repair-table-ownership.sql`) is unaffected — it uses `pg_tables` dynamically. | None | — |
