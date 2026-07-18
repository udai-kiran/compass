import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { loadConfig } from "./config.ts";
import { encryptSecret } from "./crypto.ts";
import { createPool, resolveUserId, upsertMailbox } from "./db.ts";

/**
 * One-time mailbox onboarding. Runs Google's OAuth2 authorization-code flow with
 * a loopback redirect + PKCE to obtain a long-lived refresh token, encrypts it,
 * and stores it in mailbox_accounts. Re-running for the same address rotates the
 * token.
 *
 *   npm run connect -w apps/ingestor -- <mailbox-email> [--folder INBOX] [--as <app-user-email>]
 *
 * Requires GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (a "Web application" OAuth
 * client) with http://127.0.0.1:<OAUTH_REDIRECT_PORT> as an authorized redirect.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://mail.google.com/";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function main(): Promise<void> {
  const config = loadConfig();
  const mailboxEmail = process.argv[2];
  if (!mailboxEmail || mailboxEmail.startsWith("--")) {
    console.error("usage: npm run connect -w apps/ingestor -- <mailbox-email> [--folder INBOX] [--as <app-user-email>]");
    process.exit(1);
  }
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    console.error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set to connect a Google mailbox.");
    process.exit(1);
  }
  const folder = arg("folder") ?? "INBOX";
  const asEmail = arg("as");
  const redirectUri = `http://127.0.0.1:${config.OAUTH_REDIRECT_PORT}`;

  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  const authUrl =
    `${AUTH_URL}?` +
    new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      login_hint: mailboxEmail,
    }).toString();

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      const gotCode = url.searchParams.get("code");
      const gotState = url.searchParams.get("state");
      const err = url.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html" });
      if (err || !gotCode || gotState !== state) {
        res.end("<h3>Authorization failed. You can close this tab.</h3>");
        server.close();
        reject(new Error(err ?? "missing code / state mismatch"));
        return;
      }
      res.end("<h3>Connected. You can close this tab and return to the terminal.</h3>");
      server.close();
      resolve(gotCode);
    });
    server.listen(config.OAUTH_REDIRECT_PORT, "127.0.0.1", () => {
      console.log("\nOpen this URL in a browser signed in as", mailboxEmail, ":\n");
      console.log(authUrl, "\n");
      console.log(`Waiting for the redirect to ${redirectUri} ...`);
    });
    server.on("error", reject);
  });

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
  }
  const tokens = (await tokenRes.json()) as { refresh_token?: string };
  if (!tokens.refresh_token) {
    throw new Error("No refresh_token returned. Revoke prior access at myaccount.google.com and retry.");
  }

  const pool = createPool(config.DATABASE_URL);
  try {
    const userId = await resolveUserId(pool, asEmail);
    if (!userId) throw new Error(asEmail ? `No app user with email ${asEmail}` : "No users found in the database");
    const id = await upsertMailbox(pool, {
      userId,
      provider: "google",
      emailAddress: mailboxEmail,
      refreshTokenEnc: encryptSecret(tokens.refresh_token, config.MAILBOX_SECRET),
      folder,
    });
    console.log(`\n✓ Connected ${mailboxEmail} (folder ${folder}) → mailbox ${id}`);
    console.log("The ingestor will pick it up on its next pass.");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("connect failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
