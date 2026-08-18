import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  HouseholdBalancesSchema,
  SettlementSchema,
  CreateSettlementSchema,
  type CreateSettlement,
} from "@compass/shared";
import { apiGet, apiPost } from "./api.ts";
import { toast } from "./toast.tsx";

export function useHouseholdBalances(householdId: string | undefined) {
  return useQuery({
    queryKey: ["household-balances", householdId],
    queryFn: () => apiGet(`/api/households/${householdId}/balances`, HouseholdBalancesSchema),
    enabled: !!householdId,
  });
}

export function useSettlements(householdId: string | undefined) {
  return useQuery({
    queryKey: ["settlements", householdId],
    queryFn: () => apiGet(`/api/households/${householdId}/settlements`, z.array(SettlementSchema)),
    enabled: !!householdId,
  });
}

export function useCreateSettlement(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSettlement) =>
      apiPost(`/api/households/${householdId}/settlements`, SettlementSchema, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["household-balances", householdId] });
      void qc.invalidateQueries({ queryKey: ["settlements", householdId] });
      toast("Settlement recorded", "success");
    },
    onError: (err: Error) => toast(err.message),
  });
}

// Re-export schema for convenience
export { CreateSettlementSchema };
