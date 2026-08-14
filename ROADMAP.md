# Compass — State & Roadmap

> Companion to [`PRD.md`](./PRD.md) (the product spec) and [`tasks/README.md`](./tasks/README.md) (the executable task board).
> This document answers two questions: **what does Compass do today**, and **what is it going to do next**.

**Current release:** `v3.0.0` · 139 releases since 2026-07-15 · ~5 releases/day cadence.

---

## 1. What Compass is

A **self-hosted personal-finance application built for the Indian context** — INR throughout, TDS and EPF from payslips, MF folios, credit-card statement cycles, EPF/PPF/NPS/SSY as first-class account types.

It is not accounting software. The framing is a private financial coach: awareness, automation and actionable insight over double-entry bookkeeping.

**Shape of the system**

| Piece | What it is |
|---|---|
| `apps/api` | Fastify on Node 24, TypeScript run directly via native type stripping (no build step) |
| `apps/web` | React 19 SPA — Vite, React Router, TanStack Query, Tailwind v4 |
| `apps/docs` | Docusaurus, served at `/docs/` from the same origin as the SPA |
| `apps/ingestor` + `apps/extractor` | Optional email→transaction pipeline, gated behind the compose `email` profile |
| `packages/shared` | Zod schemas + money/date/redaction utilities — the contract both sides consume |
| `packages/ai` | Optional AI module; a vendor firewall with zero AI SDKs |

Postgres and Redis are **external services**, not part of the compose stack. Object storage goes to self-hosted MinIO with a disk fallback.

**Scale today:** 50,384 LOC of source · 19,909 LOC of tests across 133 test files · 49 tables · 158 API routes across 40 route modules · 32 web pages · 3 BullMQ queues with 9 schedulers.

---

## 2. What is available today

### Ledger & transactions
Accounts (11 active types incl. PPF/EPF/SSY/NPS/overdraft/home-loan-OD; a deprecated `insurance` value is retained only because a Postgres enum cannot drop a value) · categories with a hierarchical tree and merge · cursor-paginated transactions · category-split transactions (via postings) · bulk edit · transfer detection and posting-pair linking · transaction↔transaction links (refunds, repayments) · receipt attachments · recurring templates · merchant rules and global rename · resources (the vehicle or connection an expense belongs to) · personal tasks · global ⌘K search.

### Import & reconciliation
CSV import as a staged pipeline — upload → column mapping with saved bank presets → editable row preview → commit → **rollback**. Duplicate detection with an explicit keep-anyway override. Credit-card statement import including password-protected PDFs. Mutual-fund CAS import with AMFI scheme mapping. Statement↔ledger reconciliation with carry-over absorption.

### Budgets & planning
Period budgets with per-category lines · copy-from-previous · suggestions · actual-vs-budget comparison · overspend alerts · goals with progress, funding breakdown and drag-reorder · cash-flow history, 90-day forecast and runway · bills and subscriptions with forgotten-subscription detection · per-user return/inflation projection assumptions.

**Goal planning is deeper than it looks:** a horizon-based glide path already exists (`goal-plan.ts`), recommending an equity/debt mix that de-risks as a goal approaches, a required monthly contribution split to that mix, the gap against committed SIPs, and allocation-drift detection.

### Cards & credit
Billing-cycle and due-date engine across month boundaries · statement-period spend · credit-utilization monitoring with thresholds · reward ledger and issuer earn-rate settings · encrypted statement passwords · statement reconciliation · EMI/loan amortization with principal/interest splits and step schedules · overdraft and bank details.

### Investments & wealth
Holdings with a buy/sell event ledger and sequencing · manual valuations · AMFI NAV refresh · gold and NPS sub-details · portfolio and allocation views · **FIFO tax-lot matching and capital-gains reporting** (short/long term, financial-year aware, SGB-at-maturity handled) · SIPs targeting either an MF folio or an account, linkable to real ledger transactions · net-worth snapshots, backfill and per-goal attribution.

### Protection & retirement
Life/health/vehicle policies as standalone entities · premium payment log · policy documents and health-card images · EPF/PPF retirement details · NPS tier/PRAN.

### Insight, reporting & automation
Deterministic insight cards · statistical spending-anomaly detection · financial health score · trends · report builder with prior-period comparison and CSV export · notification centre with per-channel preferences.

Nine scheduled jobs: net-worth close and snapshot, recurring materialization, bill and card reminders, **autopilot cash-runway review** (daily), **autopilot goal review** (weekly), and weekly encrypted backup — with boot catch-up so nothing is lost to downtime.

### AI (entirely optional)
Configured **per user**, stored encrypted, never via environment variables. Four providers behind one HTTP path: Anthropic, Ollama, and an OpenAI-compatible provider serving OpenRouter/DeepSeek/custom. Capabilities: category suggestions, monthly narrative summaries, a tool-calling assistant, and a **full AI event log** recording the exact context sent and raw response for every call.

