import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BankDetailsSchema,
  RetirementDetailsSchema,
  type UpsertBankDetails,
  type UpsertRetirementDetails,
} from "@compass/shared";
import { apiGet, apiPut } from "./api.ts";

/**
 * Detail sections are per-type, so a query is only enabled for the types that
 * have one. Fetching bank details for a PPF account would 400 by design.
 */
export function useBankDetails(accountId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["bank-details", accountId],
    queryFn: () => apiGet(`/api/accounts/${accountId}/bank-details`, BankDetailsSchema.nullable()),
    enabled,
  });
}

export function useBankDetailsMutation(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertBankDetails) =>
      apiPut(`/api/accounts/${accountId}/bank-details`, BankDetailsSchema, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bank-details", accountId] });
      // The account number drives accounts.account_last4 — the list is now stale.
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useRetirementDetails(accountId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["retirement-details", accountId],
    queryFn: () =>
      apiGet(`/api/retirement/${accountId}/details`, RetirementDetailsSchema.nullable()),
    enabled,
  });
}

export function useRetirementDetailsMutation(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertRetirementDetails) =>
      apiPut(`/api/retirement/${accountId}/details`, RetirementDetailsSchema, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["retirement-details", accountId] }),
  });
}
