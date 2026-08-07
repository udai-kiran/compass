# backend-4 — post-entry.ts edits

## Files inspected
- `/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts`

## Files changed
- `/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts`

## Edits applied

**Edit 1 — remove unused `Db` import (line 2)**

Before:
```
import type { Db, DbOrTx } from "../../../db/index.ts";
```
After:
```
import type { DbOrTx } from "../../../db/index.ts";
```

**Edit 2a — add `sql` to drizzle-orm import (line 1)**

Before:
```
import { and, eq, isNotNull } from "drizzle-orm";
```
After:
```
import { and, eq, isNotNull, sql } from "drizzle-orm";
```

**Edit 2b — add `targetWhere` partial-index predicate to `onConflictDoNothing` in `seedSystemAccounts`**

Before:
```
.onConflictDoNothing({ target: [accounts.userId, accounts.systemKind] });
```
After:
```
.onConflictDoNothing({ target: [accounts.userId, accounts.systemKind], targetWhere: sql`system_kind is not null` });
```

## Commands run

```
git diff --no-index /dev/null apps/api/src/modules/ledger/services/post-entry.ts
```

## Literal diff output

Note: the file is on branch `feat/postings-model-sp1` and is **untracked** (new file not yet staged), so `git diff` produces no output; `git diff --no-index /dev/null <file>` is used to show the full resulting file as a diff (exit code 1 is expected when differences exist):

