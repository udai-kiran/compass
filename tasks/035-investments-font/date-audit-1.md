# Date rendering audit — apps/web/src

**Date:** 2026-08-12  
**Scope:** Every `.tsx` file under `apps/web/src` — user-visible JSX content only.  
**Excluded:** `*.test.*`, `input value=`, API/query parameters, `console.log`, comments.

---

## What IS already formatted (baseline)

`formatDisplayDate` (YYYY-MM-DD → DD-Mon-YYYY) and `formatPeriodKey` (YYYY-MM → "Jan 2026") are used
correctly in: GoalsPage, TransactionDrawer, TasksPage, ReportsPage, SipsPage, TransactionsPage,
PortfolioPage (lastValuationDate only), TransactionPicker, EMIsPage, DateField.

---

## Raw ISO dates rendered without formatting

### 1. `apps/web/src/routes/insurance/PremiumsPanel.tsx:114`
Field: `p.date`  
```tsx
<span className="w-24 shrink-0 text-slate-500">{p.date}</span>
```
Renders the insurance premium payment date as raw `YYYY-MM-DD`.

---

### 2. `apps/web/src/routes/cashflow/CashFlowPage.tsx:203`
Field: `o.date`  
```tsx
<span className="text-slate-500">{o.date}</span>
```
Renders the upcoming scheduled payment date as raw `YYYY-MM-DD`.

---

### 3. `apps/web/src/routes/dashboard/DashboardPage.tsx:146`
Field: `t.date`  
```tsx
<span className="w-20 text-slate-400">{t.date}</span>
```
Renders the recent transaction date as raw `YYYY-MM-DD` in the dashboard "Recent" list.

---

### 4. `apps/web/src/routes/dashboard/DashboardPage.tsx:43,48`
Field: `data.month.periodKey`  
```tsx
label={`Income · ${data.month.periodKey}`}
// ...
label={`Spending · ${data.month.periodKey}`}
```
StatTile's `label` prop is rendered as `<p className="text-sm text-slate-500">{label}</p>`.
So the dashboard shows e.g. "Income · 2026-08" and "Spending · 2026-08" instead of "Income · Aug 2026".

---

### 5. `apps/web/src/routes/investments/PortfolioPage.tsx:321`
Field: `e.date`  
```tsx
<span className="w-24 text-slate-500">{e.date}</span>
```
Renders the investment event date as raw `YYYY-MM-DD` in the events list.

---

### 6. `apps/web/src/routes/cards/CardsPage.tsx:210`
Field: `card.dueDate`  
```tsx
<Stat label="Due date" value={card.dueDate ?? "—"} />
```
`Stat` renders `value` as `<p className="mt-0.5 text-sm font-medium text-slate-800">{value}</p>`.
Raw `YYYY-MM-DD` shown in card summary grid.

---

### 7. `apps/web/src/routes/cards/CardsPage.tsx:641`
Field: `r.date`  
```tsx
<span className="w-24 text-slate-500">{r.date}</span>
```
Renders the credit card reward event date as raw `YYYY-MM-DD`.

---

### 8. `apps/web/src/routes/bills/BillsPage.tsx:107`
Field: `b.dueDate`  
```tsx
<span className={`w-24 shrink-0 tabular-nums ${b.dueDate <= today ? "font-semibold text-red-700" : "text-slate-500"}`}>
  {b.dueDate}
</span>
```
Renders the bill due date as raw `YYYY-MM-DD` in the upcoming bills list.

---

### 9. `apps/web/src/routes/accounts/AccountLedgerPage.tsx:163`
Field: `txn.date`  
```tsx
<p className="text-xs text-slate-400">
  {txn.date}
  {categoryName ? ` · ${categoryName}` : ""}
</p>
```
Renders the ledger transaction date as raw `YYYY-MM-DD`.

---

### 10. `apps/web/src/routes/cards/CardDetailPage.tsx:58`
Field: `data.dueDate`  
```tsx
{data.dueDate ? `Due by ${data.dueDate}` : "No due date set"}
```
Visible in a `<p className="mt-1 text-xs text-rose-700/70">` element. Shows e.g. "Due by 2026-08-20".

---

### 11. `apps/web/src/routes/cards/CardDetailPage.tsx:59–60`
Fields: `data.statementStart`, `data.statementEnd`  
```tsx
{data.statementStart && data.statementEnd
  ? ` · statement ${data.statementStart} → ${data.statementEnd}`
  : ""}
```
Same `<p>` element as #10. Shows e.g. "· statement 2026-07-15 → 2026-08-14".

---

### 12. `apps/web/src/routes/cards/CardDetailPage.tsx:84`
Field: `data.dueDate`  
```tsx
hint={
  data.statementEnd
    ? `Billed${data.dueDate ? ` · due by ${data.dueDate}` : ""}`
    : "No statement cycle configured for this card."
}
```
The `hint` prop of `TxnSection` is rendered as visible section subtitle text. Shows e.g.
"Billed · due by 2026-08-20".

---

### 13. `apps/web/src/routes/cards/CardDetailPage.tsx:429`
Field: `t.date`  
```tsx
<p className="text-xs text-slate-400">
  {t.date}
  {catName(t.categoryId) ? ` · ${catName(t.categoryId)}` : ""}
</p>
```
Renders the card transaction date as raw `YYYY-MM-DD` in the card detail transaction list.

---

### 14. `apps/web/src/routes/settings/RecurringPanel.tsx:117`
Field: `t.nextDueDate`  
```tsx
{t.frequency}{t.interval > 1 ? ` ×${t.interval}` : ""} · next {t.nextDueDate} · {accName(t.accountId)} · {catName(t.categoryId)}
```
The JSX text node ` · next {t.nextDueDate}` renders the recurring transaction next due date as raw `YYYY-MM-DD`.

