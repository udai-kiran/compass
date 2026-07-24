import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { z } from "zod";
import {
  AccountSchema,
  AccountWithBalanceSchema,
  AttachmentSchema,
  BulkResultSchema,
  CategorySchema,
  PayslipResultSchema,
  TransactionPageSchema,
  TransactionSchema,
  TransferSuggestionSchema,
  type BulkAction,
  type CreateAccount,
  type CreateCategory,
  type CreatePayslipInput,
  type CreateTransaction,
  type Transaction,
  type TransactionFilter,
  type TransactionPage,
  type UpdateAccount,
  type UpdateCategory,
  type UpdateTransaction,
} from "@compass/shared";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api.ts";

const OkSchema = z.object({ ok: z.boolean() });

// ---------- accounts ----------

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => apiGet("/api/accounts", z.array(AccountWithBalanceSchema)),
  });
}

export function useAccountMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["accounts"] });
  const create = useMutation({
    mutationFn: (body: CreateAccount) => apiPost("/api/accounts", AccountSchema, body),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: UpdateAccount & { id: string }) =>
      apiPatch(`/api/accounts/${id}`, AccountSchema, body),
    // A type change normalizes the per-type detail rows server-side (e.g. EPS is
    // dropped when leaving EPF); refresh those caches so the detail form doesn't
    // keep — and re-submit — stale values.
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["retirement-details", id] });
      void qc.invalidateQueries({ queryKey: ["overdraft-details", id] });
      void qc.invalidateQueries({ queryKey: ["bank-details", id] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/accounts/${id}`, OkSchema),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

// ---------- categories ----------

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => apiGet("/api/categories", z.array(CategorySchema)),
  });
}

export function useCategoryMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["categories"] });
  const create = useMutation({
    mutationFn: (body: CreateCategory) => apiPost("/api/categories", CategorySchema, body),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: UpdateCategory & { id: string }) =>
      apiPatch(`/api/categories/${id}`, CategorySchema, body),
    onSuccess: invalidate,
  });
  const merge = useMutation({
    mutationFn: ({ id, intoCategoryId }: { id: string; intoCategoryId: string }) =>
      apiPost(`/api/categories/${id}/merge`, OkSchema, { intoCategoryId }),
    onSuccess: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
  return { create, update, merge };
}

// ---------- transactions ----------

export function txQueryString(filter: TransactionFilter, extra: Record<string, string> = {}) {
  const params = new URLSearchParams(extra);
  for (const [k, v] of Object.entries(filter)) {
    if (v !== undefined && v !== "") params.set(k, String(v));
  }
  return params.toString();
}

export function useTransactionsInfinite(filter: TransactionFilter) {
  return useInfiniteQuery({
    queryKey: ["transactions", filter],
    queryFn: ({ pageParam }) =>
      apiGet(
        `/api/transactions?${txQueryString(filter, {
          limit: "100",
          ...(pageParam ? { cursor: pageParam } : {}),
        })}`,
        TransactionPageSchema,
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useTransactionMutations(filter: TransactionFilter) {
  const qc = useQueryClient();
  const key = ["transactions", filter];
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["transactions"] });
    void qc.invalidateQueries({ queryKey: ["accounts"] });
  };

  const create = useMutation({
    mutationFn: (body: CreateTransaction) =>
      apiPost("/api/transactions", TransactionSchema, body),
    onSuccess: invalidate,
  });

  const update = useMutation({
    scope: { id: "transaction-update" },
    mutationFn: ({ id, ...body }: UpdateTransaction & { id: string }) =>
      apiPatch(`/api/transactions/${id}`, TransactionSchema, body),
    // optimistic inline edit
    onMutate: async ({ id, ...body }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<InfiniteData<TransactionPage>>(key);
      if (prev) {
        qc.setQueryData<InfiniteData<TransactionPage>>(key, {
          ...prev,
          pages: prev.pages.map((p) => ({
            ...p,
            items: p.items.map((t) => (t.id === id ? ({ ...t, ...body } as Transaction) : t)),
          })),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/transactions/${id}`, OkSchema),
    onSuccess: invalidate,
  });

  const bulk = useMutation({
    mutationFn: (action: BulkAction) => apiPost("/api/transactions/bulk", BulkResultSchema, action),
    onSuccess: invalidate,
  });

  const setSplits = useMutation({
    mutationFn: ({
      id,
      splits,
    }: {
      id: string;
      splits: Array<{ categoryId: string; amountPaise: number; note: string }>;
    }) => apiPut(`/api/transactions/${id}/splits`, TransactionSchema, { splits }),
    onSuccess: invalidate,
  });

  return { create, update, remove, bulk, setSplits };
}

// ---------- payslips ----------

export function usePayslipMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePayslipInput) =>
      apiPost("/api/payslips", PayslipResultSchema, body),
    // A payslip creates several linked entries and moves EPF into a retirement
    // account, so refresh transactions and account balances together.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

// ---------- transfers ----------

export function useTransferSuggestions() {
  return useQuery({
    queryKey: ["transfer-suggestions"],
    queryFn: () => apiGet("/api/transfers/suggestions", z.array(TransferSuggestionSchema)),
  });
}

export function useTransferMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["transactions"] });
    void qc.invalidateQueries({ queryKey: ["transfer-suggestions"] });
  };
  const link = useMutation({
    mutationFn: (body: { outTransactionId: string; inTransactionId: string }) =>
      apiPost("/api/transfers", z.object({ id: z.uuid() }), body),
    onSuccess: invalidate,
  });
  const unlink = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/transfers/${id}`, OkSchema),
    onSuccess: invalidate,
  });
  return { link, unlink };
}

// ---------- attachments ----------

export function useAttachments(transactionId: string | null) {
  return useQuery({
    queryKey: ["attachments", transactionId],
    queryFn: () =>
      apiGet(`/api/transactions/${transactionId}/attachments`, z.array(AttachmentSchema)),
    enabled: transactionId !== null,
  });
}

export function useAttachmentMutations(transactionId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["attachments", transactionId] });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/transactions/${transactionId}/attachments`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        throw new Error(((await res.json()) as { message?: string }).message ?? "Upload failed");
      }
      return AttachmentSchema.parse(await res.json());
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/attachments/${id}`, OkSchema),
    onSuccess: invalidate,
  });
  return { upload, remove };
}
