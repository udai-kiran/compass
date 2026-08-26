import { useQuery } from "@tanstack/react-query";
import {
  InsuranceAdequacyReportSchema,
  MaturityCalendarSchema,
  ContinuityDossierSchema,
} from "@compass/shared";
import { apiGet } from "./api.ts";

export function useAdequacy() {
  return useQuery({
    queryKey: ["insurance-adequacy"],
    queryFn: () => apiGet("/api/insurance/adequacy", InsuranceAdequacyReportSchema),
  });
}

export function useMaturityCalendar() {
  return useQuery({
    queryKey: ["maturity-calendar"],
    queryFn: () => apiGet("/api/protection/calendar", MaturityCalendarSchema),
  });
}

export function useDossier() {
  return useQuery({
    queryKey: ["continuity-dossier"],
    queryFn: () => apiGet("/api/protection/dossier", ContinuityDossierSchema),
  });
}
