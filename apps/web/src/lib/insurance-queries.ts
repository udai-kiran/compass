import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  InsurancePolicySchema,
  PolicyPremiumsSchema,
  type CreateInsurancePolicy,
  type LogPremium,
  type UpdateInsurancePolicy,
} from "@compass/shared";
import { apiDelete, apiGet, apiPost, apiPut } from "./api.ts";

const PoliciesSchema = z.array(InsurancePolicySchema);

export function usePolicies() {
  return useQuery({
    queryKey: ["insurance-policies"],
    queryFn: () => apiGet("/api/insurance/policies", PoliciesSchema),
  });
}

export function usePolicyMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["insurance-policies"] });

  const create = useMutation({
    mutationFn: (body: CreateInsurancePolicy) =>
      apiPost("/api/insurance/policies", InsurancePolicySchema, body),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateInsurancePolicy }) =>
      apiPut(`/api/insurance/policies/${id}`, InsurancePolicySchema, body),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiDelete(`/api/insurance/policies/${id}`, z.object({ ok: z.boolean() })),
    onSuccess: invalidate,
  });

  const uploadDocument = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/insurance/policies/${id}/document`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        throw new Error(((await res.json()) as { message?: string }).message ?? "Upload failed");
      }
      return InsurancePolicySchema.parse(await res.json());
    },
    onSuccess: invalidate,
  });

  const removeDocument = useMutation({
    mutationFn: (id: string) =>
      apiDelete(`/api/insurance/policies/${id}/document`, InsurancePolicySchema),
    onSuccess: invalidate,
  });

  return { create, update, remove, uploadDocument, removeDocument };
}

export function usePolicyPremiums(policyId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["insurance-premiums", policyId],
    queryFn: () => apiGet(`/api/insurance/policies/${policyId}/premiums`, PolicyPremiumsSchema),
    enabled,
  });
}

export function useLogPremium(policyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LogPremium) =>
      apiPost(`/api/insurance/policies/${policyId}/premiums`, PolicyPremiumsSchema, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["insurance-premiums", policyId] });
      // The premium became a real expense on the paying account — its balance and
      // the ledger are now stale.
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}
