import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  FamilyMemberSchema,
  UserProfileSchema,
  type CreateFamilyMember,
  type UpdateFamilyMember,
  type UpdateUserProfile,
} from "@compass/shared";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api.ts";
import { toast } from "./toast.tsx";

export function useUserProfile() {
  return useQuery({
    queryKey: ["user-profile"],
    queryFn: () => apiGet("/api/profile", UserProfileSchema),
  });
}

export function useUserProfileMutation() {
  const qc = useQueryClient();
  return useMutation({
    // Bounded so a request that never settles can't leave `isPending` stuck true,
    // which would keep the Save button disabled until the page was reloaded.
    mutationFn: (body: UpdateUserProfile) =>
      apiPut("/api/profile", UserProfileSchema, body, { timeoutMs: 20_000 }),
    // Cancel any GET still in flight before caching the response: a request that
    // started before the write can resolve after it and overwrite the saved profile
    // with pre-save data, making the form visibly revert to the old date of birth.
    onSuccess: async (profile) => {
      await qc.cancelQueries({ queryKey: ["user-profile"] });
      qc.setQueryData(["user-profile"], profile);
      toast("Profile updated", "success");
    },
    onError: (err: Error) => toast(err.message),
  });
}

export function useFamilyMembers() {
  return useQuery({
    queryKey: ["family-members"],
    queryFn: () => apiGet("/api/family", z.array(FamilyMemberSchema)),
  });
}

export function useFamilyMutations() {
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: (body: CreateFamilyMember) => apiPost("/api/family", FamilyMemberSchema, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["family-members"] });
      toast("Family member added", "success");
    },
    onError: (err: Error) => toast(err.message),
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateFamilyMember }) =>
      apiPatch(`/api/family/${id}`, FamilyMemberSchema, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["family-members"] });
      toast("Family member updated", "success");
    },
    onError: (err: Error) => toast(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/family/${id}`, z.object({ ok: z.boolean() })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["family-members"] });
      toast("Family member removed", "success");
    },
    onError: (err: Error) => toast(err.message),
  });

  return { create, update, remove };
}
