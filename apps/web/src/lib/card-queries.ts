import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  CardDetailsSchema,
  CardSummarySchema,
  RewardEntrySchema,
  type CreateRewardEntry,
  type UpsertCardDetails,
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

export function useCards() {
  return useQuery({
    queryKey: ["cards"],
    queryFn: () => apiGet("/api/cards", z.array(CardSummarySchema)),
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

export function useRewards(accountId: string | null) {
  return useQuery({
    queryKey: ["rewards", accountId],
    queryFn: () => apiGet(`/api/cards/${accountId!}/rewards`, z.array(RewardEntrySchema)),
    enabled: accountId !== null,
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
