# Frontend conventions

**Every task marked `ui: true` must be read alongside this file.** It exists because UI tasks are executed unattended by an agent that cannot ask clarifying questions — so the decisions that would otherwise be asked about are settled here, once.

## Stack — and what not to add

React 19 · React Router 8 (`createBrowserRouter`) · TanStack Query 5 · Tailwind v4 · Vite 8. Dependencies are deliberately minimal: `@tanstack/react-virtual`, `react-qr-code`, `@compass/shared`.

**Do not add a UI component library** (MUI, shadcn, Radix, Chakra, Headless UI). **Do not add a charting library** (Recharts, Chart.js, D3, Victory). **Do not add a form library, a date library, or an icon package.** Every primitive this app needs already exists in-repo, listed below. If something genuinely seems missing, build it in `src/components/` in the existing style rather than pulling in a dependency.

## The design system is CSS classes, not components

Defined in `src/index.css` and available globally:

| Class | Use |
|---|---|
| `.card` | `rounded-xl border border-slate-200 bg-white shadow-sm` — the standard container |
| `.input` | bordered text input with brand focus ring |
| `.btn-primary` | brand-filled primary action |
| `.btn-secondary` | bordered secondary action |
| `.badge` | rounded-full pill |
| `.no-print` | excluded from print styles |

There is **no `<Card>`, `<Button>` or `<Modal>` React component**. Use the classes.

## Components that do exist — reuse these

| Path | Exports |
|---|---|
| `src/components/States.tsx` | `PageLoading`, `PageError`, `EmptyState` — **always** use these for loading/error/empty |
| `src/components/CategoryPicker.tsx` | searchable hierarchical category selector (portal-rendered) |
| `src/components/DateField.tsx` | date input with typed parsing + calendar popover |
| `src/components/CommandPalette.tsx` | ⌘K palette; holds the `PAGES` list |
| `src/components/icons.tsx` | `Icon` + the **closed** `IconName` union |
| `src/lib/viz.tsx` | `Sparkline`, `Meter`, `Donut`, `LineChart`, `Columns`, `StatTile`, `SERIES`, `STATUS`, `compactINR` — hand-rolled SVG, the entire chart system |
| `src/lib/toast.tsx` | `toast(msg, "success" \| "error")` |
| `src/lib/institutions.tsx` | `InstitutionIcon`, `InstitutionDatalist` |

**Modals and drawers have no shared primitive** — each is open-coded as `fixed inset-0 z-{40,50}` with a backdrop. Copy the closest existing one:
- centered modal → `src/routes/transactions/RecordEpfModal.tsx` (best a11y template: `role="dialog" aria-modal="true"`)
- right-side drawer → `src/routes/transactions/TransactionDrawer.tsx`
- slide-over → `src/layouts/AppLayout.tsx`

## Adding a nav entry takes three coordinated edits

Miss any one and it either fails to compile or is silently unreachable:

1. **`src/layouts/AppLayout.tsx`** — add to the `NAV_GROUPS` array (`{ heading, items: [{ to, label, icon }] }`)
2. **`src/components/icons.tsx`** — add the name to the `IconName` union **and** an SVG case. The union is closed; TypeScript errors otherwise.
3. **`src/components/CommandPalette.tsx`** — add to `PAGES` so the route is ⌘K-reachable

## Data access

Query hooks live in `src/lib/<feature>-queries.ts` and follow one shape without exception:

```ts
export function useThings() { return useQuery({ queryKey: ["things"], queryFn: () => apiGet("/api/things", ThingsSchema) }); }
export function useThingMutations() {
  const qc = useQueryClient();
  const create = useMutation({ mutationFn: ..., onSuccess: () => qc.invalidateQueries({ queryKey: ["things"] }) });
  return { create, update, remove };
}
```

- Use `apiGet/apiPost/apiPut/apiPatch/apiDelete` from `src/lib/api.ts` — Zod-validated, throws `ApiError` with a status.
- **Types and schemas come from `@compass/shared`.** Never redeclare a shape the backend already defines.
- `api.ts` is **JSON-only**. File upload uses `FormData` + raw `fetch`, then `invalidateQueries` — copy `useAttachmentMutations().upload` in `src/lib/queries.ts`.
- Query errors already surface as toasts globally; do not add per-call error toasts.

## Rules that are not negotiable

- **Money is integer paise.** Format with `formatINR` from `@compass/shared`, or `compactINR` from `viz.tsx` for axes. **Never** build a rupee string by hand, and never do currency arithmetic in the component.
- **AI-dependent UI must disappear when AI is off.** Gate on `useCapabilities()`, as `Assistant.tsx` does by returning `null`. The page must remain fully usable without it.
- **Demo mode is read-only.** Mutations 403; surface that state rather than letting a click fail silently.
- **Extract pure logic into a tested sibling module.** Every route directory already does this (`repayment-eligibility.ts`, `card-warnings.ts`, `goal-date.ts`, `sip-recording.ts`). Selection, eligibility, formatting and derivation logic belongs in `<feature>-<thing>.ts` with a `.test.ts` next to it — not inline in JSX.
- **Never render a named financial product.** Planning surfaces show instrument *categories*, never a scheme, fund or AMC name.
- **Show assumptions.** Any projected or estimated figure displays its basis (return/inflation assumption, observation date, confidence) rather than presenting an estimate as fact.
- **Advisory tone, never scolding.** Shortfalls, overspending and missed savings are information with a next action — not a red banner telling the user off.

## Accessibility & responsiveness

- Modals: `role="dialog"`, `aria-modal="true"`, Escape closes, focus is trapped, backdrop click closes.
- Live regions for async state — `States.tsx` already wires `role="status"` / `role="alert"`.
- Every interactive element is keyboard-reachable; icon-only buttons need `aria-label`.
- Sidebar collapses to a hamburger drawer below `md`. **Test at narrow width** — tables and charts must scroll inside their own container, never make the page scroll horizontally.

## Verification before a UI task is done

```bash
npm run typecheck
npm run lint
npm run test -w apps/web
npm run build -w apps/web
```

All four must pass. `npm run build` catches the closed-union and unreachable-route mistakes that `tsc --noEmit` alone can miss.

## Working style for unattended runs

- Make the reasonable decision and proceed; there is no one to ask.
- Prefer extending an existing page over creating a parallel one — `/goals` gains planning panels rather than a new `/planning` route.
- Match the surrounding code's density, naming and comment style. Read the neighbouring file before writing a new one.
- Leave the working tree building. A half-finished component that breaks `npm run build -w apps/web` blocks everyone.
