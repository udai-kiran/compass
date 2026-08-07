All changes are complete and verified. Here is the full report.

---

# B1a Schema-only slice — report

## Files changed (6)

| File | Change |
|---|---|
| `apps/api/src/db/shared/hubs.ts` | append `"system"` to `account_type` enum; new `accountSystemKind` pgEnum; accounts: drop `openingBalancePaise`, add nullable `systemKind`, add partial unique index |
| `apps/api/src/db/shared/ledger.ts` | transactions: drop `accountId`, `amountPaise`, `categoryId`, `necessity`, `isOpening` + 2 indexes; remove unused `boolean` import; new `postings` table beside `transactions` |
| `apps/api/src/modules/ledger/schema.ts` | re-export line now includes `postings` |
| `apps/api/drizzle/0067_slim_blizzard.sql` | **NEW** — generated migration |
| `apps/api/drizzle/meta/0067_snapshot.json` | **NEW** — generated snapshot |
| `apps/api/drizzle/meta/_journal.json` | 0067 journal entry appended by drizzle-kit |

`apps/api/src/db/schema.ts` — **verified, not modified**: `postings` flows through the barrel via `export * from "./shared/ledger.ts"` (line 22) and is **not** in the explicit module import list (line 41 is `{ transactionSplits, transferLinks, transactionLinks, merchantRules, userTasks, attachments }`), so it is exported **exactly once** — no duplicate, no edit needed.

Per the delegation scope, I did **not** touch `post-entry.ts`, `backup.ts`, `auth.ts`, `db/seed.ts`, `transaction_splits`, or `transfer_links` (later slices), and did **not** run typecheck/lint/test.

## Full unified diffs

### `apps/api/src/db/shared/hubs.ts`

```diff
diff --git a/apps/api/src/db/shared/hubs.ts b/apps/api/src/db/shared/hubs.ts
index 784114f..7989c3e 100644
--- a/apps/api/src/db/shared/hubs.ts
+++ b/apps/api/src/db/shared/hubs.ts
@@ -43,6 +43,14 @@ export const accountType = pgEnum("account_type", [
   // not an account. This enum value is retained only because Postgres cannot drop
   // an enum value; no account uses it and the UI no longer offers it.
   "insurance",
+  // System account — not a real financial container. See accountSystemKind.
+  "system",
+]);
+
+export const accountSystemKind = pgEnum("account_system_kind", [
+  "expenses",
+  "income",
+  "opening",
 ]);
 
 export const accounts = pgTable(
@@ -79,9 +87,7 @@ export const accounts = pgTable(
       .notNull()
       .default(sql`'{}'::text[]`),
     currency: text("currency").notNull().default("INR"),
-    openingBalancePaise: bigint("opening_balance_paise", { mode: "number" })
-      .notNull()
-      .default(0),
+    systemKind: accountSystemKind("system_kind"),
     /**
      * Goal this account is earmarked for; net worth and goal funding group by
      * it. Null = the "Unassigned" bucket. Set-null on goal delete so the account
@@ -95,7 +101,12 @@ export const accounts = pgTable(
     createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
     updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
   },
-  (t) => [index("accounts_user_idx").on(t.userId)],
+  (t) => [
+    index("accounts_user_idx").on(t.userId),
+    uniqueIndex("accounts_system_kind_idx")
+      .on(t.userId, t.systemKind)
+      .where(sql`system_kind is not null`),
+  ],
 );
 
 export const emailClass = pgEnum("email_class", [
```

### `apps/api/src/db/shared/ledger.ts`

