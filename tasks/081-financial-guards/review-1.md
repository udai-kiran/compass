## High

1. **EMI rate units are wrong and would understate interest by 100×.**  
   The plan defines `annualRatePct`, but [`standardEmiPaise`](/work/personal/compass/packages/shared/src/money.ts:36) accepts integer `annualRateBps` (`1200` means 12%). Passing `12` would calculate 0.12%. Use `annualRateBps` throughout. Processing fees should likewise use integer basis points or an explicit paise amount, not floating-point `processingFeePct`.

   The financial model is also incomplete:

   - Define `totalRepaymentPaise`, `interestPaise`, `feesPaise`, and `extraCostPaise`; `totalCostPaise` versus `trueCostPaise` is currently ambiguous.
   - `emiPaise * tenureMonths - principal` can produce rounding errors because the last installment should be adjusted. Reuse [`amortize`](/work/personal/compass/apps/api/src/modules/credit/services/emis.ts:38), or calculate an adjusted final installment.
   - A “no-cost” comparison needs enough input to compare against cash purchase: cash price, financed principal, merchant EMI discount/subvention, processing fee, and applicable taxes. The current `totalPricePaise` and rate cannot prove the offer is genuinely no-cost.
   - The parent requirement explicitly mentions opportunity cost, but the task plan omits it entirely.
   - Multiple `emiOffers` need an offer identifier/index in each result.

2. **The goal-impact calculation has no defined financial counterfactual.**  
   `computeGoalImpact(db, userId, amountPaise)` does not say what the purchase displaces. Subtracting the full cart amount from every goal’s corpus would falsely count the same money multiple times; reducing every goal’s monthly inflow is equally unjustified. The plan must define whether the purchase:

   - reduces a particular goal’s current corpus,
   - consumes one month’s investable surplus,
   - or is allocated across goals using the existing priority/allocation rules.

   Baseline and counterfactual projections should then be compared using the same assumptions. The response should expose those assumptions rather than presenting delay as fact.

   Existing APIs cannot safely be composed as proposed:

   - [`listGoals`](/work/personal/compass/apps/api/src/modules/planning/services/goals.ts:77) includes archived goals.
   - [`getGoalProgress`](/work/personal/compass/apps/api/src/modules/planning/services/goals.ts:275) reloads accounts, portfolio, contribution history, settings, and commitments for every goal.
   - It also calls [`checkGoalMilestones`](/work/personal/compass/apps/api/src/modules/planning/services/goals.ts:357), so a supposedly read-only guard can write notifications.
   - Its `projectedMonths` is rounded to one decimal month, which is too coarse for a reliable day-level delta.
   - [`projectGoal`](/work/personal/compass/apps/api/src/modules/planning/services/goal-projection.ts:78) is pure and suitable for the counterfactual, but the plan needs a side-effect-free bulk loader that supplies its raw inputs.

   Exclude archived and already-completed goals and explicitly handle undated, unreachable, zero-inflow, past-target, and baseline-unreachable cases. `delayDays` likely needs to be nullable or accompanied by an applicability/status discriminator.

## Medium

1. **The budget-cap plan does not match `getUtilization` or rollover semantics.**  
   [`getUtilization`](/work/personal/compass/apps/api/src/modules/planning/services/budgets.ts:178) requires both `period` and `key`; the proposed function supplies neither. The plan should explicitly use the current monthly period—or explain how annual versus monthly budgets are selected.

   Other missing rules:

   - A category must be selected to satisfy “grocery envelope.” Optional `categoryId` leaves it unclear whether the cart is checked against all budget lines.
   - Spending is grouped by exact category ID in [`spentByCategory`](/work/personal/compass/apps/api/src/lib/periods.ts:59); parent grocery budgets do not automatically include child-category spend.
   - The live available amount is `budgetedPaise + carryPaise`, as shown by [`remainingPaise`](/work/personal/compass/apps/api/src/modules/planning/services/budgets.ts:191). Returning only `budgetedPaise`, `spentPaise`, and `remainingPaise` hides rollover and makes the result difficult to reconcile.
   - Define whether `overBudgetPaise` is the final envelope overage or only the incremental overage attributable to this cart, especially when the budget is already overspent.
   - Validate that a supplied category belongs to the session user and distinguish “category has no budget line” from a genuine zero-value budget.

