# Prod Deferred Ingestion Check — 2026-08-13

Investigation of two `card_statement` ingestions that remain permanently `deferred` after the reprocess-all run triggered by commit `5092c59`.

Ingestion IDs under investigation:
- `9ce9fa70-84ff-44f9-86b2-a32d3b6d9cac` — Amazon Pay ICICI Bank Credit Card Statement
- `2aebe253-6c33-4d81-bc61-df3bb45bb558` — BPCL SBI Card OCTANE Monthly Statement

---

## Q1 — Raw email length and PDF markers

Command:
```
ssh 192.168.2.228 'docker exec pennypilot-postgres psql -U compass compass -c "SELECT id, subject, length(raw) as raw_len, (raw LIKE '%Content-Type: application/pdf%' OR raw LIKE '%filename=\"%.pdf%') as has_pdf_marker, (raw LIKE '%application/octet-stream%') as has_octet, created_at FROM email_ingestions WHERE id IN ('9ce9fa70-84ff-44f9-86b2-a32d3b6d9cac', '2aebe253-6c33-4d81-bc61-df3bb45bb558');"'
```

Result:
```
                  id                  |                                            subject                                             | raw_len | has_pdf_marker | has_octet |          created_at           
--------------------------------------+------------------------------------------------------------------------------------------------+---------+----------------+-----------+-------------------------------
 9ce9fa70-84ff-44f9-86b2-a32d3b6d9cac | Fwd: Amazon Pay ICICI Bank Credit Card Statement for the period June 19, 2026 to July 18, 2026 | 1167495 | t              | f         | 2026-08-12 05:19:20.193257+00
 2aebe253-6c33-4d81-bc61-df3bb45bb558 | Your BPCL SBI Card OCTANE Monthly Statement -Jul 2026                                          | 1514239 | t              | t         | 2026-08-12 05:19:20.491947+00
(2 rows)
```

Observations:
- Both emails contain a `Content-Type: application/pdf` MIME marker (`has_pdf_marker = t`).
- The SBI OCTANE email additionally contains `application/octet-stream` (`has_octet = t`); the Amazon Pay ICICI one does not.
- Raw sizes are substantial (1.1 MB and 1.5 MB respectively), consistent with PDF attachments embedded as base64.
- Both were ingested at 2026-08-12 ~05:19 UTC.

---

## Q2 — from_addr, status, error, and raw email start

Command:
```
ssh 192.168.2.228 'docker exec pennypilot-postgres psql -U compass compass -c "SELECT id, subject, from_addr, status, error, left(raw, 2000) as raw_start FROM email_ingestions WHERE id IN ('9ce9fa70-..', '2aebe253-..');"'
```

Result (key fields extracted):

| id | subject | from_addr | status | error |
|----|---------|-----------|--------|-------|
| 9ce9fa70-… | Fwd: Amazon Pay ICICI Bank Credit Card Statement for the period June 19, 2026 to July 18, 2026 | s.udaikiran@gmail.com | deferred | (empty) |
| 2aebe253-… | Your BPCL SBI Card OCTANE Monthly Statement -Jul 2026 | Statements@sbicard.com | deferred | (empty) |

Observations:
- The `error` column is NULL/empty for both rows. The deferred status was set by the extractor intentionally (not due to a processing crash).
- The Amazon Pay ICICI email is a **forwarded** message (`from_addr = s.udaikiran@gmail.com`, subject prefixed with `Fwd:`). The original sender is ICICI Bank; it was forwarded from a personal Gmail account.
- The SBI OCTANE email was delivered directly from `Statements@sbicard.com`.
- The first 2000 characters of each raw email are standard RFC 822 / SMTP delivery headers (Received, ARC-Seal, DKIM-Signature, etc.) — nothing anomalous.

---

## Q3 — Extractor logs: grep for these IDs and PDF-related terms

Command:
```
ssh 192.168.2.228 "docker logs pennypilot-extractor --since 2026-08-12 2>&1 | grep -E '9ce9fa70|2aebe253|deferred|No PDF|pdf' | head -50"
```

Result:
```
{"t":"2026-08-13T02:23:29.170Z","level":"warn","msg":"statement PDF not opened — no matching card password stored"}
{"t":"2026-08-13T02:23:29.205Z","level":"info","msg":"extracted","ingestionId":"9ce9fa70-84ff-44f9-86b2-a32d3b6d9cac","classification":"card_statement","status":"deferred","found":0,"duplicates":0,"inserted":0}
{"t":"2026-08-13T02:23:58.955Z","level":"warn","msg":"statement PDF not opened — no matching card password stored"}
{"t":"2026-08-13T02:23:58.966Z","level":"info","msg":"extracted","ingestionId":"2aebe253-6c33-4d81-bc61-df3bb45bb558","classification":"card_statement","status":"deferred","found":0,"duplicates":0,"inserted":0}
```

