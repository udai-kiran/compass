import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { encodeBundle } from "./bundle.ts";

/**
 * One-time mailbox onboarding, run on YOUR OWN machine (the one with a browser).
 * It runs Google's OAuth2 authorization-code flow with a loopback redirect +
 * PKCE to obtain a long-lived refresh token, then prints a base64 "bundle" you
 * paste into Compass → Settings → Mailboxes. It talks only to Google — no DB,
 * Redis, or Compass access — so it works even when Compass is headless on a
 * remote/Tailscale host.
 *
 *   npm run connect -w apps/ingestor -- <mailbox-email> \
 *     --client-id <id> --client-secret <secret> [--folder INBOX] [--port 53682]
 *
 * The Google client must be your own OAuth client whose authorized redirect is
 * the loopback URI printed below (http://127.0.0.1:<port>). Google only accepts
 * loopback or an https URL on a registered domain — hence the local flow.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://mail.google.com/";
const PROVIDER = "google" as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function main(): Promise<void> {
  const mailboxEmail = process.argv[2];
  const clientId = arg("client-id");
  const clientSecret = arg("client-secret");
  const folder = arg("folder") ?? "INBOX";
  const port = Number(arg("port") ?? "53682");

  if (!mailboxEmail || mailboxEmail.startsWith("--") || !clientId || !clientSecret) {
    console.error(
      "usage: npm run connect -w apps/ingestor -- <mailbox-email> " +
        "--client-id <id> --client-secret <secret> [--folder INBOX] [--port 53682]",
    );
    process.exit(1);
  }
  const redirectUri = `http://127.0.0.1:${port}`;

  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  const authUrl =
    `${AUTH_URL}?` +
    new URLSearchParams({
      client_id: clientId,
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
    server.listen(port, "127.0.0.1", () => {
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
      client_id: clientId,
      client_secret: clientSecret,
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

  const bundle = encodeBundle({
    v: 1,
    provider: PROVIDER,
    email: mailboxEmail,
    folder,
    clientId,
    clientSecret,
    refreshToken: tokens.refresh_token,
  });

  console.log(`\n✓ Captured ${mailboxEmail}. Paste this into Compass → Settings → Mailboxes:\n`);
  console.log(bundle, "\n");
}

main().catch((err: unknown) => {
  console.error("connect failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
