import { useQuery } from "@tanstack/react-query";
import { InsightsSchema } from "@compass/shared";
import { apiGet } from "./api.ts";

export function useInsights(period: string) {
  return useQuery({
    queryKey: ["insights", period],
    queryFn: () => apiGet(`/api/insights?period=${period}`, InsightsSchema),
  });
}
