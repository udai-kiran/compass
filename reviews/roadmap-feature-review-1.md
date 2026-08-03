## 1. Missing features

### P0 — First-class fixed-income and small-savings instruments

Compass claims Indian depth, but fixed deposits are only `holdings.assetClass = "fd"`. There is no principal, interest rate, compounding convention, start date, maturity date, payout frequency, auto-renewal instruction, bank TDS, joint-holder status, or premature-closure penalty. RD and NSC are not modelled at all.

This blocks or weakens several planned features:

- Task 12.2 cannot produce FD/RD/NSC maturities.
- Task 11.2 cannot identify five-year tax-saver FDs or NSC contributions.
- Task 11.3 cannot calculate accrued interest or TDS.
- Task 5.5 cannot price an FD break penalty.
- Task 13.2 cannot detect an FD maturity as a windfall.

Reuse `holdings`, `holdingValuations`, `holdingEvents`, `goalId`, the document-storage pattern in `insurancePolicies`, and reminder infrastructure in `services/bills.ts`. Add typed deposit details and cash-flow schedules, not more free-form notes.

Effort: medium, roughly 2–3 backend tasks plus one web surface. It should precede tax, maturity calendar, rebalancing, and windfall work.

---

### P0 — Structured taxable-income ledger and tax-source reconciliation

The tax roadmap expects salary, interest, dividends, rent, TDS and capital gains to combine into one liability. Only capital gains have a structured computation. Interest, rent and dividends are ordinary categorized transactions with no payer, PAN, section, gross-versus-net amount, TDS section, accrual period, or AIS linkage.

`holdingEvents.type = "dividend"` exists in `apps/api/src/db/schema.ts`, but `services/tax-lots.ts` explicitly ignores dividends because they are slab-taxed. Nothing picks them up afterward. Bank interest and rental income have no equivalent structure at all.

Add an income-event model covering:

- interest under sections 194A/194K;
- dividends and IDCW;
- rent and section 194-I TDS;
- salary and section 192 TDS;
- gross amount, TDS, payer, PAN/TAN, booking date and FY;
- linkage to a ledger transaction, holding, account, payslip, or AIS line.

Then add AIS/26AS reconciliation and Form 16 import. These are higher-value than most of the shopping roadmap because Compass already holds portions of the same data and currently cannot reconcile them.

Reuse `holdingEvents`, `transactions`, `capital-gains.ts`, the staged/reviewable import pattern in `services/imports.ts`, and `statementReconciliations`.

Effort: large, but divisible. The income-event substrate is medium; AIS/26AS/Form 16 import and reconciliation are another medium-to-large tranche.

---

### P0 — Credit-card payment completion and revolving-debt detection

Compass knows statement total due, minimum due, due date, ledger balance, linked repayments and statement lines, but it does not answer the most consequential card question: “Was this statement paid in full by the due date?”

Relevant data already exists in:

- `statementReconciliations.totalDuePaise` and `minDuePaise`;
- `cardDetails.dueDay`;
- repayment links handled by `services/inbox.ts`;
- transaction-to-transaction relationships in `transactionLinks`;
- card-cycle logic in `services/cards.ts`.

Add a statement-payment state machine:

- unpaid / partially paid / paid in full;
- paid amount and payment date;
- likely revolving balance;
- estimated finance charge and lost grace period;
- overdue and minimum-only warnings;
- issuer-level exposure across cards.

This is materially more valuable than generic utilization alerts. A user carrying card debt should also pre-empt goal allocation, rebalancing, shopping offers, and windfall optimization.

The model currently lacks card APR, cash-withdrawal APR, late fee, GST and interest-free-period terms, so those must be added to `cardDetails` or issuer/product terms.

Effort: medium.

---

### P0 — EPF passbook reconciliation and retirement benefit projection

“Record EPF contribution” is currently a manual transaction form, not payslip or EPFO reconciliation. `recordEpfContribution()` in `apps/api/src/services/epf-contributions.ts` creates one income transaction tagged `"payslip"`; [RecordEpfModal.tsx](/home/udai/PennyPilot/apps/web/src/routes/transactions/RecordEpfModal.tsx) is the actual input surface.

Compass already stores:

