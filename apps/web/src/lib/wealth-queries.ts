import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  HoldingEventSchema,
  HoldingSchema,
  NetWorthReportSchema,
  PortfolioSchema,
  type CreateHolding,
  type CreateHoldingEvent,
  type SetValuation,
  type UpdateHolding,
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

export function useHoldingMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["portfolio"] });
    void qc.invalidateQueries({ queryKey: ["net-worth"] });
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
  return { create, update, remove, setValuation, addEvent, removeEvent };
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
