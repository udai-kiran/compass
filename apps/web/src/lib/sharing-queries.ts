import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  SharingGrantSchema,
  type CreateSharingGrant,
  type SharingResourceType,
} from "@compass/shared";
import { apiDelete, apiGet, apiPost } from "./api.ts";
import { toast } from "./toast.tsx";

export function useSharingGrants(resourceType: SharingResourceType, resourceId: string) {
  return useQuery({
    queryKey: ["sharing-grants", resourceType, resourceId],
    queryFn: () =>
      apiGet(
        `/api/sharing-grants?resourceType=${resourceType}&resourceId=${resourceId}`,
        z.array(SharingGrantSchema),
      ),
    enabled: !!resourceId,
  });
}

export function useSharingMutations(resourceType: SharingResourceType, resourceId: string) {
  const qc = useQueryClient();

  const grant = useMutation({
    mutationFn: (body: CreateSharingGrant) =>
      apiPost("/api/sharing-grants", SharingGrantSchema, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sharing-grants", resourceType, resourceId] });
      toast("Shared successfully", "success");
    },
    onError: (err: Error) => toast(err.message),
  });

  const revoke = useMutation({
    mutationFn: (grantId: string) =>
      apiDelete(`/api/sharing-grants/${grantId}`, z.object({ ok: z.boolean() })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sharing-grants", resourceType, resourceId] });
      toast("Sharing removed", "success");
    },
    onError: (err: Error) => toast(err.message),
  });

  return { grant, revoke };
}