Observations:
- The pattern is unambiguous: for **each** of the two IDs, the extractor emits a `warn` log `"statement PDF not opened — no matching card password stored"` immediately before recording `status: deferred`.
- This is a deliberate, non-error path: the extractor found a PDF attachment, attempted to open it (PDF is password-protected, as Indian bank statement PDFs typically are), could not find a stored card password for the matching card/account, and deferred the ingestion to await the password being configured.
- `found: 0`, `duplicates: 0`, `inserted: 0` confirms no transactions were extracted.

---

## Q4 — Last 200 lines of extractor logs (full context)

Command:
```
ssh 192.168.2.228 "docker logs pennypilot-extractor --since 2026-08-12 2>&1 | tail -200"
```

Result (163 lines total, full output captured):

```
{"t":"2026-08-13T02:14:43.576Z","level":"info","msg":"extractor ready","queue":"email.extract"}
{"t":"2026-08-13T02:23:23.401Z","level":"info","msg":"extracted","ingestionId":"f821e2a3-...","classification":"transaction_alert","status":"extracted","found":1,...}
{"t":"2026-08-13T02:23:24.926Z","level":"info","msg":"extracted","ingestionId":"457587ba-...","classification":"transaction_alert","status":"extracted","found":1,...}
{"t":"2026-08-13T02:23:29.170Z","level":"warn","msg":"statement PDF not opened — no matching card password stored"}
{"t":"2026-08-13T02:23:29.205Z","level":"info","msg":"extracted","ingestionId":"9ce9fa70-84ff-44f9-86b2-a32d3b6d9cac","classification":"card_statement","status":"deferred","found":0,"duplicates":0,"inserted":0}
{"t":"2026-08-13T02:23:33.772Z","level":"info","msg":"statement extracted","accountId":"12d4b791-...","found":4}
{"t":"2026-08-13T02:23:33.798Z","level":"info","msg":"extracted","ingestionId":"60b7dc36-...","classification":"card_statement","status":"extracted","found":4,...}
...
{"t":"2026-08-13T02:23:58.955Z","level":"warn","msg":"statement PDF not opened — no matching card password stored"}
{"t":"2026-08-13T02:23:58.966Z","level":"info","msg":"extracted","ingestionId":"2aebe253-6c33-4d81-bc61-df3bb45bb558","classification":"card_statement","status":"deferred","found":0,"duplicates":0,"inserted":0}
...
[remaining 110+ lines are transaction_alert/other/promo ingestions all extracted or ignored normally]
```

The extractor processed the full batch normally. Other `card_statement` ingestions in the same run (e.g. `60b7dc36`, `39350655`, `71eb40fa`, `119aec88`, `718ed2b9`) completed with `status: extracted`. Only these two emitted the password-missing warn and deferred.

---

## Root Cause Summary

Both ingestions contain password-protected PDF attachments (confirmed by `has_pdf_marker = t`). The extractor's PDF-open step requires a card-specific password to be configured in the user's account settings. For both these cards (Amazon Pay ICICI and SBI OCTANE), no such password is stored. The extractor therefore sets status `deferred` and exits cleanly — no error, no crash. This is working-as-designed behaviour.

The `error` column being NULL confirms this was not a failure; it is an intentional hold state awaiting user action (storing the card statement password). These ingestions will remain `deferred` indefinitely unless the user adds the card PDF password in the app settings and the extractor is re-triggered for these IDs.

---

## Files Inspected

- `email_ingestions` table rows for both IDs (via prod DB query)
- `pennypilot-extractor` docker logs since 2026-08-12

## Commands Run

1. `ssh 192.168.2.228 'docker exec pennypilot-postgres psql -U compass compass -c "<Q1 SQL>"'`
2. `ssh 192.168.2.228 'docker exec pennypilot-postgres psql -U compass compass -c "<Q2 SQL>"'`
3. `ssh 192.168.2.228 "docker logs pennypilot-extractor --since 2026-08-12 2>&1 | grep -E '9ce9fa70|2aebe253|deferred|No PDF|pdf' | head -50"`
4. `ssh 192.168.2.228 "docker logs pennypilot-extractor --since 2026-08-12 2>&1 | tail -200"`
