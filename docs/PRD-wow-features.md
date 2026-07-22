# Compass — Next Wave PRDs ("Wow" Features)

> Companion to `PRD.md`. This document specifies the next five (+1 bonus) high-leverage
> features that move Compass from a **best-in-class personal-finance tracker** to a
> **proactive financial co-pilot for the Indian household** — written at the level of
> ambition and rigor a YC application demands: sharp problem, "why now", a wedge, a
> defensible moat, and metrics that matter.

Each PRD is grounded in what Compass already has (integer-paise ledger, per-user encrypted
AI, BullMQ jobs, capital-gains/tax-lot services, anomaly detection, email pipeline,
`user_id`-scoped tables) so none of it is greenfield fantasy — it's the next layer on the
existing spine.

---

## Portfolio at a glance

| # | Feature | The one-liner | Moat | Reuses |
|---|---------|---------------|------|--------|
| 1 | **Account Aggregator Live Sync** | Consented, real-time bank + MF + EPF data via RBI's AA rails — no more CSV | Regulatory rails + first-mover in self-hosted | imports, holdings, transactions |
| 2 | **AI Tax Co-pilot** | Old-vs-new regime optimizer + AIS/26AS reconciliation + ITR-ready pack | India tax depth competitors won't touch | capital-gains, tax-lots, payroll |
| 3 | **Financial Autopilot** | An always-on agent that warns you *before* you overspend, not after | Proactive agent loop on private data | jobs, anomaly, notifications, AI chat |
| 4 | **Household & Split** | Shared budgets + built-in expense splitting for a family/flat | Kills the "Compass + Splitwise" seam | open signup, budgets, transactions |
| 5 | **Scenario Planner** | A "financial time machine": prepay vs invest, career break, home loan | Simulation on your *actual* balance sheet | goals, networth, emis, projections |
| ⭐ | **Local-Brain Mode** (bonus) | Your money never leaves your house — 100% on-device LLM | Privacy as a product, not a promise | packages/ai (Ollama), self-host |

---

# 1. Account Aggregator Live Sync

**The wow:** Connect once, then your bank accounts, mutual funds, EPF, and NPS flow into
Compass automatically — reconciled, categorized, and up to date every morning — over India's
RBI-regulated Account Aggregator (AA) framework. No screen-scraping, no shared passwords, no
CSV export ritual.

### Problem
Compass's single biggest friction is data entry. Today users either hand-import CSVs
(`routes/imports`) or rely on the opt-in email pipeline. Both are lossy, delayed, and require
setup per bank. Every "personal finance" app in India dies at the same wall: getting clean,
complete, *current* transaction and holdings data without asking for net-banking credentials.

### Why now
The Account Aggregator ecosystem (Sahamati / RBI) is now production-grade: 1.1B+ accounts are
AA-enabled across banks, MF RTAs (CAMS/KFintech), EPFO, and depositories. Consent is
standardized (FI-Notification / FI-Request / FI-Fetch), revocable, and time-boxed. A
self-hosted app can integrate as an FIU (Financial Information User) through a licensed AA/TSP
gateway. **The rails finally exist; almost no self-hosted tool uses them.**

### Target user & JTBD
The multi-account professional (3+ bank accounts, 2 credit cards, a dozen MF folios).
*"When I open Compass, I want it to already know everything that happened to my money since
yesterday, so I never do bookkeeping."*

### The experience
1. Settings → **Connections** → "Link a bank/MF via Account Aggregator".
2. Redirect to the AA consent flow (phone + OTP), pick accounts, approve a **recurring**
   consent (e.g. daily fetch, 1-year validity).
3. Compass stores only the encrypted consent handle. A nightly BullMQ job fetches new FI data,
   normalizes it into the existing staging pipeline, runs duplicate detection, and drops clean
   rows into `transactions` / `holdings` — surfaced in the **Inbox** for one-tap review, never
   auto-committed to the ledger.
