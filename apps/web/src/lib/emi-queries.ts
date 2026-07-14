import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { EmiSummarySchema, type CreateEmi } from "@compass/shared";
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

export function useEmis() {
  return useQuery({
    queryKey: ["emis"],
    queryFn: () => apiGet("/api/emis", z.array(EmiSummarySchema)),
  });
}

export function useEmiMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["emis"] });
    void qc.invalidateQueries({ queryKey: ["transactions"] });
    void qc.invalidateQueries({ queryKey: ["recurring"] });
  };
  const create = useMutation({
    mutationFn: (body: CreateEmi) => apiPost("/api/emis", EmiSummarySchema, body),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (templateId: string) => send("DELETE", `/api/emis/${templateId}`, OkSchema),
    onSuccess: invalidate,
  });
  // pause/resume reuses the recurring-template endpoint (an EMI is a template)
  const setPaused = useMutation({
    mutationFn: ({ templateId, paused }: { templateId: string; paused: boolean }) =>
      send("PATCH", `/api/recurring/${templateId}`, z.unknown(), { paused }),
    onSuccess: invalidate,
  });
  return { create, remove, setPaused };
}
