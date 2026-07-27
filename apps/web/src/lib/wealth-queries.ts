import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  CapitalGainsStatementSchema,
  GoldDetailsSchema,
  HoldingEventSchema,
  HoldingSchema,
  MfImportPreviewSchema,
  MfImportResultSchema,
  NetWorthByGoalSchema,
  NetWorthReportSchema,
  PortfolioSchema,
  RefreshNavResultSchema,
  type CreateHolding,
  type CreateHoldingEvent,
  type SetValuation,
  type UpdateHolding,
  type UpsertGoldDetails,
} from "@compass/shared";
import { apiGet, apiPost } from "./api.ts";

const OkSchema = z.object({ ok: z.boolean() });

async function send<T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message ?? "Failed");
  return schema.parse(await res.json());
}

// ---------- portfolio ----------

export function usePortfolio() {
  return useQuery({ queryKey: ["portfolio"], queryFn: () => apiGet("/api/portfolio", PortfolioSchema) });
}

/** FIFO capital-gains statement for one financial year (undefined fy = latest). */
export function useCapitalGains(fy?: string) {
  return useQuery({
    queryKey: ["capital-gains", fy ?? "latest"],
    queryFn: () =>
      apiGet(
        `/api/holdings/capital-gains${fy ? `?fy=${fy}` : ""}`,
        CapitalGainsStatementSchema,
      ),
  });
}

/**
 * Gold-only detail section. Enabled by the caller for gold holdings alone —
 * the endpoint 404s any other asset class by design (`ownedHoldingOfClass`).
 */
export function useGoldDetails(holdingId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["gold-details", holdingId],
    queryFn: () => apiGet(`/api/holdings/${holdingId}/gold`, GoldDetailsSchema.nullable()),
    enabled,
  });
}

export function useGoldDetailsMutation(holdingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertGoldDetails) =>
      send("PUT", `/api/holdings/${holdingId}/gold`, GoldDetailsSchema, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["gold-details", holdingId] }),
  });
}

export function useHoldingMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["portfolio"] });
    void qc.invalidateQueries({ queryKey: ["net-worth"] });
    // Sales, tax-class/grandfather-NAV edits, and deletes all move the statement.
    void qc.invalidateQueries({ queryKey: ["capital-gains"] });
  };
  const create = useMutation({
    mutationFn: (body: CreateHolding) => apiPost("/api/holdings", HoldingSchema, body),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: UpdateHolding & { id: string }) =>
      send("PATCH", `/api/holdings/${id}`, HoldingSchema, body),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => send("DELETE", `/api/holdings/${id}`, OkSchema),
    onSuccess: invalidate,
  });
  const setValuation = useMutation({
    mutationFn: ({ id, ...body }: SetValuation & { id: string }) =>
      send("PUT", `/api/holdings/${id}/valuation`, OkSchema, body),
    onSuccess: invalidate,
  });
  const addEvent = useMutation({
    mutationFn: ({ id, ...body }: CreateHoldingEvent & { id: string }) =>
      apiPost(`/api/holdings/${id}/events`, HoldingEventSchema, body),
    onSuccess: invalidate,
  });
  const removeEvent = useMutation({
    mutationFn: ({ id, eventId }: { id: string; eventId: string }) =>
      send("DELETE", `/api/holdings/${id}/events/${eventId}`, OkSchema),
    onSuccess: invalidate,
  });
  const moveEvent = useMutation({
    mutationFn: ({ id, eventId, direction }: { id: string; eventId: string; direction: "up" | "down" }) =>
      apiPost(`/api/holdings/${id}/events/${eventId}/move`, OkSchema, { direction }),
    onSuccess: invalidate,
  });
  return { create, update, remove, setValuation, addEvent, removeEvent, moveEvent };
}

export function useRefreshNav() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost("/api/holdings/refresh-nav", RefreshNavResultSchema, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["portfolio"] });
      void qc.invalidateQueries({ queryKey: ["net-worth"] });
    },
  });
}

// ---------- MF import ----------

export function useMfImportPreview() {
  return useMutation({
    mutationFn: (csv: string) => apiPost("/api/holdings/import-mf/preview", MfImportPreviewSchema, { csv }),
  });
}

export function useMfImportCommit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (csv: string) => apiPost("/api/holdings/import-mf/commit", MfImportResultSchema, { csv }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["portfolio"] });
      void qc.invalidateQueries({ queryKey: ["net-worth"] });
      void qc.invalidateQueries({ queryKey: ["capital-gains"] });
    },
  });
}

// ---------- net worth ----------

export function useNetWorth() {
  return useQuery({ queryKey: ["net-worth"], queryFn: () => apiGet("/api/net-worth", NetWorthReportSchema) });
}

export function useNetWorthBackfill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (months: number) => apiPost("/api/net-worth/backfill", NetWorthReportSchema, { months }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["net-worth"] }),
  });
}

// ---------- net worth by goal ----------

export function useNetWorthByGoal() {
  return useQuery({
    queryKey: ["net-worth-by-goal"],
    queryFn: () => apiGet("/api/net-worth/by-goal", NetWorthByGoalSchema),
  });
}

/**
 * Sets the goal tag on one asset. The row may be an account or a holding, so it
 * routes to the right PATCH endpoint; goalId null clears the tag (Unassigned).
 */
export function useAssetGoalMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, id, goalId }: { kind: "account" | "holding"; id: string; goalId: string | null }) =>
      send("PATCH", `/api/${kind === "account" ? "accounts" : "holdings"}/${id}`, z.unknown(), { goalId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["net-worth-by-goal"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["portfolio"] });
      void qc.invalidateQueries({ queryKey: ["net-worth"] });
      // A goal's funded value and projection are the sum of its mapped assets.
      void qc.invalidateQueries({ queryKey: ["goals"] });
      void qc.invalidateQueries({ queryKey: ["goal-progress"] });
    },
  });
}
