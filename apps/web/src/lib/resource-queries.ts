import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  CreateResourceSchema,
  ResourceSchema,
  type CreateResource,
  type UpdateResource,
} from "@compass/shared";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api.ts";

const OkSchema = z.object({ ok: z.boolean() });

export function useResources() {
  return useQuery({
    queryKey: ["resources"],
    queryFn: () => apiGet("/api/resources", z.array(ResourceSchema)),
  });
}

export function useResourceMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["resources"] });
  const create = useMutation({
    mutationFn: (body: CreateResource) =>
      apiPost("/api/resources", ResourceSchema, CreateResourceSchema.parse(body)),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: UpdateResource & { id: string }) =>
      apiPatch(`/api/resources/${id}`, ResourceSchema, body),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/resources/${id}`, OkSchema),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}
