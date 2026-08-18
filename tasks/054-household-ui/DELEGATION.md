# Sonnet Worker Delegation — Task 054: Household UI

## Task
054 — Household switcher & management page (nav entry, query hooks, HouseholdPage, route).

## Approved Plan
- P1: Add "household" icon to icons.tsx (use a SVG group/home-family icon)
- P2: Add "Household" nav item to AppLayout.tsx NAV_GROUPS (in "Setup" group)
- P3: Add household to CommandPalette.tsx PAGES array
- P4: Create apps/web/src/lib/household-queries.ts with query hooks
- P5: Create apps/web/src/routes/household/HouseholdPage.tsx
- P6: Add lazy import + route to main.tsx
- P7: npm run typecheck + build

## Files and Symbols

### Modify
- `apps/web/src/components/icons.tsx` — add "household" to IconName union + SVG path
- `apps/web/src/layouts/AppLayout.tsx` — add { to: "/household", label: "Household", icon: "household" } in "Setup" group
- `apps/web/src/components/CommandPalette.tsx` — add household to PAGES
- `apps/web/src/main.tsx` — add lazy HouseholdPage import + route

### Create
- `apps/web/src/lib/household-queries.ts`
- `apps/web/src/routes/household/HouseholdPage.tsx`

## Required Changes

### 1. icons.tsx — add "household" to IconName

Find the IconName type (it's a union of string literals). Add `"household"` to it.

Find the Icon component's switch/map that maps names to SVGs. Add a household case.
Use this SVG path for a "people/household" icon:
```
// A simple house with people icon (using heroicons "user-group" style)
case "household":
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
    </svg>
  );
```

First read icons.tsx to understand the exact pattern before editing.

### 2. AppLayout.tsx — add to Setup group

In the NAV_GROUPS array, find the "Setup" group and add:
```ts
{ to: "/household", label: "Household", icon: "household" }
```

### 3. CommandPalette.tsx — add to PAGES

Read the file to find where PAGES array is. Add:
```ts
{ to: "/household", label: "Household", icon: "household" }
```
(or whatever the exact object shape is in that file)

### 4. lib/household-queries.ts

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  AcceptInviteSchema,
  CreateHouseholdSchema,
  HouseholdInviteSchema,
  HouseholdMemberSchema,
  HouseholdSchema,
  UpdateHouseholdSchema,
  type AcceptInvite,
  type CreateHousehold,
  type UpdateHousehold,
} from "@compass/shared";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api.ts";
import { toast } from "./toast.tsx";

export function useHouseholds() {
  return useQuery({
    queryKey: ["households"],
    queryFn: () => apiGet("/api/households", z.array(HouseholdSchema)),
  });
}

export function useHouseholdMembers(householdId: string | undefined) {
  return useQuery({
    queryKey: ["household-members", householdId],
    queryFn: () => apiGet(`/api/households/${householdId}/members`, z.array(HouseholdMemberSchema)),
    enabled: !!householdId,
  });
}

