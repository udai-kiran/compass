import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  BankPresetSchema,
  CommitResultSchema,
  ImportBatchSchema,
  ImportRowSchema,
  ImportRowsPageSchema,
  MerchantRuleSchema,
  type ImportMapping,
  type RenameMerchant,
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

// ---------- imports ----------

export function useImports() {
  return useQuery({
    queryKey: ["imports"],
    queryFn: () => apiGet("/api/imports", z.array(ImportBatchSchema)),
  });
}

export function useImportBatch(id: string | null) {
  return useQuery({
    queryKey: ["imports", id],
    queryFn: () => apiGet(`/api/imports/${id}`, ImportBatchSchema),
    enabled: id !== null,
  });
}

export function useImportRows(
  id: string | null,
  page: { offset: number; limit: number; onlyProblems: boolean },
) {
  return useQuery({
    queryKey: ["import-rows", id, page],
    queryFn: () =>
      apiGet(
        `/api/imports/${id}/rows?offset=${page.offset}&limit=${page.limit}${page.onlyProblems ? "&onlyProblems=true" : ""}`,
        ImportRowsPageSchema,
      ),
    enabled: id !== null,
    placeholderData: (prev) => prev,
  });
}

export function useBankPresets() {
  return useQuery({
    queryKey: ["bank-presets"],
    queryFn: () => apiGet("/api/imports/presets", z.array(BankPresetSchema)),
    staleTime: Infinity,
  });
}

export function useImportMutations() {
  const qc = useQueryClient();
  const invalidateBatch = (id: string) => {
    void qc.invalidateQueries({ queryKey: ["imports"] });
    void qc.invalidateQueries({ queryKey: ["import-rows", id] });
  };

  const upload = useMutation({
    mutationFn: async ({ accountId, file }: { accountId: string; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/imports?accountId=${accountId}`, { method: "POST", body: form });
      if (!res.ok) {
        throw new Error(((await res.json()) as { message?: string }).message ?? "Upload failed");
      }
      return ImportBatchSchema.parse(await res.json());
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["imports"] }),
  });

  const setMapping = useMutation({
    mutationFn: ({ id, mapping, saveAsPreset }: { id: string; mapping: ImportMapping; saveAsPreset: boolean }) =>
      send("PUT", `/api/imports/${id}/mapping`, ImportBatchSchema, { mapping, saveAsPreset }),
    onSuccess: (batch) => invalidateBatch(batch.id),
  });

  const updateRow = useMutation({
    mutationFn: ({
      importId,
      rowId,
      ...body
    }: {
      importId: string;
      rowId: string;
      include?: boolean;
      duplicate?: boolean;
      categoryId?: string | null;
    }) => send("PATCH", `/api/imports/${importId}/rows/${rowId}`, ImportRowSchema, body),
    onSuccess: (_row, vars) => void qc.invalidateQueries({ queryKey: ["import-rows", vars.importId] }),
  });

  const commit = useMutation({
    mutationFn: (id: string) => apiPost(`/api/imports/${id}/commit`, CommitResultSchema),
    onSuccess: (_r, id) => {
      invalidateBatch(id);
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const rollback = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/api/imports/${id}/rollback`, z.object({ removed: z.number() })),
    onSuccess: (_r, id) => {
      invalidateBatch(id);
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => send("DELETE", `/api/imports/${id}`, OkSchema),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["imports"] }),
  });

  return { upload, setMapping, updateRow, commit, rollback, remove };
}

// ---------- merchant rules ----------

export function useMerchantRules() {
  return useQuery({
    queryKey: ["merchant-rules"],
    queryFn: () => apiGet("/api/merchant-rules", z.array(MerchantRuleSchema)),
  });
}

export function useMerchantMutations() {
  const qc = useQueryClient();
  const rename = useMutation({
    mutationFn: (body: RenameMerchant) =>
      apiPost("/api/merchants/rename", z.object({ updated: z.number() }), body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["merchant-rules"] });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
  const removeRule = useMutation({
    mutationFn: (id: string) => send("DELETE", `/api/merchant-rules/${id}`, OkSchema),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["merchant-rules"] }),
  });
  return { rename, removeRule };
}
