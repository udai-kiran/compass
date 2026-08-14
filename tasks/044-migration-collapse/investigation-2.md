# Investigation 2 — Migration Collapse

## 1. File counts

```
$ ls apps/api/drizzle/*.sql | wc -l
69

$ ls apps/api/drizzle/meta/*.json | wc -l
70
```

(70 meta JSON files = 69 snapshots numbered 0000–0068 + _journal.json)

## 2. Migration entry count in journal

```
$ grep -c '"idx"' apps/api/drizzle/meta/_journal.json
69
```

## 3. First 5 and last 5 entries (idx + tag lines)

```
$ grep -E '"idx"|"tag"' apps/api/drizzle/meta/_journal.json | head -20
      "idx": 0,
      "tag": "0000_mysterious_mockingbird",
      "idx": 1,
      "tag": "0001_natural_klaw",
      "idx": 2,
      "tag": "0002_fts-and-split-check",
      "idx": 3,
      "tag": "0003_tired_khan",
      "idx": 4,
      "tag": "0004_fixed_plazm",
      "idx": 5,
      "tag": "0005_vengeful_shiver_man",
      "idx": 6,
      "tag": "0006_slim_pride",
      "idx": 7,
      "tag": "0007_open_deathbird",
      "idx": 8,
      "tag": "0008_chief_james_howlett",
      "idx": 9,
      "tag": "0009_huge_mentallo",

$ grep -E '"idx"|"tag"' apps/api/drizzle/meta/_journal.json | tail -20
      "idx": 59,
      "tag": "0059_steady_wonder_man",
      "idx": 60,
      "tag": "0060_brave_ender_wiggin",
      "idx": 61,
      "tag": "0061_magical_the_anarchist",
      "idx": 62,
      "tag": "0062_stale_garia",
      "idx": 63,
      "tag": "0063_cheerful_switch",
      "idx": 64,
      "tag": "0064_happy_zzzax",
      "idx": 65,
      "tag": "0065_smiling_tana_nile",
      "idx": 66,
      "tag": "0066_eager_spectrum",
      "idx": 67,
      "tag": "0067_illegal_shocker",
      "idx": 68,
      "tag": "0068_mean_sentinel",
```

## 4. Files referencing transfer_links / transaction_splits / is_opening / openingBalancePaise (apps/api)

```
$ grep -rn 'transfer_links\|transaction_splits\|transactionSplits\|transferLinks\|is_opening\|isOpening\|openingBalancePaise' apps/api/src/modules/ apps/api/src/db/ apps/api/src/lib/ apps/api/src/jobs/ --include='*.ts' -l
/work/personal/compass/apps/api/src/modules/credit/services/cards.ts
/work/personal/compass/apps/api/src/modules/ingest/routes/ingest.route.test.ts
/work/personal/compass/apps/api/src/modules/credit/services/card-due-tasks.test.ts
/work/personal/compass/apps/api/src/modules/ingest/services/imports.ts
/work/personal/compass/apps/api/src/modules/credit/services/emis.test.ts
/work/personal/compass/apps/api/src/modules/ingest/services/inbox.test.ts
/work/personal/compass/apps/api/src/modules/ledger/services/legacy-projection.ts
/work/personal/compass/apps/api/src/modules/credit/services/reconciliation-writes.test.ts
/work/personal/compass/apps/api/src/modules/credit/services/reconciliation-writes.ts
/work/personal/compass/apps/api/src/modules/ledger/services/transfers.ts
/work/personal/compass/apps/api/src/modules/investments/services/sip-installments.ts
/work/personal/compass/apps/api/src/modules/ledger/schema.ts
/work/personal/compass/apps/api/src/modules/ledger/services/accounts.ts
/work/personal/compass/apps/api/src/modules/ledger/schema.smoke.test.ts
/work/personal/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts
/work/personal/compass/apps/api/src/modules/ledger/services/post-entry.ts
/work/personal/compass/apps/api/src/modules/investments/services/sip-installments.test.ts
/work/personal/compass/apps/api/src/modules/ledger/services/accounts.test.ts
/work/personal/compass/apps/api/src/modules/ledger/services/epf-contributions.test.ts
/work/personal/compass/apps/api/src/modules/ledger/services/postings-balance-parity.test.ts
/work/personal/compass/apps/api/src/modules/ledger/services/legacy-projection.test.ts
/work/personal/compass/apps/api/src/modules/ledger/services/recurring.test.ts
/work/personal/compass/apps/api/src/modules/ledger/services/average-balance.ts
/work/personal/compass/apps/api/src/modules/system/services/demo.ts
/work/personal/compass/apps/api/src/modules/ledger/services/categories.ts
/work/personal/compass/apps/api/src/modules/ledger/services/transactions.ts
/work/personal/compass/apps/api/src/modules/ledger/services/postings.ts
/work/personal/compass/apps/api/src/modules/ledger/services/reconcile-postings.test.ts
/work/personal/compass/apps/api/src/modules/ledger/services/reconcile-postings.ts
/work/personal/compass/apps/api/src/modules/planning/services/postings-planning-parity.test.ts
/work/personal/compass/apps/api/src/db/schema.decomposition.test.ts
/work/personal/compass/apps/api/src/db/shared/ledger.ts
/work/personal/compass/apps/api/src/modules/system/services/backup.ts
/work/personal/compass/apps/api/src/modules/system/services/backup.test.ts
/work/personal/compass/apps/api/src/db/schema.ts
/work/personal/compass/apps/api/src/db/shared/hubs.ts
/work/personal/compass/apps/api/src/lib/postings-periods-parity.test.ts
```

