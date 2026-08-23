# Task: 13.9 — Tax Deadline Nudges

## Status
PLAN_REVIEW

## Pre-hardening (from sibling reviews; Codex review pending)
**Owns the alert pipeline** (096 ships only the pure `computeDueAlerts()`): this task implements the daily scheduled evaluator, `createNotification` call, boot catch-up, and claim-then-notify ordering (write alert_ledger + notification atomically; a notification failure must not leave a permanent dedup tombstone). Registering a new date-sensitive scheduler requires the jobs framework classification — follow the existing scheduler registration pattern in `apps/api/src/jobs/index.ts`.

**Alert keys**: kind uses kebab-case (`tax-80c-headroom`, `ppf-minimum`, `fy-end-reminder`, `advance-tax-q1..q4`); refKey is occurrence-specific: `{fy}:{tier}` for escalating 80C tiers (bare FY would suppress distinct tiers), `{accountId}:{fy}` for PPF, `{fy}` for instalments (kind already distinguishes quarter).

**Suppression semantics**: new-regime users get an explicit informational message ("80C/80D deductions don't apply under the new regime") surfaced through the GET endpoint — never silently hidden, never as an alert.

**Never fire without actionable headroom**: 80C nudge requires headroomPaise > 0 AND regime='old' AND FY not ended; PPF nudge requires statusCode='discontinued_risk'; advance-tax nudge requires computeDueAlerts() to return the instalment (liability ≥ effective-dated threshold from tax-rules.ts, senior exemption not applied).

**Escalation tiers**: 60/30/7 days before 31 March; each tier is its own refKey so escalation re-alerts exactly once per tier.

**Estimates**: every nudge payload carries isEstimate + FY basis.

## Objective
Regime-gated, alert_ledger-deduped nudges for 80C/80D headroom (old regime only), PPF minimum before dormancy, advance tax instalments, and year-end filing deadline.

## Root Cause
No nudge system for tax deadlines exists. Under the new regime (default since FY 2023-24), 80C headroom prompts would be actively wrong — users need the regime context to gate prompts.

## Scope

### Pure computation (no new DB tables)
`apps/api/src/modules/tax/services/tax-nudges.ts`

**Nudges defined**:

1. **80C headroom** (OLD REGIME ONLY):
   - Fire when: headroomPaise > 0 AND FY not ended AND user regime = 'old'
   - Message: "You have ₹{X} remaining 80C headroom before 31 March {year}"
   - Escalate: 60 days before FY end → 30 days → 7 days
   - Suppress: if regime='new', show "80C deductions don't apply under the new regime" as informational (not an alert)
   - Alert kind: 'tax_80c_headroom'; refKey: `{fy}:{days_tier}` (dedup by tier)

2. **PPF minimum** (from scheme-compliance):
   - Fire when: statusCode='discontinued_risk' AND FY not ended
   - Message: "Your PPF account needs ₹{deficit} before 31 March to avoid discontinuation"
   - Alert kind: 'ppf_minimum'; refKey: `{accountId}:{fy}`

3. **Advance tax instalments** (from advance-tax.ts):
   - Fire 14 days before each due date when net liability > 0
   - Already handled by advance-tax task (096); this task only adds the 80C/PPF nudges

4. **FY end general reminder**:
   - Fire 7 days before 31 March
   - Message: "Financial year ends in 7 days. Review your tax planning."
   - Alert kind: 'fy_end_reminder'; refKey: fy

### Scheduled job integration
Add to `apps/api/src/jobs/index.ts` — daily cron job checking nudge conditions for all users.

### Routes (relative paths in tax plugin)
- `GET /tax-nudges?fy=` — list pending nudges for user (read-only, not duplicating alert_ledger data)

## Dependencies
- 13.7 (deduction basket — 80C headroom) — task 093
- 13.8 (regime comparison — regime gate) — task 094
- 13.6 (scheme compliance — PPF status) — task 092

## Plan
- P1: Create tax-nudges.ts service (pure condition evaluation)
- P2: Create daily cron job (or integrate into existing scheduler)
- P3: Create GET /tax-nudges route
- P4: Wire plugin
- P5: Tests: old-regime fires, new-regime suppressed, PPF discontinued_risk fires, dedup (no double alerts), FY-end escalation

## Acceptance Criteria
- AC1: 80C headroom alerts only fire for old-regime users
- AC2: New-regime users see regime-appropriate message (not headroom bar)
- AC3: PPF minimum fires when discontinued_risk
- AC4: Alert_ledger dedup prevents duplicate nudges per (user, kind, refKey)
- AC5: Alerts escalate as FY end approaches (3 tiers)
- AC6: typecheck + lint + test green

## Non-Goals
- ELSS lock-in alerts (deferred)
- 80D headroom alerts (deferred)
- Personalised priority ordering of nudges
