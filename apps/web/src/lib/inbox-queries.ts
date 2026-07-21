import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  ExtractedTransactionSchema,
  InboxCountSchema,
  type AcceptExtractedTxn,
  type AcceptTransfer,
  type ExtractedTxnReviewStatus,
} from "@compass/shared";
import { apiGet, apiPost } from "./api.ts";

export function useInbox(status: ExtractedTxnReviewStatus = "pending") {
  return useQuery({
    queryKey: ["inbox", status],
    queryFn: () => apiGet(`/api/inbox?status=${status}`, z.array(ExtractedTransactionSchema)),
  });
}

export function useInboxCount() {
  return useQuery({
    queryKey: ["inbox-count"],
    queryFn: () => apiGet("/api/inbox/count", InboxCountSchema),
    // a light poll so the nav badge tracks newly-extracted drafts
    refetchInterval: 60_000,
  });
}

export function useInboxMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["inbox"] });
    void qc.invalidateQueries({ queryKey: ["inbox-count"] });
  };

  const accept = useMutation({
    mutationFn: ({ id, ...body }: AcceptExtractedTxn & { id: string }) =>
      apiPost(`/api/inbox/${id}/accept`, ExtractedTransactionSchema, body),
    onSuccess: () => {
      invalidate();
      // a new ledger transaction landed — refresh the views that show it
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const acceptTransfer = useMutation({
    mutationFn: (body: AcceptTransfer) =>
      apiPost(`/api/inbox/transfer`, z.array(ExtractedTransactionSchema), body),
    onSuccess: () => {
      invalidate();
      // two ledger transactions + a transfer link landed — refresh the ledger views
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: ["transfers"] });
    },
  });

  const reject = useMutation({
    mutationFn: (id: string) => apiPost(`/api/inbox/${id}/reject`, ExtractedTransactionSchema),
    onSuccess: invalidate,
  });

  // "Not a duplicate": a matched statement line goes back to the pending queue.
  const unmatch = useMutation({
    mutationFn: (id: string) => apiPost(`/api/inbox/${id}/unmatch`, ExtractedTransactionSchema),
    onSuccess: invalidate,
  });

  return { accept, acceptTransfer, reject, unmatch };
}