4. Holdings (units per scheme+folio) and EPF/NPS balances refresh into `networth` snapshots.

### Functional requirements
- **FIU integration** via a pluggable `AaGateway` abstraction (like `Storage`/`lib/storage.ts`):
  swap the licensed provider (Finvu/Setu/etc.) behind one interface; a `null` gateway keeps the
  app fully runnable with AA disabled (mirrors the AI-disabled invariant).
- **Consent lifecycle**: create, active, paused, revoked, expired — stored encrypted, per-user,
  in a new `aa_consents` table (added to `ALL_TABLES`/`USER_TABLES` for backup coverage).
- **Idempotent ingestion**: reuse `import-reconciliation` + `duplicate-detection`; AA rows carry
  a provider txn-id so re-fetch is a no-op. Statement-period dedup already exists — extend it.
- **Reviewable, not authoritative**: nothing hits the ledger without user accept (same contract
  as the extractor). Demo mode stays read-only automatically via the auth chokepoint.
- **Kill switch**: `AA_ENABLED=false` (config.ts) re-locks; revoking consent purges the handle.

### Architecture fit
`services/aa/*` (gateway client, consent store, FI→staging mapper) + `routes/connections.ts` +
a `jobs/aa-poll.ts` worker. Feeds the *existing* imports/holdings/networth services — this is an
input adapter, not a new vertical.

### Success metrics
- **North Star:** % of a user's monthly transactions that arrive without manual entry (target
  >80% within 30 days of linking).
- Activation: % of new users who link ≥1 account in week 1.
- Guardrail: reconciliation false-duplicate rate <0.5%; consent-fetch failure rate <2%.

### Monetization / wedge
The wedge that makes Compass the *default* place your money lives. AA fetch has per-call cost →
natural basis for a hosted "Compass Cloud" tier while self-hosters bring their own gateway key.

### Risks & mitigations
- *Gateway onboarding is KYC-gated (FIU registration).* → Ship the abstraction now; support
  BYO-gateway credentials so early self-hosters with access can use it; partner for the cloud tier.
- *Data sensitivity.* → Store only consent handles + encrypted FI data at rest; user-scoped;
  honor revocation with hard purge.

### Non-goals
Payments/UPI initiation (AA is read-only by design). No credential storage, ever.

---

# 2. AI Tax Co-pilot

**The wow:** Compass tells you, in plain language, **which tax regime saves you more, exactly
how much 80C/80D headroom you have left, which capital gains to harvest before March 31, and
then hands you an ITR-ready pack** reconciled against your AIS/Form 26AS.

### Problem
Indian tax is where personal finance gets genuinely hard and genuinely expensive to get wrong.
Compass already computes the raw material — `services/capital-gains.ts`, `tax-lots.ts`,
`payroll.ts` (TDS/EPF payslips) — but stops short of the decision. Users still export to a CA or
guess in a spreadsheet. Meanwhile the government's AIS/26AS is the source of truth that nobody
reconciles against their own records.

### Why now
- New vs old regime (post-2023) makes the "which regime" question non-trivial and personal.
- AIS (Annual Information Statement) is now comprehensive and downloadable — a machine-readable
  ground truth to reconcile against.
- Compass already has the tax-lot engine and LLM plumbing to *explain* the numbers.

### Target user & JTBD
The salaried investor with capital gains. *"Before I file, I want to know I've claimed every
deduction, picked the cheaper regime, and that my numbers match what the IT department already
sees — without paying a CA to tell me what I could have optimized in January."*

### The experience
- **Regime optimizer**: pulls salary/TDS from imported payslips + deductions from tagged
  transactions → shows old-vs-new side by side with the ₹ delta and a one-line "why".
