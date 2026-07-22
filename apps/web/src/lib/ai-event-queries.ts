import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  AiEventDetailSchema,
  AiEventPageSchema,
  type AiEventKind,
} from "@compass/shared";
import { apiGet } from "./api.ts";

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
