---
sidebar_position: 1
title: AI Setup
---

# AI Setup

AI is optional and configured **per user in the app**, not via deployment environment variables. The API key is encrypted at rest and never displayed again.

## Enabling AI

Go to **Settings → AI** and select a provider.

## Supported providers

- **Anthropic** — Claude models (requires Anthropic API key)
- **DeepSeek** — DeepSeek models (requires DeepSeek API key)
- **OpenRouter** — proxy supporting multiple models (requires OpenRouter API key)
- **Ollama** — local, self-hosted LLM (base URL only, no key needed)
- **Custom** — any OpenAI-compatible endpoint (base URL + API key + model name)
- **Disabled** — no AI; the app runs fully functional without it

## Server-side endpoints

If users select **Ollama** or **Custom** providers, you (the operator) must list their base URLs in the deployment environment variable `AI_ALLOWED_BASE_URLS` before they can save the configuration. This prevents users from exfiltrating data to untrusted endpoints.

Example:
```
AI_ALLOWED_BASE_URLS=http://localhost:11434,https://custom-llm.example.com
```

For **Anthropic**, **DeepSeek**, and **OpenRouter**, the keys travel inside the encrypted `ai_settings` table, so no environment setup is needed beyond setting an AI provider (see below for email extraction).

## Email extraction

If you enable the email pipeline (`docker compose --profile email up -d`), users can extract transactions from bank/card alert emails. The extractor decrypts and uses **the mailbox owner's own per-user AI provider** (configured in Settings → AI). Each user must have a provider configured in the app, or extraction produces nothing.

## Privacy

- AI API keys are encrypted at rest in the `ai_settings.api_key_enc` column
- OAuth refresh tokens are encrypted at rest in the `mailbox_accounts.refresh_token_enc` column
- OAuth client secrets are encrypted at rest in the `mailbox_credentials.client_secret_enc` column
- For **alert emails**, the extractor sends the LLM only: Subject, From, category names, and a stripped/capped email body
- For **PDF credit-card statements**, the extractor decrypts the attachment and sends the LLM up to 60,000 characters of its extracted text (plus category names) in a separate call. This text is not PII-redacted, so it can include merchant names, amounts, and dates for every line on the statement
- Raw headers and full email content are **never** sent to the LLM
- Extracted transactions land in an **in-app review inbox** — nothing writes to the ledger automatically
