import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { AiEventDetailSchema, AiEventPageSchema, type AiEventKind } from "@compass/shared";
import { apiGet, apiPost } from "./api.ts";

export function useAiEvents(kind: AiEventKind | "all") {
  return useInfiniteQuery({
    queryKey: ["ai-events", kind],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "50" });
      if (kind !== "all") params.set("kind", kind);
      if (pageParam) params.set("cursor", pageParam);
      return apiGet(`/api/ai-events?${params.toString()}`, AiEventPageSchema);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useAiEvent(id: string | null) {
  return useQuery({
    queryKey: ["ai-event", id],
    queryFn: () => apiGet(`/api/ai-events/${id}`, AiEventDetailSchema),
    enabled: id !== null,
  });
}

export function useRetryIngestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ingestionId: string) =>
      apiPost(`/api/mailboxes/ingestions/${ingestionId}/retry`, z.object({ ok: z.literal(true) })),
    // The extractor re-runs out-of-band and its duration isn't known upfront
    // (one or more model calls) — unlike useMailboxes()'s `sync` mutation,
    // which has a caller-chosen window to wait out. Refresh a few times on a
    // spread of delays instead of once, so a slower run still surfaces its
    // outcome without the user having to reload the page.
    onSuccess: () => {
      for (const delayMs of [5000, 15000, 40000]) {
        setTimeout(() => void qc.invalidateQueries({ queryKey: ["ai-events"] }), delayMs);
      }
    },
  });
}
