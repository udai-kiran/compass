**Plan Review: Task 078**

Findings, ordered by impact:

1. Existing `shopping-queries.ts` is not a new file  
   The task says to create `apps/web/src/lib/shopping-queries.ts`, but it already exists and exports `shoppingUnitsQuery` / `useShoppingUnits`, with tests in `shopping-queries.test.ts`. The implementation plan should say “extend existing file and tests,” not create a fresh query module. Replacing it risks deleting the current unit-query behavior and test coverage.

2. Verification is missing the required web test command  
   `tasks/UI.md` requires UI work to finish with:
   `npm run typecheck`, `npm run lint`, `npm run test -w apps/web`, and `npm run build -w apps/web`.  
   Task 078’s verification and AC8 omit `npm run test -w apps/web`. That is a convention violation, especially because `shopping-queries.ts` already has a colocated test file that should be extended.

3. Acceptance criteria are not in TDD checklist form  
   `tasks/TDD.md` says every unchecked acceptance criterion becomes a test and gets ticked only after passing. Task 078 lists `AC1`, `AC2`, etc., but not as checkbox items. That weakens the project’s normal workflow and makes “status source of truth” harder to enforce. Convert ACs to `- [ ]`.

4. `apiPost` cannot handle `parse-image` upload  
   The plan says `useParseImage()` posts `FormData`, but `apps/web/src/lib/api.ts` JSON-stringifies every `apiPost` body and sets `content-type: application/json`. For `POST /api/shopping/parse-image`, the hook must use raw `fetch` with `FormData`, matching the attachment/import upload patterns. It should parse `ParseListImageResponseSchema` manually and surface non-OK `{ message }` errors.

5. Backend shared contracts must be reused, not recreated  
   `packages/shared/src/schemas/shopping.ts` already defines the needed schemas and types:
   `ShoppingListSchema`, `ShoppingListWithItemsSchema`, `CreateShoppingListSchema`, `UpdateShoppingListSchema`, `CreateShoppingListItemSchema`, `UpdateShoppingListItemSchema`, `ReorderItemsSchema`, `ParseListTextResponseSchema`, `ParseListImageResponseSchema`, `CatalogItemSchema`, `CatalogMatchResultSchema`, `CanonicalizeItemResponseSchema`, and `ShoppingUnitsResponseSchema`.  
   The plan should explicitly require these imports from `@compass/shared`.

6. Full-replace `PUT` contracts are easy to misuse  
   `PUT /shopping/lists/:id` requires `name`, `note`, and `status`.  
   `PUT /shopping/lists/:id/items/:itemId` requires `rawText`, `catalogItemId`, `quantityBase`, `unit`, and `status`.  
   The plan says “rename,” “archive,” and “mark-bought,” but does not call out that these mutations must send the complete current object, not a partial patch. Otherwise simple UI actions will 400.

7. Catalog scope is incomplete  
   The task mentions consuming `GET /api/shopping/catalog` and canonicalize, but the backend also exposes `GET /api/shopping/catalog/match?q=`. For ambiguous review, relying only on `candidateIds` from canonicalize means the UI needs local catalog lookup by id. The plan should specify how candidate IDs are resolved to names, or add a `useCatalogMatch(q)` / catalog lookup strategy. “Ambiguous catalog matches shown” is underspecified without this.

8. AI capability behavior is inconsistent with UI conventions  
   `tasks/UI.md` says AI-dependent UI must disappear when AI is off, gated on `useCapabilities()`. The task says `available: false → graceful message (no AI configured)`. Those can coexist, but the plan needs to define the behavior: the list page remains usable, while paste/photo capture controls either hide when the relevant capability is off or render a disabled explanatory state. Do not rely only on calling a mutating AI parse endpoint and then handling `available: false`.

9. Demo-mode mutation failures need explicit scope  
   UI conventions say demo mode mutations 403 and the UI must surface that state. This task has many mutations: create/rename/archive/delete list, add/edit/delete/reorder/mark item, parse text, parse image, canonicalize, commit parsed items. The plan only says toast mutation feedback generally. Add an acceptance criterion that demo-mode failures are visible and do not leave optimistic local state stuck.

10. Loading/error/empty state scope is broader than stated  
   AC6 says use `States.tsx`, but the plan only mentions `EmptyState`. It should require `PageLoading`, `PageError`, and `EmptyState` for list loading, selected-list loading, catalog/units errors, empty lists collection, empty selected list, empty parse result, and placeholder pages. Current nearby files sometimes use inline states, but Task 078 explicitly requires `States.tsx`.

