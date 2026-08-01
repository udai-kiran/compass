import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  CreateUserTaskSchema,
  UserTaskSchema,
  type CreateUserTask,
  type UpdateUserTask,
} from "@compass/shared";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api.ts";

const OkSchema = z.object({ ok: z.boolean() });

export function useUserTasks() {
  return useQuery({
    queryKey: ["user-tasks"],
    queryFn: () => apiGet("/api/user-tasks", z.array(UserTaskSchema)),
  });
}

export function useUserTaskMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["user-tasks"] });
  const create = useMutation({
    mutationFn: (body: CreateUserTask) =>
      apiPost("/api/user-tasks", UserTaskSchema, CreateUserTaskSchema.parse(body)),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: UpdateUserTask & { id: string }) =>
      apiPatch(`/api/user-tasks/${id}`, UserTaskSchema, body),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/user-tasks/${id}`, OkSchema),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}
