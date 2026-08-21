/**
 * automation module — physically defines its 2 resident tables + 3 resident enums,
 * re-exports shared tables/enums from the shared layers that this module's
 * services rely on, and imports the shared tables/enums its residents reference
 * via FK.
 *
 * Resident tables/enums are defined here as real `pgTable()`/`pgEnum()` calls
 * (moved verbatim from `db/schema.ts`). Shared tables/enums from other domains
 * that this module's residents FK to are imported from the appropriate shared
 * layer files. `db/schema.ts` is the barrel entry point; this file never imports
 * from `../../db/schema.ts` or from another module's schema.ts.
 */

import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../db/core-schema.ts";
import { accounts, emailIngestions } from "../../db/shared/hubs.ts";

/**
 * `custom` is a generic OpenAI-compatible endpoint (base URL + key + model);
 * the others are named providers with fixed base URLs (see packages/ai/factory).
 */
export const aiProvider = pgEnum("ai_provider", [
  "none",
  "anthropic",
  "ollama",
  "openrouter",
  "deepseek",
  "custom",
]);

/**
 * Per-user AI provider config. Replaces the old global AI_* env vars: the API's
 * AI features and the email extractor both resolve the provider from here. The
 * API key is encrypted at rest with the same secret-box envelope as mailbox
 * secrets (keyed by MAILBOX_SECRET), so the extractor can decrypt it too.
 */
export const aiSettings = pgTable("ai_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: aiProvider("provider").notNull().default("none"),
  /** encrypted API key; "" for ollama/none */
  apiKeyEnc: text("api_key_enc").notNull().default(""),
  /** base URL for ollama/custom; "" otherwise */
  baseUrl: text("base_url").notNull().default(""),
  /** model name; provider default used when "" */
  model: text("model").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiEventKind = pgEnum("ai_event_kind", [
  "email_extract", // an ingested email classified/extracted by the model
  "statement_parse", // a credit-card statement PDF's lines parsed
  "statement_summary", // a statement's rewards/summary parsed
  "categorize", // in-app "Suggest categories"
  "summary", // the monthly narrative summary
  "assistant", // an assistant chat turn
  "goal_roadmap", // goal roadmap narrative (task 5.4)
  "shopping_parse", // paste-text shopping list parse (task 9.4)
]);
export const aiEventStatus = pgEnum("ai_event_status", ["ok", "error"]);

/**
 * One model call, logged for transparency: what context was sent to the LLM and
 * what came back, plus provider/model/latency. Both the API and the extractor
 * write here. `requestContext`/`responseRaw` are the exact strings exchanged, so
 * the event log can show precisely what left the app (only subject/from/body of a
 * mail is ever sent — never the raw headers).
 */
export const aiEvents = pgTable(
  "ai_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: aiEventKind("kind").notNull(),
    status: aiEventStatus("status").notNull(),
    provider: text("provider").notNull().default(""),
    model: text("model").notNull().default(""),
    /** short label for the list row (email subject, "12 transactions", …) */
    title: text("title").notNull().default(""),
    ingestionId: uuid("ingestion_id").references(() => emailIngestions.id, { onDelete: "set null" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    /** exactly what was sent to the model (system + user context), as text */
    requestContext: text("request_context").notNull().default(""),
    /** raw text the model returned */
    responseRaw: text("response_raw").notNull().default(""),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_events_user_created_idx").on(t.userId, t.createdAt.desc())],
);