- EPF account balance and UAN/reference number;
- EPS balance in `retirementDetails.epsBalancePaise`;
- manual contribution history;
- date of birth in `userProfiles`;
- salary-linked SIP intent via `sips.fundingSource = "payroll"`.

Add:

- employee, employer-EPF and EPS components separately;
- wage month and employer;
- passbook/payslip reconciliation;
- interest-credit reconciliation;
- contribution gaps;
- VPF rate;
- projected EPF and EPS benefit at retirement;
- job-change/UAN continuity checks.

One combined positive transaction is insufficient for tax, pension, employer matching, or missing-contribution analysis.

Effort: medium-to-large. It should be built together with payslip parsing, not left as a generic transaction convention.

---

### P0 — Contribution-limit and eligibility checks for PPF, SSY and NPS

Compass already knows scheme type, annual contribution transactions, maturity date, holder, family members and dates of birth, yet draws no compliance or action conclusions.

Add FY-aware checks for:

- PPF minimum and maximum contribution, missed-year status and extension mode;
- SSY beneficiary age/eligibility, minimum/maximum annual contribution, 15-year contribution period, maturity and partial-withdrawal rules;
- NPS Tier I contribution history, employer contribution, 80CCD buckets and age/exit constraints;
- duplicate use of the same contribution across tax buckets;
- excess or short contributions before year-end.

Reuse `accounts`, `retirementDetails`, `accountNpsDetails`, `transactions`, `sips`, `familyMembers`, `fyOf()` and `fyRange()`.

Effort: medium. This should feed both the deduction basket and maturity calendar.

---

### P1 — Tax-loss and LTCG harvesting planner

The “wow” PRD names harvesting, but it is not on the 53-task board. This is a conspicuous omission because the hard data is already present:

- FIFO open lots in `services/tax-lots.ts`;
- current valuations and NAVs in `holdingValuations`;
- realised FY totals in `getCapitalGains()`;
- grandfathering and holding-period classification;
- user-set tax class.

Add:

- unrealised gain/loss per open lot;
- lots nearing long-term status;
- equity LTCG exemption headroom;
- loss-offset opportunities;
- harvest-and-rebuy caveats;
- estimated tax effect and transaction/exit-load assumptions.

This should share a tax-position service with rebalancing instead of being a separate calculator.

Effort: medium after the tax-rate engine exists.

---

### P1 — Insurance policy-quality and claim-readiness model

Task 12.1 proposes adequacy mostly from `sumAssuredPaise`. That is too shallow for Indian health insurance and can produce dangerously optimistic conclusions.

The current `insurancePolicies` model lacks:

- deductible;
- co-pay;
- room-rent or ICU limits;
- sub-limits;
- waiting periods;
- restoration benefit;
- no-claim bonus terms;
- employer-versus-personal ownership;
- network/claim contacts;
- policy exclusions;
- nominee relationship;
- covered-member IDs.

`coveredMembers` is merely `text[]`, despite `familyMembers` already existing. A name change or duplicate name breaks the relationship.

Add structured policy terms, link coverage to `familyMembers.id`, and build a claim-readiness checklist: policy document, health card, TPA contact, renewal status, waiting-period end and missing disclosures/documents.

Effort: medium. Do this before insurance adequacy; otherwise the adequacy result will overstate usable cover.

---

### P1 — Household-level financial roles before cross-user sharing

If “single household” remains the product boundary, the app still needs an explicit model for earners, dependents, asset holders, borrowers and insured people. `accounts.holderName`, `insurancePolicies.coveredMembers`, `insurancePolicies.nominee`, and `familyMembers` are unrelated strings today.

Introduce stable links from accounts, policies, goals, liabilities, nominees and income sources to a person record. This supports:

- whose income is lost in an insurance scenario;
- whose 80D senior-citizen limit applies;
- who owns an asset for tax;
- whose loan and credit exposure is being assessed;
- which child an SSY or education goal belongs to.

This is more foundational than turning every record into an arbitrary share grant.

Reuse `familyMembers`; allow a registered user to correspond to a household person without making every person a login.

Effort: medium-to-large.

---

### P1 — Data-completeness and reconciliation health

Compass has multiple partial sources—CSV batches, email alerts, card statements, MF CAS, manual transactions and eventually payslips—but no view answering whether a month is complete.

