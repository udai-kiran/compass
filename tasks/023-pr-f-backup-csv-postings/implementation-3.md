# Iteration 3 — D9.6 flake fix

## Files inspected
- apps/api/src/modules/system/services/backup.test.ts (lines 1703-1728)
- apps/api/src/db/shared/ledger.ts (line 135: `id: uuid("id").primaryKey().defaultRandom()`)

## Files changed
- apps/api/src/modules/system/services/backup.test.ts — D9.6 test only

## Diff (D9.6 block)

```diff
-  // Insert two real (system_kind IS NULL) postings with different amounts.
-  // The one inserted first will have the lower id and must win (order by p.id limit 1).
-  await db.insert(postings).values({ transactionId: txn!.id, accountId: fx.bankId, amountPaise: -7000 });
-  await db.insert(postings).values({ transactionId: txn!.id, accountId: fx.walletId, amountPaise: -9999 });
+  // Insert two real (system_kind IS NULL) postings with different amounts.
+  // Hard-coded UUID literals are used so the lexical ordering (and therefore which
+  // posting wins `ORDER BY p.id LIMIT 1`) is deterministic and independent of
+  // insertion order. Do NOT replace these with generated ids: the test would flake
+  // because gen_random_uuid() gives no insertion-order guarantee.
+  // '...0001' < '...0002' lexically, so the posting on bankId/-7000 wins.
+  await db.insert(postings).values({ id: "00000000-0000-4000-8000-000000000001", transactionId: txn!.id, accountId: fx.bankId, amountPaise: -7000 });
+  await db.insert(postings).values({ id: "00000000-0000-4000-8000-000000000002", transactionId: txn!.id, accountId: fx.walletId, amountPaise: -9999 });
   ...
-  // The first-inserted (lowest id) real posting is bank/-7000; wallet/-9999 must not appear.
+  // The posting with the smaller UUID ('...0001', on bankId/-7000) wins; wallet/-9999 must not appear.
```

## UUIDs used
- Winner: `00000000-0000-4000-8000-000000000001` → bankId / -7000 → wins because it is lexically smaller
- Loser:  `00000000-0000-4000-8000-000000000002` → walletId / -9999 → suppressed by LIMIT 1

## backup.ts SHA-256 (unchanged)
1e675ee2790f571c0796503d9746087e78b279014aea4d6deb90f041444d7151

## Commands and results

1. `npm run typecheck` — EXIT:0 (all workspaces clean)
2. `npm run lint` — EXIT:0 (no violations)
3. `node --test apps/api/src/modules/system/services/backup.test.ts` — BLOCKED (EXIT:1); module throws at load: `requireDatabaseUrl` aborts with "backup.test.ts's DB-backed tests need DATABASE_URL set"; no DATABASE_URL available in this environment.
