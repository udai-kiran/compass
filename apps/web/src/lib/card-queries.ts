import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  CardActivitySchema,
  CardDetailsSchema,
  CardHolderSummarySchema,
  CardIssuerSettingsSchema,
  CardStatementSchema,
  RewardEntrySchema,
  StatementReconciliationSchema,
  type CreateRewardEntry,
  type UpsertCardDetails,
  type UpsertCardIssuerSettings,
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

/** Credit cards grouped under their bank/issuer holder (combined limit + utilization). */
export function useCardHolders() {
  return useQuery({
    queryKey: ["cards"],
    queryFn: () => apiGet("/api/cards", z.array(CardHolderSummarySchema)),
  });
}

export function useCardActivity(accountId: string | null) {
  return useQuery({
    queryKey: ["card-activity", accountId],
    queryFn: () => apiGet(`/api/cards/${accountId}/activity`, CardActivitySchema),
    enabled: accountId !== null,
  });
}

export function useCardDetailsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, ...body }: UpsertCardDetails & { accountId: string }) =>
      send("PUT", `/api/cards/${accountId}/details`, CardDetailsSchema, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cards"] }),
  });
}

/** Save the settings shared across a bank's cards (combined limit, alert, mobile, password). */
export function useIssuerSettingsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertCardIssuerSettings) =>
      send("PUT", "/api/card-issuers/settings", CardIssuerSettingsSchema, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cards"] }),
  });
}

/** Set ("" to clear) just the statement-PDF password, without touching cycle/limit. */
export function useStatementPasswordMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, password }: { accountId: string; password: string }) =>
      send(
        "PUT",
        `/api/cards/${accountId}/statement-password`,
        z.object({ hasStatementPassword: z.boolean() }),
        { password },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cards"] }),
  });
}

/** Statement PDFs/images uploaded for a card. */
export function useCardStatements(accountId: string | null) {
  return useQuery({
    queryKey: ["card-statements", accountId],
    queryFn: () => apiGet(`/api/cards/${accountId!}/statements`, z.array(CardStatementSchema)),
    enabled: accountId !== null,
  });
}

export function useStatementMutations(accountId: string) {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["card-statements", accountId] });
  const upload = useMutation({
    mutationFn: async ({ file, period }: { file: File; period: string }) => {
      const form = new FormData();
      form.append("file", file);
      const url = period
        ? `/api/cards/${accountId}/statements?period=${period}`
        : `/api/cards/${accountId}/statements`;
      const res = await fetch(url, { method: "POST", body: form });
      if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message ?? "Upload failed");
      return CardStatementSchema.parse(await res.json());
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => send("DELETE", `/api/cards/${accountId}/statements/${id}`, OkSchema),
    onSuccess: invalidate,
  });
  return { upload, remove };
}

export function useRewards(accountId: string | null) {
  return useQuery({
    queryKey: ["rewards", accountId],
    queryFn: () => apiGet(`/api/cards/${accountId!}/rewards`, z.array(RewardEntrySchema)),
    enabled: accountId !== null,
  });
}

/** Statement reconciliations for a card, newest cycle first (read-only). */
export function useReconciliations(accountId: string | null) {
  return useQuery({
    queryKey: ["reconciliations", accountId],
    queryFn: () =>
      apiGet(`/api/cards/${accountId!}/reconciliations`, z.array(StatementReconciliationSchema)),
    enabled: accountId !== null,
  });
}

/**
 * Re-check a cycle against the ledger. The extractor matched it once, when the
 * statement arrived — usually before its spends were accepted — so a cycle can
 * read as uncleared long after the ledger caught up.
 */
export function useRecomputeReconciliation(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      send(
        "POST",
        `/api/cards/${accountId}/reconciliations/${id}/recompute`,
        StatementReconciliationSchema,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reconciliations", accountId] });
      void qc.invalidateQueries({ queryKey: ["card-activity", accountId] });
    },
  });
}

export function useRewardMutations(accountId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["rewards", accountId] });
    void qc.invalidateQueries({ queryKey: ["cards"] });
  };
  const add = useMutation({
    mutationFn: (body: CreateRewardEntry) =>
      apiPost(`/api/cards/${accountId}/rewards`, RewardEntrySchema, body),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => send("DELETE", `/api/cards/${accountId}/rewards/${id}`, OkSchema),
    onSuccess: invalidate,
  });
  return { add, remove };
}
