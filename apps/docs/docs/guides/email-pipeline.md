---
sidebar_position: 2
title: Email Pipeline
---

# Email Pipeline

Extract transactions from bank and credit-card alert emails. This is an opt-in module that reads Gmail over OAuth2 IMAP and produces **reviewable** transactions — nothing is written to your ledger automatically.

## Prerequisites

- Each mailbox owner's AI provider configured in the app (see [AI Setup](./ai-setup.md))
- A Google OAuth client (created in the Google Cloud Console)
- `MAILBOX_SECRET` set in the deployment environment (≥32 chars; can reuse `SESSION_SECRET`)

## Start the workers

Enable the email profile in Docker Compose:

```bash
docker compose --profile email up -d
```

This starts the `ingestor` and `extractor` services.

## Create a Google OAuth client

Gmail is accessed over IMAP with XOAUTH2, so you need your own OAuth client. Nothing goes in the deployment `.env` — the client ID/secret travel inside an encrypted bundle and are stored per user.

### Steps

1. In the target Gmail account, confirm IMAP is enabled under **Gmail → Settings → See all settings → Forwarding and POP/IMAP**. Personal Gmail always has IMAP on. If you see Auto-Expunge or folder-size options, you're set. (Google Workspace accounts control IMAP via the admin console.)

2. Open the [Google Cloud Console](https://console.cloud.google.com/), create or select a project.

3. **APIs & Services → OAuth consent screen**:
   - Choose **External**
   - Fill in an app name and your support email
   - Under **Scopes**, add `https://mail.google.com/`
   - Under **Test users**, add the Gmail account whose mail you'll ingest

4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URI: `http://127.0.0.1:53682` (the `connect` CLI listens on this loopback redirect; override the port with `--port` if 53682 is taken, and add the matching URI here)

5. Copy the **Client ID** and **Client secret**.

## Capture credentials on your local machine

On a machine with a browser, from a checkout of this repo:

```bash
npm install
npm run connect -w apps/ingestor -- you@gmail.com \
  --client-id <CLIENT_ID> --client-secret <CLIENT_SECRET>
```

Open the printed Google URL, consent to IMAP access, and copy the base64 **bundle** that prints.

## Add the mailbox in Compass

1. In the app, go to **Settings → Mailboxes**
2. Paste the bundle into the text box
3. Click **Add mailbox**

The ingestor picks up the new mailbox on its next poll. Extracted transactions land in **Inbox** (top-level navigation) for review.

## Refresh-token longevity

**Important:** While your OAuth app is in **Testing** status, Google expires refresh tokens after ~7 days, which will stall ingestion.

For a long-lived self-hosted setup:
1. Set the OAuth app to **In production** (you can dismiss the "unverified app" warning during consent since you're the only user)
2. Re-run `connect` to capture a fresh token bundle
3. Paste the new bundle into Compass

## Privacy

- The ingestor stores raw RFC822 email bodies (subject, headers, and full content) in the `email_ingestions` table
- For **alert emails**, the extractor sends the LLM only: Subject, From, category names, and a stripped/capped email body
- For **PDF credit-card statements**, the extractor decrypts the attachment and sends the LLM up to 60,000 characters of its extracted text (plus category names) in a separate call. This text is not PII-redacted, so it can include merchant names, amounts, and dates for every line on the statement
- Raw headers and full email content are **never** sent to the LLM
- Extracted transactions are **reviewable** — you accept or reject each one before it reaches your ledger