```diff
diff --git a/apps/api/src/modules/ledger/services/post-entry.ts b/apps/api/src/modules/ledger/services/post-entry.ts
new file mode 100644
index 0000000..aab9877
--- /dev/null
+++ b/apps/api/src/modules/ledger/services/post-entry.ts
@@ -0,0 +1,183 @@
+import { and, eq, isNotNull, sql } from "drizzle-orm";
+import type { DbOrTx } from "../../../db/index.ts";
+import { accounts, postings, transactions } from "../schema.ts";
+import { HttpError } from "../../../lib/errors.ts";
+import { assertZeroSum, type PostingDraft } from "./postings.ts";
+
+// ---------------------------------------------------------------------------
+// Types
+// ---------------------------------------------------------------------------
+
+export interface PostEntryHeader {
+  date: string;
+  occurredAt?: Date | null;
+  merchant?: string;
+  notes?: string;
+  tags?: string[];
+  source?: "manual" | "import" | "recurring";
+  policyId?: string | null;
+  resourceId?: string | null;
+  sipId?: string | null;
+  recurringTemplateId?: string | null;
+  reconciledStatementId?: string | null;
+}
+
+// ---------------------------------------------------------------------------
+// Writer helpers
+// ---------------------------------------------------------------------------
+
+/**
+ * Insert a new transaction header + its postings in ONE db transaction,
+ * asserting zero-sum immediately before persistence. Returns the new tx id.
+ */
+export async function postEntry(
+  db: DbOrTx,
+  input: { userId: string; header: PostEntryHeader; postings: PostingDraft[] },
+): Promise<{ transactionId: string }> {
+  return db.transaction(async (t) => {
+    assertZeroSum(input.postings);
+
+    // Build header values, omitting undefined fields so DB defaults apply.
+    const headerValues: Record<string, unknown> = {
+      userId: input.userId,
+      date: input.header.date,
+    };
+    if (input.header.occurredAt !== undefined) headerValues.occurredAt = input.header.occurredAt;
+    if (input.header.merchant !== undefined) headerValues.merchant = input.header.merchant;
+    if (input.header.notes !== undefined) headerValues.notes = input.header.notes;
+    if (input.header.tags !== undefined) headerValues.tags = input.header.tags;
+    if (input.header.source !== undefined) headerValues.source = input.header.source;
+    if (input.header.policyId !== undefined) headerValues.policyId = input.header.policyId;
+    if (input.header.resourceId !== undefined) headerValues.resourceId = input.header.resourceId;
+    if (input.header.sipId !== undefined) headerValues.sipId = input.header.sipId;
+    if (input.header.recurringTemplateId !== undefined) headerValues.recurringTemplateId = input.header.recurringTemplateId;
+    if (input.header.reconciledStatementId !== undefined) headerValues.reconciledStatementId = input.header.reconciledStatementId;
+
+    const [txn] = await t.insert(transactions).values(headerValues).returning();
+    const transactionId = txn!.id;
+
+    if (input.postings.length > 0) {
+      await t.insert(postings).values(
+        input.postings.map((p) => ({
+          transactionId,
+          accountId: p.accountId,
+          amountPaise: p.amountPaise,
+          categoryId: p.categoryId,
+          necessity: p.necessity,
+          note: p.note,
+        })),
+      );
+    }
+
+    return { transactionId };
+  });
+}
+
+/**
+ * Replace ALL postings of an existing transaction (delete + insert) inside a
+ * single db transaction, asserting zero-sum before persist. For posting
+ * mutations.
+ */
+export async function replacePostings(
+  db: DbOrTx,
+  transactionId: string,
+  replacements: PostingDraft[],
+): Promise<void> {
+  return db.transaction(async (t) => {
+    assertZeroSum(replacements);
+
+    await t.delete(postings).where(eq(postings.transactionId, transactionId));
+
+    if (replacements.length > 0) {
+      await t.insert(postings).values(
+        replacements.map((p) => ({
+          transactionId,
+          accountId: p.accountId,
+          amountPaise: p.amountPaise,
+          categoryId: p.categoryId,
+          necessity: p.necessity,
+          note: p.note,
+        })),
+      );
+    }
+  });
+}
+
+/**
+ * Header-only metadata/FK update. MUST NOT touch postings.
+ */
+export async function updateTransactionHeader(
+  db: DbOrTx,
+  transactionId: string,
+  patch: Partial<PostEntryHeader>,
+): Promise<void> {
+  const values: Record<string, unknown> = { updatedAt: new Date() };
+  if (patch.date !== undefined) values.date = patch.date;
+  if (patch.occurredAt !== undefined) values.occurredAt = patch.occurredAt;
+  if (patch.merchant !== undefined) values.merchant = patch.merchant;
+  if (patch.notes !== undefined) values.notes = patch.notes;
+  if (patch.tags !== undefined) values.tags = patch.tags;
+  if (patch.source !== undefined) values.source = patch.source;
+  if (patch.policyId !== undefined) values.policyId = patch.policyId;
+  if (patch.resourceId !== undefined) values.resourceId = patch.resourceId;
+  if (patch.sipId !== undefined) values.sipId = patch.sipId;
+  if (patch.recurringTemplateId !== undefined) values.recurringTemplateId = patch.recurringTemplateId;
+  if (patch.reconciledStatementId !== undefined) values.reconciledStatementId = patch.reconciledStatementId;
+
+  await db.update(transactions).set(values).where(eq(transactions.id, transactionId));
+}
+
+// ---------------------------------------------------------------------------
+// System accounts
+// ---------------------------------------------------------------------------
+
+const SYSTEM_ACCOUNT_NAMES: Record<string, string> = {
+  expenses: "Expenses",
+  income: "Income",
+  opening: "Opening Balances",
+};
+
+/**
+ * Idempotent: ensure one system account per kind for the user. Uses ON CONFLICT
+ * DO NOTHING against the `accounts_system_kind_idx` partial unique index.
+ */
+export async function seedSystemAccounts(
+  db: DbOrTx,
+  userId: string,
+): Promise<void> {
+  for (const [kind, name] of Object.entries(SYSTEM_ACCOUNT_NAMES)) {
+    await db
+      .insert(accounts)
+      .values({
+        userId,
+        name,
+        type: "system",
+        systemKind: kind as "expenses" | "income" | "opening",
+      })
+      .onConflictDoNothing({ target: [accounts.userId, accounts.systemKind], targetWhere: sql`system_kind is not null` });
+  }
+}
+
+/**
+ * Resolve the three system-account ids for a user. Throws if any missing.
+ */
+export async function resolveSystemAccounts(
+  db: DbOrTx,
+  userId: string,
+): Promise<{ expenses: string; income: string; opening: string }> {
+  const rows = await db
+    .select({ id: accounts.id, systemKind: accounts.systemKind })
+    .from(accounts)
+    .where(and(eq(accounts.userId, userId), isNotNull(accounts.systemKind)));
+
+  const result: Partial<{ expenses: string; income: string; opening: string }> = {};
+  for (const row of rows) {
+    result[row.systemKind!] = row.id;
+  }
+
+  if (!result.expenses || !result.income || !result.opening) {
+    throw new HttpError(500, "system accounts not seeded");
+  }
+
+  return result as { expenses: string; income: string; opening: string };
+}
```

## Assumptions

The file is untracked (new) on branch `feat/postings-model-sp1`, so `git diff` against HEAD shows nothing; the diff above was produced with `git diff --no-index /dev/null <file>` and confirms the two edits are present in the final file (lines 1–2).

## Unresolved risks

None. Both edits are confined to the named file and symbols.
