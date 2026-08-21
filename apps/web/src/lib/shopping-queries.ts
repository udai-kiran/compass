import { useQuery } from "@tanstack/react-query";
import { ShoppingUnitsResponseSchema } from "@compass/shared";
import { apiGet } from "./api.ts";

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
