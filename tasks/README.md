# Compass — Task Board (2.0 → 2.8)

One file per task; the `status:` field in each file's frontmatter is the source of truth (`todo | in-progress | done | blocked`). The `release:` field says which version a task targets. Update the file, then regenerate this index if desired.

**How these get built: [TDD.md](./TDD.md)** · **UI tasks: [UI.md](./UI.md).**

Tasks marked 🎨 carry `ui: true` in their frontmatter and are written to be executed **unattended** by the `frontend-engineer` agent — self-contained, with exact file paths, the components to reuse, and their own verification. Each links `UI.md` for the conventions rather than repeating them. List them with `grep -l '^ui: true' tasks/*.md`.

**How these get built: [TDD.md](./TDD.md).** Every acceptance-criterion checkbox is a test written *before* the code that satisfies it — tick the box only once its test exists and passes. Money invariants get property tests, not example tests; refactors get characterization tests written before the move.

**Currently at `v3.1.2`.** v2.x tags (v2.0.0-v2.8.17) were incremental releases during the module migration and postings work. Themed releases resume at v3.x. See [REVAMP.md](./REVAMP.md) for the architectural critique and the Shopping Intelligence pillar.

## Release roadmap

| Release | Theme | Phases | Tasks |
|---|---|---|---|
| **2.0.0** | Foundation — modules, event bus, double-entry ledger | 0–3 | 21 |
| **2.1.0** | Household & Split | 4 | 8 |
| **2.2.0** | Goal-based planning | 5–7 | 15 |
| **2.3.0** | Vision & Shopping Intelligence | 8–12 | 20 |
| **2.4.0** | Tax intelligence | 13 | 14 |
| **2.5.0** | Protection & continuity | 14 | 5 |
| **2.6.0** | Debt & windfall | 15 | 3 |
| **2.7.0** | Everyday savings | 16 | 5 |
| **2.8.0** | Portfolio & integrity | 17 | 3 |

Later releases are deliberately small and independently shippable — 2.0.0 is already the largest release in the project's history, and everything after it is staggered rather than piled on. No task depends on a task in a later release (validated).

**2.1.0 — Tax intelligence.** Compass records *several* deduction sources and totals none of them — but the Codex review corrected an earlier overstatement here: **most are not tax-classified and some are absent entirely** (ELSS is indistinguishable from any equity fund, tax-saver FDs from normal FDs, NSC is unmodelled). Instrument tax-classification is therefore the bulk of the work, not aggregation. Realised capital gains *are* computed; the advance tax they trigger is not. Depends on the income model (5.1) from 2.0.0.

**2.2.0 — Protection & continuity.** Compass tracks insurance meticulously but never asks whether cover is adequate; `maturityDate` sits in three tables with nothing consolidating it; and `nominee` exists on exactly one table. This release turns the most complete financial picture a household will ever have into something their family could actually use.

**2.3.0 — Debt & windfall.** The two decisions Indian households face most often — prepay or invest, and where a bonus should go — both of which fall out cheaply once the multi-goal engine (5.2) and regime comparison (11.4) exist.

