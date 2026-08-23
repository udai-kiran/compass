**Findings**

1. High: AC5 is not implemented. The task requires ambiguous catalog matches to be surfaced with candidate names and a “not this” escape hatch ([TASK.md](/work/personal/compass/tasks/078-shopping-ui-lists/TASK.md:107), [TASK.md](/work/personal/compass/tasks/078-shopping-ui-lists/TASK.md:96)). The implementation adds a `canonicalize` mutation in [shopping-queries.ts](/work/personal/compass/apps/web/src/lib/shopping-queries.ts:168), but neither `ListsPage` nor `CapturePanel` calls it. Captured items are committed with `catalogItemId: null` in [CapturePanel.tsx](/work/personal/compass/apps/web/src/routes/shopping/CapturePanel.tsx:139), and there is no candidate-name rendering or “not this” action. This leaves AC5 and P7 incomplete.

2. Medium: The current worktree violates the delegation scope if these changes are part of task 078. The task objective says “no backend changes” ([TASK.md](/work/personal/compass/tasks/078-shopping-ui-lists/TASK.md:7)), and DELEGATION explicitly says not to change `apps/api/` or `packages/shared/` ([DELEGATION.md](/work/personal/compass/tasks/078-shopping-ui-lists/DELEGATION.md:157)). `git status` shows modified/untracked API files and `packages/shared/src/schemas/shopping.ts`. If those are unrelated local changes, they should be excluded from the task handoff; if they were made for 078, that is a scope violation.

3. Low: The “no lists” empty state does not use `EmptyState` as required by P6/AC6. The selected-list panel uses `EmptyState`, but the actual no-list condition in the sidebar renders a plain paragraph in [ListsPage.tsx](/work/personal/compass/apps/web/src/routes/shopping/ListsPage.tsx:728). P6 specifically calls for `EmptyState` when there are no lists ([TASK.md](/work/personal/compass/tasks/078-shopping-ui-lists/TASK.md:85)).

**AC/P Coverage**

P1-P4 / AC1: Implemented. Icons, nav group, command palette entries, lazy imports, and route entries are present.

P5: Mostly implemented. `useShoppingUnits` is preserved; list, catalog, mutation, parse-text, and raw FormData parse-image hooks exist. Note: the task text says `useShoppingLists()` should parse `{ lists: [...] }`, but the current backend route returns a bare array, so the implementation matches the actual route contract.

P6 / AC2 / AC6 / AC9: Mostly implemented. CRUD, full PUT bodies, mark-bought, delete, add, and complete reorder IDs are present. AC6 has the no-list `EmptyState` gap above.

P7 / AC3 / AC4 / AC5 / AC8 / AC10: Partially implemented. Paste/photo parse, preview, explicit commit, raw image upload, file `accept` and `capture` are present. AI-disabled controls are disabled after capabilities load. Ambiguous catalog review is missing.

P8: Implemented. Placeholder pages exist and use `EmptyState`.

P9 / AC13: Not verified in this read-only review. I did not run typecheck, lint, tests, or build.

AC7: No package manifest changes were shown in the requested web diff, so no new dependencies appear to have been added.

Security/privacy: I did not see sensitive data logging or cross-user data exposure in the reviewed frontend files. The image upload uses raw `fetch` with `FormData`, as required.