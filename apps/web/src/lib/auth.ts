import { useQuery } from "@tanstack/react-query";
import { BootstrapStatusSchema, UserSchema } from "@compass/shared";
import { apiGet } from "./api.ts";

/** Shared so the login flow can prime this exact cache entry with a real fetch. */
export const meQuery = {
  queryKey: ["me"] as const,
  queryFn: () => apiGet("/api/auth/me", UserSchema),
  retry: false,
};

export function useMe() {
  return useQuery({ ...meQuery, staleTime: 5 * 60_000 });
}

export function useBootstrapStatus() {
  return useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => apiGet("/api/auth/bootstrap", BootstrapStatusSchema),
    staleTime: Infinity,
  });
}
