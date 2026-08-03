# Compass Revamp

This document has two parts:

1. **Architectural revamp** — how the backend should be restructured if we were building it again today, based on a critical read of the current codebase (51 tables in one `schema.ts`, 102 files in a flat `services/`, `app.ts` hand-registering 40 route modules, a regex-based side-effect hook). Not a rewrite — a target shape to migrate toward module by module.
2. **New product pillar: Shopping Intelligence** — shopping list capture, an AI shopper that hunts for the cheapest price, and a smart cart that learns household habits. Deliberately pushed toward "wild" — including ideas that reuse data Compass already has (card rewards, EMI math, budgets, goals, net worth) in ways no shopping app does.

---

# Part 1 — Architectural Revamp

## What's staying exactly as-is

These are correct decisions, not up for debate in a revamp:

- **Money as integer paise** everywhere via `packages/shared/src/money.ts`. No float rupees, no per-feature reinvention.
- **`packages/ai` as a vendor firewall** — one `postJson` HTTP path, ESLint bans SDK imports outside the package, per-user provider config instead of env globals. This pattern gets reused for the new shopping pillar (see Part 2).
- **Zod schemas as the shared contract** between API and web (`packages/shared`), no codegen.
- **Optional features run in their own containers** (ingestor/extractor behind a compose profile) so the core ledger has zero dependency on them and can't be destabilized by them.
- **AI is assist-only, never autonomous** — no rules engine silently classifying transactions (`02.06-rules-engine.md` was correctly dropped), demo sessions can't mutate. This principle extends directly to the new AI shopper: it can *research and draft*, it can never *pay*.

## What's broken structurally

**No enforced domain boundary.** What started as an expense tracker grew into accounts, cards, EMIs, SIPs, insurance, retirement, net worth, budgets, goals, recurring, bills, insights, backup, AI, and an email pipeline — all living in one flat `services/` folder (102 files) and one `schema.ts` (1767 lines, 51 tables). Nothing stops `cards.ts` from reaching into SIP tables directly; the only thing preventing cross-domain spaghetti today is convention.

**`app.ts` manually wires 40 route files** with no domain grouping — Fastify's plugin encapsulation (each domain gets its own decorator scope) exists and isn't used.

**Side effects are stringly-typed.** The `onResponse` hook that drives cache invalidation and budget re-evaluation matches on URL regex:
```js
if (/^\/api\/(transactions|transfers|imports|recurring|inbox)/.test(req.url)) { ... }
```
Add a mutating route under one of these prefixes, or rename one, and this silently changes behavior with nothing to catch it.

**Some services have outgrown "a service."** `inbox.test.ts` is 1767 lines; `cards.ts` and `sips.ts` are 1000+ lines each. Usually means the module does multiple jobs (e.g. inbox = review-queue CRUD + extraction state machine + mailbox lifecycle, all in one file).

**`repositories/` is a fiction** — "nearly empty, write logic in services" — fine as a pragmatic call, but the empty folder implies a layer that doesn't exist.

## Target shape: modular monolith

Still one deployable, one Fastify app, one Postgres. Partitioned into explicit modules:

| Module | Owns |
|---|---|
| `ledger` | accounts, categories, transactions, transfers, imports, recurring |
| `credit` | cards, EMIs, card-due tasks, rewards |
| `investments` | holdings, SIPs, net worth |
| `protection` | insurance, retirement (EPF/NPS) |
| `planning` | budgets, goals, cash flow, bills |
| `automation` | AI settings, AI event log, insights |
| `ingest` | email inbox pipeline, mailboxes |
| `shopping` | *new — Part 2* |

Each module gets:
- its **own schema slice** (`modules/credit/schema.ts`) re-exported into one Drizzle instance, instead of a single 1767-line file nobody holds in their head.
- its **own Fastify plugin** with a prefix (`app.register(creditModule, { prefix: "/api/cards" })`), replacing manual imports in `app.ts`.
- a **narrow declared interface** for cross-module reads (e.g. net worth asks each module for its contribution via a `NetWorthContributor` port) instead of raw joins across module boundaries.

**Domain events replace the regex hook.** Services emit `events.emit("ledger.mutated", { userId })` after a write; cache invalidation, budget re-eval, and notifications subscribe to that event. Self-declaring, not pattern-matched from outside — and it's the same mechanism the shopping module uses to hand off a checked-out cart to the ledger (Part 2).