---

### 15. `apps/web/src/routes/settings/RecurringPanel.tsx:118`
Field: `t.endDate`  
```tsx
{t.endDate && ` · ends ${t.endDate}`}
```
Same `<p>` element as #14. Shows e.g. "· ends 2027-03-01".

---

### 16. `apps/web/src/routes/investments/CapitalGainsPage.tsx:247`
Field: `s.buyDate`  
```tsx
<td className="px-4 py-2 text-slate-600">{s.buyDate}</td>
```
Capital gains table "Buy date" column — raw `YYYY-MM-DD`.

---

### 17. `apps/web/src/routes/investments/CapitalGainsPage.tsx:248`
Field: `s.sellDate`  
```tsx
<td className="px-4 py-2 text-slate-600">{s.sellDate}</td>
```
Capital gains table "Sell date" column — raw `YYYY-MM-DD`.

---

### 18. `apps/web/src/components/CommandPalette.tsx:80` (rendered at line 144)
Field: `t.date`  
```tsx
// line 80 — hint string built here:
hint: `${t.date} · ${formatINR(t.amountPaise)}`
// line 144 — rendered here:
{item.hint && <span ...>{item.hint}</span>}
```
Transaction search results in the command palette show the raw `YYYY-MM-DD` date in the hint.

---

### 19. `apps/web/src/routes/budgets/BudgetsPage.tsx:35`
Field: `key` (a YYYY-MM period key)  
```tsx
<span className="w-20 text-center font-medium text-slate-700">{key}</span>
```
The budget period navigation header shows e.g. "2026-08" instead of "Aug 2026".

---

### 20. `apps/web/src/routes/budgets/BudgetsPage.tsx:94`
Field: `periodKey` (YYYY-MM)  
```tsx
<h2 className="text-sm font-semibold text-slate-700">Set up your {periodKey} budget</h2>
```
Budget wizard title shows e.g. "Set up your 2026-08 budget".

---

## Borderline / chart context

### `apps/web/src/lib/viz.tsx:256` (source: NetWorthPage.tsx:55)
Field: `labels[hoverI]` (where labels are YYYY-MM-DD strings from `nw.history.map(p => p.date)`)  
```tsx
<span className="ml-auto tabular-nums text-slate-500">
  {labels[hoverI]}:{" "}
  ...
</span>
```
The LineChart hover tooltip shows the full raw `YYYY-MM-DD`. Axis tick labels use `l.slice(5)` (MM-DD
only), which is less egregious but also not a human month-name format.

---

## Not a raw-date issue (correctly sliced or already formatted)

- `CardsPage.tsx:214–215`: `card.statementStart.slice(5) → card.statementEnd.slice(5)` — renders MM-DD,
  not a full ISO string; arguably should still use a formatter but is distinct from a full raw ISO dump.
- `GoalsPage.tsx:217–218`: uses `formatDisplayDate(goal.targetDate)` — correct.
- All `SipsPage.tsx` date renders: use `formatDisplayDate` — correct.
- `PortfolioPage.tsx:256`: `formatDisplayDate(h.lastValuationDate)` — correct.

---

## Summary table

| # | File | Line | Field | Shape |
|---|------|------|-------|-------|
| 1 | routes/insurance/PremiumsPanel.tsx | 114 | `p.date` | YYYY-MM-DD |
| 2 | routes/cashflow/CashFlowPage.tsx | 203 | `o.date` | YYYY-MM-DD |
| 3 | routes/dashboard/DashboardPage.tsx | 146 | `t.date` | YYYY-MM-DD |
| 4 | routes/dashboard/DashboardPage.tsx | 43, 48 | `data.month.periodKey` | YYYY-MM |
| 5 | routes/investments/PortfolioPage.tsx | 321 | `e.date` | YYYY-MM-DD |
| 6 | routes/cards/CardsPage.tsx | 210 | `card.dueDate` | YYYY-MM-DD |
| 7 | routes/cards/CardsPage.tsx | 641 | `r.date` | YYYY-MM-DD |
| 8 | routes/bills/BillsPage.tsx | 107 | `b.dueDate` | YYYY-MM-DD |
| 9 | routes/accounts/AccountLedgerPage.tsx | 163 | `txn.date` | YYYY-MM-DD |
| 10 | routes/cards/CardDetailPage.tsx | 58 | `data.dueDate` | YYYY-MM-DD |
| 11 | routes/cards/CardDetailPage.tsx | 59–60 | `data.statementStart`, `data.statementEnd` | YYYY-MM-DD |
| 12 | routes/cards/CardDetailPage.tsx | 84 | `data.dueDate` | YYYY-MM-DD |
| 13 | routes/cards/CardDetailPage.tsx | 429 | `t.date` | YYYY-MM-DD |
| 14 | routes/settings/RecurringPanel.tsx | 117 | `t.nextDueDate` | YYYY-MM-DD |
| 15 | routes/settings/RecurringPanel.tsx | 118 | `t.endDate` | YYYY-MM-DD |
| 16 | routes/investments/CapitalGainsPage.tsx | 247 | `s.buyDate` | YYYY-MM-DD |
| 17 | routes/investments/CapitalGainsPage.tsx | 248 | `s.sellDate` | YYYY-MM-DD |
| 18 | components/CommandPalette.tsx | 80 | `t.date` (in hint) | YYYY-MM-DD |
| 19 | routes/budgets/BudgetsPage.tsx | 35 | `key` | YYYY-MM |
| 20 | routes/budgets/BudgetsPage.tsx | 94 | `periodKey` | YYYY-MM |
| — | lib/viz.tsx | 256 | `labels[hoverI]` (LineChart tooltip) | YYYY-MM-DD |
