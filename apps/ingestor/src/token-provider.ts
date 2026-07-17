export type MailboxProvider = "google" | "microsoft";

export interface AccessToken {
  token: string;
  /** epoch ms when this token should be considered expired */
  expiresAt: number;
}

/** Turns a stored refresh token into a short-lived access token for XOAUTH2. */
export interface TokenProvider {
  readonly provider: MailboxProvider;
  /** IMAP host to connect to for this provider */
  readonly imapHost: string;
  readonly imapPort: number;
  refresh(refreshToken: string): Promise<AccessToken>;
}

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

type FetchImpl = typeof fetch;

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Google provider. Exchanges a refresh token at the OAuth2 token endpoint; the
 * access token is short-lived (~1h), so callers cache it and re-refresh near
 * expiry. Kept behind {@link TokenProvider} so Microsoft/Graph can slot in
 * without touching the IMAP loop.
 */
export function createGoogleTokenProvider(
  creds: GoogleCredentials,
  fetchImpl: FetchImpl = fetch,
): TokenProvider {
  return {
    provider: "google",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    async refresh(refreshToken: string): Promise<AccessToken> {
      const res = await fetchImpl(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });
      if (!res.ok) {
        throw new Error(`Google token refresh failed (${res.status})`);
      }
      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!data.access_token) throw new Error("Google token refresh returned no access_token");
      // Refresh a minute early to avoid using a token that expires mid-connection.
      const expiresAt = Date.now() + ((data.expires_in ?? 3600) - 60) * 1000;
      return { token: data.access_token, expiresAt };
    },
  };
}

export function getTokenProvider(
  provider: MailboxProvider,
  creds: GoogleCredentials,
  fetchImpl: FetchImpl = fetch,
): TokenProvider {
  switch (provider) {
    case "google":
      return createGoogleTokenProvider(creds, fetchImpl);
    case "microsoft":
      throw new Error("Microsoft/Graph mailboxes are not supported yet");
    default:
      throw new Error(`Unknown mailbox provider: ${String(provider)}`);
  }
}

/**
 * Build the SASL XOAUTH2 initial-response string. imapflow accepts the raw
 * access token directly, but exposing the encoder makes the wire format
 * testable and documents exactly what is sent.
 */
export function xoauth2Token(user: string, accessToken: string): string {
  return Buffer.from(`user=${user}\x01auth=Bearer ${accessToken}\x01\x01`).toString("base64");
}
