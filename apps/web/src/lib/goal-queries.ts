import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  BillOccurrenceSchema,
  CashflowMonthSchema,
  ForecastSchema,
  GoalProgressSchema,
  GoalSchema,
  NotificationPrefSchema,
  SipSchema,
  SubscriptionSuggestionSchema,
  type CreateGoal,
  type CreateSip,
  type ReorderGoals,
  type UpdateGoal,
  type UpdateSip,
  type UpsertNotificationPref,
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

// ---------- goals ----------

export function useGoals() {
  return useQuery({ queryKey: ["goals"], queryFn: () => apiGet("/api/goals", z.array(GoalSchema)) });
}

export function useGoalProgress(id: string) {
  return useQuery({
    queryKey: ["goal-progress", id],
    queryFn: () => apiGet(`/api/goals/${id}/progress`, GoalProgressSchema),
  });
}

export function useGoalMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["goals"] });
    void qc.invalidateQueries({ queryKey: ["goal-progress"] });
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const create = useMutation({
    mutationFn: (body: CreateGoal) => apiPost("/api/goals", GoalSchema, body),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: UpdateGoal & { id: string }) =>
      send("PATCH", `/api/goals/${id}`, GoalSchema, body),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => send("DELETE", `/api/goals/${id}`, OkSchema),
    onSuccess: invalidate,
  });
  const reorder = useMutation({
    mutationFn: (body: ReorderGoals) =>
      send("PUT", "/api/goals/order", z.array(GoalSchema), body),
    onSuccess: (ordered) => {
      qc.setQueryData(["goals"], ordered);
    },
  });
  return { create, update, remove, reorder };
}

// ---------- SIPs ----------

export function useSips(goalId: string) {
  return useQuery({
    queryKey: ["sips", goalId],
    queryFn: () => apiGet(`/api/goals/${goalId}/sips`, z.array(SipSchema)),
  });
}

export function useSipMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["sips"] });
    void qc.invalidateQueries({ queryKey: ["goal-progress"] });
    void qc.invalidateQueries({ queryKey: ["forecast"] });
  };
  const create = useMutation({
    mutationFn: (body: CreateSip) => apiPost("/api/sips", SipSchema, body),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: UpdateSip & { id: string }) =>
      send("PATCH", `/api/sips/${id}`, SipSchema, body),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => send("DELETE", `/api/sips/${id}`, OkSchema),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

// ---------- cash flow & forecast ----------

export function useCashflow(months: number) {
  return useQuery({
    queryKey: ["cashflow", months],
    queryFn: () => apiGet(`/api/cashflow?months=${months}`, z.array(CashflowMonthSchema)),
  });
}

export function useForecast() {
  return useQuery({ queryKey: ["forecast"], queryFn: () => apiGet("/api/forecast", ForecastSchema) });
}

// ---------- bills & subscriptions ----------

export function useUpcomingBills(days = 60) {
  return useQuery({
    queryKey: ["bills-upcoming", days],
    queryFn: () => apiGet(`/api/bills/upcoming?days=${days}`, z.array(BillOccurrenceSchema)),
  });
}

export function useSubscriptionSuggestions() {
  return useQuery({
    queryKey: ["subscription-suggestions"],
    queryFn: () => apiGet("/api/subscriptions/suggestions", z.array(SubscriptionSuggestionSchema)),
  });
}

export function useDismissSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (merchant: string) => apiPost("/api/subscriptions/dismiss", OkSchema, { merchant }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["subscription-suggestions"] }),
  });
}

// ---------- notification prefs ----------

export function useNotificationPrefs() {
  return useQuery({
    queryKey: ["notification-prefs"],
    queryFn: () => apiGet("/api/notification-prefs", z.array(NotificationPrefSchema)),
  });
}

export function useUpsertPref() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertNotificationPref) =>
      send("PUT", "/api/notification-prefs", NotificationPrefSchema, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notification-prefs"] }),
  });
}

export function useArchiveNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost(`/api/notifications/${id}/archive`, OkSchema),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