It already holds useful evidence:

- import batches and rejected/duplicate rows;
- card statement `matchedCount` and `unmatchedCount`;
- mailbox ingestion failures;
- unreconciled extracted drafts;
- account statement periods;
- stale holdings valuations;
- net-worth snapshot failures.

Add a monthly close/readiness view by account:

- expected statement present or missing;
- last imported-through date;
- unreconciled card lines;
- unresolved drafts;
- stale valuations;
- unexplained balance difference;
- confidence level for reports, tax and planning.

Without this, goal or tax advice may look precise while being based on an incomplete ledger.

Effort: medium.

---

### P1 — Reward value, expiry and earn-rule modelling

Task 7.4 cannot be accurate using the current rewards data. Compass stores only point movements and a single `earnRatePer100`. It does not know:

- point value by redemption route;
- expiry date;
- merchant-category exclusions;
- accelerated earn caps;
- milestone benefits;
- issuer/product-specific redemption fees;
- whether an offer requires a particular network or card product.

`cardIssuerSettings` is issuer-level, but many offers and reward rules are card-product-specific. `cardDetails.productName` and `network` exist and should be used.

Add product-level reward rules and expiry lots before attempting “best card” recommendations. Otherwise task 7.4 will confidently compare incomparable points.

Effort: large if comprehensive; medium for a deliberately constrained manual rule model.

---

### P2 — Portfolio income and performance attribution

XIRR exists in `services/xirr.ts`, portfolio XIRR is exposed, and holdings track dividends, valuations and buy/sell events. Compass still does not explain why returns changed.

Add:

- capital appreciation versus dividends/interest;
- realised versus unrealised return;
- contributions versus market movement;
- asset-class and holding contribution;
- benchmark comparison only where a user explicitly selects a benchmark;
- after-tax return once the tax engine exists.

Reuse `positionCashFlows`, `holdingEvents`, `holdingValuations`, `getPortfolio()` and net-worth snapshots.

Effort: medium.

---

### P2 — Financial fraud and duplicate-charge review

`services/anomaly.ts` detects statistical amount anomalies, but the ledger could also flag conclusions with higher actionability:

- duplicate card charges at the same merchant;
- repeated failed/reversed/charged sequences;
- subscription price increases;
- unexpected ATM/cash withdrawal;
- a refund that never arrived;
- charge after a subscription was supposedly cancelled.

Reuse merchant normalization, transaction links, card statement reconciliation, recurring-template history and the existing review inbox.

Effort: medium.

---

## 2. Factual errors in `ROADMAP.md`

### “Compass already records every deduction input” is false

This is repeated in the 2.1.0 description and task board.

The schema does not distinguish ELSS from an ordinary equity MF, tax-saver FD from a normal FD, NSC at all, tuition-fee eligibility, preventive health check-ups, employer NPS contribution, or home-loan interest eligibility. `holdings` has `assetClass` and `gainsTaxClass`, but neither identifies ELSS or tax-saver deposits. `holdingEvents` has no tax-deduction metadata.

Insurance premiums exist, and `services/emis.ts` can split principal and interest, but that is nowhere close to “every input.”

Files demonstrating the gaps:

- `apps/api/src/db/schema.ts`: `holdings`, `holdingEvents`, `insurancePolicies`, `emiDetails`;
- `packages/shared/src/schemas/wealth.ts`: no ELSS/tax-saver/NSC contract;
- `apps/api/src/services/capital-gains.ts`: gains only;
- `apps/api/src/services/tax-lots.ts`: capital-gains classification only.

The accurate claim is: Compass records several potential deduction sources, but most are not tax-classified and some are absent entirely.

---

### “Compass already pulls EPF contributions from payslips” is false

There is no payslip parser or payslip table today.

`recordEpfContribution()` in `apps/api/src/services/epf-contributions.ts` accepts a manually entered amount and creates a transaction. The `"payslip"` tag is a provenance label, not evidence of extraction. The UI is the manual `RecordEpfModal` in `apps/web/src/routes/transactions/RecordEpfModal.tsx`; the route is `/api/transactions/epf-contribution` in `apps/api/src/routes/transactions.ts`.

Task 11.1 should say “Compass can manually record an EPF contribution attributed to a payslip.”