Forced tool-calling is used for structured output, with a pre-flight validity guard, exact-name tool matching, and fail-closed behaviour on ambiguous responses.

### Email → transaction pipeline (opt-in)
Per-user Gmail OAuth2 IMAP, onboarded by a local `connect` CLI so credentials never transit a server. Raw messages retained for replay. AI extraction produces **reviewable drafts** — transaction alerts, bills and card statements — that reach a review inbox and never the ledger unaccepted. The model sees only redacted subject/sender/category-names and a capped body.

### Operations
Encrypted backup and restore (server-keyed instance backups plus per-user portable archives) · full JSON export plus transaction and report CSV exports · read-only demo mode enforced at a single chokepoint · hand-rolled security layer (CSP/HSTS headers, Origin-based CSRF, three Redis rate-limit buckets) · Redis-backed sessions with argon2 · versioned container images published from git tags.

---

## 3. Principles that constrain every feature

These are not aspirations; they are enforced in code and tests.

- **Money is always integer paise.** Never floating-point rupees, anywhere, end to end.
- **No auto-categorization.** Category is a human decision. A rules engine that silently classifies was built, evaluated and deliberately dropped.
- **Nothing reaches the ledger unaccepted.** Every automated path produces reviewable drafts.
- **The app must run fully with AI disabled.** ESLint forbids importing any AI SDK outside `packages/ai`; every provider uses plain `fetch`.
- **AI is per-user, never global.** No shared provider, no server-side default key.
- **Every user-facing table is `user_id`-scoped.** There is no admin or owner-privileged data path.
- **Demo mode is read-only at one chokepoint**, so every new mutating route is demo-safe automatically.
- **Backup coverage is test-enforced** — a new table that is not registered for backup fails the suite.
- **Your data stays yours.** Self-hosted, exportable, and — with Ollama — capable of running without any data leaving the machine.

---

## 4. Where Compass is going

Full detail lives in [`tasks/README.md`](./tasks/README.md); 94 tasks across nine releases.

### 2.0.0 — Foundation *(shipped as v3.0.0, 21 tasks)*

**Architecture.** The app grew from an expense tracker into a full personal-finance OS without domain boundaries: one 1,767-line schema file, 102 files in a flat services folder, 39 route modules registered flat, and cache invalidation driven by a URL regex. 3.0.0 completed the restructure: the schema is now 49 tables split into layered schema slices under `db/shared/` and `modules/*/schema.ts`, the flat services folder is replaced by eight domain modules with prefixed Fastify plugins, and a domain event bus is in place — all verified by a route-table snapshot that proved all 155 URLs stayed byte-identical.

### 2.1.0 — Household & Split *(8 tasks)*

Compass becomes multi-player: households, explicit per-record sharing grants, and built-in expense splitting with a running who-owes-whom balance. The authorization model gains one central sharing guard; private stays the default.

### 2.2.0 — Goal-based planning *(15 tasks)*

Compass already tracks well; this makes it advise:
- a **forward glide-path roadmap** with dated allocation switch points, not just today's spot mix
- **instrument-category guidance** for the Indian context (ELSS, PPF, EPF/VPF, NPS, short-duration debt, FD, SGB, index funds) with lock-in, tax and liquidity attributes
- an **income-based multi-goal allocation engine** — the real gap, since every goal is currently planned in isolation against an income that cannot fund them all
- a **lever advisor** quantifying all four ways to close a shortfall: extend the timeline, cut the target, cut expenses, or **increase income**
- **actionable rebalancing** with amounts and routes, preferring contribution redirection over taxable switching
- **tax-aware rebalancing** using existing FIFO tax lots, willing to conclude that a rebalance is not worth its tax cost

### 2.3.0 — Vision & Shopping Intelligence *(20 tasks)*

**Vision in `packages/ai`** — multimodal support, the prerequisite for any photo or receipt capture.

**Shopping Intelligence** *(explicitly the garnish, not the cake)* — list capture by paste or photo, unit-normalized price comparison, basket arbitrage across platforms including delivery fees and minimum-cart thresholds, **card-offer ingestion from forwarded deal emails**, deal- and reward-aware portal/card recommendation, habit-learned pantry and predictive carts, and a receipt→ledger loop. Budget caps, goal-impact receipts and an EMI temptation guard connect it back to the financial core.

### 2.4.0 — Tax intelligence *(14 tasks)*

Payslip parsing (CTC, TDS, EPF) · **80C/80CCD/80D deduction basket** with deadline-aware headroom · **advance tax with 234B/234C interest** · **old vs new regime comparison**.

