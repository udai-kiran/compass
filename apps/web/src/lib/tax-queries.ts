/**
 * tax-queries.ts — TanStack Query hooks for the Tax surface (task 13.14).
 *
 * Types come straight from @compass/shared; every response is Zod-validated by
 * apiGet. Statement review mutations only flip the statement's own status —
 * reconciliation is never auto-applied to the ledger, so invalidating the
 * statements list is the whole story.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  AdvanceTaxPositionSchema,
  DeductionBasketSchema,
  RegimeComparisonSchema,
  TaxStatementDetailSchema,
  TaxStatementListSchema,
} from "@compass/shared";
import { apiDelete, apiGet, apiPost } from "./api.ts";

export function useDeductionBasket(fy: string) {
  return useQuery({
    queryKey: ["tax", "deductions", fy],
    queryFn: () => apiGet(`/api/tax/deductions?fy=${fy}`, DeductionBasketSchema),
  });
}

export function useRegimeComparison(fy: string) {
  return useQuery({
    queryKey: ["tax", "regime-comparison", fy],
    queryFn: () => apiGet(`/api/tax/regime-comparison?fy=${fy}`, RegimeComparisonSchema),
  });
}

export function useAdvanceTax(fy: string) {
  return useQuery({
    queryKey: ["tax", "advance-tax", fy],
    queryFn: () => apiGet(`/api/tax/advance-tax?fy=${fy}`, AdvanceTaxPositionSchema),
  });
}

export function useTaxStatements(fy: string) {
  return useQuery({
    queryKey: ["tax", "statements", fy],
    queryFn: () => apiGet(`/api/tax/statements?fy=${fy}`, TaxStatementListSchema),
  });
}

export function useTaxStatementDetail(id: string | null) {
  return useQuery({
    queryKey: ["tax", "statements", "detail", id],
    enabled: id != null,
    queryFn: () =>
      apiGet(
        `/api/tax/statements/${id}`,
        TaxStatementDetailSchema,
      ),
  });
}

export function useTaxStatementMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["tax", "statements"] });
  const accept = useMutation({
    mutationFn: (id: string) => apiPost(`/api/tax/statements/${id}/accept`, TaxStatementDetailSchema),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: (id: string) => apiPost(`/api/tax/statements/${id}/reject`, TaxStatementDetailSchema),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiDelete<{ ok: true }>(`/api/tax/statements/${id}`, z.object({ ok: z.literal(true) })),
    onSuccess: invalidate,
  });
  return { accept, reject, remove };
}