---

### “No NRE/NRO handling” is false as written

NRE and NRO are implemented bank-account subtypes:

- `bankAccountSubtype` includes `"nre"` and `"nro"` in `apps/api/src/db/schema.ts`;
- `BankAccountSubtypeSchema` includes them in `packages/shared/src/schemas/ledger.ts`;
- they are editable in `apps/web/src/routes/settings/AccountDetailPage.tsx`;
- they are displayed in `apps/web/src/routes/accounts/AccountsPage.tsx` and `AccountLedgerPage.tsx`.

What is genuinely absent is NRI taxation, repatriability, RFC/FCNR accounts, foreign currency, foreign assets and Schedule FA. The roadmap should say that, rather than denying existing NRE/NRO classification.

---

### The maturity-calendar premise is materially incomplete

`ROADMAP.md` says maturity dates live in three tables, which is literally true:

- `retirementDetails.maturityDate`;
- `insurancePolicies.maturityDate`;
- `goldDetails.maturityDate`.

But the proposed calendar promises FD/RD/NSC maturities. None of those dates exists. An FD is only `holdings.assetClass = "fd"`; RD and NSC do not exist as types. The roadmap presents the feature as consolidation when a significant part is greenfield modelling.

Task 12.2’s effort and dependencies are therefore understated.

---

### “Tax-aware rebalancing can reuse existing FIFO tax lots” overstates readiness

The FIFO engine can classify realised slices. It cannot compute the real tax cost of a proposed switch because Compass lacks:

- a tax regime and slab engine;
- other taxable income;
- surcharge, cess, rebate and marginal relief;
- previous/current losses and set-off;
- exit loads;
- locked-unit metadata;
- per-event disposal mode for SGB;
- acquisition-level ELSS classification.

`services/tax-lots.ts` itself documents that `gainsTaxClass` is holding-wide and that a mixed exchange-sale/RBI-redemption SGB position cannot be represented correctly.

The existing code is a useful lot-matching primitive, not a ready tax-aware rebalancing engine.

---

### “51 tables in one 1,767-line schema file” is stale

`apps/api/src/db/schema.ts` is longer than the stated 1,767 lines in the inspected tree: the last exported table begins at line 1743 and continues beyond it. This is minor, but the roadmap presents exact scale statistics as current facts.

---

### “Full JSON/CSV export” is imprecise

The JSON export is broad: `exportUserData()` covers all user and linked tables in `services/backup.ts`. The general CSV endpoint only exports transactions via `transactionsCsv()` and `/api/export/transactions.csv` in `routes/backup.ts`. Reports and cash flow have their own CSV outputs, but there is no full all-domain CSV export.

Say “full JSON export plus transaction/report CSV exports.”

---

## 3. Roadmap sequencing problems

### 11.2 and 11.4 have an explicit dependency inversion

Task 11.2 depends on 11.1, while task 11.4 depends on 11.2. But 11.2 requires headroom prompts to be suppressed based on the result of 11.4. The board’s Known Traps section acknowledges this contradiction.

Fix it by splitting the work:

1. Versioned FY tax-rule data and a user regime preference.
2. Base old/new regime calculator.
3. Deduction-basket computation.
4. Final comparison and crossover presentation.
5. Deadline nudges.

The basket can compute totals without the comparison, but it must not ship nudges until regime selection/comparison exists.

---

### Task 5.5 depends on later task 12.2

Tax-aware rebalancing promises to exclude or flag ELSS, PPF, EPF, FD and SGB constraints. Task 12.2 is where most of those constraints are planned, and the board explicitly says 12.2 feeds 5.4/5.5.

That directly contradicts “No task depends on a task in a later release.”

Pull a reusable instrument-constraint model—lock-ins, maturity, exit windows and penalties—before 5.5. The calendar UI can remain in 2.2.0.

---

### Task 5.5 also belongs after the 2.1 tax engine

FIFO gains are not tax liability. Whether a switch is worth its tax cost depends on regime, total income, loss set-off, surcharge, cess and FY-wide realised gains. None exists in 2.0.0.

Either move tax-aware rebalancing after 11.4 or constrain 5.5 honestly to “show realised gains and holding-period consequences,” without claiming actual tax cost or an optimal decision.

---