- **Deduction radar**: live 80C/80D/80CCD(1B)/24(b) headroom bars; nudges in Q3/Q4 ("₹42,000 of
  80C headroom unused — a ₹42k ELSS SIP saves you ₹13,104 at your slab").
- **Harvest planner**: uses `tax-lots` to surface LTCG within the ₹1.25L exemption and
  loss-harvest candidates before FY end.
- **AIS reconciliation**: upload the AIS/26AS JSON; Compass diffs it against the ledger and flags
  interest/dividends/sales it's missing or that don't match.
- **ITR pack**: a deterministic export (capital gains schedule, interest income, deductions) —
  numbers computed by services, *narrated* by AI, never invented (same contract as `generateSummary`).

### Functional requirements
- All tax math is **deterministic in `services/tax/*`**; the LLM only explains/summarizes
  precomputed facts (upholds "AI narrates numbers, never re-derives" — see `SummaryInput.facts`).
- Regime/slab tables are versioned by assessment year (config data, not hard-coded in prompts).
- AIS/26AS importer is a new parser under `services/imports` producing a diff report; never
  auto-writes to the ledger.
- Everything paise-integer; formatting via `formatINR`.

### Architecture fit
`services/tax/{regime,deductions,harvest,ais-reconcile}.ts` + `routes/tax.ts` +
`routes/tax` web page. Consumes existing `capital-gains`, `tax-lots`, `payroll`. New
`ais_imports` table (backup-covered).

### Success metrics
- **North Star:** ₹ of tax saved surfaced per user per year (and % who act on a nudge).
- Reconciliation coverage: % of AIS line items matched to ledger.
- Guardrail: zero incorrect deterministic computations (property-tested against worked examples).

### Monetization
The single most "willing-to-pay" moment in Indian personal finance. Premium "Tax Season" pack;
CA-shareable export as a paid unlock.

### Risks & mitigations
- *Tax correctness liability.* → Deterministic engine + versioned slab tables + test vectors;
  frame output as "estimate/prep aid, not filing advice"; never file on the user's behalf.
- *AIS format drift.* → Isolate parsing behind a schema-validated importer with fixtures.

### Non-goals
E-filing to the IT portal. Advice for business/ITR-3 complexity (start with ITR-1/2 profiles).

---

# 3. Financial Autopilot (Proactive Agent)

**The wow:** Compass stops waiting to be opened. It runs in the background, watches your money,
and reaches out *first* — "You'll be ₹8,000 short before payday at this rate" — three days
before it happens, with a fix you can tap.

### Problem
Every finance app is passive: insights sit in a dashboard nobody opens until the damage is done.
Compass already computes anomaly detection (`services/anomaly.ts`), cash-flow forecasts
(`cashflow.ts`), budget overspend, upcoming bills, and has a notification center — but the user
still has to go *look*. The value is trapped behind an open-the-app step.

### Why now
Compass now has all three legs of a proactive agent: (1) deterministic signals worth alerting on,
(2) a per-user AI provider that can phrase a nudge like a human coach, and (3) a jobs runtime
(BullMQ) to run the loop. What's missing is the *loop that connects them* and an outbound channel.

### Target user & JTBD
The busy person living paycheck-adjacent. *"Tell me when I need to do something, and only then.
I don't want a dashboard; I want a heads-up."*

### The experience
- A nightly **Autopilot** BullMQ job runs a per-user "review": cash-flow runway, budget burn,
  unusual charges (anomaly), a forgotten subscription's price hike, a bill due with insufficient
  buffer, a goal falling behind pace.
- Deterministic signals are ranked; the top 1–2 (never spam) are turned into a **plain-language
  nudge** by the user's AI, each with a concrete action ("move ₹5k from Savings", "review this
  charge", "pause this SIP this month").
- Delivered via the notification center **and** an opt-in outbound channel (email now; Telegram/
  ntfy/webhook later — self-host friendly).
- A weekly "Money Monday" digest: last week in one paragraph + this week's watch-items.

### Functional requirements
- **Signal registry**: pluggable detectors (`AutopilotSignal` interface) so each existing service
  contributes candidates without the agent knowing their internals.
- **Rate-limited & ranked**: hard cap on nudges/user/day; dedupe repeated signals; user tunes
  categories & channel in Settings.
- **AI is phrasing only**: the *decision to alert* is deterministic; the LLM writes the sentence
  (degrades gracefully to a templated message when AI is disabled — respects `AiDisabledError`).
- **Observability**: reuse the fire-and-forget `AiObserver` event log; every nudge is auditable.

### Architecture fit
`services/autopilot/{signals,rank,compose}.ts`, `jobs/autopilot.ts`, extend `services/notifications`
+ a `Channel` abstraction for outbound delivery. Zero new domain data — it's an orchestration layer.

### Success metrics
- **North Star:** actioned-nudge rate (nudges that lead to a user action within 48h).
- Retention: D30 for Autopilot-on vs off cohorts.
- Guardrail: unsubscribe/mute rate <5%; ≤2 nudges/user/day p95.

### Monetization
Retention engine (raises LTV of every other feature). Outbound channels + higher-frequency
Autopilot as a premium tier.

### Risks & mitigations
- *Notification fatigue → churn.* → Deterministic ranking, hard caps, per-category opt-out,
  "was this useful?" feedback that suppresses noisy signals.
- *A wrong/alarming nudge.* → Only alert on high-confidence deterministic signals; AI never
  invents a number; conservative thresholds.

### Non-goals
Auto-moving money. Trading/investment "advice". It suggests; the user acts.

---

# 4. Household & Split

**The wow:** Compass becomes the shared brain for a family or flat — one net-worth view across
partners, shared budgets everyone can see, and **built-in expense splitting** so you never
reconcile "who owes whom" in a separate app again.

### Problem
Money is rarely solo, but Compass is single-user. Households run their finances across two apps:
a tracker (Compass) *and* a splitter (Splitwise). The seam is painful — shared expenses get
double-entered, and neither app shows the true household picture. The open-signup work already in
flight (`routes/Signup.tsx`, `SIGNUP_ENABLED`) makes multi-user real; households are the natural
next unit.

### Why now
The codebase is moving from single-owner to open multi-user *right now* (the UI-revamp plan lifts
the owner guard). Every table is already `user_id`-scoped — the hard privacy work is done; a
household is a sharing layer on top, not a schema rewrite.

### Target user & JTBD
Couples and flatmates. *"We want a shared view of household money and a running tally of who paid
for what, without leaving the app that already has our accounts."*

### The experience
- Create a **Household**, invite members (leverages open signup + an invite token).
- **Shared vs personal**: each account/budget/goal is either private (default, unchanged) or
  shared to the household. A household dashboard aggregates shared items into one net-worth +
  budget view.
- **Split**: on any transaction, tap "Split" → choose members + a split rule (equal / shares /
  exact). Compass maintains a running **balance ledger** ("Priya owes you ₹1,240") and a
  "settle up" action that records the settling transfer.
- Privacy is explicit and default-safe: nothing is shared unless you share it; leaving a
  household revokes access cleanly.

### Functional requirements
- New tables: `households`, `household_members`, `splits`, `split_shares`, `settlements`
  (all backup-covered). Sharing is an **explicit grant**, never implied by household membership.
- **Authorization** extends the existing scoping: a resource is visible if `user_id == me` **or**
  it's shared to a household I belong to — one central guard, no per-route ad-hoc checks.
- Split balances are integer-paise, always sum to zero across members (invariant-tested).
- Demo mode + CSRF/rate-limit posture inherited unchanged.

### Architecture fit
`services/households.ts`, `services/splits.ts`, `routes/households.ts`, a `withSharing()` scope
helper the services compose. Web: household switcher in `AppLayout`, a Split modal on transactions.

### Success metrics
- **North Star:** % of active users in a household of ≥2 (network effect / stickiness).
- Multi-player retention lift (household users vs solo).
- Guardrail: zero cross-household data leaks (authorization property tests).

### Monetization
Per-seat or per-household plan — the classic "team" upsell, and the strongest viral loop Compass
has (every invite is a new user).

### Risks & mitigations
- *Authorization bugs = privacy breach.* → One central sharing guard + exhaustive tests; shared is
  opt-in; conservative default (private).
- *Split complexity creep.* → Ship equal/shares/exact only; no multi-currency, no groups-of-groups.

### Non-goals
Actual money movement/settlement rails (records the settle-up transfer; doesn't move funds).
Multi-currency.

---

# 5. Scenario Planner ("Financial Time Machine")

**The wow:** Ask "what if?" against your **real** balance sheet. Should I prepay the home loan or
invest the surplus? Can we afford a one-year career break? What does buying a ₹80L house do to us
in 2030? Compass simulates each path forward and shows the fork in net worth.

### Problem
Compass shows the present (net worth, cash flow) and computes goal *projections*, but users face
*decisions*, and decisions are comparisons between futures. Today that lives in messy Excel
models that don't know your actual accounts, EMIs, SIPs, or spending. The data to answer these
questions already sits in Compass — it just can't branch time.

### Why now
The projection engine exists (`goal-projection.ts`, `goal-returns.ts`, `retirement.ts`,
`networth.ts`, `emis.ts`, `projection-settings.ts`). Turning point-forecasts into
**comparable scenarios** is an incremental, high-wow leap, not a new domain.

### Target user & JTBD
Anyone at a financial fork. *"I have a lump sum / a big decision. Show me, on my actual numbers,
which choice leaves me better off — and where the risk is."*

### The experience
- Start from **current state** (real accounts, EMIs, SIPs, income, recurring spend) as the baseline.
- Apply **levers**: prepay loan (full/partial), start/stop/step-up a SIP, a one-time expense
  (house, car), an income change (raise, break, second income), inflation/return assumptions.
- See **Baseline vs Scenario** side by side: net-worth trajectory, monthly cash-flow, goal
  completion dates, and a plain-language verdict ("Prepaying saves ₹4.2L interest but investing
  the surplus at 11% ends ₹6.1L ahead by 2035 — at higher risk").
- Save/compare multiple scenarios; "promote a scenario to a plan" seeds real goals/reminders.

### Functional requirements
- A pure, deterministic **simulation core** (`services/scenario/engine.ts`): baseline state +
  ordered levers → month-by-month projected balance sheet. No side effects; fully unit-tested.
- Reuses existing return/inflation assumptions from `projection-settings`; paise-integer throughout.
- AI layer only **narrates the comparison** (verdict + risk callouts) from computed series.
- Scenarios are user data (`scenarios` table, backup-covered); baseline is read-only derived.

### Architecture fit
`services/scenario/*` composing the existing projection/networth/emi/holdings services;
`routes/scenarios.ts`; a web "Planner" page with a lever panel + dual-trajectory chart.

### Success metrics
- **North Star:** scenarios created per active user + "promoted to plan" rate.
- Depth-of-engagement / session time on Planner.
- Guardrail: simulation determinism (same inputs → identical output; snapshot-tested).

### Monetization
Premium "Planner Pro" (more levers, Monte-Carlo risk bands, exportable one-pager for a spouse/advisor).

### Risks & mitigations
- *Over-precision implies false certainty.* → Always show assumptions + a risk band, never a single
  "answer"; label as projections.
- *Combinatorial lever complexity.* → Ship the top 5 levers; ordered, composable, each tested.

### Non-goals
Real-time market data / live portfolio optimization. Tax micro-optimization (that's Feature 2).

---

# ⭐ Bonus — Local-Brain Mode (Privacy as a Product)

**The wow:** Every AI feature in Compass — categorization, summaries, the assistant, the
extractor, Autopilot's phrasing — runs on a model **on your own hardware**. Your financial data
never touches a third-party API. Privacy isn't a policy page; it's the architecture.

### Problem
Personal finance is the most sensitive data a person owns, and "AI features" almost always mean
"your transactions get POSTed to OpenAI/Anthropic." That's a hard no for a large, underserved
segment — and it's the exact segment self-hosted Compass already attracts.

### Why now
Compass is **already 90% there**: it's self-hosted, `packages/ai` speaks plain `fetch` with an
Ollama provider, and AI is optional by design. Local models (Llama/Qwen/DeepSeek-distill class)
are now good enough for categorization, summarization, and tool-use. The missing piece is
packaging it as a **first-class, one-command mode** rather than an advanced config.

### Target user & JTBD
The privacy-maximalist self-hoster. *"I'll adopt AI features the moment I'm certain my money data
physically cannot leave my house."*

### The experience
- A **"Local Brain"** toggle in Settings → AI that provisions a bundled Ollama + a curated
  default model via the compose stack (opt-in profile, like the `email` profile).
- A visible **"🔒 On-device"** badge across every AI surface when active; the app can *guarantee*
  (via provider allow-listing) no external AI host is ever contacted.
- Honest capability notes per feature (local model quality vs a hosted frontier model), so the
  trade-off is informed.

### Functional requirements
- A compose `localai` profile bundling Ollama + a pinned model; `AI_ALLOWED_BASE_URLS` locked to
  localhost when Local-Brain is on (network-level guarantee, not just intent).
- Reuse `createOllamaProvider` unchanged; add provisioning + health-check + first-run model pull.
- The existing "app must run with AI fully disabled" invariant is preserved; Local-Brain is a
  third state between "disabled" and "hosted".

### Architecture fit
Pure packaging + config: compose profile, a `services/ai-settings` provider option, a Settings UI
state, and an egress allow-list assertion. No new domain code.

### Success metrics
- **North Star:** % of self-hosted installs with AI enabled (Local-Brain removes the privacy blocker).
- AI-feature adoption among privacy-first users.
- Guardrail: zero external AI egress when Local-Brain is on (enforced + tested).

### Monetization
Not a revenue feature — a **positioning & adoption** feature. It's the story that makes Compass
*the* self-hosted finance app: "the only money app whose AI can't leak your data because it never
leaves the box." That narrative is the top-of-funnel.

### Risks & mitigations
- *Local model quality gap.* → Set expectations per feature; keep hosted providers available for
  those who want frontier quality; let users choose per the existing per-user config.
- *Hardware requirements.* → Curate a small-but-capable default; document the RAM/VRAM floor.

### Non-goals
Training/fine-tuning on user data. Shipping GPUs. Matching frontier-model quality on every task.

---

## Sequencing recommendation

1. **Financial Autopilot (3)** — highest retention lift, lowest new-surface risk, pure
   orchestration of what already exists. Ship first to raise the value of everything else.
2. **AI Tax Co-pilot (2)** — strongest willingness-to-pay; builds directly on the tax services
   already in the tree; seasonal urgency.
3. **Account Aggregator (1)** — the moat and the data-entry killer, but gated on FIU/gateway
   onboarding, so start the abstraction early and land it once access is secured.
4. **Household & Split (4)** — rides the open-signup work; the viral loop; do it once multi-user
   is stable.
5. **Scenario Planner (5)** — the depth feature that makes power users evangelists.
6. **Local-Brain Mode (⭐)** — a fast packaging win any time; ship alongside whichever AI feature
   lands first, as the privacy headline.

## Cross-cutting invariants (all features honor these)
- Money is **integer paise**, formatted `en-IN` via `formatINR` — no floats.
- **AI narrates, never derives** numbers; every feature runs with AI disabled.
- Nothing hits the ledger without user accept; **demo mode stays read-only** via the auth chokepoint.
- Every new table is `user_id`-scoped **and** added to `ALL_TABLES`/`USER_TABLES` (backup test).
- New external integrations sit behind a **`null`-able abstraction** (like `Storage`) so the app
  always runs without them.