2. **The schemas are substantially underspecified.**  
   P1 mentions only result/response schemas, but repository rules require shared request and response contracts. Add a shared `FinancialGuardsRequestSchema` and EMI-offer input schema and consume them in the route and eventual web hook.

   Required constraints and fields include:

   - safe nonnegative integer paise values, following the existing `.safe()` helper pattern in [`shopping.ts`](/work/personal/compass/packages/shared/src/schemas/shopping.ts:22);
   - UUID validation for category and offer identifiers;
   - integer bounded `annualRateBps`, tenure, fee basis points, and a maximum EMI-offer array size;
   - explicit absence/applicability states, such as `budget: null`, `goals: []`, and `emis: []`;
   - `goalId`, not only mutable/non-unique `goalName`;
   - baseline/projected completion dates or months, assumptions, and nullable/unreachable handling;
   - enough EMI fields to map each output to its input offer and reconcile principal, repayments, interest, fees, discounts, and extra cost.

   “Overage stated in rupees” should mean returning an amount, not a boolean. The API should retain integer paise and the UI should use `formatINR`; it should not return manually assembled currency strings.

3. **The proposed test plan is inadequate and internally inconsistent.**  
   P4 calls these “pure function tests,” but `checkBudgetCap` and `computeGoalImpact` are DB-backed. The no-budget and no-goal cases are also persistence behavior. Add:

   - real-DB service integration tests for current-period selection, rollover, existing overspend, exact category selection, no line/no budget, archived goals, user isolation, and absence of notification side effects;
   - pure tests for the counterfactual goal-delay calculation, including completed, undated, unreachable, zero-rate, zero-inflow, sub-day, and rounding boundaries;
   - EMI invariant/property tests showing repayments reconcile to principal + interest and all results remain safe integers;
   - schema tests for invalid/unsafe paise, fractional rates, invalid tenure, excessive offer arrays, and response variants;
   - route tests for authentication, validation, response-schema conformance, multiple offers, 200 responses for advisory warnings, and no-data degradation;
   - assertions for both route snapshots.

4. **`POST /guards/check` is structurally reasonable, but it has an unaddressed demo-mode problem.**  
   The shopping plugin requires relative paths, so the route must register `"/guards/check"` and resolve to `POST /api/shopping/guards/check`, consistent with [`plugin.ts`](/work/personal/compass/apps/api/src/modules/shopping/plugin.ts:21).

   However, the global auth guard rejects every POST for demo sessions via [`MUTATING_METHODS`](/work/personal/compass/apps/api/src/plugins/auth.ts:16), even though this endpoint is read-only. The plan must either:

   - provide an explicit, narrowly scoped demo-safe computation mechanism in the auth policy, or
   - choose a genuinely read-only transport.

   Without this, the cart guard silently becomes unavailable in demo mode. Also introduce a DB-backed orchestration service so the route remains validation/session plumbing only.

5. **The dependency list does not reflect the implementation.**  
   As currently designed, task 081 does **not** depend on 079: the endpoint accepts `cartTotalPaise`, not a draft ID, and uses no cart-draft schema or service. It can be built independently. If the intended security/integrity model is to accept `draftId` and derive the authoritative total server-side, then 079 becomes a real dependency and the plan must add draft ownership/status checks.

   Task 075 is also not used by the proposed implementation, and task 6.6 is a rebalancing plan, not the projection primitive being consumed. The real prerequisites are the existing budget utilization, goal projection/progress inputs, and EMI math. The task-board dependency metadata should be corrected accordingly.

6. **Trusting a caller-provided cart total weakens integrity.**  
   There is no direct cross-user disclosure because planning queries are user-scoped, but a client can submit any amount/category combination and receive a result unrelated to the displayed draft. Decide whether this is intentionally a generic calculator. If it is meant to guard a particular cart, accept `draftId`, load its total under `userId`, require an active draft, and avoid trusting client-derived totals.

## Low

1. **Plugin and snapshot scope needs to be explicit.**  
   Register the new route in [`shopping/plugin.ts`](/work/personal/compass/apps/api/src/modules/shopping/plugin.ts:27). “Route snapshots” should name both:

   - `apps/api/src/route-surface.snapshot.txt`
   - `apps/api/src/route-table.snapshot.txt`

   A route-level test should prove the plugin exposes the resolved path.

2. **`backup.ts` does not need modification for task 081 as currently scoped.**  
   Financial guards add no table or stored file, so the plan correctly omits [`backup.ts`](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:32). Existing backup tests already enforce exhaustive table coverage. Only add backup work if guard results or audit history become persisted.

3. **The listed implementation inputs contain unused or misleading scope.**  
   `goal-plan.ts` and task 6.6 rebalancing are not needed merely to run `projectGoal`; conversely, the available credit amortization service is listed as optional even though it is needed to avoid repayment-rounding errors and produce a defensible interest breakdown. Tighten the scope so each imported module has a defined role.

4. **“Inform, never block” needs an observable acceptance test.**  
   Specify that over-budget, delayed-goal, and expensive-EMI outcomes still return HTTP 200 and never produce an order/checkout decision. Validation, authentication, and infrastructure failures may still return errors; AC4 should not be worded as though malformed or unauthorized requests must always succeed.