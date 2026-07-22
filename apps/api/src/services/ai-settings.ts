import { eq } from "drizzle-orm";
import { createAiProvider, NullProvider, type AiObserver, type AiProvider } from "@compass/ai";
import type { AiSettings, UpdateAiSettings } from "@compass/shared";
import { UpdateAiSettingsSchema } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { aiSettings } from "../db/schema.ts";
import { decryptSecret, encryptSecret } from "../lib/secret-box.ts";
import { HttpError } from "../lib/errors.ts";

type Row = typeof aiSettings.$inferSelect;

/** Read model: what the settings page needs, never the key itself. */
export async function getAiSettings(db: Db, userId: string): Promise<AiSettings> {
  const row = await db.query.aiSettings.findFirst({ where: eq(aiSettings.userId, userId) });
  return {
    provider: row?.provider ?? "none",
    baseUrl: row?.baseUrl ?? "",
    model: row?.model ?? "",
    hasApiKey: (row?.apiKeyEnc ?? "") !== "",
  };
}

/**
 * Upsert a user's AI config. `apiKey` is optional: omitted leaves the stored key
 * untouched (so the UI need not round-trip the secret), "" clears it, a value
 * replaces it. The key is encrypted at rest with the app secret.
 */
export async function upsertAiSettings(
  db: Db,
  userId: string,
  input: UpdateAiSettings,
  secret: string,
  allowedBaseUrls: string,
): Promise<AiSettings> {
  const parsed = UpdateAiSettingsSchema.parse(input);
  const current = await db.query.aiSettings.findFirst({ where: eq(aiSettings.userId, userId) });
  const needsKey = ["anthropic", "openrouter", "deepseek", "custom"].includes(parsed.provider);
  const suppliesKey = parsed.apiKey !== undefined && parsed.apiKey !== "";
  const canReuseKey =
    parsed.apiKey === undefined &&
    current?.provider === parsed.provider &&
    current.apiKeyEnc !== "";
  if (needsKey && !suppliesKey && !canReuseKey) {
    throw new HttpError(400, "An API key is required when selecting this provider");
  }
  assertAllowedBaseUrl(parsed.provider, parsed.baseUrl, allowedBaseUrls);
  // A provider that takes no key (ollama/none) never carries one.
  const clearsKey =
    parsed.provider === "none" ||
    parsed.provider === "ollama" ||
    current?.provider !== parsed.provider;
  const apiKeyEnc =
    parsed.apiKey === ""
      ? ""
      : parsed.apiKey !== undefined
        ? encryptSecret(parsed.apiKey, secret)
        : clearsKey
          ? ""
          : undefined; // undefined = leave whatever is stored

  const base = { provider: parsed.provider, baseUrl: parsed.baseUrl, model: parsed.model };
  const set: Partial<Row> = { ...base, updatedAt: new Date() };
  if (apiKeyEnc !== undefined) set.apiKeyEnc = apiKeyEnc;

  await db
    .insert(aiSettings)
    .values({ userId, ...base, apiKeyEnc: apiKeyEnc ?? "" })
    .onConflictDoUpdate({ target: aiSettings.userId, set });

  return getAiSettings(db, userId);
}

/**
 * Build the caller's AI provider from their stored config. No row, or
 * provider `none`, yields the NullProvider (AI disabled). Read per request —
 * AI calls are user-initiated and low-QPS, so there's nothing to cache/invalidate.
 */
export async function getUserAiProvider(
  db: Db,
  userId: string,
  secret: string,
  allowedBaseUrls: string,
  observe?: AiObserver,
): Promise<AiProvider> {
  const row = await db.query.aiSettings.findFirst({ where: eq(aiSettings.userId, userId) });
  if (!row || row.provider === "none") return NullProvider;
  try {
    assertAllowedBaseUrl(row.provider, row.baseUrl, allowedBaseUrls);
  } catch {
    return NullProvider;
  }
  const apiKey = row.apiKeyEnc ? decryptSecret(row.apiKeyEnc, secret) : "";
  return createAiProvider({
    provider: row.provider,
    apiKey,
    baseUrl: row.baseUrl,
    model: row.model,
    observe,
  });
}

export function assertAllowedBaseUrl(
  provider: Row["provider"],
  baseUrl: string,
  allowed: string,
): void {
  if (provider !== "ollama" && provider !== "custom") return;
  const normalized = normalizeBaseUrl(baseUrl);
  const allowlist = allowed
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean)
    .flatMap((url) => {
      try {
        return [normalizeBaseUrl(url)];
      } catch {
        return [];
      }
    });
  if (!allowlist.includes(normalized)) {
    throw new HttpError(400, "This AI base URL is not allowed by the deployment");
  }
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid protocol");
  if (url.username || url.password || url.search || url.hash) throw new Error("invalid base URL");
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