Compass records *several* deduction sources — insurance premiums, EPF contributions, PPF/SSY/NPS accounts, and home-loan principal derivable from EMI splits — but **most are not tax-classified and some are absent entirely**: nothing distinguishes ELSS from an ordinary equity fund, or a five-year tax-saver FD from a normal one, and NSC is not modelled at all. Instrument tax-classification is therefore a prerequisite, not a detail. Realised capital gains *are* computed, but the advance tax they trigger is not.

### 2.5.0 — Protection & continuity *(5 tasks)*

**Insurance adequacy** (Human Life Value against income, dependents and liabilities) · a **maturity and renewal calendar** — only partly a consolidation exercise, since `maturityDate` exists solely on retirement, insurance and gold details: **FD, RD and NSC are not modelled at all** and must be built before the calendar can cover them · a **nominee and continuity dossier** — because `nominee` currently exists on exactly one table, and Compass holds the most complete picture of a household's finances that will ever exist in one place.

### 2.6.0 — Debt & windfall *(3 tasks)*

**Prepay vs invest and floating-rate reset impact** · **windfall allocator** routing a bonus through the multi-goal engine.

### 2.7.0 — Everyday savings *(5 tasks)*

Comparify-inspired price comparison for everyday purchases · food delivery and cab fare comparison across platforms · realized savings tracking against the best available alternative.

### 2.8.0 — Portfolio & integrity *(3 tasks)*

Performance attribution across the holdings ledger · fraud and duplicate review tooling.

---

## 5. Rostered but not scheduled

From [`docs/PRD-wow-features.md`](./docs/PRD-wow-features.md):

| # | Feature | Status |
|---|---|---|
| 1 | **Account Aggregator live sync** — consented real-time bank/MF/EPF data over RBI's AA rails | Not started; the largest single leap in data quality available |
| 2 | **AI Tax Co-pilot** — AIS/26AS reconciliation, ITR-ready pack | Partly absorbed into 2.4.0; reconciliation and ITR export remain |
| 3 | **Financial Autopilot** — proactive agent | **Partly shipped** — daily cash-runway and weekly goal reviews already run |
| 4 | **Household & Split** | **Scheduled into 2.1.0** |
| 5 | **Scenario Planner** — prepay vs invest, career break, home purchase | Partly absorbed into 2.6.0; broader simulation remains |
| ⭐ | **Local-Brain Mode** — 100% on-device LLM | Foundation exists (Ollama provider); needs a first-class private mode |

---

## 6. Known gaps and open questions

- **Microsoft mailboxes are unsupported** — the schema accepts the provider but the token provider throws. A visible gap if multi-provider mail is ever claimed.
- **No OCR anywhere** until vision lands in 2.3.0 (task 8.1); the only PDF capability is statement text extraction.
- **Ollama supports neither forced tool-calling nor vision**, so structured and multimodal paths degrade for fully-local users — directly in tension with Local-Brain Mode.
- **Shopping price data has no durable source.** Quick-commerce platforms expose no public price APIs; crowdsourced entry, receipt OCR and affiliate APIs are the only legitimate inputs, and live scraping is deliberately excluded from core.
- **NRI support is classification-only.** NRE/NRO *are* modelled as bank-account subtypes (`BankAccountSubtypeSchema`), but nothing follows from it: no NRI taxation, no repatriability tracking, no FCNR/RFC accounts, no foreign currency, no Schedule FA foreign-asset reporting.
- **Tax rules need effective-date granularity, not just financial-year versioning.** `tax-lots.ts` already encodes the 23 July 2024 holding-period reform and a section 50AA acquisition-date condition — a table keyed only by FY cannot represent Indian tax law safely.
- **Fixed income is barely modelled.** An FD is just `assetClass = "fd"` with no principal, rate, compounding, maturity, payout frequency, auto-renewal or premature-closure penalty; RD and NSC do not exist. This blocks the maturity calendar, tax-saver identification, break-penalty pricing and windfall detection.
- **No structured taxable-income ledger.** Interest, dividends and rent are ordinary categorized transactions with no payer, PAN/TAN, section, gross-vs-net split or TDS metadata, so they cannot be reconciled against AIS/26AS.
- **No card statement-payment state.** Compass knows the total and minimum due but never whether a statement was paid in full, so revolving credit-card debt is invisible to planning.
- **The ingestor and extractor images carry no version provenance** even though they are versioned and published.
- **Single-instance assumption** — all images are expected to move together on one version; there is no mixed-version deployment story.

---

## 7. Non-goals

- **Money movement.** Compass records a settle-up or a payment; it never moves funds and holds no payment credentials.
- **Autonomous action.** Every AI capability drafts or advises; a human always accepts. This holds for extracted transactions, shopping carts, rebalancing and tax.
- **Named product recommendations.** Planning advises instrument *categories* with their tradeoffs — never a specific scheme, fund or AMC.
- **Scraping third-party platforms** as a core feature.
- **Multi-tenant SaaS.** Compass is self-hosted and single-household by design; households are a sharing layer, not tenancy.