**Migration path:** incremental, one module at a time, starting with the one under the most active change pressure. No big-bang rewrite — the schema-slice/plugin/events pattern can be introduced for a new module (`shopping`) first, proving it out before existing modules are migrated.

---

# Part 2 — Shopping Intelligence

## Vision

Compass already tracks *what you spent*. This pillar makes it also help with *what to buy, from where, and for how much* — closing the loop from "shopping list" through "cheapest source" through "actual ledger transaction," using data Compass uniquely already has: card reward multipliers, EMI true-cost math, budget envelopes, and goal timelines.

## Non-negotiable design principle

**Assist, never autonomous.** Mirrors the existing "no auto-categorization" rule and the demo-mode mutation guard. The AI shopper can search, compare, and stage a cart. It never holds payment credentials, never places an order, never auto-checks-out. Every price/cart/substitution suggestion is a *draft* the user accepts or discards, exactly like `extracted_transactions` from the email pipeline never touches the ledger without explicit accept.

## Domain model (`shopping` module)

- `shopping_lists` / `shopping_list_items` — a list is a named collection of `(catalog_item, quantity, unit)`
- `catalog_items` — canonical item identity + normalized unit (so "atta 5kg" and "wheat flour 5kg" resolve to one thing)
- `price_sources` — platform registry (BigBasket, Blinkit, Zepto, JioMart, Amazon.in, Flipkart, DMart Ready, "kirana — manual")
- `price_observations` — timestamped `(catalog_item, source, price_paise, unit_price_paise, observed_via)` — the crowdsourced/OCR/affiliate price history
- `pantry_items` — inferred household stock level per catalog item, decremented by consumption-rate model
- `cart_drafts` — an AI-Shopper-proposed cart awaiting user review, never auto-submitted
- `habit_profiles` — per-user learned consumption rate, preferred sources, preferred cards

## Feature Set A — Shopping list processing

- **Multi-channel capture:** paste raw text, photograph a handwritten list (OCR), forward a WhatsApp/email export, dictate a voice note, or generate one from a pasted recipe.
- Parsing reuses the `packages/ai` pattern (per-user provider, `postJson`, `observe` hook) to turn free text into structured `(item, qty, unit)` — same forced-tool-calling structured-output approach already used by the extractor.
- New items get canonicalized against `catalog_items`; ambiguous matches ("maggi" → which pack size?) are a review step, not a silent guess — same "reviewable, nothing auto-commits" pattern as email extraction.

## Feature Set B — AI Shopper (find-it-cheapest)

- **Price comparison, unit-normalized** — ₹/kg or ₹/L across sources so a 200ml vs 1L bottle compares honestly.
- **Basket arbitrage optimizer** — given a full shopping list, solve for the cheapest way to split it across platforms, factoring in per-platform delivery fees and minimum-cart thresholds — not just cheapest item-by-item, cheapest *total trip*.
- **Reward-aware recommendation** *(differentiated — reuses `cards.ts` data no generic shopping app has)* — "checkout via HDFC card on BigBasket nets 5% cashback vs SBI on Blinkit" — combines live price with the card reward data Compass already tracks.
- **Price history & timing** — "buy now vs. wait" using observed price trends, flagging likely upcoming sales.
- **Price-honesty detector** — cross-references a platform's "was ₹X, now ₹Y" claim against Compass's own observed price history to flag inflated reference prices during festival sales.
- **Kirana vs. online, time-costed** — factors delivery wait and your own time value against walking to the local kirana, not just sticker price.

## Feature Set C — Smart cart from habits

- **Consumption-rate learning** from repeat purchases in transaction history *and* shopping-list submissions (e.g. "5kg atta lasts ~22 days for this household").
- **Predictive replenishment** — auto-drafts a cart before you run out; you review and edit, nothing ships itself.
- **Budget-aware capping** — draft cart is checked against the live `planning` module budget envelope for groceries before it's ever shown.
- **Substitution suggestions** on price spikes (regular brand up 30% this week → suggest the usual alternate).
- **Subscribe-and-save breakeven optimizer** — for genuinely recurring high-frequency items, compute whether a subscription actually beats ad-hoc buying.
- **EMI temptation guard** *(differentiated)* — a big-ticket cart item with a "no-cost EMI" offer gets run through the existing EMI true-cost math (processing fees, opportunity cost) before it's shown as "no cost."
- **Goal-impact receipt** *(differentiated)* — "this cart delays your Emergency Fund goal by 4 days" computed against existing goal/net-worth projections, shown *before* checkout, not after.

