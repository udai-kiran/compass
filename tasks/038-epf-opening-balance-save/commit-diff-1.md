# Commit diff: a89ef79 → 0da6688

## 1. `git show a89ef79 --stat`

```
commit a89ef7945edd7371aca1edf2f88d5bd04f639900
Author: Udai Kiran <ukiran@altoslabs.com>
Date:   Wed Aug 12 08:16:46 2026 +0000

    fix epf save in accounts page

 apps/api/src/modules/ledger/services/accounts.ts   |   8 +-
 apps/web/src/routes/accounts/account-groups.test.ts |   1 +
 apps/web/src/routes/settings/AccountDetailPage.tsx  |  10 +-
 packages/shared/src/schemas/ledger.ts              |   1 +
 tasks/038-epf-opening-balance-save/DELEGATION.md   | 155 +++++++++++++++++++++
 tasks/038-epf-opening-balance-save/TASK.md         |  90 ++++++++++++
 tasks/038-epf-opening-balance-save/review-1.md     |  33 +++++
 tasks/038-epf-opening-balance-save/review-2.md     |  25 ++++
 8 files changed, 317 insertions(+), 6 deletions(-)
```

## 2. `git diff a89ef79 0da6688 -- apps/web/src/routes/settings/AccountDetailPage.tsx`

```diff
diff --git a/apps/web/src/routes/settings/AccountDetailPage.tsx b/apps/web/src/routes/settings/AccountDetailPage.tsx
index 511626e..49eca8b 100644
--- a/apps/web/src/routes/settings/AccountDetailPage.tsx
+++ b/apps/web/src/routes/settings/AccountDetailPage.tsx
@@ -105,7 +105,11 @@ function AccountDetail({ account }: { account: AccountWithBalance }) {
       </header>
 
       <IdentitySection account={account} />
-      <OpeningBalanceSection account={account} />
+      {account.type === "epf" ? (
+        <EpfOpeningSection account={account} />
+      ) : (
+        <OpeningBalanceSection account={account} />
+      )}
       {supportsUpi && <UpiSection account={account} />}
       {/* Keyed by type so a change within a family (e.g. PPF→EPF) remounts the
           section with fresh state rather than keeping the old scheme's values. */}
@@ -294,6 +298,69 @@ function IdentitySection({ account }: { account: AccountWithBalance }) {
   );
 }
 
+/**
+ * EPF-specific opening balance section. EPF passbooks report a single combined
+ * figure (Member PF account = EE + ER share, PLUS Pension account = EPS corpus).
+ * The "Total PF balance" is that combined figure — what you enter here as your
+ * starting point before you begin recording monthly contributions.
+ */
+function EpfOpeningSection({ account }: { account: AccountWithBalance }) {
+  const { update } = useAccountMutations();
+  // openingTransactionPaise: the amount of the is_opening transaction for this
+  // account. Always 0 when no opening balance has been set yet.
+  const [text, setText] = useState(() =>
+    openingBalanceToInput(account.openingTransactionPaise, account.type),
+  );
+  useEffect(() => {
+    setText(openingBalanceToInput(account.openingTransactionPaise, account.type));
+  }, [account.openingTransactionPaise, account.type]);
+
+  const parsed = openingBalanceFromInput(text, account.type);
+  const error = parsed === null ? "must be an amount in rupees" : null;
+  const dirty = parsed !== null && parsed !== account.openingTransactionPaise;
+
+  function submit(e: FormEvent) {
+    e.preventDefault();
+    if (error || parsed === null) return;
+    update.mutate(
+      { id: account.id, openingBalancePaise: parsed },
+      { onSuccess: () => toast("Opening balance saved", "success") },
+    );
+  }
+
+  return (
+    <form onSubmit={submit}>
+      <Section
+        title="Opening balance"
+        hint="The combined balance from your EPFO passbook — Member PF account (EE + ER share) plus Pension account (EPS corpus). Set this once as your starting point; monthly contributions are recorded separately."
+      >
+        <Field label="Total PF balance" error={error}>
+          <div className="flex items-center gap-2">
+            <span className="text-sm text-slate-400">₹</span>
+            <input
+              value={text}
+              onChange={(e) => setText(e.target.value)}
+              inputMode="decimal"
+              aria-invalid={error !== null}
+              className={`${inputClass} tabular-nums ${error ? "border-red-400" : ""}`}
+            />
+          </div>
+        </Field>
+        <div className="space-y-2 rounded-md bg-slate-50 p-3">
+          <DerivedRow
+            label="Current balance"
+            value={formatINR(account.balancePaise)}
+            hint="opening balance plus every contribution"
+          />
+        </div>
+        <div className="pt-1">
+          <SaveButton dirty={dirty} disabled={error !== null} pending={update.isPending} />
+        </div>
+      </Section>
+    </form>
+  );
+}
+
 function OpeningBalanceSection({ account }: { account: AccountWithBalance }) {
   const { update } = useAccountMutations();
   const [text, setText] = useState(() => openingBalanceToInput(account.openingTransactionPaise, account.type));
```

## 3. `git show 0da6688 --stat`

```
commit 0da66888ad028b63e51d743754ab774d247b78a0
Author: Udai Kiran <ukiran@altoslabs.com>
Date:   Wed Aug 12 09:06:47 2026 +0000

    fix epf save in accounts page

 apps/web/src/routes/settings/AccountDetailPage.tsx | 69 +++++++++++++++++++++-
 1 file changed, 68 insertions(+), 1 deletion(-)
```

## 4. `gh run list --commit 0da6688 --limit 5`

No output (no runs returned for that specific commit hash). However, `gh run list --limit 10` shows
that the PR and merge-to-main push associated with this commit ("Fix/epf save in accounts page
(#191)") have **failing** CI:

```
completed  failure  Fix/epf save in accounts page (#191)  Publish images  v2.8.13       push          31581529948  1m22s  2026-08-12T09:08:04Z
completed  failure  Fix/epf save in accounts page (#191)  Publish images  main          push          31581484057  1m29s  2026-08-12T09:07:28Z
completed  failure  Fix/epf save in accounts page (#191)  CI             main          push          31581484052  1m35s  2026-08-12T09:07:28Z
completed  failure  Fix/epf save in accounts page         Publish images  fix/epf-...   pull_request  31581474171  1m46s  2026-08-12T09:07:20Z
completed  failure  Fix/epf save in accounts page         CI             fix/epf-...   pull_request  31581474131  1m42s  2026-08-12T09:07:20Z
```

### CI failure detail (run 31581484052 — "CI" check on main push)

The `typecheck` step fails with **TS2393 Duplicate function implementation** in
`apps/web/src/routes/settings/AccountDetailPage.tsx`:

```
src/routes/settings/AccountDetailPage.tsx(308,10): error TS2393: Duplicate function implementation.
src/routes/settings/AccountDetailPage.tsx(439,10): error TS2393: Duplicate function implementation.
npm error Lifecycle script `typecheck` failed with error:
npm error code 2
```

Lint and all subsequent steps were skipped because typecheck failed first.
