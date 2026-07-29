---
sidebar_position: 3
title: Backup & Restore
---

# Backup & Restore

Compass offers two independent backup paths: instance backups (for the operator) and per-user encrypted archives (for self-service portability).

## Instance backups

A weekly BullMQ job writes a full-database logical backup to `BACKUP_DIR` (default `./data/backups`). Every table is dumped to JSON, gzipped, then AES-256-GCM encrypted into a self-describing envelope: `compass-backup-<timestamp>.json.gz.enc`.

### What is backed up

- Every application table: accounts, transactions, budgets, goals, holdings, cards, net-worth snapshots, and more — a complete logical snapshot
- Uploaded files (attachments, documents) live in object storage (MinIO in production, disk in development) and are **not** in the instance backup — back that store up separately

### Encryption key

The envelope is encrypted with `BACKUP_KEY` if set, otherwise `SESSION_SECRET`. **Store this key separately from the backups** — without it the data is unrecoverable. Rotating `SESSION_SECRET` without setting `BACKUP_KEY` will make older backups undecryptable.

### Triggering a backup

- Automatic: every Sunday at 03:00 (BullMQ job `backup.weekly`)
- Manual: `POST /api/backup/run` returns `{ path, bytes }`

### Restore drill

1. Copy the `.enc` file to the target machine and ensure the same `BACKUP_KEY` (or `SESSION_SECRET`) is in the environment.

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

3. Point `DATABASE_URL` at a fresh, empty database and recreate the schema:
   ```bash
   npm run db:migrate -w apps/api
   ```

4. Restore the encrypted backup:
   ```bash
   npm run db:restore -w apps/api -- path/to/compass-backup-*.json.gz.enc
   ```
   The restore is transactional and refuses a database that already contains a user. It handles account↔goal cycles and category parent links in a second pass, after all referenced rows exist.

5. Restore `STORAGE_DIR` from your file backup.

6. Start the app and verify the dashboard totals match the source instance.

## Per-user encrypted archive (files included)

A **per-user archive** carries one user's rows *and every uploaded file those rows reference*, encrypted with a **passphrase the user chooses** (not the server key) — so it restores on any Compass instance without sharing server secrets.

The envelope is v2 format (`CMPB2`): an 8-byte-length-prefixed header JSON (the user's table rows + file references), followed by one length-prefixed frame per file. The whole thing is streamed through gzip→AES-256-GCM, keeping memory flat.

### Creating a per-user archive

**Settings → Data → Encrypted backup**:
1. Choose a strong passphrase (you will need it to restore)
2. Click **Download**

This produces a `.cmpb` file. **The passphrase cannot be recovered** — lose it and the archive is unreadable.

### Restoring into a fresh account

1. On the target instance, **register a new account** (or use one with no data yet).
2. **Settings → Data → Restore from backup**: pick the `.cmpb` file, enter the passphrase, click **Restore**.
3. Every row is re-homed to the new account's `user_id`, every file is re-uploaded to this instance's storage, and the new storage keys are written back — so no restored record points to a missing object.

The restore refuses an account that already has data (accounts, transactions, insurance, goals, or holdings).

## Storage health (orphan report)

**Settings → Data → Storage health** lists objects in the store that **no row references** — left behind by crashed uploads or deletes. **Report only**; nothing is deleted. Review before removing any.

## Data export

Users can export their own data at any time (no files):

- **Settings → Data → Export** downloads `compass-export.json` — portable JSON of all records
- **Settings → Data → Export transactions** downloads `compass-transactions.csv`
