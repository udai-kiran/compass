import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  BillOccurrenceSchema,
  CashflowMonthSchema,
  ForecastSchema,
  GoalProgressSchema,
  GoalSchema,
  HoldingEventSchema,
  NotificationPrefSchema,
  SipInstallmentCandidateSchema,
  SipSchema,
  SubscriptionSuggestionSchema,
  type CreateGoal,
  type CreateSip,
  type RecordSipInstallment,
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

/**
 * Every cached view a SIP write can move. Shared by the single-SIP mutations
 * and the batch installment recorder so the two can't drift on what they
 * refresh.
 */
function invalidateSipViews(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["sips"] });
  void qc.invalidateQueries({ queryKey: ["goal-progress"] });
  void qc.invalidateQueries({ queryKey: ["forecast"] });
  // Recording an installment inserts a `buy` holding event — the same row
  // addEvent creates in wealth-queries.ts, so it moves the same three views.
  void qc.invalidateQueries({ queryKey: ["portfolio"] });
  void qc.invalidateQueries({ queryKey: ["net-worth"] });
  void qc.invalidateQueries({ queryKey: ["capital-gains"] });
  // Linking a deposit must remove it from every open picker's unlinked list,
  // and unlinking must put it back — both are the same candidate query.
  void qc.invalidateQueries({ queryKey: ["sip-installment-candidates"] });
}

export function useSips(goalId: string) {
  return useQuery({
    queryKey: ["sips", goalId],
    queryFn: () => apiGet(`/api/goals/${goalId}/sips`, z.array(SipSchema)),
  });
}

/**
 * Every SIP across every goal — backs the `/sips` page. The `["sips", ...]`
 * key prefix is deliberate: `invalidateSipViews` invalidates `["sips"]`, which
 * prefix-matches both this and each per-goal `useSips(goalId)` cache.
 */
export function useAllSips() {
  return useQuery({ queryKey: ["sips", "all"], queryFn: () => apiGet("/api/sips", z.array(SipSchema)) });
}

/**
 * The ledger transactions that could be (or already are) this account-target
 * SIP's installment as of `date`. `enabled` is what keeps the /sips page from
 * firing one request per account row on mount — the picker asks only once the
 * user opens it (or it opened itself because the installment is due).
 */
export function useSipInstallmentCandidates(sipId: string, date: string, enabled: boolean) {
  return useQuery({
    queryKey: ["sip-installment-candidates", sipId, date],
    queryFn: () =>
      apiGet(`/api/sips/${sipId}/installment-candidates?date=${date}`, z.array(SipInstallmentCandidateSchema)),
    enabled,
  });
}

export function useSipMutations() {
  const qc = useQueryClient();
  const invalidate = () => invalidateSipViews(qc);
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
  const recordInstallment = useMutation({
    mutationFn: ({ id, ...body }: RecordSipInstallment & { id: string }) =>
      apiPost(`/api/sips/${id}/installments`, HoldingEventSchema, body),
    onSuccess: invalidate,
  });
  const linkInstallment = useMutation({
    mutationFn: ({ id, transactionId }: { id: string; transactionId: string }) =>
      apiPost(`/api/sips/${id}/installments/link`, SipSchema, { transactionId }),
    onSuccess: invalidate,
  });
  const unlinkInstallment = useMutation({
    mutationFn: ({ id, transactionId }: { id: string; transactionId: string }) =>
      send("DELETE", `/api/sips/${id}/installments/link/${transactionId}`, SipSchema),
    onSuccess: invalidate,
  });
  return { create, update, remove, recordInstallment, linkInstallment, unlinkInstallment };
}

/** One row of a batch installment submission. `id` is the SIP; the rest is the request body. */
export interface SipInstallmentDraft {
  id: string;
  date: string;
  amountPaise: number;
  nav: number | null;
  units: number | null;
  note: string;
}

/** Per-row result of a batch submission — `error` is null when that row was recorded. */
export interface SipInstallmentOutcome {
  id: string;
  error: string | null;
}

/**
 * Records several SIP installments from one user action by fanning out to the
 * single-installment endpoint, one request per SIP.
 *
 * Deliberately NOT a server-side batch endpoint. Each installment is already
 * its own transaction, and per-row independence is the behaviour we want: a
 * mistyped NAV on one folio must not roll back the installments that were
 * fine, which is exactly what a single-transaction batch route would do.
 *
 * Because every row's failure is caught here, the mutation itself always
 * resolves. That is what keeps a failed row's message inline against its own
 * row instead of firing the global `mutationCache` error toast (see main.tsx),
 * and it means one cache invalidation covers the whole batch rather than N.
 */
export function useRecordInstallments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (drafts: SipInstallmentDraft[]): Promise<SipInstallmentOutcome[]> => {
      const settled = await Promise.allSettled(
        drafts.map(({ id, ...body }) => apiPost(`/api/sips/${id}/installments`, HoldingEventSchema, body)),
      );
      return drafts.map((draft, i) => {
        const result = settled[i]!;
        if (result.status === "fulfilled") return { id: draft.id, error: null };
        const reason: unknown = result.reason;
        return {
          id: draft.id,
          error: reason instanceof Error ? reason.message : "Couldn't record this installment",
        };
      });
    },
    onSuccess: () => invalidateSipViews(qc),
  });
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
