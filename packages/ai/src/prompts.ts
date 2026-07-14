import type { SuggestCategoriesInput, SummaryInput } from "./types.ts";

export function categorizationPrompt(input: SuggestCategoriesInput): string {
  const cats = input.categories
    .map((c) => `${c.id}\t${c.kind}\t${c.name}`)
    .join("\n");
  const txns = input.transactions
    .map((t) => `${t.id}\t${(t.amountPaise / 100).toFixed(2)}\t${t.merchant} ${t.description}`.trim())
    .join("\n");
  return [
    "You categorize personal-finance transactions. For each transaction pick the single best category from the list, or null if none fits well.",
    "Return ONLY a JSON array; each item: {\"transactionId\":string,\"categoryId\":string|null,\"confidence\":number between 0 and 1}.",
    "categoryId MUST be an id from the CATEGORIES list. Expense transactions (negative amount) map to expense categories; positive to income.",
    "",
    "CATEGORIES (id<TAB>kind<TAB>name):",
    cats,
    "",
    "TRANSACTIONS (id<TAB>amount<TAB>text):",
    txns,
  ].join("\n");
}

export const SUMMARY_SYSTEM =
  "You write a short, friendly month-in-review for a personal-finance app. " +
  "Use ONLY the numbers provided in FACTS — never invent or recompute figures. " +
  "Two or three short paragraphs, no headings, no markdown tables. " +
  "End with one gentle, clearly-optional suggestion.";

export function summaryPrompt(input: SummaryInput): string {
  const facts = Object.entries(input.facts)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return `Month: ${input.period}\nFACTS:\n${facts}`;
}

export const ASSISTANT_SYSTEM =
  "You are Compass, a helpful personal-finance assistant. Answer using the provided tools, " +
  "which read the user's own data. Never invent numbers — call a tool to get them. " +
  "Be concise. Amounts are in Indian Rupees. If a tool returns no data, say so plainly.";