11. No tests acceptance conflicts with task workflow  
   The task says “Tests for UI components (no test infrastructure for React components in this repo)” as a non-goal. That is fine for component rendering tests, but it does not excuse all tests. For this task, tests should target query options/hooks where possible and pure sibling logic for selection, reorder orderedIds, parsed-item editing/removal, commit payload building, and ambiguous-match display derivation. Existing `shopping-queries.test.ts` demonstrates this exact pattern.

12. Reorder edge cases need definition  
   Backend requires `orderedIds` to be exactly the current item IDs, no missing/foreign/duplicate IDs. The plan says “simple position swap,” but should specify that bought/dropped items are included in the full order payload, disabled controls at boundaries, and stale list data is handled by refetch/error rather than sending a partial subset.

13. Capture commit needs atomicity expectations  
   “Paste → preview → commit; nothing saved before confirmation” is clear, but commit likely means multiple `POST /lists/:id/items` calls because the backend has no bulk add route. The plan should define partial failure behavior: whether it stops on first failure, reports how many were added, invalidates/refetches the list, and prevents double-submit. Without this, “commit” can silently add half a preview.

14. Parse failure and empty parse result handling is underspecified  
   Shared contracts say parse routes can return `available: true` with `items: []` and a `message` on malformed/bad model output or unreadable photo, not necessarily throw. The plan should explicitly cover:
   empty parsed items,
   `available: false`,
   network/API errors,
   schema validation failures from `apiGet/apiPost`,
   unsupported image type / too-large image errors from parse-image,
   clearing stale preview after a failed parse.

15. Photo input scope needs file validation UX  
   Backend accepts jpeg/png/webp only and enforces a max size. The plan only says `capture="environment"`. It should also require `accept="image/jpeg,image/png,image/webp"` or equivalent, handle clearing/reselecting the same file, and display upload/parse pending state.

16. Quantity/unit UI needs more detail  
   Shopping quantities are stored in base units only: `g`, `ml`, `piece`, and `quantityBase` must be paired with `unit`. The plan says edit parsed/list items, but not how quantities are displayed or edited. It should avoid float money-like mistakes and should preserve the pair invariant. If user-facing `kg`/`litre` inputs are used, use shared conversion utilities rather than ad hoc math.

17. Placeholder route acceptance is incomplete  
   The plan adds Cart, Pantry, and Price Watch placeholder pages and command palette entries. AC1 covers reachability, but there is no acceptance criterion that the three placeholders render correctly via `EmptyState`, have no backend calls, and do not imply implemented behavior.

18. Navigation route naming is mostly correct, but label/icon assumptions need confirmation  
   The closed `IconName` union and `PATHS` record must both be updated. Adding `"pricewatch"` is valid only if used exactly everywhere. Consider whether the existing naming style would prefer `"priceWatch"`; current icons are lowercase simple strings like `"cashflow"` and `"networth"`, so `"pricewatch"` is acceptable if consistent across `IconName`, `PATHS`, `NAV_GROUPS`, and `PAGES`.

19. Tailwind/component convention risks  
   The task should explicitly forbid adding drag/icon/UI/form libraries, which it does via AC7. Also ensure implementation uses existing global classes like `.card`, `.input`, `.btn-primary`, `.btn-secondary`, `.badge` where appropriate. No lucide/icon package; icons must be inline SVG paths in `components/icons.tsx`.

20. Missing accessibility acceptance criteria  
   The plan mentions neither keyboard nor narrow viewport behavior. Given this page includes list selection, item editing, reorder controls, file capture, and possibly a 2-step panel, add ACs for keyboard-reachable controls, `aria-label` on icon-only buttons, disabled pending states, narrow viewport layout without horizontal page scroll, and focus behavior if any dialog/drawer is introduced.

Recommended additions to acceptance criteria:

- `npm run test -w apps/web` passes.
- Existing `shopping-queries.ts` is extended, preserving `useShoppingUnits` and its tests.
- Parse-image uses raw `fetch` + `FormData`, validates with `ParseListImageResponseSchema`, and handles 400/413/415 errors.
- All shared shopping request/response schemas come from `@compass/shared`; no duplicated backend shapes.
- Full-replace list/item updates include all required fields.
- Empty, loading, and error states use `PageLoading`, `PageError`, and `EmptyState`.
- Empty parse results, parse unavailable, parse errors, unsupported image type, and partial commit failures are visibly handled.
- Capture controls are gated or disabled appropriately when AI capabilities are unavailable; list CRUD remains usable with AI off.
- Demo-mode mutation failures are visible and do not leave stale optimistic UI.
- Reorder sends the complete ordered ID set and handles first/last/stale-list edge cases.
- Placeholder Cart/Pantry/Price Watch routes render reachable `EmptyState` pages only.
- Keyboard and narrow viewport behavior are verified.