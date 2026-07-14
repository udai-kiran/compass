import { z } from "zod";

export const SearchResultsSchema = z.object({
  transactions: z.array(
    z.object({
      id: z.uuid(),
      merchant: z.string(),
      amountPaise: z.number().int(),
      date: z.iso.date(),
    }),
  ),
  categories: z.array(z.object({ id: z.uuid(), name: z.string() })),
  accounts: z.array(z.object({ id: z.uuid(), name: z.string() })),
  goals: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type SearchResults = z.infer<typeof SearchResultsSchema>;
