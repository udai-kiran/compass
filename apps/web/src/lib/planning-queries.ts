import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  GlidePathScheduleSchema,
  InstrumentGuidanceSchema,
  RebalancingPlanSchema,
  TaxAwareRebalancingPlanSchema,
  MultiGoalAllocationPlanSchema,
  IncomeAdequacyReportSchema,
} from "@compass/shared";
import { apiGet } from "./api.ts";

const RoadmapNarrativeSchema = z
  .object({ narrative: z.string(), generatedAt: z.string() })
  .nullable();

export function useGlidePath(goalId: string, enabled = true) {
  return useQuery({
    queryKey: ["glide-path", goalId],
    queryFn: () => apiGet(`/api/goals/${goalId}/glide-path`, GlidePathScheduleSchema),
    enabled,
  });
}

export function useInstrumentGuidance(
  goalId: string,
  leg: "equity" | "debt",
  horizonMonths?: number,
  enabled = true,
) {
  const params = new URLSearchParams({ leg });
  if (horizonMonths !== undefined) params.set("horizonMonths", String(horizonMonths));
  return useQuery({
    queryKey: ["instrument-guidance", goalId, leg, horizonMonths],
    queryFn: () =>
      apiGet(`/api/goals/${goalId}/instrument-guidance?${params}`, InstrumentGuidanceSchema),
    enabled,
  });
}

export function useRebalancingPlan(goalId: string) {
  return useQuery({
    queryKey: ["rebalancing-plan", goalId],
    queryFn: () => apiGet(`/api/goals/${goalId}/rebalancing-plan`, RebalancingPlanSchema),
  });
}

export function useTaxAwareRebalancing(goalId: string, enabled = true) {
  return useQuery({
    queryKey: ["tax-aware-rebalancing", goalId],
    queryFn: () =>
      apiGet(`/api/goals/${goalId}/tax-aware-rebalancing`, TaxAwareRebalancingPlanSchema),
    enabled,
  });
}

export function useRoadmapNarrative(goalId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["roadmap-narrative", goalId],
    queryFn: () => apiGet(`/api/goals/${goalId}/roadmap-narrative`, RoadmapNarrativeSchema),
    enabled,
    staleTime: 5 * 60 * 1000, // narrative is expensive — cache for 5 min
  });
}

export function useMultiGoalAllocation() {
  return useQuery({
    queryKey: ["multi-goal-allocation"],
    queryFn: () => apiGet("/api/planning/multi-goal-allocation", MultiGoalAllocationPlanSchema),
  });
}

export function useIncomeAdequacy() {
  return useQuery({
    queryKey: ["income-adequacy"],
    queryFn: () => apiGet("/api/planning/income-adequacy", IncomeAdequacyReportSchema),
  });
}