Exit code: 0 (37 files)

## 5. Files referencing transfer_links / transaction_splits (packages/shared, apps/web)

```
$ grep -rn 'transfer_links\|transaction_splits\|transactionSplits\|transferLinks' packages/shared/src/ apps/web/src/ --include='*.ts' -l
/work/personal/compass/packages/shared/src/schemas/ledger.ts
```

Exit code: 0 (1 file)

## 6. apps/api/src/db/seed.ts (first 80 lines)

```
1  import argon2 from "argon2";
2  import { eq } from "drizzle-orm";
3  import { loadConfig } from "../config.ts";
4  import { seedDefaultCategories } from "../modules/ledger/services/categories.ts";
5  import { createPool } from "../infra/db.ts";
6  import { createDb } from "./index.ts";
7  import { users } from "./schema.ts";
8  
9  const config = loadConfig();
10 const pool = createPool(config.DATABASE_URL);
11 const db = createDb(pool);
12 
13 const demoUser = {
14   email: "demo@compass.local",
15   displayName: "Demo User",
16   passwordHash: await argon2.hash("demo1234", { type: argon2.argon2id }),
17 };
18 
19 const inserted = await db.insert(users).values(demoUser).onConflictDoNothing().returning();
20 console.log(
21   inserted.length > 0
22     ? `seeded demo user: ${demoUser.email} (password: demo1234)`
23     : `demo user already present: ${demoUser.email}`,
24 );
25 
26 const owner =
27   inserted[0] ?? (await db.query.users.findFirst({ where: eq(users.email, demoUser.email) }))!;
28 await seedDefaultCategories(db, owner.id);
29 console.log("default categories ensured");
30 
31 await pool.end();
```

(file is only 32 lines; first 80 = entire file)

## 7. Hand-edited migration content (CREATE EXTENSION, CREATE TRIGGER, CREATE FUNCTION, INSERT INTO, UPDATE…SET, ALTER…USING, custom CHECK)

```
$ grep -n 'CREATE EXTENSION\|CREATE TRIGGER\|CREATE FUNCTION\|INSERT INTO\|UPDATE.*SET\|ALTER.*USING\|custom CHECK' apps/api/drizzle/*.sql

apps/api/drizzle/0007_open_deathbird.sql:41:ALTER TABLE "holdings" ALTER COLUMN "asset_class" SET DATA TYPE "public"."asset_class" USING "asset_class"::"public"."asset_class";--> statement-breakpoint
apps/api/drizzle/0015_calm_spacker_dave.sql:5:UPDATE "accounts" SET "goal_id" = NULL WHERE "goal_id" IS NOT NULL AND "type" NOT IN ('investment', 'ppf', 'epf', 'ssy');--> statement-breakpoint
apps/api/drizzle/0015_calm_spacker_dave.sql:6:UPDATE "retirement_details" AS rd SET "maturity_date" = NULL FROM "accounts" a WHERE rd."account_id" = a."id" AND a."type" = 'epf';
apps/api/drizzle/0034_early_bug.sql:20:INSERT INTO "card_issuer_settings" (
apps/api/drizzle/0045_convert_opening_balances_to_tx.sql:11:INSERT INTO transactions (user_id, account_id, date, amount_paise, merchant, is_opening)
apps/api/drizzle/0017_typical_toad.sql:8:UPDATE "holding_events" he SET "seq" = ord.rn
apps/api/drizzle/0017_typical_toad.sql:18:UPDATE "holdings" SET "gains_tax_class" = 'other' WHERE "asset_class" NOT IN ('stock', 'mutual_fund', 'etf');
```

Exit code: 0

## 8. apps/api/package.json scripts section

```json
"scripts": {
  "dev": "node --watch --env-file-if-exists=../../.env src/server.ts",
  "start": "node --env-file-if-exists=../../.env src/server.ts",
  "db:generate": "node --env-file-if-exists=../../.env ../../node_modules/drizzle-kit/bin.cjs generate",
  "db:migrate": "node --env-file-if-exists=../../.env ../../node_modules/drizzle-kit/bin.cjs migrate",
  "db:seed": "node --env-file-if-exists=../../.env src/db/seed.ts",
  "db:bootstrap": "node --env-file-if-exists=../../.env src/db/bootstrap.ts",
  "db:restore": "node --env-file-if-exists=../../.env src/db/restore.ts",
  "test": "node --env-file-if-exists=../../.env --test \"src/**/*.test.ts\"",
  "typecheck": "tsc --noEmit"
}
```
