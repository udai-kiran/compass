import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  BudgetComparisonSchema,
  BudgetSchema,
  BudgetSuggestionSchema,
  BudgetUtilizationSchema,
  DashboardSchema,
  NotificationsPageSchema,
  RecurringTemplateSchema,
  CreateRecurringTemplateSchema,
  TrendsSchema,
  type BudgetPeriod,
  type CreateRecurringTemplate,
  type UpdateRecurringTemplate,
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

// ---------- budgets ----------

export function useBudgetUtilization(period: BudgetPeriod, key: string) {
  return useQuery({
    queryKey: ["budget", period, key],
    queryFn: () => apiGet(`/api/budgets/${period}/${key}`, BudgetUtilizationSchema),
  });
}

export function useBudgetSuggestions(enabled: boolean) {
  return useQuery({
    queryKey: ["budget-suggestions"],
    queryFn: () => apiGet("/api/budgets/suggestions", z.array(BudgetSuggestionSchema)),
    enabled,
  });
}

export function useBudgetComparison(key: string) {
  return useQuery({
    queryKey: ["budget-comparison", key],
    queryFn: () => apiGet(`/api/budgets/monthly/${key}/comparison`, BudgetComparisonSchema),
  });
}

export function useBudgetMutations(period: BudgetPeriod, key: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["budget"] });
    void qc.invalidateQueries({ queryKey: ["budget-comparison"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const saveAll = useMutation({
    mutationFn: (lines: Array<{ categoryId: string; amountPaise: number; rollover: boolean }>) =>
      send("PUT", `/api/budgets/${period}/${key}`, BudgetSchema, { lines }),
    onSuccess: invalidate,
  });
  const saveLine = useMutation({
    mutationFn: (line: { categoryId: string; amountPaise: number; rollover: boolean }) =>
      send("PUT", `/api/budgets/${period}/${key}/lines`, BudgetSchema, line),
    onSuccess: invalidate,
  });
  const removeLine = useMutation({
    mutationFn: (categoryId: string) =>
      send("DELETE", `/api/budgets/${period}/${key}/lines/${categoryId}`, OkSchema),
    onSuccess: invalidate,
  });
  const copyPrevious = useMutation({
    mutationFn: () => apiPost(`/api/budgets/${period}/${key}/copy-previous`, BudgetSchema),
    onSuccess: invalidate,
  });
  return { saveAll, saveLine, removeLine, copyPrevious };
}

// ---------- dashboard / trends ----------

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiGet("/api/dashboard", DashboardSchema),
  });
}

export function useTrends(months = 12) {
  return useQuery({
    queryKey: ["trends", months],
    queryFn: () => apiGet(`/api/trends?months=${months}`, TrendsSchema),
  });
}

// ---------- notifications ----------

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiGet("/api/notifications", NotificationsPageSchema),
    refetchInterval: 60_000,
  });
}

export function useNotificationMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["notifications"] });
  const markRead = useMutation({
    mutationFn: (id: string) => apiPost(`/api/notifications/${id}/read`, OkSchema),
    onSuccess: invalidate,
  });
  const markAllRead = useMutation({
    mutationFn: () => apiPost("/api/notifications/read-all", OkSchema),
    onSuccess: invalidate,
  });
  return { markRead, markAllRead };
}

// ---------- recurring ----------

export function useRecurring() {
  return useQuery({
    queryKey: ["recurring"],
    queryFn: () => apiGet("/api/recurring", z.array(RecurringTemplateSchema)),
  });
}

export function useRecurringMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["recurring"] });
    void qc.invalidateQueries({ queryKey: ["transactions"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const create = useMutation({
    mutationFn: (body: CreateRecurringTemplate) =>
      apiPost("/api/recurring", RecurringTemplateSchema, CreateRecurringTemplateSchema.parse(body)),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: UpdateRecurringTemplate & { id: string }) =>
      send("PATCH", `/api/recurring/${id}`, RecurringTemplateSchema, body),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => send("DELETE", `/api/recurring/${id}`, OkSchema),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}
