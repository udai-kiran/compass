import { and, desc, eq } from "drizzle-orm";
import {
  ConnectBundleSchema,
  type MailboxAccount,
  type MailboxCredentialsStatus,
} from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { mailboxAccounts, mailboxCredentials } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { encryptSecret } from "../../../lib/secret-box.ts";

/**
 * Mailbox management for the email→transaction pipeline. Credentials are
 * strictly per user: each user brings their own Google OAuth client, captured
 * on their own machine by the `connect` CLI and handed over as an opaque base64
 * bundle (never a raw form). We store the client secret and the refresh token
 * encrypted; the ingestor resolves them per mailbox at sync time. Secrets are
 * never returned to the client.
 */

/** Encryption key for mailbox secrets; mirrors the ingestor's MAILBOX_SECRET. */
export function mailboxSecret(config: { MAILBOX_SECRET: string; SESSION_SECRET: string }): string {
  return config.MAILBOX_SECRET || config.SESSION_SECRET;
}

type MailboxRow = typeof mailboxAccounts.$inferSelect;

function toDto(row: MailboxRow): MailboxAccount {
  return {
    id: row.id,
    provider: row.provider,
    emailAddress: row.emailAddress,
    folder: row.folder,
    status: row.status,
    lastError: row.lastError,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listMailboxes(db: Db, userId: string): Promise<MailboxAccount[]> {
  const rows = await db
    .select()
    .from(mailboxAccounts)
    .where(eq(mailboxAccounts.userId, userId))
    .orderBy(desc(mailboxAccounts.createdAt));
  return rows.map(toDto);
}

/** Decode the base64 bundle the CLI printed. Throws a 400 on anything malformed. */
function decodeBundle(bundle: string) {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(bundle.trim(), "base64").toString("utf8"));
  } catch {
    throw new HttpError(400, "That doesn't look like a valid bundle — copy the whole line the connect CLI printed.");
  }
  const parsed = ConnectBundleSchema.safeParse(json);
  if (!parsed.success) {
    throw new HttpError(400, "The bundle is missing required fields — re-run the connect CLI and paste its full output.");
  }
  return parsed.data;
}

/**
 * Store a per-user client + one mailbox from a connect bundle. Upserts so
 * re-onboarding the same address (rotating the token) or updating client
 * credentials just overwrites in place.
 */
export async function addMailboxFromBundle(
  db: Db,
  userId: string,
  bundle: string,
  secret: string,
): Promise<MailboxAccount> {
  const b = decodeBundle(bundle);

  return db.transaction(async (tx) => {
    await tx
      .insert(mailboxCredentials)
      .values({
        userId,
        provider: b.provider,
        clientId: b.clientId,
        clientSecretEnc: encryptSecret(b.clientSecret, secret),
      })
      .onConflictDoUpdate({
        target: [mailboxCredentials.userId, mailboxCredentials.provider],
        set: {
          clientId: b.clientId,
          clientSecretEnc: encryptSecret(b.clientSecret, secret),
          updatedAt: new Date(),
        },
      });

    const [row] = await tx
      .insert(mailboxAccounts)
      .values({
        userId,
        provider: b.provider,
        emailAddress: b.email,
        refreshTokenEnc: encryptSecret(b.refreshToken, secret),
        folder: b.folder,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [mailboxAccounts.userId, mailboxAccounts.emailAddress],
        set: {
          provider: b.provider,
          refreshTokenEnc: encryptSecret(b.refreshToken, secret),
          folder: b.folder,
          status: "active",
          lastError: null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return toDto(row!);
  });
}

export async function removeMailbox(db: Db, userId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(mailboxAccounts)
    .where(and(eq(mailboxAccounts.userId, userId), eq(mailboxAccounts.id, id)))
    .returning({ id: mailboxAccounts.id });
  if (deleted.length === 0) throw new HttpError(404, "Mailbox not found");
}

/** Whether the user has Google client credentials on file (client id only, no secret). */
export async function getCredentialsStatus(
  db: Db,
  userId: string,
): Promise<MailboxCredentialsStatus> {
  const row = await db.query.mailboxCredentials.findFirst({
    where: and(eq(mailboxCredentials.userId, userId), eq(mailboxCredentials.provider, "google")),
  });
  return { configured: row !== undefined, clientId: row?.clientId ?? null };
}
