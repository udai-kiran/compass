import { useQuery } from "@tanstack/react-query";
import { BootstrapStatusSchema, UserSchema } from "@compass/shared";
import { apiGet } from "./api.ts";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet("/api/auth/me", UserSchema),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useBootstrapStatus() {
  return useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => apiGet("/api/auth/bootstrap", BootstrapStatusSchema),
    staleTime: Infinity,
  });
}
