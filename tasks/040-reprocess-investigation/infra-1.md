# Infra Investigation: "Reprocess All" – udaikiran@outlook.com
Date: 2026-08-12

## Environment

Containers (`docker ps` on 192.168.2.183):

```
pennypilot-ingestor-dev   ghcr.io/udai-kiran/pennypilot-ingestor:1.99.0   Up 31 hours
pennypilot-extractor-dev  ghcr.io/udai-kiran/pennypilot-extractor:1.99.0  Up 31 hours
pennypilot-api-dev        ghcr.io/udai-kiran/pennypilot-api:1.99.0        Up 31 hours
pennypilot-web-dev        ghcr.io/udai-kiran/pennypilot-web:1.99.0        Up 31 hours
pennypilot-postgres-dev   pgvector/pgvector:pg18-trixie                   Up 31 hours (healthy)
pennypilot-valkey-dev     valkey/valkey:9.1.1-alpine                      Up 31 hours (healthy)
pennypilot-minio-dev      minio/minio:latest                              Up 31 hours (healthy)
```

Database: `compass-staging` (from `DATABASE_URL` on the API container).
Redis: `valkey:6379/1` (used by both API and ingestor).

---

## Ingestor Logs (full output)

```
docker logs pennypilot-ingestor-dev (1 line total)
{"t":"2026-08-11T10:40:55.982Z","level":"info","msg":"ingestor starting","queue":"email.extract","pollSeconds":120}
```

The ingestor has emitted exactly one log line since container start ~31 hours ago.
No poll cycles, no errors, no user processing events recorded.

---

## Extractor Logs (full output)

```
docker logs pennypilot-extractor-dev (1 line total)
{"t":"2026-08-11T10:40:55.694Z","level":"info","msg":"extractor ready","queue":"email.extract"}
```

Same pattern — started, then silent.

---

## API Logs (non-heartbeat)

```
{"level":30,"time":1786444857071,...,"msg":"Server listening at http://127.0.0.1:3001"}
{"level":30,"time":1786444857071,...,"msg":"Server listening at http://172.32.0.6:3001"}
{"level":30,"time":1786493100121,...,"closed":1,"refreshed":0,"date":"2026-08-11","msg":"net-worth snapshots closed out"}
{"level":30,"time":1786494600125,...,"written":1,"msg":"net-worth snapshots written"}
```

No HTTP requests of any kind appear in the API logs — no reprocess/reset/ingest/mailbox
calls were ever made.

---

## User Record

```sql
SELECT id, email, created_at FROM users WHERE email = 'udaikiran@outlook.com';

                  id                  |         email         |          created_at
--------------------------------------+-----------------------+-------------------------------
 548de57b-e7b7-47cf-b343-f59e9a5cae54 | udaikiran@outlook.com | 2026-08-11 10:19:00.838807+00
```

User was created at 10:19 UTC on 2026-08-11 (about 31 hours ago).

---

## mailbox_accounts (ingestor cursor/checkpoint state)

```sql
SELECT id, user_id, provider, email_address, status, last_error,
       uid_validity, last_uid, last_synced_at, created_at, updated_at
FROM mailbox_accounts WHERE user_id = '548de57b-e7b7-47cf-b343-f59e9a5cae54';

(0 rows)
```

**No mailbox account is connected.** The `uid_validity`, `last_uid`, and
`last_synced_at` columns (the IMAP resume watermark / cursor) are all absent
because no row exists. The user has never run the `connect` CLI.

---

## mailbox_credentials

```sql
SELECT id, user_id, provider, created_at, updated_at
FROM mailbox_credentials WHERE user_id = '548de57b-e7b7-47cf-b343-f59e9a5cae54';

(0 rows)
```

No Google OAuth client credentials on file.

---

## email_ingestions

```sql
SELECT COUNT(*) FROM email_ingestions WHERE user_id = '548de57b-e7b7-47cf-b343-f59e9a5cae54';

 count
-------
     0

SELECT COUNT(*) FROM email_ingestions;   -- across all users
 count
-------
     0
```

Zero ingestions for this user and zero total in the database.

---

## BullMQ Queue State (Redis)

Queue keys present: `bull:ingestor.run:meta`, `bull:ingestor.run:stalled-check`,
`bull:email.extract:meta`, `bull:email.extract:stalled-check`.

```
bull:ingestor.run:wait      depth = 0
bull:ingestor.run:active    depth = 0
bull:ingestor.run:failed    depth = 0
bull:ingestor.run:delayed   depth = 0
bull:email.extract:wait     depth = 0
bull:email.extract:active   depth = 0
bull:email.extract:failed   depth = 0
bull:email.extract:completed depth = 0
bull:ingestor.run:repeat    (empty — no scheduled/repeating jobs registered)
```

Both queues are entirely empty; no failed or stuck jobs.

---

## Root Cause

The "Reprocess all" button (Settings → Mailboxes → `resetMailboxWatermark`) requires
a `mailbox_accounts` row to exist. Without it:

1. The UI button is never rendered (the mailbox list is empty).
2. Any direct API call to reset would return HTTP 404 ("Mailbox not found").
3. The ingestor has no accounts to poll, so it starts and sits idle indefinitely.

The user (`udaikiran@outlook.com`) created an account at 10:19 UTC on 2026-08-11 but
has never connected a Gmail mailbox via the `connect` CLI. There is no cursor, no
ingestions, and no reprocess activity to investigate — the pipeline has never run.

---

## What the Code Does (for reference)

- `apps/api/src/modules/ingest/services/mailboxes.ts` — `resetMailboxWatermark()`
  sets `last_uid = 0` (preserving `uid_validity`) on the `mailbox_accounts` row,
  then resets terminal-status ingestions to `pending` so the next ingestor poll
  re-enqueues them. Ownership is verified; returns 404 if no row matches.
- `apps/web/src/routes/settings/MailboxesPanel.tsx:180` — "Reprocess all" button
  calls `onReset(mb.id)` after a confirm dialog. It is only rendered per-mailbox
  row, so no mailbox = no button visible.
- `mailbox_accounts` columns `uid_validity`, `last_uid`, `last_synced_at` are the
  IMAP cursor/checkpoint. The ingestor reads these to determine `fromUid` on each
  poll cycle.

---

## No Errors Found

No reprocess errors, no cursor/checkpoint errors, no failed jobs.
The feature cannot have malfunctioned because it was never invoked —
the prerequisite (a connected mailbox) does not exist.