### Insurance adequacy is scheduled before policy data is adequate

Task 12.1 proposes employer-only cover detection, usable health-cover adequacy and dependent-specific reasoning, but the schema has no employer-owned flag and `coveredMembers` is an unstructured `text[]`.

Add policy-term and person-linking work before adequacy. Otherwise the first implementation will hard-code assumptions or infer facts from names.

---

### The income model comes too late for several things that should use it and too early for payslip truth

Task 5.1 derives salary from ledger credits before task 11.1 introduces gross salary, HRA, TDS and EPF. That creates two incompatible income concepts:

- net cash salary for investable surplus;
- gross taxable/insurable income for tax and Human Life Value.

Define an income-source contract in 5.1 that explicitly separates gross, net, regular, variable and payroll deductions, even if the first adapter is ledger inference. Task 11.1 should populate the same model, not create a second salary representation.

---

### Household sharing should not be coupled to all subsequent 2.0 work

Task 6.1 depends on `withSharing()` merely because pantry data is household-scoped. That forces the highest-risk authorization rewrite onto shopping, planning surfaces and the entire 2.0 release.

For a single-household self-hosted product, pantry can initially be instance- or owner-scoped. Household login/sharing can ship independently after the finance core. Coupling shopping to sharing magnifies schedule and privacy risk without improving the first-user experience.

---

### Windfall allocation needlessly depends on the complete prepay-versus-invest feature

Task 13.2 depends on 13.1. A useful windfall allocator can prioritize emergency reserves, card debt and goals without modelling home-loan rate resets and section 24(b). Ship basic allocation first; add debt comparison as an optional adapter later.

---

### The maturity substrate should move before instrument guidance

Task 4.2 promises ranked Indian instrument categories based on lock-in, tax, liquidity and horizon. Those facts are not represented as versioned data until pieces of 11.x and 12.2.

Create a single versioned instrument-rules registry before 4.2. Otherwise instrument guidance, tax deductions, maturity calendar and rebalancing will each encode their own inconsistent rules.

---

### Card payment health must precede goal and shopping optimization

The allocation engine can currently send surplus toward goals while a user is revolving credit-card debt because it lacks reliable statement-payment status and card APR. The shopping optimizer can then recommend card offers on that same card.

Add statement-payment/revolving-debt detection before 5.2, 7.4 and 13.2. High-interest unsecured debt must be a hard planning constraint.

---

## 4. Features that should be cut or deferred

### Defer most of Shopping Intelligence

The shopping pillar is disproportionate to the product and data reality. Tasks 6.1–9.1 introduce at least eight core tables plus offers, considerable AI extraction, OCR, catalog normalization, pantry inference, basket optimization and a large web surface. Yet the roadmap admits there is no durable price source.

Manual and receipt-derived prices cannot support credible cross-platform basket arbitrage or “buy now versus wait.” They produce sparse, stale, household-specific observations. A mathematically correct optimizer over bad data is still a bad feature.

Keep only:

- simple shopping lists;
- receipt capture into a reviewable ledger draft, if vision exists;
- budget impact before purchase.

Defer catalog canonicalization, basket arbitrage, price timing, pantry prediction and platform recommendation until a legitimate, demonstrably useful data source exists.

---

### Cut “goal-impact receipt” in its proposed form

“This cart delays your Emergency Fund by four days” is false precision. The existing projections use deterministic return assumptions and coarse monthly contributions. Translating one grocery cart into exact days suggests accuracy the model does not possess.

Show the concrete budget overage or equivalent portion of monthly surplus instead. That is both actionable and defensible.

---

### Defer AI goal-roadmap narrative

Task 4.3 adds little capability. The deterministic roadmap, shortfall and action amounts are the value. An LLM paraphrase increases privacy surface, event types, testing burden and failure modes without resolving a financial decision.

Ship good deterministic explanations first. Add narration only if usage data shows users cannot understand them.

---

### Remove direct stocks from default instrument guidance

Task 4.2 lists direct stocks alongside diversified funds as a candidate equity leg. That is a poor default for goal funding: concentrated security selection is not equivalent to an asset category suitable for a target-date glide path.

Compass has no research, diversification, volatility or suitability machinery. Direct stocks should be displayed as an existing exposure, not recommended as a funding route.

