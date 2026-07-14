import { useMutation } from "@tanstack/react-query";
import {
  AiCategorizeResponseSchema,
  AiSummarySchema,
  type AiCategorizeResponse,
  type AiChatMessage,
  type AiSummary,
} from "@compass/shared";
import { apiPost } from "./api.ts";

export function useAiCategorize() {
  return useMutation({
    mutationFn: (transactionIds?: string[]): Promise<AiCategorizeResponse> =>
      apiPost("/api/ai/categorize", AiCategorizeResponseSchema, { transactionIds }),
  });
}

export function useAiSummary() {
  return useMutation({
    mutationFn: (vars: { period: string; refresh?: boolean }): Promise<AiSummary> =>
      apiPost("/api/ai/summary", AiSummarySchema, vars),
  });
}

export interface AssistantEvent {
  type: "tool" | "text" | "done" | "error";
  name?: string;
  delta?: string;
  message?: string;
}

/**
 * Stream the assistant chat over SSE. Parses `data: {json}` frames from the
 * response body and invokes `onEvent` for each. Resolves when the stream ends.
 */
export async function streamAssistant(
  messages: AiChatMessage[],
  onEvent: (e: AssistantEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: "The assistant is unavailable right now." });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as AssistantEvent);
      } catch {
        // ignore malformed frame
      }
    }
  }
}
