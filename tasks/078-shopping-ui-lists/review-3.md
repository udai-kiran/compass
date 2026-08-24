**Findings**

1. Medium: `CapturePanel` canonicalizes pre-existing list items, not only the items just added. In [CapturePanel.tsx](/work/personal/compass/apps/web/src/routes/shopping/CapturePanel.tsx:120), `seenItemIds` starts empty, but each `addItem` response is the full list with items. On the first successful add, the loop at [CapturePanel.tsx](/work/personal/compass/apps/web/src/routes/shopping/CapturePanel.tsx:160) treats every existing item in the list as “new” and queues it for `canonicalize.mutate` at [CapturePanel.tsx](/work/personal/compass/apps/web/src/routes/shopping/CapturePanel.tsx:181). That is outside the requested “for each added item” behavior and can silently link older pending items when the user only committed the current capture batch.

**Checked Fixes**

The `ListsPage` canonicalize UI is otherwise scoped to AC5: the `Link` button appears only for pending unlinked items, calls the existing mutation, surfaces ambiguous candidates, resolves names from `useShoppingCatalog()`, and provides the requested `not this` dismiss path.

The no-lists replacement at [ListsPage.tsx](/work/personal/compass/apps/web/src/routes/shopping/ListsPage.tsx:791) correctly uses `EmptyState` with a create action and does not introduce unrelated behavior.

No other scope creep found in the inspected areas.