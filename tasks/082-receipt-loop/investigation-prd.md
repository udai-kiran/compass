# PRD & Tasks Search: 11.4 and 12.2

## Task 11.4: Receipt OCR → cart reconcile → ledger

**Source:** `/work/personal/compass/tasks/11.04-receipt-loop.md`

**Canonical Definition:**
- **ID:** 11.4
- **Title:** Receipt OCR → cart reconcile → ledger
- **Phase:** 11 — Smart cart
- **Release:** 2.3.0
- **Status:** todo
- **Dependencies:** [8.1 (AI vision), 11.2 (predictive cart)]

**Scope:**
Closes the loop: photograph a real receipt, reconcile it against the drafted cart, and post the actual purchase to the ledger through the existing import/inbox review path. Confirmed purchases replenish the pantry and sharpen consumption rates.

**Core Rules:**
- Category stays manual — no auto-categorization for shopping
- Nothing reaches the ledger without explicit accept (like email-extracted transactions)

**Key Deliverables:**
- Receipt photo → line items via vision path (8.1)
- Reconciliation reports extra, missing, and price-differing items
- Accepted purchase becomes ledger transaction with manually chosen category
- Confirmed purchase replenishes pantry and updates consumption rates
- Unreadable receipt degrades to manual entry (no error page)
- Emits `ledger.mutated` event for cache/budget reactions

---

## Task 12.2: Cart review screen

**Source:** `/work/personal/compass/tasks/12.02-cart-review-ui.md`

**Canonical Definition:**
- **ID:** 12.2
- **Title:** Cart review screen
- **Phase:** 12 — Shopping surface
- **Release:** 2.3.0
- **Status:** todo (UI task, `ui: true`)
- **Dependency:** [11.3 (financial guards)]

**Scope:**
Centrepiece of the shopping surface; direct descendant of `InboxPage.tsx`. Pre-filled editable draft cards with provenance strip, action bar, and escape hatches.

**Display Requirements (before accept):**
- Platform split with delivery fees, minimum-cart thresholds, **delivery ETA** (from 10.2)
- Recommended card with offer cap arithmetic visible: *"10% back, capped ₹1,500 — you reach the cap at ₹15,000"*
- **Budget cap** overage and **goal-impact** figure from 11.3
- Every price with source and observation time (crowdsourced data not presented as live truth)

**Critical Non-Feature:**
- Nothing is ordered and nothing is paid
- No "Buy" affordance (button would be a lie)
- Makes clear user accepts a draft only

---

## PRD.md Search Results

Only **one direct match** for core shopping concepts in `/work/personal/compass/PRD.md`:

- **Line 64:** Receipt attachments (listed under Transaction Management features)

**Finding:** The PRD.md is feature-overview level and does not contain detailed task specifications. The canonical task definitions live in the individual task files (11.04-receipt-loop.md, 12.02-cart-review-ui.md) and the phased roadmap in tasks/README.md.

---

## tasks/README.md Search Results

**"receipt"** (7 occurrences):
- Line 35: References closing "the loop from recommendation to receipt to realized saving" (2.4.0 release theme)
- Line 87: Core rule: "Category stays manual, including on receipt-derived transactions"
- Line 90: Prices from "user entry, receipt OCR and official affiliate APIs"
- Line 157: Task 11.3 title includes "goal-impact receipt & EMI guard"
- Line 158: **Task 11.4** — "Receipt OCR → cart reconcile → ledger"
- Line 230: References 11.4 in the Codex review resolution section

**"cart review"** (1 occurrence):
- Line 160: **Task 12.2** — "Cart review screen"

**"reconcil"** (5 occurrences):
- Line 61: Historical reconciliation as a cost during migration
- Line 112: Task 2.6 — "Ledger invariants & reconciliation guard"
- Line 132: Task 6.3 — "Data-completeness & reconciliation health"
- Line 158: **Task 11.4** — "Receipt OCR → cart reconcile → ledger"
- Line 167, 175: Tasks 13.5 and 13.13 (EPF and AIS reconciliation)

---

## Dependency Chain

**11.4 depends on:**
- **8.1** (AI vision support) — photograph receipt → OCR line items
- **11.2** (predictive cart) — receipt reconciles against draft cart

**12.2 depends on:**
- **11.3** (financial guards) — budget cap and goal-impact figures displayed before accept

**Cross-phase impact:**
- 11.4 emits `ledger.mutated` event (relates to 0.2 domain event bus)
- 11.4 replenishes pantry (relates to 11.1 consumption-rate model)
- 12.2 displays serviceability/ETA from 10.2
- 12.2 displays reward cap arithmetic (relates to 10.5 reward-model)
