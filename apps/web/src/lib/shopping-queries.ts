import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CanonicalizeItemResponseSchema,
  BuyNowVsWaitSchema,
  CatalogItemSchema,
  HabitProfileListResponseSchema,
  ParseListImageResponseSchema,
  ParseListTextResponseSchema,
  PantryListResponseSchema,
  PriceHistoryResponseSchema,
  PriceHonestyResultSchema,
  PriceSourceSchema,
  ShoppingListSchema,
  ShoppingListWithItemsSchema,
  ShoppingUnitsResponseSchema,
  type CreateShoppingList,
  type CreateShoppingListItem,
  type CorrectPantry,
  type ParseListTextRequest,
  type ReplenishPantry,
  type ReorderItems,
  type UpdateShoppingList,
  type UpdateShoppingListItem,
} from "@compass/shared";
import { z } from "zod";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "./api.ts";

/**
 * Query options for the normalized-unit vocabulary, exported separately from the
 * hook so a plain `node --test` can assert the key, path and schema without a
 * React renderer — a test that only exercised `apiGet` would still pass if this
 * hook were deleted or pointed at the wrong URL.
 *
 * Server-owned and effectively static, so it is cached indefinitely rather than
 * refetched per mount.
 */
export const shoppingUnitsQuery = {
  queryKey: ["shopping", "units"] as const,
  queryFn: () => apiGet("/api/shopping/units", ShoppingUnitsResponseSchema),
  staleTime: Infinity,
};

export function useShoppingUnits() {
  return useQuery(shoppingUnitsQuery);
}

// ─── Shopping lists ───────────────────────────────────────────────────────────

/**
 * Query options for all shopping lists, exported so tests can assert the key
 * and path without a renderer.
 */
export const shoppingListsQuery = {
  queryKey: ["shopping", "lists"] as const,
  queryFn: () => apiGet("/api/shopping/lists", z.array(ShoppingListSchema)),
};

export function useShoppingLists() {
  return useQuery(shoppingListsQuery);
}

/**
 * Fetch a single shopping list with its ordered items.
 * Only fires when `id` is a non-empty string.
 */
export function useShoppingList(id: string | null) {
  return useQuery({
    queryKey: ["shopping", "lists", id] as const,
    queryFn: () => apiGet(`/api/shopping/lists/${id!}`, ShoppingListWithItemsSchema),
    enabled: !!id,
  });
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

/**
 * Query options for the user's catalog items, exported for tests.
 */
export const shoppingCatalogQuery = {
  queryKey: ["shopping", "catalog"] as const,
  queryFn: () => apiGet("/api/shopping/catalog", z.array(CatalogItemSchema)),
};

export function useShoppingCatalog() {
  return useQuery(shoppingCatalogQuery);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useShoppingListMutations() {
  const qc = useQueryClient();

  function invalidateLists() {
    return qc.invalidateQueries({ queryKey: ["shopping", "lists"] });
  }

  function invalidateList(id: string) {
    return qc.invalidateQueries({ queryKey: ["shopping", "lists", id] });
  }

  /** Create a new shopping list. */
  const create = useMutation({
    mutationFn: (body: CreateShoppingList) =>
      apiPost("/api/shopping/lists", ShoppingListSchema, body),
    onSuccess: () => invalidateLists(),
  });

  /** Full-replace update of a list (name + note + status). */
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateShoppingList }) =>
      apiPut(`/api/shopping/lists/${id}`, ShoppingListSchema, body),
    onSuccess: () => invalidateLists(),
  });

  /** Delete a list (cascades to items). */
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiDelete(`/api/shopping/lists/${id}`, z.object({ ok: z.boolean() })),
    onSuccess: () => invalidateLists(),
  });

  /** Add an item to a list. Returns the full list with updated items. */
  const addItem = useMutation({
    mutationFn: ({ listId, body }: { listId: string; body: CreateShoppingListItem }) =>
      apiPost(`/api/shopping/lists/${listId}/items`, ShoppingListWithItemsSchema, body),
    onSuccess: (_, { listId }) => invalidateList(listId),
  });

  /** Full-replace update of a list item. Returns the full list. */
  const updateItem = useMutation({
    mutationFn: ({
      listId,
      itemId,
      body,
    }: {
      listId: string;
      itemId: string;
      body: UpdateShoppingListItem;
    }) =>
      apiPut(`/api/shopping/lists/${listId}/items/${itemId}`, ShoppingListWithItemsSchema, body),
    onSuccess: (_, { listId }) => invalidateList(listId),
  });

  /** Remove an item from a list. Returns the full list. */
  const removeItem = useMutation({
    mutationFn: ({ listId, itemId }: { listId: string; itemId: string }) =>
      apiDelete(`/api/shopping/lists/${listId}/items/${itemId}`, ShoppingListWithItemsSchema),
    onSuccess: (_, { listId }) => invalidateList(listId),
  });

  /**
   * Reorder all items of a list.
   * `orderedIds` must be EXACTLY the full set of current item IDs (all statuses).
   */
  const reorder = useMutation({
    mutationFn: ({ listId, body }: { listId: string; body: ReorderItems }) =>
      apiPut(`/api/shopping/lists/${listId}/items/reorder`, ShoppingListWithItemsSchema, body),
    onSuccess: (_, { listId }) => invalidateList(listId),
  });

  /**
   * Try to match a list item against the catalog and link it.
   * Returns the updated item and the match result.
   */
  const canonicalize = useMutation({
    mutationFn: ({ listId, itemId }: { listId: string; itemId: string }) =>
      apiPost(
        `/api/shopping/lists/${listId}/items/${itemId}/canonicalize`,
        CanonicalizeItemResponseSchema,
      ),
    onSuccess: (_, { listId }) => invalidateList(listId),
  });

  return { create, update, remove, addItem, updateItem, removeItem, reorder, canonicalize };
}