```diff
diff --git a/apps/api/src/db/shared/ledger.ts b/apps/api/src/db/shared/ledger.ts
index 6850e41..42f4d3b 100644
--- a/apps/api/src/db/shared/ledger.ts
+++ b/apps/api/src/db/shared/ledger.ts
@@ -1,7 +1,6 @@
 import { sql } from "drizzle-orm";
 import {
   bigint,
-  boolean,
   date,
   index,
   pgEnum,
@@ -27,9 +26,6 @@ export const transactions = pgTable(
     userId: uuid("user_id")
       .notNull()
       .references(() => users.id),
-    accountId: uuid("account_id")
-      .notNull()
-      .references(() => accounts.id),
     date: date("date").notNull(),
     /**
      * Precise transaction instant when known (a card alert / statement line
@@ -38,32 +34,13 @@ export const transactions = pgTable(
      * matching, where amount + timestamp uniquely ties a line to its ledger row.
      */
     occurredAt: timestamp("occurred_at", { withTimezone: true }),
-    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
     merchant: text("merchant").notNull().default(""),
-    categoryId: uuid("category_id").references(() => categories.id),
-    /**
-     * Need-vs-want for this specific spend, overriding the category's default.
-     * Null = inherit (see `effectiveNecessity` in packages/shared).
-     *
-     * No check constraint like `categories` has: a transaction carries no `kind`
-     * to contradict, and sign alone does not disqualify a row — a refund against
-     * an essential purchase is still essential spend being reversed.
-     */
-    necessity: expenseNecessity("necessity"),
     notes: text("notes").notNull().default(""),
     tags: text("tags")
       .array()
       .notNull()
       .default(sql`'{}'::text[]`),
     source: transactionSource("source").notNull().default("manual"),
-    /**
-     * True for the single seed row carrying a bank/cash account's starting
-     * balance, so the account ledger reconciles instead of a balance appearing
-     * from a hidden column. Excluded from income/expense/spend aggregations the
-     * same way transfers are. A boolean (not a new `source` enum value) so the
-     * marker is usable in the same migration transaction that adds it.
-     */
-    isOpening: boolean("is_opening").notNull().default(false),
     /**
      * Insurance policy this expense pays a premium for — a link to an
      * insurance_policies row, kept apart from `accountId` (the account the money
@@ -106,8 +83,6 @@ export const transactions = pgTable(
       t.createdAt.desc(),
       t.id.desc(),
     ),
-    index("transactions_account_idx").on(t.accountId),
-    index("transactions_category_idx").on(t.categoryId),
     index("transactions_policy_idx").on(t.policyId),
     index("transactions_resource_idx").on(t.resourceId),
     index("transactions_recurring_template_idx").on(t.recurringTemplateId),
@@ -122,4 +97,27 @@ export const transactions = pgTable(
       .on(t.sipId, t.date)
       .where(sql`sip_id is not null and deleted_at is null`),
   ],
+);
+
+export const postings = pgTable(
+  "postings",
+  {
+    id: uuid("id").primaryKey().defaultRandom(),
+    transactionId: uuid("transaction_id")
+      .notNull()
+      .references(() => transactions.id, { onDelete: "cascade" }),
+    accountId: uuid("account_id")
+      .notNull()
+      .references(() => accounts.id),
+    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
+    categoryId: uuid("category_id").references(() => categories.id),
+    necessity: expenseNecessity("necessity"),
+    note: text("note").notNull().default(""),
+    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
+  },
+  (t) => [
+    index("postings_tx_idx").on(t.transactionId),
+    index("postings_account_idx").on(t.accountId),
+    index("postings_category_idx").on(t.categoryId),
+  ],
 );
\ No newline at end of file
```

### `apps/api/src/modules/ledger/schema.ts`

```diff
diff --git a/apps/api/src/modules/ledger/schema.ts b/apps/api/src/modules/ledger/schema.ts
index f2cc2a8..3fe78a9 100644
--- a/apps/api/src/modules/ledger/schema.ts
+++ b/apps/api/src/modules/ledger/schema.ts
@@ -35,7 +35,7 @@ import { categories } from "../../db/shared/foundation.ts";
 export { accounts, accountType } from "../../db/shared/hubs.ts";
 export { categories, categoryKind, expenseNecessity, resourceKind, resources } from "../../db/shared/foundation.ts";
 export { recurringFrequency, recurringKind, recurringTemplates } from "../../db/shared/recurring.ts";
-export { transactions, transactionSource } from "../../db/shared/ledger.ts";
+export { transactions, transactionSource, postings } from "../../db/shared/ledger.ts";
 
 export const transactionSplits = pgTable(
   "transaction_splits",
```

### `apps/api/drizzle/meta/_journal.json` (generated)

```diff
diff --git a/apps/api/drizzle/meta/_journal.json b/apps/api/drizzle/meta/_journal.json
index f63e420..32a8990 100644
--- a/apps/api/drizzle/meta/_journal.json
+++ b/apps/api/drizzle/meta/_journal.json
@@ -470,6 +470,13 @@
       "when": 1785655874565,
       "tag": "0066_eager_spectrum",
       "breakpoints": true
+    },
+    {
+      "idx": 67,
+      "version": "7",
+      "when": 1786003592710,
+      "tag": "0067_slim_blizzard",
+      "breakpoints": true
     }
   ]
 }
```

## db:generate run

**Literal command:** `cd /home/udai/PennyPilot && npm run db:generate`

**First attempt (non-TTY)** — drizzle-kit required an interactive prompt but had no TTY, so it errored. Output (stdout+stderr), shell-reported exit code `0` (npm wrapper; the child threw):