---

### Defer predictive pantry and consumption learning

Tasks 8.1 and 8.2 depend on reliable item identity and purchase quantities. Receipt OCR will have inconsistent names, units and pack sizes; the ledger itself usually records only the total transaction. The likely result is annoying, incorrect replenishment prompts.

Do not build this until receipt reconciliation has produced a substantial clean item history and measured canonicalization accuracy.

---

### Defer offer-email ingestion until the reward model is expanded

Task 7.3 can extract headline offers, but task 7.4 cannot recommend a card correctly from `earnRatePer100` and issuer matching. Product eligibility, MCC, network, caps, milestones and point value decide the outcome.

Offer storage alone becomes another inbox the user must maintain. Build product-level reward/offer rules first or defer both tasks.

---

### Defer Local-Brain packaging, especially bundled model provisioning

Ollama already exists. Bundling a pinned model creates large downloads, architecture-specific hardware problems, model licensing/versioning duties and an operational dependency outside the core financial experience. It also does not solve the stated lack of forced tool calling or vision.

Improve capability detection and honest fallbacks first. A “local-only egress policy” is useful; automatic model provisioning is not urgent.

---

### Reconsider arbitrary per-record sharing

Explicit grants on every account, budget, goal and derived child record create an authorization system closer to collaborative SaaS than a single-household finance app. The benefit is unclear relative to the privacy and backup complexity.

A smaller model—private person, shared household ledger, shared expense—would be easier to understand and safer. If arbitrary sharing remains, do not pretend it is a lightweight household layer.

---

## 5. Risks missed by “Known traps”

### Sharing cannot be solved by one SQL guard

Visibility is also embedded in:

- cache keys and invalidation in `services/cache.ts`;
- user-scoped exports in `services/backup.ts`;
- restore behavior in `services/restore-user.ts`;
- global search;
- derived net-worth snapshots;
- scheduled notifications and autopilot jobs;
- account and holding ownership assertions;
- transaction creation and linking;
- object-storage access.

A shared record may be readable by two users but writable only by its owner. Jobs must not send duplicate or private notifications to every household member. Revocation must invalidate every member’s cache. Portable restore must preserve or intentionally strip grants. None of this is covered by enumerating parent-scoped tables.

---

### Household balances are not the same as transaction amounts

For an expense paid by one member, the split liability is usually based on the expense magnitude, while the ledger transaction is a negative signed amount. Refunds, income, partial reimbursements, deleted transactions and a transaction paid from a shared account need explicit semantics.

“Shares sum to the transaction amount” is underspecified and may produce inverted debts. Settlement also should not simply “zero the pair’s balance” unless it records an amount equal to the current balance and handles later edits safely.

---

### Cross-user transactions break ownership assumptions

A shared split expense still belongs to one account and one ledger owner. Creating a settlement transfer across accounts owned by different users cannot reuse `createTransfer()` unchanged because that service requires both accounts to belong to the same user.

The task board assumes “settle-up records a transfer” without resolving this domain mismatch.

---

### The income-surplus model is highly vulnerable to double counting

Task 5.1 lists recurring bills, insurance premiums, EMIs and SIPs as committed outflows. Historical ledger expenses already include many of those. A naïve model will subtract historical expenses and then subtract their schedules again.

It also needs to distinguish:

- net salary from gross salary;
- bank-debit SIPs from payroll-funded EPF;
- credit-card purchases from card repayments;
- EMI principal from interest without counting the loan-account leg;
- annual premiums from monthly commitments;
- transfers from expenses.

The existing `getForecast()` in `services/cashflow.ts` carefully excludes recurring-sourced rows before adding scheduled obligations. Task 5.1 needs the same explicit accounting convention.

---

### Rebalancing cannot act on an account-level allocation model

`accountAllocationClass()` in `services/goal-allocation.ts` labels every generic `investment` account as equity and every NPS account as `other`. That is too coarse for actionable amounts. An investment account may contain debt; NPS already stores E/C/G percentages in `accountNpsDetails`.

Before issuing switches, the allocation engine must split composite instruments and stop inferring asset class from account type.

---

### Holding-wide tax classification can produce wrong advice

