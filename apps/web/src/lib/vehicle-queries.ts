import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  CreateOdometerReadingSchema,
  MarkServiceDoneSchema,
  OdometerReadingSchema,
  UpdateVehicleServiceConfigSchema,
  VehicleOverviewSchema,
  VehicleServiceConfigSchema,
  VehicleSummarySchema,
  VehicleTransactionCandidateSchema,
  type CreateOdometerReading,
  type MarkServiceDone,
  type UpdateVehicleServiceConfig,
} from "@compass/shared";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api.ts";

const OkSchema = z.object({ ok: z.boolean() });

export function useVehicleOverviews() {
  return useQuery({
    queryKey: ["vehicles"],
    queryFn: () => apiGet("/api/vehicles", z.array(VehicleOverviewSchema)),
  });
}

export function useVehicleSummary(resourceId: string | undefined) {
  return useQuery({
    queryKey: ["vehicles", resourceId],
    queryFn: () => apiGet(`/api/vehicles/${resourceId}`, VehicleSummarySchema),
    enabled: resourceId !== undefined,
  });
}

/** Recent transactions already tagged to this vehicle, near `nearDate` — for the "link a spend" picker. */
export function useVehicleTransactionCandidates(resourceId: string, nearDate: string) {
  return useQuery({
    queryKey: ["vehicles", resourceId, "transactions", nearDate],
    queryFn: () =>
      apiGet(
        `/api/vehicles/${resourceId}/transactions?near=${encodeURIComponent(nearDate)}`,
        z.array(VehicleTransactionCandidateSchema),
      ),
    enabled: nearDate !== "",
  });
}

export function useVehicleMutations(resourceId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["vehicles"] });
    void qc.invalidateQueries({ queryKey: ["vehicles", resourceId] });
  };

  const updateServiceConfig = useMutation({
    mutationFn: (body: UpdateVehicleServiceConfig) =>
      apiPatch(
        `/api/vehicles/${resourceId}/service-config`,
        VehicleServiceConfigSchema,
        UpdateVehicleServiceConfigSchema.parse(body),
      ),
    onSuccess: invalidate,
  });

  const markServiceDone = useMutation({
    mutationFn: (body: MarkServiceDone) =>
      apiPost(
        `/api/vehicles/${resourceId}/service-done`,
        VehicleServiceConfigSchema,
        MarkServiceDoneSchema.parse(body),
      ),
    onSuccess: invalidate,
  });

  const addReading = useMutation({
    mutationFn: (body: CreateOdometerReading) =>
      apiPost(
        `/api/vehicles/${resourceId}/readings`,
        OdometerReadingSchema,
        CreateOdometerReadingSchema.parse(body),
      ),
    onSuccess: invalidate,
  });

  const deleteReading = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/vehicles/${resourceId}/readings/${id}`, OkSchema),
    onSuccess: invalidate,
  });

  return { updateServiceConfig, markServiceDone, addReading, deleteReading };
}
