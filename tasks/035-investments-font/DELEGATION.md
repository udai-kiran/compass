# Sonnet Worker Delegation — date formatting sweep

## Task
035 — format all raw ISO dates across the web UI

## Approved Plan
Apply `formatDisplayDate` (YYYY-MM-DD → "DD-Mon-YYYY") and `formatPeriodKey`
(YYYY-MM → "Mon YYYY") to every raw ISO date render site found in the audit.
Both helpers are already exported from `@compass/shared`.

## Files and Changes

### 1. `apps/web/src/routes/insurance/PremiumsPanel.tsx`
- Import: add `formatDisplayDate` to the `@compass/shared` import line 2
- Line 114: `{p.date}` → `{formatDisplayDate(p.date)}`

### 2. `apps/web/src/routes/cashflow/CashFlowPage.tsx`
- Import: add `formatDisplayDate` to the `@compass/shared` import line 2
- Line 203: `{o.date}` → `{formatDisplayDate(o.date)}`

### 3. `apps/web/src/routes/dashboard/DashboardPage.tsx`
- Import: add `formatDisplayDate` and `formatPeriodKey` to the `@compass/shared` import line 2
- Line 43: `` `Income · ${data.month.periodKey}` `` → `` `Income · ${formatPeriodKey(data.month.periodKey)}` ``
- Line 48: `` `Spending · ${data.month.periodKey}` `` → `` `Spending · ${formatPeriodKey(data.month.periodKey)}` ``
- Line 146: `{t.date}` → `{formatDisplayDate(t.date)}`

### 4. `apps/web/src/routes/investments/PortfolioPage.tsx`
- `formatDisplayDate` is ALREADY imported
- Line 321: `{e.date}` → `{formatDisplayDate(e.date)}`

### 5. `apps/web/src/routes/cards/CardsPage.tsx`
- Import: add `formatDisplayDate` to the `@compass/shared` import block (line 3-11)
- Line 210: `value={card.dueDate ?? "—"}` → `value={card.dueDate ? formatDisplayDate(card.dueDate) : "—"}`
- Lines 214-215: `${card.statementStart.slice(5)} → ${card.statementEnd.slice(5)}` → `${formatDisplayDate(card.statementStart)} → ${formatDisplayDate(card.statementEnd)}`
- Line 641: `{r.date}` → `{formatDisplayDate(r.date)}`

### 6. `apps/web/src/routes/bills/BillsPage.tsx`
- Import: add `formatDisplayDate` to the `@compass/shared` import block
- Line 107: `{b.dueDate}` → `{formatDisplayDate(b.dueDate)}`

### 7. `apps/web/src/routes/accounts/AccountLedgerPage.tsx`
- Import: add `formatDisplayDate` to the `@compass/shared` import line 2
- Line 163: `{txn.date}` → `{formatDisplayDate(txn.date)}`

### 8. `apps/web/src/routes/cards/CardDetailPage.tsx`
- Import: add `formatDisplayDate` to the `@compass/shared` import block
- Line 58: `` `Due by ${data.dueDate}` `` → `` `Due by ${formatDisplayDate(data.dueDate)}` ``
- Lines 59-60: `` `statement ${data.statementStart} → ${data.statementEnd}` `` → `` `statement ${formatDisplayDate(data.statementStart)} → ${formatDisplayDate(data.statementEnd)}` ``
- Line 84: `` `Billed${data.dueDate ? ` · due by ${data.dueDate}` : ""}` `` → `` `Billed${data.dueDate ? ` · due by ${formatDisplayDate(data.dueDate)}` : ""}` ``
- Line 429: `{t.date}` → `{formatDisplayDate(t.date)}`

### 9. `apps/web/src/routes/settings/RecurringPanel.tsx`
- Import: add `formatDisplayDate` to the `@compass/shared` import line 2
- Line 117: ` · next {t.nextDueDate} ` → ` · next {formatDisplayDate(t.nextDueDate)} `
- Line 118: `` ` · ends ${t.endDate}` `` → `` ` · ends ${formatDisplayDate(t.endDate)}` ``

### 10. `apps/web/src/routes/investments/CapitalGainsPage.tsx`
- Import: add `formatDisplayDate` to the `@compass/shared` import block
- Line 247: `{s.buyDate}` → `{formatDisplayDate(s.buyDate)}`
- Line 248: `{s.sellDate}` → `{formatDisplayDate(s.sellDate)}`

### 11. `apps/web/src/components/CommandPalette.tsx`
- Import: add `formatDisplayDate` to the `@compass/shared` import line 4
- Line 80: `` `${t.date} · ${formatINR(...)}` `` → `` `${formatDisplayDate(t.date)} · ${formatINR(...)}` ``

### 12. `apps/web/src/routes/budgets/BudgetsPage.tsx`
- Import: add `formatPeriodKey` to the `@compass/shared` import line 2
- Line 34: `{key}` → `{formatPeriodKey(key)}`
- Line 94: `{periodKey}` → `{formatPeriodKey(periodKey)}`

## Must Not Change
- Any date used in input `value=` attributes (those need to stay as YYYY-MM-DD for the DateField/input)
- Any API query parameters
- Logic, conditions, or comparisons using raw date strings (e.g. `b.dueDate <= today` must stay raw)
- `CardsPage.tsx` lines 212-215 also has `card.statementStart.slice(5)` — update THAT slice to `formatDisplayDate(card.statementStart)` / `formatDisplayDate(card.statementEnd)` (already listed above)

## Required Evidence
- All 12 files listed in "Files and Changes"
- Complete diff (`git diff`)
- Exit code 0 from `npm run typecheck -w apps/web`
