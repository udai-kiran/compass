import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateFamilyMemberSchema,
  FamilyMemberSchema,
  UpdateFamilyMemberSchema,
  UpdateUserProfileSchema,
  UserProfileSchema,
} from "@compass/shared";
import {
  createFamilyMember,
  deleteFamilyMember,
  getUserProfile,
  listFamilyMembers,
  updateFamilyMember,
  updateUserProfile,
} from "../services/profile.ts";

export async function profileRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/profile",
    { schema: { response: { 200: UserProfileSchema } } },
    async (req) => getUserProfile(app.db, req.session!.userId),
  );

  r.put(
    "/api/profile",
    {
      schema: {
        body: UpdateUserProfileSchema,
        response: { 200: UserProfileSchema },
      },
    },
    async (req) => updateUserProfile(app.db, req.session!.userId, req.body),
  );

  r.get(
    "/api/family",
    { schema: { response: { 200: z.array(FamilyMemberSchema) } } },
    async (req) => listFamilyMembers(app.db, req.session!.userId),
  );

  r.post(
    "/api/family",
    {
      schema: {
        body: CreateFamilyMemberSchema,
        response: { 200: FamilyMemberSchema },
      },
    },
    async (req) => createFamilyMember(app.db, req.session!.userId, req.body),
  );

  r.patch(
    "/api/family/:id",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: UpdateFamilyMemberSchema,
        response: { 200: FamilyMemberSchema },
      },
    },
    async (req) => updateFamilyMember(app.db, req.session!.userId, req.params.id, req.body),
  );

  r.delete(
    "/api/family/:id",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      await deleteFamilyMember(app.db, req.session!.userId, req.params.id);
      return { ok: true };
    },
  );
}