**2.4.0 — Everyday savings.** Inspired by [Comparify](https://comparify.pro/), a live Indian comparator covering ten quick-commerce platforms plus food delivery and cab fares. Compass's advantage over any standalone comparator is that it **already holds the ledger**: it can close the loop from recommendation to receipt to realized saving, and it can see the recurring pattern (a ₹4,100/month cab habit that is really one commute) rather than one transaction in isolation. This release also lands the pluggable price-source adapter model that answers the "shopping has no durable data source" objection head-on.

**Stack unchanged:** React + TS SPA · Fastify on Node 24 + TS ~5.9 · Postgres (Drizzle) + Redis, both external · AI as an optional isolated module, app fully functional with it disabled.

## What 2.0.0 is

**A foundation release, deliberately near-invisible to users.** Two refactors that both touch every service, done together so nothing gets touched twice:

1. **Module migration** (phases 0–1) — 51 tables → schema slices, 39 flat route registrations → prefixed module plugins, 102 services reorganized, and a domain event bus replacing the URL-regex `onResponse` hook.
2. **Double-entry ledger** (phase 2) — `transactions` becomes a header and `postings` carries the money, with a zero-sum invariant per transaction.

Every product pillar ships *after* this, from 2.1.0 onward. Building planning or household splits on the single-entry model and converting afterwards would mean writing them twice.

### Why double-entry, and why now

The current model is single-entry: a transaction **is** a signed amount against one account, and a balance is `openingBalancePaise + sum(amountPaise)` — two sources of truth for one number. A transfer is two rows stitched by `transfer_links`, which every aggregate must then exclude via a correlated `EXISTS` subquery referenced in **25 places**.

Postings collapse all of that. Category stays a **dimension on the posting**, so there is one `Expenses` system account rather than a chart of accounts — the pragmatic middle ground, not full Beancount. The conversion is a **net deletion**:

| Removed | Replaced by |
|---|---|
| `transfer_links` + 25 exclusion call-sites | Two asset postings on one transaction |
| `transaction_splits` | Multiple `Expenses` postings with different categories |
| `is_opening` + `openingBalancePaise` | A posting against `Opening Balances`; balance is purely `sum(postings)` |
| Semantic sign conventions | Mechanical signs and a zero-sum invariant |

**Now, because the production database is being recreated from scratch.** That removes backfill, dual-write, shadow periods and historical reconciliation — roughly 60–70% of what makes such a conversion expensive. There will not be a cheaper moment.

**Blast radius is contained by keeping the simple API** (2.5): `POST /api/transactions {accountId, amountPaise, categoryId}` still works and expands internally to two postings, so `apps/web` needs almost no change during the conversion.

**Ordering is the risk control.** The module migration completes before the ledger conversion — module boundaries and cross-module ports are exactly what keep the conversion bounded, and the route-table snapshot from 0.3 proves the API surface held.

**Release model:** keep shipping `1.95 → 1.9x` continuously as tasks land; cut `2.0.0` at 3.2. At ~5 releases/day a frozen branch fights how this project works.

## What already exists (do not rebuild)

Phase 4 and 5 are **extensions of real working code**, not greenfield. Verified during planning:

- **`services/goal-plan.ts`** — `targetAllocation()` is already a horizon glide path (≥10y → 75/25 equity/debt, down to 0/100 under a year; emergency funds pinned to 0/100). `buildGoalPlan()` already computes the recommended monthly contribution, splits it to the mix, and reports the gap against committed SIPs.
- **Drift detection already exists** — `DRIFT_BAND_PCT = 10`, `OTHER_BAND_PCT = 50`, and the `allocationDrifted` flag on `GoalPlan`.
- **`services/goal-allocation.ts`** — maps account types and asset classes to `equity | debt | other` (NPS deliberately `other`, since it spans E/C/G).
- **`goal-projection.ts`, `goal-returns.ts`, `goal-networth.ts`, `projection-settings.ts`** — projections, per-asset assumed returns, per-goal net worth, per-user return/inflation assumptions.
- **`services/autopilot.ts`** — `runGoalReview()` already runs weekly, deduped by ISO week.
- **`capital-gains.ts` + `tax-lots.ts`** — FIFO tax-lot matching and FY handling, ready for tax-aware rebalancing.

**The real gaps** are: no *forward* roadmap (only today's spot allocation), no instrument-level guidance (only equity/debt/other), no engine that splits one income across competing goals (every goal is planned in isolation), drift reported as a boolean rather than actionable amounts, and no tax cost attached to a proposed switch.

## Non-negotiables carried through

- **Planning advises; it never executes.** No order placement, no auto-rebalance, no auto-checkout.
- **Instrument *categories*, never named schemes, funds or AMCs** — enforced by test in 4.2 and carried to the UI in 9.3.
- **The model explains; the services compute.** No financial figure ever originates in an LLM.
- **No auto-categorization.** Category stays manual, including on receipt-derived transactions.
- **Money is integer paise** end to end — prices, splits, unit prices, rewards, tax.
- **Nothing reaches the ledger unaccepted**, exactly as with email-extracted transactions.
- **Live scraping stays out of core.** Prices come from user entry, receipt OCR and official affiliate APIs. 14.1 defines a pluggable adapter interface that *permits* other sources without Compass shipping, enabling or endorsing a scraper.

| ID | Task | Phase | Status |
|---|---|---|---|
| 0.1 | [Domain event bus](./00.01-domain-event-bus.md) | 0 — Foundation | done |
| 0.2 | [Retire the URL-regex onResponse hook](./00.02-retire-url-regex-hook.md) | 0 — Foundation | done |
| 0.3 | [Module scaffold + route-table identity gate](./00.03-module-scaffold-and-route-gate.md) | 0 — Foundation | done |
| 1.1 | [Migrate ledger module](./01.01-migrate-ledger.md) | 1 — Module migration | done |
| 1.2 | [Migrate credit module](./01.02-migrate-credit.md) | 1 — Module migration | done |
| 1.3 | [Migrate investments module](./01.03-migrate-investments.md) | 1 — Module migration | done |
| 1.4 | [Migrate protection module](./01.04-migrate-protection.md) | 1 — Module migration | done |
| 1.5 | [Migrate planning module](./01.05-migrate-planning.md) | 1 — Module migration | done |
| 1.6 | [Migrate automation/AI module](./01.06-migrate-automation.md) | 1 — Module migration | done |
| 1.7 | [Migrate ingest module](./01.07-migrate-ingest.md) | 1 — Module migration | done |
| 1.8 | [Migrate system module](./01.08-migrate-system.md) | 1 — Module migration | done |
| 1.9 | [Cross-module ports + flat-services cleanup](./01.09-cross-module-ports.md) | 1 — Module migration | done |
| 1.10 | [Storage backend contract tests](./01.10-storage-backend-contract-tests.md) | 1 — Module migration | done |
| 2.1 | [Postings model & balance invariant](./02.01-postings-model.md) | 2 — Double-entry ledger | done |
| 2.2 | [Retire transfer_links & transfer-exclusion logic](./02.02-retire-transfer-links.md) | 2 — Double-entry ledger | done |
| 2.3 | [Fold transaction_splits into postings](./02.03-splits-into-postings.md) | 2 — Double-entry ledger | done |
| 2.4 | [Convert consuming services to postings](./02.04-service-conversion.md) | 2 — Double-entry ledger | done |
| 2.5 | [Keep the simple transaction API; add multi-leg](./02.05-api-compatibility.md) | 2 — Double-entry ledger | done |
| 2.6 | [Ledger invariants & reconciliation guard](./02.06-double-entry-invariants.md) | 2 — Double-entry ledger | done |
| 2.7 | [Transaction UI for postings](./02.07-transaction-postings-ui.md) 🎨 | 2 — Double-entry ledger | done |
| 3.1 | [Architecture & docs update](./03.01-docs-and-prd.md) | 3 — Ship 2.0.0 | done |
| 3.2 | [2.0.0 release](./03.02-release-2-0-0.md) | 3 — Ship 2.0.0 | done |
| — | **↓ 2.1.0** | | |
| 4.1 | [Household person & roles model](./04.01-household-person-model.md) | 4 — Household & Split | done |
| 4.2 | [Households schema + membership](./04.02-households-schema.md) | 4 — Household & Split | done |
| 4.3 | [Central withSharing() authorization guard](./04.03-sharing-guard.md) | 4 — Household & Split | done |
| 4.4 | [Splits, shares & settle-up](./04.04-splits-and-settlements.md) | 4 — Household & Split | done |
| 4.5 | [Household & split API routes](./04.05-household-api.md) | 4 — Household & Split | done |
| 4.6 | [Household switcher & management page](./04.06-household-switcher-ui.md) 🎨 | 4 — Household & Split | done |
| 4.7 | [Per-record sharing controls](./04.07-sharing-controls-ui.md) 🎨 | 4 — Household & Split | done |
| 4.8 | [Split modal, balances & settle-up](./04.08-split-modal-ui.md) 🎨 | 4 — Household & Split | done |
| — | **↓ 2.2.0** | | |
| 5.1 | [Goal glide-path roadmap (forward path)](./05.01-goal-glide-path-roadmap.md) | 5 — Goal roadmap & instruments | todo |
| 5.2 | [Instrument rules registry](./05.02-instrument-rules-registry.md) | 5 — Goal roadmap & instruments | todo |
| 5.3 | [Instrument-category guidance](./05.03-instrument-guidance.md) | 5 — Goal roadmap & instruments | todo |
| 5.4 | [AI goal roadmap narrative](./05.04-ai-roadmap-narrative.md) | 5 — Goal roadmap & instruments | todo |
| 6.1 | [Income & investable-surplus model](./06.01-income-surplus-model.md) | 6 — Income allocation & rebalancing | todo |
| 6.2 | [Card statement-payment & revolving-debt detection](./06.02-card-debt-detection.md) | 6 — Income allocation & rebalancing | todo |
| 6.3 | [Data-completeness & reconciliation health](./06.03-data-completeness.md) | 6 — Income allocation & rebalancing | todo |
| 6.4 | [Multi-goal allocation engine](./06.04-multi-goal-allocation.md) | 6 — Income allocation & rebalancing | todo |
| 6.5 | [Income adequacy & lever advisor](./06.05-income-adequacy-advisor.md) | 6 — Income allocation & rebalancing | todo |
| 6.6 | [Actionable rebalancing plan](./06.06-rebalancing-plan.md) | 6 — Income allocation & rebalancing | todo |
| 6.7 | [Tax-aware rebalancing](./06.07-tax-aware-rebalancing.md) | 6 — Income allocation & rebalancing | todo |
| 7.1 | [Goal roadmap timeline](./07.01-goal-roadmap-ui.md) 🎨 | 7 — Planning surface | todo |
| 7.2 | [Instrument guidance panel](./07.02-instrument-guidance-ui.md) 🎨 | 7 — Planning surface | todo |
| 7.3 | [Income allocation & lever advisor](./07.03-allocation-levers-ui.md) 🎨 | 7 — Planning surface | todo |
| 7.4 | [Rebalancing & tax-cost panel](./07.04-rebalancing-ui.md) 🎨 | 7 — Planning surface | todo |
| — | **↓ 2.3.0** | | |
| 8.1 | [Vision support in packages/ai](./08.01-ai-vision-support.md) | 8 — Vision | done |
| 9.1 | [Shopping schema + shared contracts](./09.01-shopping-schema.md) | 9 — Shopping core | todo |
| 9.2 | [Shopping lists CRUD + API](./09.02-lists-crud.md) | 9 — Shopping core | todo |
| 9.3 | [Catalog canonicalization + unit normalization](./09.03-catalog-canonicalization.md) | 9 — Shopping core | todo |
| 9.4 | [Paste-text list capture](./09.04-paste-text-capture.md) | 9 — Shopping core | todo |
| 9.5 | [Photo list capture](./09.05-photo-capture.md) | 9 — Shopping core | todo |
| 10.1 | [Price sources & observations](./10.01-price-observations.md) | 10 — AI Shopper & deals | todo |
| 10.2 | [Platform serviceability & delivery ETA](./10.02-serviceability-delivery-eta.md) | 10 — AI Shopper & deals | todo |
| 10.3 | [Basket arbitrage optimizer](./10.03-basket-arbitrage.md) | 10 — AI Shopper & deals | todo |
| 10.4 | [Card offer & deal ingestion](./10.04-card-offer-ingestion.md) | 10 — AI Shopper & deals | todo |
| 10.5 | [Reward value, expiry & earn-rule model](./10.05-reward-model.md) | 10 — AI Shopper & deals | todo |
| 10.6 | [Deal- & reward-aware portal recommendation](./10.06-reward-aware-checkout.md) | 10 — AI Shopper & deals | todo |
| 10.7 | [Price history, buy-now-vs-wait & honesty check](./10.07-price-history-timing.md) | 10 — AI Shopper & deals | todo |
| 11.1 | [Consumption-rate learning + pantry model](./11.01-habits-and-pantry.md) | 11 — Smart cart | todo |
| 11.2 | [Predictive replenishment cart drafts](./11.02-predictive-cart.md) | 11 — Smart cart | todo |
| 11.3 | [Budget cap, goal-impact receipt & EMI guard](./11.03-financial-guards.md) | 11 — Smart cart | todo |
| 11.4 | [Receipt OCR → cart reconcile → ledger](./11.04-receipt-loop.md) | 11 — Smart cart | todo |
| 12.1 | [Shopping nav group, lists & capture](./12.01-shopping-lists-ui.md) 🎨 | 12 — Shopping surface | todo |
| 12.2 | [Cart review screen](./12.02-cart-review-ui.md) 🎨 | 12 — Shopping surface | todo |
| 12.3 | [Pantry & price watch](./12.03-pantry-price-watch-ui.md) 🎨 | 12 — Shopping surface | todo |
| — | **↓ 2.4.0** | | |
| 13.1 | [FY tax-rule data & regime preference](./13.01-tax-rule-data.md) | 13 — Tax intelligence | todo |
| 13.2 | [Payslip parsing → CTC, TDS & EPF](./13.02-payslip-parse.md) | 13 — Tax intelligence | todo |
| 13.3 | [First-class fixed-income & small-savings instruments](./13.03-fixed-income-instruments.md) | 13 — Tax intelligence | todo |
| 13.4 | [Structured taxable-income ledger](./13.04-taxable-income-ledger.md) | 13 — Tax intelligence | todo |
| 13.5 | [EPF passbook reconciliation & benefit projection](./13.05-epf-passbook-reconciliation.md) | 13 — Tax intelligence | todo |
| 13.6 | [PPF / SSY / NPS contribution-limit & eligibility checks](./13.06-scheme-contribution-limits.md) | 13 — Tax intelligence | todo |
| 13.7 | [Section 80C / 80D deduction basket](./13.07-80c-80d-basket.md) | 13 — Tax intelligence | todo |
| 13.8 | [Old vs new regime comparison](./13.08-regime-comparison.md) | 13 — Tax intelligence | todo |
| 13.9 | [Tax deadline nudges](./13.09-deadline-nudges.md) | 13 — Tax intelligence | todo |
| 13.10 | [Advance tax & 234B/234C interest](./13.10-advance-tax.md) | 13 — Tax intelligence | todo |
| 13.11 | [Capital loss set-off & carry-forward](./13.11-loss-carryforward.md) | 13 — Tax intelligence | todo |
| 13.12 | [LTCG & tax-loss harvesting planner](./13.12-harvesting-planner.md) | 13 — Tax intelligence | todo |
| 13.13 | [AIS / 26AS reconciliation & Form 16 import](./13.13-ais-reconciliation.md) | 13 — Tax intelligence | todo |
| 13.14 | [Tax surface](./13.14-tax-surface-ui.md) 🎨 | 13 — Tax intelligence | todo |
| — | **↓ 2.5.0** | | |
| 14.1 | [Insurance policy terms & claim-readiness](./14.01-insurance-policy-terms.md) | 14 — Protection & continuity | todo |
| 14.2 | [Insurance adequacy check](./14.02-insurance-adequacy.md) | 14 — Protection & continuity | todo |
| 14.3 | [Maturity & renewal calendar](./14.03-maturity-calendar.md) | 14 — Protection & continuity | todo |
| 14.4 | [Nominee & continuity dossier](./14.04-nominee-continuity-dossier.md) | 14 — Protection & continuity | todo |
| 14.5 | [Protection & continuity surface](./14.05-protection-surface-ui.md) 🎨 | 14 — Protection & continuity | todo |
| — | **↓ 2.6.0** | | |
| 15.1 | [Prepay vs invest & rate-reset impact](./15.01-prepay-vs-invest.md) | 15 — Debt & windfall | todo |
| 15.2 | [Windfall allocator](./15.02-windfall-allocator.md) | 15 — Debt & windfall | todo |
| 15.3 | [Debt & windfall surface](./15.03-debt-windfall-ui.md) 🎨 | 15 — Debt & windfall | todo |
| — | **↓ 2.7.0** | | |
| 16.1 | [Pluggable price-source adapters](./16.01-price-source-adapters.md) | 16 — Everyday savings | todo |
| 16.2 | [Realized-savings tracker](./16.02-realized-savings-tracker.md) | 16 — Everyday savings | todo |
| 16.3 | [Food-delivery price comparison](./16.03-food-delivery-comparison.md) | 16 — Everyday savings | todo |
| 16.4 | [Cab-fare comparison](./16.04-cab-fare-comparison.md) | 16 — Everyday savings | todo |
| 16.5 | [Everyday savings surface](./16.05-everyday-savings-ui.md) 🎨 | 16 — Everyday savings | todo |
| — | **↓ 2.8.0** | | |
| 17.1 | [Portfolio income & performance attribution](./17.01-performance-attribution.md) | 17 — Portfolio & integrity | todo |
| 17.2 | [Fraud & duplicate-charge review](./17.02-fraud-duplicate-review.md) | 17 — Portfolio & integrity | todo |
| 17.3 | [Portfolio attribution & integrity surface](./17.03-portfolio-integrity-ui.md) 🎨 | 17 — Portfolio & integrity | todo |

## GitHub issues for manual testing

`scripts/tasks-to-issues.mjs` generates one GitHub issue per task, for hands-on verification and screenshot capture.

```bash
node scripts/tasks-to-issues.mjs --dry-run            # list what would be created
node scripts/tasks-to-issues.mjs --dry-run --id 2.1   # preview one issue body
node scripts/tasks-to-issues.mjs --only 2.0.0         # create just this release
```

Each issue carries a link back to its task file, `Blocked by #N` links resolved from `depends`, the acceptance criteria, a **manual-test checklist** (derived from the criteria, with build gates and code-structure items filtered out — those are not hand-testable), a **Screenshots** section, and the verification commands. UI issues additionally ask for desktop and mobile captures plus loading/empty/error states.

Milestones are the release; labels are `task`, `ui`, `release:*` and `phase:*`. Re-runs skip issues that already exist by title, so adding tasks later only creates the new ones. `tasks/.issue-map.json` records id → issue number.

**The task file is the source of truth.** Issue bodies are generated from it and do not sync back — edit the task, then regenerate.

## Codex review — resolution

Full review: [`reviews/roadmap-feature-review-1.md`](../reviews/roadmap-feature-review-1.md). **All findings are now actioned.**

**Factual corrections applied** to `ROADMAP.md` and tasks 5.7, 11.2, 11.7, 12.3 — the claims that Compass "pulls EPF from payslips" and "records every 80C input" were both false, and NRE/NRO *are* already modelled. One Codex claim was rejected: `schema.ts` is exactly 1767 lines, not stale.

**Prerequisites added to 2.0.0** because they gate already-planned work:

| New | Gates | Why |
|---|---|---|
| 2.1 Household person & roles | 2.3 sharing guard | `coveredMembers` is a `text[]`; names break on rename |
| 4.2 Instrument rules registry | 4.3, 5.7, 11.7, 12.3 | Four features would otherwise encode four inconsistent rule sets |
| 5.2 Card revolving-debt detection | 5.4, 7.6, 13.2 | Allocation could fund equity at 12% while revolving at 42% |
| 5.3 Data-completeness & confidence | all advisory features | Precise-looking advice on an incomplete ledger |
| 7.5 Reward value & earn rules | 7.6 | `earnRatePer100` alone compares incomparable points |

**2.1.0 expanded 4 → 13 tasks.** The 11.2/11.4 dependency inversion is fixed by extracting **11.1 FY tax-rule data & regime preference** and splitting deadline nudges into **11.9**. Added Codex's P0/P1 tax items: fixed-income instruments (11.3), taxable-income ledger (11.4), EPF passbook reconciliation (11.5), scheme contribution limits (11.6), loss carry-forward (11.11), harvesting planner (11.12), AIS/26AS reconciliation (11.13).

**Also added:** 12.1 insurance policy terms (before adequacy, since sum-assured alone overstates usable cover) and a new **2.5.0 — Portfolio & integrity** with performance attribution (15.1) and fraud/duplicate review (15.2).

**Decoupled:** 13.2 windfall allocator no longer depends on 13.1 — basic allocation does not need home-loan rate-reset modelling.

**Deliberately not taken:** Codex recommended deferring most of Shopping Intelligence for lack of a durable price source. Kept, but answered directly — 14.1 defines the pluggable adapter model and 7.2 adds serviceability, without Compass shipping a scraper. Codex also suggested decoupling shopping from `withSharing()`; kept coupled, since pantry is genuinely household data and 2.1 now makes the person model sound.

## Known traps

Recorded here because each is a real property of this codebase, verified during planning:

- **All 158 URLs are hardcoded** — no route module uses a Fastify `prefix` today. The route snapshot from 0.3 is the highest-value guard in the release; during Phase 1 it must not change at all.
- **7 tables have no `user_id`** and scope via parent FK: `import_rows`, `budget_lines`, `attachments`, `transaction_links`, `holding_valuations`, `holding_events` (plus `users` as the identity root). A naive sharing guard silently misses every one.
- **Offer caps decide everything** in 7.4 — a 10% offer capped at ₹500 beats a 5% uncapped offer only below ₹10,000 of spend. Test at the cap boundary.
- **`backup.test.ts` fails on any table missing** from `ALL_TABLES`/`USER_TABLES` — new tables land across phases 2, 6 and 7.
- **`LEDGER_DAY_TZ = "Etc/UTC"` is test-enforced** in `jobs/index.test.ts`; moving job wiring during migration must not relax it.
- **`ai_events` kinds are a closed enum** — phases 4, 6 and 7 each need a new kind in `packages/shared/src/schemas/ai-events.ts`.
- **Ollama supports neither forced tool-calling nor vision** — gate on `ai.name !== "ollama"` with a prose fallback, as the extractor already does.
- **The new tax regime is the default since FY 2023-24**, and under it almost no 80C/80D deduction applies. An 80C headroom nudge shown to a new-regime filer is actively wrong advice — 11.2 must gate its prompts on 11.4.
- **Advance tax on capital gains is not retrospective** — a late-year gain becomes payable from the quarter it arose in, not from the first instalment. Getting this wrong produces alarming, wrong 234C numbers.
- **Each ELSS SIP instalment carries its own 3-year lock-in**, so a monthly SIP produces a rolling stream of unlock dates. 12.2 feeds this to rebalancing (5.4/5.5), which needs to know which units are actually free.
- **Nomination is not inheritance** under Indian law — a nominee receives as trustee; succession law or a will decides entitlement. 12.3 must state this rather than implying otherwise.
- **Tax slabs, caps and rebates must be versioned per financial year in data**, never hardcoded inline — a stale rate produces confident wrong advice.
- **`tasks/` was gitignored** prior to this board's commit (previous boards needed `git add -f` to be versioned). The `tasks/` line has since been removed from `.gitignore` so this board — and future task files — track normally without a force-add.
- **`LEDGER_DAY_TZ = "Etc/UTC"` crosses the day boundary at 05:30 IST.** Fine for ledger-day math today, but extending it to advance-tax and maturity deadlines would be a product bug — India-facing deadlines need an explicit IST business-date service.
- **Household sharing is not one SQL guard.** Visibility is also embedded in cache keys (`services/cache.ts`), per-user export (`services/backup.ts`), restore (`services/restore-user.ts`), global search, net-worth snapshots, scheduled notifications, and object-storage access. Revocation must invalidate every member's cache; jobs must not send one household member's private alert to all.
- **`createTransfer()` requires both accounts to belong to the same user**, so "settle-up records a transfer" does not work unchanged across household members.
- **Allocation is inferred from account type** — `accountAllocationClass()` labels every `investment` account as equity and every NPS account as `other`, even though `account_nps_details` stores real E/C/G percentages. Too coarse to issue switch amounts against.
- **`holdings.gainsTaxClass` is holding-wide**, and `tax-lots.ts` documents that a mixed exchange-sale/RBI-redemption SGB position cannot be represented correctly. Per-event disposal treatment is needed before tax advice.
- **Loss carry-forward does not exist** — advance tax and harvesting need brought-forward losses, set-off ordering and expiry, or they will overstate tax and can reverse a recommendation.
- **Income double-counting is the likely 5.1 bug** — historical ledger expenses already contain EMIs, premiums and SIPs, so subtracting their schedules again double-counts. `getForecast()` in `services/cashflow.ts` already solves this by excluding recurring-sourced rows; follow that convention.
- **Never `git add -A`** — a private statement PDF and `apps/docs/.docusaurus/` are in the working tree.
- **The 0.3 route-table snapshot proves URL/method identity only** — it does not prove auth requirements, `config.public` metadata, demo-write protection, or CSRF/rate-limit classification survive a plugin-encapsulation change. Tasks 1.1-1.8 must each verify those separately as their own acceptance criterion when converting flat route registrations into prefixed/nested module plugins.