export function useHouseholdMutations() {
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: (body: CreateHousehold) =>
      apiPost("/api/households", HouseholdSchema, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["households"] });
      toast("Household created", "success");
    },
    onError: (err: Error) => toast(err.message),
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateHousehold }) =>
      apiPatch(`/api/households/${id}`, HouseholdSchema, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["households"] });
      toast("Household updated", "success");
    },
    onError: (err: Error) => toast(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/households/${id}`, z.object({ ok: z.boolean() })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["households"] });
      toast("Household deleted", "success");
    },
    onError: (err: Error) => toast(err.message),
  });

  const invite = useMutation({
    mutationFn: (householdId: string) =>
      apiPost(`/api/households/${householdId}/invite`, HouseholdInviteSchema, {}),
    onSuccess: () => toast("Invite created", "success"),
    onError: (err: Error) => toast(err.message),
  });

  const acceptInvite = useMutation({
    mutationFn: (body: AcceptInvite) =>
      apiPost("/api/households/invites/accept", HouseholdSchema, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["households"] });
      toast("Joined household!", "success");
    },
    onError: (err: Error) => toast(err.message),
  });

  const leave = useMutation({
    mutationFn: (householdId: string) =>
      apiPost(`/api/households/${householdId}/leave`, z.object({ ok: z.boolean() }), {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["households"] });
      toast("Left household", "success");
    },
    onError: (err: Error) => toast(err.message),
  });

  const removeMember = useMutation({
    mutationFn: ({ householdId, memberId }: { householdId: string; memberId: string }) =>
      apiDelete(`/api/households/${householdId}/members/${memberId}`, z.object({ ok: z.boolean() })),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["household-members", vars.householdId] });
      toast("Member removed", "success");
    },
    onError: (err: Error) => toast(err.message),
  });

  return { create, update, remove, invite, acceptInvite, leave, removeMember };
}
```

Note: Check if `apiPost` with empty body `{}` compiles — it might need the body typed. Look at existing examples (e.g., leave/invite don't need a request body). Check how other mutations do void-body POSTs.

### 5. routes/household/HouseholdPage.tsx

A functional management page. Look at an existing page like `routes/goals/GoalsPage.tsx` for the pattern (page layout, States component for loading/error/empty).

The page should:
- Show user's households (useHouseholds)
- For each household, show member list (useHouseholdMembers)
- Let user create a new household
- Let household owner generate an invite token (show the token in a copyable input)
- Let user accept an invite by pasting a token
- Let user leave a household (with confirmation)

Keep it simple — a single-column layout with clear sections. Don't try to build a sophisticated UI; focus on functionality.

```tsx
import { useState } from "react";
import { useHouseholdMembers, useHouseholdMutations, useHouseholds } from "../../lib/household-queries.ts";
// ... (full implementation)
```

Key UI elements:
- "Your Households" heading with a "Create Household" button
- Empty state: "You're not in any household yet. Create one or accept an invite."
- For each household: name, member list, "Invite" button, "Leave" button
- "Accept Invite" section with a text input for the token
- Simple confirmation before destructive actions (leave/remove)

Look at how other pages handle loading/error states — likely a `States` component or similar.

### 6. main.tsx — add route

First read main.tsx to understand all lazy imports. Add:
```ts
const HouseholdPage = lazy(() =>
  import("./routes/household/HouseholdPage.tsx").then((m) => ({ default: m.HouseholdPage })),
);
```

And in the router config (find where routes are defined), add:
```ts
{ path: "/household", element: <HouseholdPage /> },
```
(wrapped in the AppLayout element, like other pages)

## Must Not Change
- Any backend files
- Any existing query hooks in other files
- Snapshot files

## Acceptance Criteria
- AC1: "Household" appears in nav sidebar and Command+K
- AC2: /household route renders the HouseholdPage
- AC3: useHouseholds, useHouseholdMembers, useHouseholdMutations all exported
- AC4: npm run typecheck exits 0
- AC5: npm run build -w apps/web exits 0

## Commands
1. Read icons.tsx to understand the SVG pattern: `head -100 apps/web/src/components/icons.tsx`
2. Read CommandPalette.tsx to find PAGES array structure: `head -60 apps/web/src/components/CommandPalette.tsx`
3. Read main.tsx fully to understand route config pattern: `wc -l apps/web/src/main.tsx` then read
4. After all edits: `cd /work/personal/compass && npm run typecheck 2>&1 | grep -E "error|Exit" | tail -20`
5. Build: `cd /work/personal/compass && npm run build -w apps/web 2>&1 | tail -20`

## Required Evidence
- List of all files changed
- typecheck output + exit code
- build output + exit code
- Any deviations or blockers

Write findings to `/work/personal/compass/tasks/054-household-ui/verification-1.md`
