import type { AiProvider, ChatMessage } from "@compass/ai";
import { ASSISTANT_SYSTEM } from "@compass/ai";
import type { AiChatMessage } from "@compass/shared";
import { runTool, TOOL_SPECS, type ToolContext } from "./tools.ts";

const MAX_TURNS = 5; // hard cap on model round-trips to kill runaway tool loops

export interface AssistantEvent {
  type: "tool" | "text" | "done" | "error";
  name?: string;
  delta?: string;
  message?: string;
}

/**
 * Run the assistant tool loop (task 7.4) and yield events for SSE streaming.
 * The model may call whitelisted tools up to {@link MAX_TURNS} times; the final
 * text answer is streamed in word chunks so tokens render progressively.
 */
export async function* runAssistant(
  ai: AiProvider,
  ctx: ToolContext,
  history: AiChatMessage[],
): AsyncGenerator<AssistantEvent> {
  const messages: ChatMessage[] = history.map((m) => ({ role: m.role, content: m.content }));

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const result = await ai.chat({
        system: ASSISTANT_SYSTEM,
        messages,
        tools: TOOL_SPECS,
        maxTokens: 1024,
      });

      if (result.toolCalls.length === 0) {
        for (const chunk of chunkText(result.text || "I don't have an answer for that.")) {
          yield { type: "text", delta: chunk };
        }
        yield { type: "done" };
        return;
      }

      // Record the assistant's tool-call turn, then run each tool.
      messages.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        yield { type: "tool", name: call.name };
        const output = await runTool(ctx, call.name, call.input);
        messages.push({ role: "tool", toolCallId: call.id, content: output });
      }
    }
    yield { type: "error", message: "The assistant took too many steps. Please rephrase your question." };
  } catch {
    // Provider outage etc. — degrade with a notice, never an error page.
    yield { type: "error", message: "The assistant is unavailable right now. Please try again later." };
  }
}

/** Split into small chunks so the client renders text progressively over SSE. */
function chunkText(text: string): string[] {
  const words = text.split(/(\s+)/);
  const out: string[] = [];
  let buf = "";
  for (const w of words) {
    buf += w;
    if (buf.length >= 12) {
      out.push(buf);
      buf = "";
    }
  }
  if (buf) out.push(buf);
  return out;
}
