# Backup & Restore

Compass writes **encrypted logical backups** to `BACKUP_DIR` (default `./data/backups`).
Each backup is the full database dumped to JSON, gzipped, then AES-256-GCM
encrypted into a self-describing envelope (`compass-backup-<timestamp>.json.gz.enc`).
No `pg_dump` binary is required, so backups work regardless of where Postgres runs.

## What's backed up

- Every application table (accounts, transactions, budgets, goals, holdings,
  cards, net-worth snapshots, …) — a complete logical snapshot.
- Attachments live as files under `STORAGE_DIR`; back that directory up with your
  normal file backups (e.g. `tar czf attachments.tgz $STORAGE_DIR`).

## Encryption key

The envelope is encrypted with `BACKUP_KEY` if set, otherwise `SESSION_SECRET`.
**Store this key separately from the backups** — without it the data is
unrecoverable. Rotating `SESSION_SECRET` without setting `BACKUP_KEY` will make
older backups undecryptable.

## Schedule & manual runs

- A BullMQ job (`backup.weekly`) runs every Sunday at 03:00.
- Trigger one on demand: `POST /api/backup/run` → `{ path, bytes }`.

## Restore drill

1. Copy the `.enc` file to the target machine and ensure the same `BACKUP_KEY`
   (or `SESSION_SECRET`) is in the environment.
2. Decrypt and inspect:

   ```bash
   node --env-file=.env -e '
     import { readFileSync } from "node:fs";
     import { decryptBackup } from "./apps/api/src/lib/crypto-backup.ts";
     const env = readFileSync(process.argv[1]);
     const key = process.env.BACKUP_KEY || process.env.SESSION_SECRET;
     const json = JSON.parse(decryptBackup(env, key).toString());
     console.log(Object.keys(json.data).map(t => `${t}: ${json.data[t].length}`).join("\n"));
   ' path/to/compass-backup-*.json.gz.enc
   ```

3. Recreate the schema on a fresh database (`npm run db:migrate -w apps/api`).
4. Load the decrypted JSON table-by-table (dependency order is preserved in the
   dump). A restore helper can iterate `json.data` and `INSERT` each row; because
   ids are preserved, foreign keys line up.
5. Restore `STORAGE_DIR` from your file backup.
6. Start the app and verify the dashboard totals match the source instance.

## Per-user data ownership export

Users can export **their own** data at any time (no admin needed):

- `GET /api/export.json` — portable JSON of all their records.
- `GET /api/export/transactions.csv` — their transactions as CSV.

These are exposed in **Settings → Data**.