`holdings.gainsTaxClass` applies to the whole holding. `services/tax-lots.ts` explicitly documents the SGB failure case: exchange sale and RBI redemption can have different tax treatment but cannot coexist correctly in one holding.

Tax-aware rebalancing and advance-tax estimates cannot rely on this model without per-event disposal treatment.

---

### Historical tax-loss carry-forward is absent

Advance tax, harvesting and rebalancing need brought-forward and current-year losses, set-off ordering and carry-forward expiry. Capital-gains totals alone are insufficient. Ignoring losses can materially overstate tax and reverse a recommendation.

---

### Regulatory data needs effective-date granularity, not merely FY versioning

Some tax changes take effect mid-year or depend on acquisition and transfer date. `services/tax-lots.ts` already demonstrates this with the 23 July 2024 holding-period reform and the acquisition-date condition for section 50AA.

A rule table keyed only by financial year cannot represent all Indian tax law safely. Rules need effective dates and sometimes separate acquisition, transaction and assessment applicability.

---

### Tax provenance and user overrides need auditability

A reviewed payslip, AIS line, manual deduction and inferred transaction can disagree. The plan does not specify source priority, overrides, duplicate prevention or an audit trail showing why a tax figure was included.

Tax facts need provenance and review status comparable to `extractedTransactions`, not just computed totals.

---

### Reward optimization lacks the data needed to be truthful

`cardDetails.earnRatePer100` is a single integer, and `rewardEntries` is a point ledger. Neither point value nor earn eligibility exists. Task 7.4’s offer-cap boundary test is necessary but nowhere near sufficient.

Without product-level rules, the engine will compare cash discounts against points using invented or missing values.

---

### Price observations create privacy and trust problems

Household purchases reveal health conditions, religion, diet and children’s needs. Crowdsourcing observations would expand the privacy boundary beyond the self-hosted household. The roadmap does not define whether prices are instance-local, globally shared, anonymized, or exportable.

It also lacks outlier resistance, unit/pack-change handling and seller/location specificity. A 1 kg item and “1 pack” cannot safely share a canonical unit price merely because names match.

---

### Receipt OCR creates a new accounting ambiguity

One receipt can contain multiple budget categories, discounts, taxes, deposits, refunds and loyalty redemptions. Task 8.4 proposes one ledger transaction with a manually selected category, discarding the item-level category information required by budgets and pantry learning.

It should either create transaction splits or explicitly accept that receipt items are shopping metadata unrelated to ledger category totals.

---

### Insurance adequacy can become unsafe pseudo-advice

Human Life Value is not a single accepted formula. Existing cover may include endowment benefits, employer cover, decreasing loan cover and overlapping floaters. Liquid assets may already be earmarked for goals and should not automatically reduce required life cover.

The calculation must expose method, dependency duration, assumed income growth, inflation and assets excluded from offset. A configurable medical-inflation number alone is not adequate protection modelling.

---

### Scheduled reminders use UTC dates for an Indian product

`LEDGER_DAY_TZ = "Etc/UTC"` in `apps/api/src/jobs/index.ts` is deliberate and test-enforced, but reminder copy and due-date decisions therefore cross the day boundary at 05:30 IST. A bill due “today” can be described using the previous Indian calendar day before 05:30.

Migration must preserve current behavior, but India-facing tax and maturity deadlines need an explicit user/household timezone or IST business-date service. Extending the UTC convention blindly into advance-tax deadlines would be a product bug.

---

### Planning confidence does not account for stale or incomplete data

Goal allocation, insurance adequacy, tax and windfall advice will consume account balances, valuations and income without checking when they were last reconciled. Manual valuations can be old; a CSV may cover only one account; an MF folio may lack a current NAV.

Every advisory result needs input freshness and completeness warnings. The planned “confidence” handling appears only in income estimation, but it is a cross-cutting requirement.

---

### Backup coverage tests do not guarantee semantic restorability

Adding a table to `ALL_TABLES`/`USER_TABLES` only prevents omission. Household memberships, grants, shared children, document references and cross-user foreign keys create restore-order and identity-remapping problems that the current per-user archive model was not designed for.

`buildUserBackupStream()` exports one user’s directly owned and linked rows. A shared record owned by another user will either disappear or require copying data the exporting user does not own. The household design needs an explicit portable-export contract before schema work begins.