## Wild / moonshot ideas (explicitly speculative — flagged, not committed)

- **Community price index** — opt-in, anonymized, user-submitted price observations build Compass's own price database across self-hosted instances, instead of scraping any platform directly. Turns the "how do we get price data legally" problem into a network-effect asset. Real privacy tradeoffs to work out before this is more than a sketch.
- **Group-buy pods** — neighbors/building opt in to pool orders and split minimum-cart / free-delivery thresholds. Big logistics and trust surface; interesting, not a near-term build.
- **Dead-stock / cost-per-use detector** — items bought but rarely consumed (unused gym supplements, novelty kitchen gadgets) surfaced with their true cost-per-use, in the same spirit as net worth "money efficiency" framing.
- **Shopping mood ledger** — correlates cart timing/size against existing spending categorization (e.g. late-night impulse orders) purely as a *nudge*, never a judgment, staying inside the "manual category, AI assist-only" rule.
- **Receipt OCR closes the loop** — a photographed receipt from an actual purchase reconciles against the drafted cart and becomes a real ledger transaction via the existing import pipeline — shopping and the ledger stop being separate features.

## The honest part: how do we actually get price data?

This is the part most "wild" shopping-AI pitches skip. Indian quick-commerce platforms mostly don't expose public price APIs, and scraping them raises real ToS and legal exposure that shouldn't be shipped as a default-on Compass feature.

| Approach | Legality/risk | Effort | Recommendation |
|---|---|---|---|
| User-submitted / crowdsourced prices | Low risk — it's the user's own observation | Low | **Start here** |
| Receipt OCR (photo of an actual receipt) | Low risk, reuses existing attachment/OCR pattern | Medium | **Start here** |
| Official affiliate APIs (Amazon PA-API, Flipkart Affiliate) | Low risk, ToS-compliant | Medium | Add where available |
| Live scraping of quick-commerce apps | Real ToS/legal risk, fragile, likely to break | High | **Not a core Compass feature.** If ever built, ship as a pluggable, disabled-by-default adapter the user opts into and runs themselves — same isolation as the AI provider pattern and the ingestor/extractor containers. Compass doesn't host or endorse it. |

## Architecture fit

- `shopping` is a new module in the modular-monolith plan (Part 1) — proves out the schema-slice + Fastify-plugin + domain-event pattern before older modules migrate to it.
- A `shopping.cart.checked_out` domain event hands off to `ledger` to draft a transaction — reuses the event bus, doesn't bypass "no auto-categorization" (category is still manual on the drafted transaction).
- The AI shopper is a consumer of `packages/ai`, not a new vendor-SDK surface — same per-user provider resolution and `observe` hook as the extractor.
- If live price-watching ever ships, it's an **optional container behind a compose profile**, exactly like `ingestor`/`extractor` — disabled by default, isolated blast radius, pluggable price-source adapters instead of one hardwired scraper.

## Phasing

| Phase | Scope |
|---|---|
| A | Modular-monolith foundation: schema slices, per-module Fastify plugins, domain event bus (no user-facing change) |
| B | Shopping lists: schema, capture channels (text/photo/voice), catalog canonicalization |
| C | AI Shopper: price comparison and arbitrage, sourced only from crowdsourced entries + receipt OCR + affiliate APIs (no scraping) |
| D | Smart cart: habit learning, pantry model, budget/goal/EMI/reward integration |
| E (moonshot, optional) | Community price index, group-buy pods, pluggable scraping adapters |

## Non-goals / open risks

- **Never autonomous checkout or payment.** The AI shopper drafts; a human always taps "buy."
- **Price data has no accuracy guarantee** — crowdsourced/OCR data needs a visible "last observed" timestamp and source, not presented as live truth.
- **Habit and pantry data stays local to the self-hosted instance** by default — no cross-user sharing unless a user explicitly opts into the community price index (Phase E).
- **Live scraping is explicitly out of core scope** — see the data-acquisition table above.