```
> compass@0.1.0 db:generate
> npm run db:generate -w apps/api


> @compass/api@0.1.0 db:generate
> node --env-file-if-exists=../../.env ../../node_modules/drizzle-kit/bin.cjs generate

No config path provided, using default 'drizzle.config.ts'
Reading config file '/home/udai/PennyPilot/apps/api/drizzle.config.ts'
Error: Interactive prompts require a TTY terminal (process.stdin.isTTY or process.stdout.isTTY is false). This can happen when running in CI, piped input, or non-interactive shells.
    at render10 (/home/udai/PennyPilot/node_modules/drizzle-kit/bin.cjs:1450:31)
    at promptColumnsConflicts (/home/udai/PennyPilot/node_modules/drizzle-kit/bin.cjs:32711:65)
    at columnsResolver (/home/udai/PennyPilot/node_modules/drizzle-kit/bin.cjs:32146:28)
    at applyPgSnapshotsDiff (/home/udai/PennyPilot/node_modules/drizzle-kit/bin.cjs:28228:73)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at async prepareAndMigratePg (/home/udai/PennyPilot/node_modules/drizzle-kit/bin.cjs:32191:42)
    at async Object.handler (/home/udai/PennyPilot/node_modules/drizzle-kit/bin.cjs:91988:7)
    at async run (/home/udai/PennyPilot/node_modules/drizzle-kit/bin.cjs:91472:7)
```

**Successful run (same literal command, driven under a pseudo-TTY via `pexpect`)** — the interactive prompt appeared and I answered it with the DROP/CREATE choice (the default `create column` option, selected with Enter). It generated the migration and exited cleanly. Tail of stdout:

```
[✓] Your SQL migration file ➜ drizzle/0067_slim_blizzard.sql 🚀
```

**Interactive prompt encountered, captured verbatim (chose DROP/CREATE):**

```
Is system_kind column in accounts table created or renamed from another column?
❯ + system_kind                         create column
  ~ opening_balance_paise › system_kind rename column
```

Only **one** real prompt appeared (the `accounts.system_kind` conflict); the five `transactions` column drops were resolved automatically as pure drops. (My capture script also logged a second "ANSWER" line, but that was a false-positive marker match on the post-prompt table-list rendering — a stray Enter with no active prompt; harmless, confirmed by the idempotent re-run below.)

**Idempotency re-run** (same schema, no whitespace/structural change; run as the npm script does from `apps/api`): `node --env-file-if-exists=../../.env ../../node_modules/drizzle-kit/bin.cjs generate` → exit code `0`, output ended `No schema changes, nothing to migrate 😴`, and still **exactly one** `0067_*.sql`.

**Migration filename:** `apps/api/drizzle/0067_slim_blizzard.sql` (exactly one new `.sql` file; plus `meta/0067_snapshot.json`).

## Full text of generated `0067_slim_blizzard.sql`

```sql
CREATE TYPE "public"."account_system_kind" AS ENUM('expenses', 'income', 'opening');--> statement-breakpoint
ALTER TYPE "public"."account_type" ADD VALUE 'system';--> statement-breakpoint
CREATE TABLE "postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"category_id" uuid,
	"necessity" "expense_necessity",
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_category_id_categories_id_fk";
--> statement-breakpoint
DROP INDEX "transactions_account_idx";--> statement-breakpoint
DROP INDEX "transactions_category_idx";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "system_kind" "account_system_kind";--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "postings_tx_idx" ON "postings" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "postings_account_idx" ON "postings" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "postings_category_idx" ON "postings" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_system_kind_idx" ON "accounts" USING btree ("user_id","system_kind") WHERE system_kind is not null;--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "opening_balance_paise";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "account_id";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "amount_paise";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "category_id";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "necessity";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "is_opening";
```

## Deviations

1. **`db:generate` required a TTY**: the literal command failed in a non-interactive shell because drizzle-kit prompts on the `accounts.system_kind` column conflict. I re-ran the identical command under a pseudo-TTY (`pexpect`) and answered the prompt with **DROP/CREATE** (`create column` — the default/first option). The prompt is captured verbatim above. This is exactly the "choose DROP/CREATE and capture the prompt verbatim" contingency in the delegation, so no schema deviation.
2. **Imports in `ledger.ts`**: only `boolean` was removed (its sole user `isOpening` is gone); `accounts`, `categories`, `expenseNecessity`, `bigint`, `index`, `text`, `timestamp`, `uuid` are all retained because the new `postings` table uses them — per the delegation's note.
3. **`db/schema.ts` was not modified**: verified it already exports `postings` exactly once via `export * from "./shared/ledger.ts"` (not duplicated in the explicit module-import list), so no edit was required.
4. Cosmetic: the generated `0067_*.sql` places `postings`' FK/index statements after the `DROP INDEX`/`ADD COLUMN` statements (drizzle-kit's own statement ordering); all columns/indexes match the spec exactly (verified against the snapshot via the "No schema changes" idempotent re-run).

No typecheck/lint/test was run, per instructions. The tree is intentionally not green until the B2–B4/F1 slices land.