// ─── AI capture mutations ─────────────────────────────────────────────────────

/** Parse a text snippet into candidate shopping items. */
export function useParseText() {
  return useMutation({
    mutationFn: (body: ParseListTextRequest) =>
      apiPost("/api/shopping/parse-text", ParseListTextResponseSchema, body),
  });
}

/**
 * Parse a photo into candidate shopping items.
 * Must use raw `fetch` + `FormData` — `apiPost` JSON-serializes, which breaks
 * multipart uploads.
 */
export function useParseImage() {
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/shopping/parse-image", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        let message = res.statusText;
        try {
          const body: unknown = await res.json();
          if (typeof body === "object" && body !== null && "message" in body) {
            message = String((body as { message: unknown }).message);
          }
        } catch {
          // non-JSON error body
        }
        throw new ApiError(res.status, message);
      }
      return ParseListImageResponseSchema.parse(await res.json());
    },
  });
}

// ─── Pantry queries (task 12.3) ──────────────────────────────────────────────

/** Fetch pantry items with habit profiles. */
export function usePantryItems() {
  return useQuery({
    queryKey: ["shopping", "pantry"] as const,
    queryFn: () => apiGet("/api/shopping/pantry", PantryListResponseSchema),
  });
}

/** Fetch all habit profiles. */
export function useHabitProfiles() {
  return useQuery({
    queryKey: ["shopping", "habits"] as const,
    queryFn: () => apiGet("/api/shopping/habits", HabitProfileListResponseSchema),
  });
}

/**
 * Pantry mutations — correct and replenish.
 * CRITICAL: Both return 204 with no body. Use raw fetch, not apiPost.
 * On success, invalidate both ["shopping", "pantry"] and ["shopping", "habits"].
 */
export function usePantryMutations() {
  const qc = useQueryClient();

  function invalidatePantry() {
    void qc.invalidateQueries({ queryKey: ["shopping", "pantry"] });
    void qc.invalidateQueries({ queryKey: ["shopping", "habits"] });
  }

  const correct = useMutation({
    mutationFn: async ({ catalogItemId, body }: { catalogItemId: string; body: CorrectPantry }) => {
      const res = await fetch(`/api/shopping/pantry/${catalogItemId}/correct`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let message = res.statusText;
        try {
          const b: unknown = await res.json();
          if (typeof b === "object" && b !== null && "message" in b)
            message = String((b as { message: unknown }).message);
        } catch {
          // empty
        }
        throw new ApiError(res.status, message);
      }
    },
    onSuccess: () => invalidatePantry(),
  });

  const replenish = useMutation({
    mutationFn: async ({
      catalogItemId,
      body,
    }: {
      catalogItemId: string;
      body: ReplenishPantry;
    }) => {
      const res = await fetch(`/api/shopping/pantry/${catalogItemId}/replenish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let message = res.statusText;
        try {
          const b: unknown = await res.json();
          if (typeof b === "object" && b !== null && "message" in b)
            message = String((b as { message: unknown }).message);
        } catch {
          // empty
        }
        throw new ApiError(res.status, message);
      }
    },
    onSuccess: () => invalidatePantry(),
  });

  return { correct, replenish };
}

// ─── Price Watch queries (task 12.3) ──────────────────────────────────────────

/** Fetch all price sources (for name resolution). */
export function usePriceSources() {
  return useQuery({
    queryKey: ["shopping", "sources"] as const,
    queryFn: () => apiGet("/api/shopping/sources", z.array(PriceSourceSchema)),
    staleTime: 5 * 60_000,
  });
}

/** Fetch price history for a catalog item. */
export function usePriceHistory(itemId: string | null, sourceId?: string) {
  const qs = sourceId ? `?sourceId=${sourceId}` : "";
  return useQuery({
    queryKey: ["shopping", "price-history", itemId, sourceId ?? null] as const,
    queryFn: () =>
      apiGet(`/api/shopping/catalog/${itemId!}/price-history${qs}`, PriceHistoryResponseSchema),
    enabled: !!itemId,
  });
}

/** Fetch buy-now-vs-wait recommendation. */
export function useBuyWait(itemId: string | null, sourceId?: string) {
  const qs = sourceId ? `?sourceId=${sourceId}` : "";
  return useQuery({
    queryKey: ["shopping", "buy-wait", itemId, sourceId ?? null] as const,
    queryFn: () => apiGet(`/api/shopping/catalog/${itemId!}/buy-wait${qs}`, BuyNowVsWaitSchema),
    enabled: !!itemId,
  });
}

/**
 * Fetch honesty check for a claimed MRP. Only fires when claimedMrpPaise > 0.
 * Route is GET with query params (not POST).
 */
export function useHonestyCheck(itemId: string | null, claimedMrpPaise: number, sourceId?: string) {
  const params = new URLSearchParams();
  params.set("claimedMrpPaise", String(claimedMrpPaise));
  if (sourceId) params.set("sourceId", sourceId);
  return useQuery({
    queryKey: ["shopping", "honesty", itemId, claimedMrpPaise, sourceId ?? null] as const,
    queryFn: () =>
      apiGet(
        `/api/shopping/catalog/${itemId!}/honesty-check?${params.toString()}`,
        PriceHonestyResultSchema,
      ),
    enabled: !!itemId && claimedMrpPaise > 0,
  });
}
