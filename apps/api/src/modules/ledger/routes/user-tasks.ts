import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CreateUserTaskSchema, UpdateUserTaskSchema, UserTaskSchema } from "@compass/shared";
import {
  createUserTask,
  deleteUserTask,
  getUserTask,
  listUserTasks,
  updateUserTask,
} from "../services/user-tasks.ts";

const Params = z.object({ id: z.uuid() });

export async function userTaskRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    "/api/user-tasks",
    { schema: { response: { 200: z.array(UserTaskSchema) } } },
    (req) => listUserTasks(app.db, req.session!.userId),
  );
  r.get(
    "/api/user-tasks/:id",
    { schema: { params: Params, response: { 200: UserTaskSchema } } },
    (req) => getUserTask(app.db, req.session!.userId, req.params.id),
  );
  r.post(
    "/api/user-tasks",
    { schema: { body: CreateUserTaskSchema, response: { 201: UserTaskSchema } } },
    async (req, reply) =>
      reply.code(201).send(await createUserTask(app.db, req.session!.userId, req.body)),
  );
  r.patch(
    "/api/user-tasks/:id",
    {
      schema: {
        params: Params,
        body: UpdateUserTaskSchema,
        response: { 200: UserTaskSchema },
      },
    },
    (req) => updateUserTask(app.db, req.session!.userId, req.params.id, req.body),
  );
  r.delete(
    "/api/user-tasks/:id",
    {
      schema: {
        params: Params,
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      await deleteUserTask(app.db, req.session!.userId, req.params.id);
      return { ok: true };
    },
  );
}
