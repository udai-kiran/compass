# Compass (PennyPilot) — Task Board

One file per task; the `status:` field in each file's frontmatter is the source of truth (`todo | in-progress | done | blocked`). Update the file, then regenerate this index if desired.

**Stack:** React + TS SPA · Fastify on Node 24 LTS + TS ~5.9 · Postgres (Drizzle) + Redis (sessions/BullMQ/cache) — both external, configured via `DATABASE_URL` / `REDIS_URL` env vars · AI as optional isolated module (`AI_PROVIDER=none` by default; app fully functional without it).

**MVP** = Phases 0–3. Phase 7 (AI) is optional by design.

| ID | Task | Phase | Status |
|---|---|---|---|
| 0.1 | [Scaffold monorepo](./00.01-scaffold-monorepo.md) | 0 — Foundation | done |
| 0.2 | [Environment config module (.env, Zod-validated)](./00.02-env-config-module.md) | 0 — Foundation | done |
| 0.3 | [Fastify API skeleton](./00.03-api-skeleton.md) | 0 — Foundation | done |
| 0.4 | [Postgres + Drizzle ORM setup](./00.04-postgres-drizzle.md) | 0 — Foundation | done |
| 0.5 | [Redis client + BullMQ job foundation](./00.05-redis-setup.md) | 0 — Foundation | done |
| 0.6 | [Auth: Argon2 + Redis-backed sessions](./00.06-auth-sessions.md) | 0 — Foundation | done |
| 0.7 | [Web app shell](./00.07-web-shell.md) | 0 — Foundation | done |
| 0.8 | [Docker Compose + CI](./00.08-docker-ci.md) | 0 — Foundation | done |
| 1.1 | [Accounts schema + CRUD API](./01.01-accounts-crud.md) | 1 — Core ledger | done |
| 1.2 | [Categories schema + default tree](./01.02-categories-crud.md) | 1 — Core ledger | done |
| 1.3 | [Transactions API](./01.03-transactions-api.md) | 1 — Core ledger | done |
| 1.4 | [Transaction list UI](./01.04-transactions-ui.md) | 1 — Core ledger | done |
| 1.5 | [Search & advanced filters](./01.05-search-filters.md) | 1 — Core ledger | done |
| 1.6 | [Split transactions](./01.06-split-transactions.md) | 1 — Core ledger | done |
| 1.7 | [Bulk edit](./01.07-bulk-edit.md) | 1 — Core ledger | done |
| 1.8 | [Transfer detection & linking](./01.08-transfer-detection.md) | 1 — Core ledger | done |
| 1.9 | [Receipt attachments](./01.09-receipt-attachments.md) | 1 — Core ledger | done |
| 1.10 | [Account & category management UI](./01.10-account-category-mgmt-ui.md) | 1 — Core ledger | done |
| 2.1 | [CSV import staging pipeline](./02.01-import-staging.md) | 2 — Import & rules | done |
| 2.2 | [Column mapping UI + bank presets](./02.02-column-mapping-presets.md) | 2 — Import & rules | done |
| 2.3 | [Duplicate detection](./02.03-duplicate-detection.md) | 2 — Import & rules | done |
| 2.4 | [Import preview, commit & rollback](./02.04-import-preview-commit-rollback.md) | 2 — Import & rules | done |
| 2.5 | [Merchant normalization](./02.05-merchant-normalization.md) | 2 — Import & rules | done |
| 2.6 | [Rule-based categorization engine](./02.06-rules-engine.md) | 2 — Import & rules | dropped |
| 2.7 | [Learning from corrections](./02.07-rule-learning-loop.md) | 2 — Import & rules | dropped |
| 3.1 | [Budgets schema + API](./03.01-budgets-api.md) | 3 — Budgets & dashboard | done |
| 3.2 | [Budget UI](./03.02-budget-ui.md) | 3 — Budgets & dashboard | done |
| 3.3 | [Budget history & comparison](./03.03-budget-history-comparison.md) | 3 — Budgets & dashboard | done |
| 3.4 | [Overspend detection & alerts](./03.04-overspend-alerts.md) | 3 — Budgets & dashboard | done |
| 3.5 | [Dashboard v1](./03.05-dashboard-v1.md) | 3 — Budgets & dashboard | done |
| 3.6 | [Spending trends](./03.06-spending-trends.md) | 3 — Budgets & dashboard | done |
| 3.7 | [Recurring transactions engine](./03.07-recurring-transactions.md) | 3 — Budgets & dashboard | done |
| 4.1 | [Goals schema + API](./04.01-goals-api.md) | 4 — Goals, cash flow, bills | done |
| 4.2 | [Goal UI + forecast](./04.02-goals-ui-forecast.md) | 4 — Goals, cash flow, bills | done |
| 4.3 | [Cash flow page](./04.03-cashflow-page.md) | 4 — Goals, cash flow, bills | done |
| 4.4 | [Cash-flow forecasting & runway](./04.04-cashflow-forecasting.md) | 4 — Goals, cash flow, bills | done |
| 4.5 | [Bills & subscriptions view](./04.05-bills-subscriptions.md) | 4 — Goals, cash flow, bills | done |
| 4.6 | [Forgotten subscription detection](./04.06-forgotten-subscription-detection.md) | 4 — Goals, cash flow, bills | done |
| 4.7 | [Notification center & preferences](./04.07-notification-center.md) | 4 — Goals, cash flow, bills | done |
| 5.1 | [Credit card cycle & due tracking](./05.01-credit-card-tracking.md) | 5 — Cards, investments, net worth | done |
| 5.2 | [EMI & reward tracking](./05.02-emi-rewards.md) | 5 — Cards, investments, net worth | done |
| 5.3 | [Investment holdings schema + API](./05.03-holdings-api.md) | 5 — Cards, investments, net worth | done |
| 5.4 | [Portfolio UI](./05.04-portfolio-ui.md) | 5 — Cards, investments, net worth | done |
| 5.5 | [Net worth snapshots & forecast](./05.05-networth-snapshots.md) | 5 — Cards, investments, net worth | done |
| 5.6 | [Credit card statement import presets](./05.06-card-statement-import.md) | 5 — Cards, investments, net worth | done |
| 6.1 | [Insight computations (deterministic)](./06.01-insight-computations.md) | 6 — Insights, reports, polish | done |
| 6.2 | [Insights page](./06.02-insights-page.md) | 6 — Insights, reports, polish | done |
| 6.3 | [Spending anomaly detection (statistical)](./06.03-anomaly-detection.md) | 6 — Insights, reports, polish | done |
| 6.4 | [Reports](./06.04-reports.md) | 6 — Insights, reports, polish | done |
| 6.5 | [Global search (cmd-K)](./06.05-global-search.md) | 6 — Insights, reports, polish | done |
| 6.6 | [Encrypted backup & restore](./06.06-backup-restore.md) | 6 — Insights, reports, polish | done |
| 6.7 | [Settings](./06.07-settings-page.md) | 6 — Insights, reports, polish | done |
| 6.8 | [Security & UX hardening](./06.08-hardening.md) | 6 — Insights, reports, polish | done |
| 6.9 | [Read-only demo mode](./06.09-demo-mode.md) | 6 — Insights, reports, polish | done |
| 6.10 | [Statement dedupe & reconciliation](./06.10-statement-reconciliation.md) | 6 — Insights, reports, polish | done |
| 7.1 | [AiProvider interface + NullProvider + capabilities](./07.01-ai-provider-interface.md) | 7 — AI module (optional) | done |
| 7.2 | [Anthropic & Ollama providers](./07.02-anthropic-ollama-providers.md) | 7 — AI module (optional) | done |
| 7.3 | [AI categorization suggestions](./07.03-ai-categorization.md) | 7 — AI module (optional) | done |
| 7.4 | [AI assistant backend (tool loop)](./07.04-assistant-backend.md) | 7 — AI module (optional) | done |
| 7.5 | [AI assistant UI](./07.05-assistant-ui.md) | 7 — AI module (optional) | done |
| 7.6 | [AI monthly summary & recommendations](./07.06-ai-summaries-recommendations.md) | 7 — AI module (optional) | done |
