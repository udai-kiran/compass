# Migration Proof — 2026-08-06

## 1. DATABASE_URL (masked)
```
$ node -e "console.log((process.env.DATABASE_URL||'UNSET').replace(/:[^:@\/]+@/,':***@'))"
UNSET
```
DATABASE_URL is not set in the shell environment directly; it is loaded at
runtime via `--env-file-if-exists=../../.env` (from apps/api/package.json
"test" and "db:migrate" scripts). The .env at repo root supplies the URL.

## 2. drizzle.config.ts
File: apps/api/drizzle.config.ts
- Reads `process.env.DATABASE_URL` — no hardcoded URL.
- Throws if DATABASE_URL is unset.
- migrations folder: `./drizzle` (apps/api/drizzle/)

## 3. npm run db:migrate
```
$ npm run db:migrate
> compass@0.1.0 db:migrate
> npm run db:migrate -w apps/api

> @compass/api@0.1.0 db:migrate
> node --env-file-if-exists=../../.env ../../node_modules/drizzle-kit/bin.cjs migrate

No config path provided, using default 'drizzle.config.ts'
Reading config file '/home/udai/PennyPilot/apps/api/drizzle.config.ts'
Using 'pg' driver for database querying
[✓] migrations applied successfully!
EXIT: 0
```

## 4. Schema state check (before — actually already applied after step 3)
```
$ node --env-file-if-exists=.env -e "..."
{"postings":"postings","sys_kind":"system_kind"}
EXIT: 0
```
- `postings` relation: EXISTS
- `system_kind` column on `accounts`: EXISTS

Both were present immediately after `db:migrate` completed in step 3 — no
separate manual migration step was needed.

## 5. No additional migration step required
`db:migrate` and the test runner use the same `--env-file-if-exists=../../.env`
(.env at repo root), so they connect to the same database. Migration 0067 was
applied by step 3.

## 6. Schema state after (same as step 4)
`postings` EXISTS, `system_kind` EXISTS.

## 7. backup.test.ts
```
$ node --env-file-if-exists=.env --test apps/api/src/modules/system/services/backup.test.ts
✔ the full backup covers every table in the schema (2.352685ms)
✔ sips precedes holding_events in ALL_TABLES (holding_events.sip_id FKs sips) (0.268494ms)
✔ the per-user export reconstructs every table (no coverage gaps) (0.246207ms)
✔ no table is scoped both directly and through a parent (0.201079ms)
✔ every storage-key column in the schema is covered by FILE_COLUMNS (0.65842ms)
✔ collectFileRefs pulls every non-empty storage key from a dump (0.503829ms)
✔ the per-user restore covers exactly the exported tables, in parent-first order (0.385906ms)
✔ restore defers cyclic and self-referencing foreign keys (0.438362ms)
✔ restoreDump's second pass issues an update for every column in DEFERRED_RESTORE_COLUMNS (1.401704ms)
✔ the mocked restoreDump records postings every column, positioned after FK parents (1.137479ms)
✔ misc-05 AC14: restoreDump's first pass carries user_tasks.source/source_key through untouched when present, and omits them (falling back to the column DEFAULT) when the dump predates the migration (0.636071ms)
✔ AC11: a task linked to an owned transaction, and an unlinked task, round-trip through per-user backup/restore (289.385034ms)
✔ misc-05 AC14: the per-user archive round-trips a card-due task's source/sourceKey through restoreUserBackup, alongside an ordinary task (200.438245ms)
✔ misc-05 AC14: a per-user archive predating source/sourceKey (missing both keys entirely) restores via restoreUserBackup by falling back to the column DEFAULTs (41.559382ms)
✔ A6 AC2: a dest user with seeded categories + system accounts restores; a real non-system account blocks with 409 (321.72064ms)
✔ A6 AC3+AC4: restore re-synthesizes postings (never trusts archived rows) (293.958171ms)
✔ A6 AC3 OLD-style (B1): restore re-synthesizes postings from an archive with no postings and no system accounts (128.606834ms)
✔ A6 AC5: a posting with a foreign account_id is skipped (never inserted) (32.856525ms)
✔ A6 AC5 post-commit throw: reconcile failure does not roll back committed restore or delete blobs (176.657431ms)
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2754.28109
EXIT: 0
```

## 8. postings.test.ts
```
$ node --env-file-if-exists=.env --test apps/api/src/modules/ledger/services/postings.test.ts
✔ assertSafePaise rejects non-safe integers (3.335719ms)
✔ sumPaise sums exactly via BigInt and rejects unsafe results (0.423049ms)
✔ assertZeroSum: random balanced sets pass, perturbed sets throw (seeded PRNG) (8.629366ms)
✔ assertZeroSum: boundary legs near ±MAX_SAFE_INTEGER (0.368704ms)
✔ buildOrdinaryPostings: -200000 expense → asset -200000 + Expenses +200000 (4.426668ms)
✔ buildOrdinaryPostings: +300000 income → asset +300000 + Income -300000 (0.29642ms)
✔ buildSplitPostings: -200000 into -150000/-50000 → asset -200000 + Expenses +150000 + Expenses +50000 (0.426996ms)
✔ buildSplitPostings: mixed-sign splits pick the correct system accounts (0.308326ms)
✔ buildTransferPostings: 200000 → from -200000 / to +200000 (0.350589ms)
✔ buildTransferPostings: rejects non-positive amounts (0.434803ms)
✔ buildOpeningPostings: 500000 → asset +500000 / opening -500000 (0.324054ms)
✔ buildTransferLegPostings: outflow leg → real -X / Clearing +X, zero-sum (0.281329ms)
✔ buildTransferLegPostings: inflow leg → real +X / Clearing -X, zero-sum (0.184897ms)
✔ buildTransferLegPostings: safe-integer boundary value zero-sums both signs (0.267633ms)
✔ classifyShape + projections round-trip: ordinary (0.506483ms)
✔ classifyShape + projections round-trip: split (0.327033ms)
✔ classifyShape + projections round-trip: mixed-sign split (0.210547ms)
✔ classifyShape + projections round-trip: opening (0.271474ms)
✔ classifyShape: transfer classifies as 'transfer' (0.346871ms)
✔ classifyShape: degenerate shapes throw (0.289895ms)
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 206.339893
EXIT: 0
```

## 9. typecheck
```
$ npm run typecheck -w apps/api
> @compass/api@0.1.0 typecheck
> tsc --noEmit

EXIT: 0
```
