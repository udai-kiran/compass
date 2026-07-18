import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  MailboxAccountSchema,
  MailboxCredentialsStatusSchema,
} from "@compass/shared";
import { apiDelete, apiGet, apiPost } from "./api.ts";

export function useMailboxes() {
  return useQuery({
    queryKey: ["mailboxes"],
    queryFn: () => apiGet("/api/mailboxes", z.array(MailboxAccountSchema)),
  });
}

export function useMailboxCredentials() {
  return useQuery({
    queryKey: ["mailbox-credentials"],
    queryFn: () => apiGet("/api/mailboxes/credentials", MailboxCredentialsStatusSchema),
  });
}

export function useMailboxMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["mailboxes"] });
    void qc.invalidateQueries({ queryKey: ["mailbox-credentials"] });
  };

  const add = useMutation({
    mutationFn: (bundle: string) => apiPost("/api/mailboxes", MailboxAccountSchema, { bundle }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/mailboxes/${id}`, z.object({ ok: z.literal(true) })),
    onSuccess: invalidate,
  });

  return { add, remove };
}
