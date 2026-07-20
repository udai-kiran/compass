import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BankDetailsSchema,
  InsuranceDetailsSchema,
  OverdraftDetailsSchema,
  PolicyPremiumsSchema,
  RetirementDetailsSchema,
  type LogPremium,
  type UpsertBankDetails,
  type UpsertInsuranceDetails,
  type UpsertOverdraftDetails,
  type UpsertRetirementDetails,
} from "@compass/shared";
import { apiGet, apiPost, apiPut } from "./api.ts";

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

export function useOverdraftDetails(accountId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["overdraft-details", accountId],
    queryFn: () =>
      apiGet(`/api/accounts/${accountId}/overdraft-details`, OverdraftDetailsSchema.nullable()),
    enabled,
  });
}

export function useOverdraftDetailsMutation(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertOverdraftDetails) =>
      apiPut(`/api/accounts/${accountId}/overdraft-details`, OverdraftDetailsSchema, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["overdraft-details", accountId] }),
  });
}

export function useInsuranceDetails(accountId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["insurance-details", accountId],
    queryFn: () =>
      apiGet(`/api/accounts/${accountId}/insurance-details`, InsuranceDetailsSchema.nullable()),
    enabled,
  });
}

export function useInsuranceDetailsMutation(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertInsuranceDetails) =>
      apiPut(`/api/accounts/${accountId}/insurance-details`, InsuranceDetailsSchema, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["insurance-details", accountId] }),
  });
}

export function usePolicyPremiums(accountId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["insurance-premiums", accountId],
    queryFn: () =>
      apiGet(`/api/accounts/${accountId}/insurance-premiums`, PolicyPremiumsSchema),
    enabled,
  });
}

export function useLogPremiumMutation(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LogPremium) =>
      apiPost(`/api/accounts/${accountId}/insurance-premiums`, PolicyPremiumsSchema, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["insurance-premiums", accountId] });
      // The premium became a real expense on the paying account — its balance and
      // the ledger are now stale.
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}
