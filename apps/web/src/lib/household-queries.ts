import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  HouseholdInviteSchema,
  HouseholdMemberSchema,
  HouseholdSchema,
  type AcceptInvite,
  type CreateHousehold,
  type UpdateHousehold,
} from "@compass/shared";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api.ts";
import { toast } from "./toast.tsx";

export function useHouseholds() {
  return useQuery({
    queryKey: ["households"],
    queryFn: () => apiGet("/api/households", z.array(HouseholdSchema)),
  });
}

export function useHouseholdMembers(householdId: string | undefined) {
  return useQuery({
    queryKey: ["household-members", householdId],
    queryFn: () =>
      apiGet(`/api/households/${householdId}/members`, z.array(HouseholdMemberSchema)),
    enabled: !!householdId,
  });
}

export function useHouseholdMutations() {
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: (body: CreateHousehold) =>
      apiPost("/api/households", HouseholdSchema, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["households"] });
      toast("Household created", "success");
    },
    onError: (err: Error) => toast(err.message),
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateHousehold }) =>
      apiPatch(`/api/households/${id}`, HouseholdSchema, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["households"] });
      toast("Household updated", "success");
    },
    onError: (err: Error) => toast(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiDelete(`/api/households/${id}`, z.object({ ok: z.boolean() })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["households"] });
      toast("Household deleted", "success");
    },
    onError: (err: Error) => toast(err.message),
  });

  const invite = useMutation({
    mutationFn: (householdId: string) =>
      apiPost(`/api/households/${householdId}/invite`, HouseholdInviteSchema),
    onSuccess: () => toast("Invite created", "success"),
    onError: (err: Error) => toast(err.message),
  });

  const acceptInvite = useMutation({
    mutationFn: (body: AcceptInvite) =>
      apiPost("/api/households/invites/accept", HouseholdSchema, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["households"] });
      toast("Joined household!", "success");
    },
    onError: (err: Error) => toast(err.message),
  });

  const leave = useMutation({
    mutationFn: (householdId: string) =>
      apiPost(`/api/households/${householdId}/leave`, z.object({ ok: z.boolean() })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["households"] });
      toast("Left household", "success");
    },
    onError: (err: Error) => toast(err.message),
  });

  const removeMember = useMutation({
    mutationFn: ({ householdId, memberId }: { householdId: string; memberId: string }) =>
      apiDelete(
        `/api/households/${householdId}/members/${memberId}`,
        z.object({ ok: z.boolean() }),
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["household-members", vars.householdId] });
      toast("Member removed", "success");
    },
    onError: (err: Error) => toast(err.message),
  });

  return { create, update, remove, invite, acceptInvite, leave, removeMember };
}
