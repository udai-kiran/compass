# Backup & Restore

Compass has two independent backup paths:

1. **Instance backups** — server-keyed, whole-database, for the operator.
2. **Per-user encrypted archives** — self-service, one user's data *and their
   uploaded files*, portable to any instance. This is what "Encrypted backup"
   and "Restore from backup" in **Settings → Data** produce and consume.

Both write **encrypted** envelopes; neither needs a `pg_dump` binary, so they
work regardless of where Postgres runs.

## Instance backups

The weekly job writes a full-database logical backup to `BACKUP_DIR` (default
`./data/backups`): every table dumped to JSON, gzipped, then AES-256-GCM
encrypted into a self-describing envelope (`compass-backup-<timestamp>.json.gz.enc`).

### What's backed up

- Every application table (accounts, transactions, budgets, goals, holdings,
  cards, net-worth snapshots, …) — a complete logical snapshot.
- Uploaded files (attachments, insurance/policy documents, health cards, card
  statements) live in object storage (MinIO/S3, or `STORAGE_DIR` on disk) and are
  **not** in the instance backup. Back that store up separately, or use the
  per-user archive below, which does include the files.

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

3. Point `DATABASE_URL` at a fresh, empty database and recreate the schema
   (`npm run db:migrate -w apps/api`).
4. Restore the encrypted backup:

   ```bash
   npm run db:restore -w apps/api -- path/to/compass-backup-*.json.gz.enc
   ```

   The restore is transactional and refuses a database that already contains a
   user. It handles the accounts↔goals cycle and category parent links in a
   second pass, after all referenced rows exist.
5. Restore `STORAGE_DIR` from your file backup.
6. Start the app and verify the dashboard totals match the source instance.

## Per-user encrypted archive (files included)

Unlike the instance backup, a **per-user archive** carries one user's rows *and
every uploaded file those rows reference*, encrypted with a **passphrase the user
chooses** (not the server key) — so it restores on any Compass instance without
sharing server secrets.

Layout inside the (v2, `CMPB2`) envelope: an 8-byte-length-prefixed header JSON
(the user's table rows + a list of file references), followed by one
length-prefixed frame per referenced object. A zero-length frame means the object
was already missing from storage at backup time (the row still restores; the link
stays as broken as it was). The whole thing is streamed through gzip→AES-256-GCM,
so memory stays flat no matter how many statements/documents have accumulated.

### Backup (Settings → Data → Encrypted backup)

- `POST /api/backup/archive` with `{ passphrase }` → downloads
  `compass-backup-<date>.cmpb`. **The passphrase cannot be recovered** — lose it
  and the archive is unreadable.

### Restore into a fresh account

Restore targets a **new, empty account** — it does not overwrite existing data.

1. On the target instance, **register a new account** (or use one with no accounts
   or transactions yet).
2. **Settings → Data → Restore from backup**: pick the `.cmpb` file, enter the
   passphrase, Restore. (`POST /api/backup/restore`, multipart.)
3. Every row is re-homed to the new account's `user_id`, every file is
   re-uploaded to this instance's storage, and the new storage keys are written
   back into the rows — so no restored record points at an object that isn't
   there. The row inserts run in one transaction; if it fails, the just-uploaded
   files are cleaned up.
4. The page reloads; verify dashboard totals and that uploaded documents open.

The guard: restore refuses an account that already has accounts, transactions,
insurance policies, goals, or holdings.

## Storage health (orphan report)

`GET /api/backup/orphans` (Settings → Data → Storage health) lists objects in the
store that **no row references** — left behind by crashed uploads or best-effort
deletes. **Report only**; nothing is deleted. Review the keys before removing any.

## Per-user data ownership export

Users can also export **their own** data as plain files at any time:

- `GET /api/export.json` — portable JSON of all their records (no files).
- `GET /api/export/transactions.csv` — their transactions as CSV.

These are exposed in **Settings → Data**.
