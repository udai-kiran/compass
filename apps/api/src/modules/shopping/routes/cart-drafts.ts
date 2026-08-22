/** Advisory cart-draft routes (task 11.2), registered below /api/shopping. */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CartDraftWithItemsSchema,
  GenerateDraftResponseSchema,
  UpdateCartDraftItemSchema,
} from "@compass/shared";
import { and, desc, eq } from "drizzle-orm";
import { cartDraftItems, cartDrafts, habitProfiles } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { assertOwnedDraft } from "../services/ownership.ts";
import {
  calculateDraftTotalPaise,
  decrementObservationCount,
  generateDraft,
  getDraftWithItems,
} from "../services/cart-draft-generator.ts";

const DraftParams = z.object({ id: z.uuid() });
const DraftItemParams = DraftParams.extend({ itemId: z.uuid() });
const CartDraftListResponseSchema = z.object({ drafts: z.array(CartDraftWithItemsSchema) });

export async function shoppingCartDraftRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/drafts/generate",
    { schema: { response: { 200: GenerateDraftResponseSchema } } },
    async (req) => {
      const draft = await generateDraft(app.db, req.session!.userId);
      return {
        draft,
        generated: draft.items.length,
        substitutions: draft.items.filter((item) => item.substitutionForItemId !== null).length,
      };
    },
  );

  r.get(
    "/drafts",
    { schema: { response: { 200: CartDraftListResponseSchema } } },
    async (req) => {
      const rows = await app.db.query.cartDrafts.findMany({
        where: eq(cartDrafts.userId, req.session!.userId),
        orderBy: [desc(cartDrafts.generatedAt)],
      });
      const drafts = await Promise.all(rows.map((draft) => getDraftWithItems(app.db, draft.id)));
      return { drafts: drafts.filter((draft): draft is NonNullable<typeof draft> => draft !== null) };
    },
  );

  r.get(
    "/drafts/:id",
    { schema: { params: DraftParams, response: { 200: CartDraftWithItemsSchema } } },
    async (req) => {
      await assertOwnedDraft(app.db, req.session!.userId, req.params.id);
      return (await getDraftWithItems(app.db, req.params.id))!;
    },
  );

  r.put(
    "/drafts/:id/items/:itemId",
    {
      schema: {
        params: DraftItemParams,
        body: UpdateCartDraftItemSchema,
        response: { 200: CartDraftWithItemsSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return app.db.transaction(async (tx) => {
        await assertOwnedDraft(tx, userId, req.params.id);
        const item = await tx.query.cartDraftItems.findFirst({
          where: and(eq(cartDraftItems.id, req.params.itemId), eq(cartDraftItems.cartDraftId, req.params.id)),
        });
        if (!item) throw new HttpError(404, "Cart draft item not found");

        await tx
          .update(cartDraftItems)
          .set({
            quantityBase: req.body.quantityBase,
            unit: req.body.unit,
            isRemoved: req.body.isRemoved,
          })
          .where(eq(cartDraftItems.id, item.id));

        // Only a false → true removal is a teaching signal; edits/retries do not repeat it.
        const teachItemId = item.substitutionForItemId ?? item.catalogItemId;
        if (!item.isRemoved && req.body.isRemoved && teachItemId) {
          const habit = await tx.query.habitProfiles.findFirst({
            where: and(eq(habitProfiles.userId, userId), eq(habitProfiles.catalogItemId, teachItemId)),
          });
          if (habit) {
            await tx
              .update(habitProfiles)
              .set({ observationCount: decrementObservationCount(habit.observationCount), updatedAt: new Date() })
              .where(eq(habitProfiles.id, habit.id));
          }
        }

        const allItems = await tx.query.cartDraftItems.findMany({
          where: eq(cartDraftItems.cartDraftId, req.params.id),
          columns: { suggestedPricePaise: true, isRemoved: true },
        });
        await tx
          .update(cartDrafts)
          .set({ totalPaise: calculateDraftTotalPaise(allItems), updatedAt: new Date() })
          .where(eq(cartDrafts.id, req.params.id));
        return (await getDraftWithItems(tx, req.params.id))!;
      });
    },
  );

  r.delete(
    "/drafts/:id",
    { schema: { params: DraftParams, response: { 204: z.void() } } },
    async (req, reply) => {
      await assertOwnedDraft(app.db, req.session!.userId, req.params.id);
      await app.db
        .update(cartDrafts)
        .set({ status: "abandoned", updatedAt: new Date() })
        .where(and(eq(cartDrafts.id, req.params.id), eq(cartDrafts.userId, req.session!.userId)));
      return reply.code(204).send();
    },
  );
}
