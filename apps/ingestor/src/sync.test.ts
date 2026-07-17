import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceLastUid, filterNew, planSync, toIngestion, type RawMessage } from "./sync.ts";
import { encryptSecret, decryptSecret } from "./crypto.ts";
import { createGoogleTokenProvider, xoauth2Token } from "./token-provider.ts";

test("planSync: first connect baselines to now, ingests no history", () => {
  const plan = planSync(null, { uidValidity: 111, uidNext: 5000 });
  assert.equal(plan.fromUid, null);
  assert.deepEqual(plan.baseline, { uidValidity: 111, lastUid: 4999 });
});

test("planSync: matching validity fetches strictly after lastUid", () => {
  const plan = planSync({ uidValidity: 111, lastUid: 4999 }, { uidValidity: 111, uidNext: 5010 });
  assert.equal(plan.fromUid, 5000);
  assert.equal(plan.baseline, null);
});

test("planSync: UIDVALIDITY change re-baselines (stored UIDs are invalid)", () => {
  const plan = planSync({ uidValidity: 111, lastUid: 4999 }, { uidValidity: 222, uidNext: 30 });
  assert.equal(plan.fromUid, null);
  assert.deepEqual(plan.baseline, { uidValidity: 222, lastUid: 29 });
});

test("filterNew drops the server's over-returned tail below the floor", () => {
  // `uid FETCH 5000:*` can return uid 4990 when nothing is ≥ 5000
  const msgs = [{ uid: 4990 }, { uid: 5001 }, { uid: 5002 }];
  assert.deepEqual(filterNew(msgs, 5000).map((m) => m.uid), [5001, 5002]);
});

test("advanceLastUid takes the max seen, never regressing", () => {
  assert.equal(advanceLastUid(4999, [5001, 5000, 5002]), 5002);
  assert.equal(advanceLastUid(4999, []), 4999);
  assert.equal(advanceLastUid(5005, [5001]), 5005);
});

test("toIngestion: keeps Message-ID, synthesizes one when absent", () => {
  const base: RawMessage = {
    uid: 42,
    messageId: "<real@bank>",
    fromAddr: "a@b",
    subject: "hi",
    receivedAt: new Date("2026-07-08T00:00:00Z"),
    raw: "raw",
  };
  assert.equal(toIngestion(base, "me@gmail.com").messageId, "<real@bank>");
  assert.equal(
    toIngestion({ ...base, messageId: null }, "me@gmail.com").messageId,
    "<uid-42@me@gmail.com>",
  );
});

test("crypto: secret round-trips, wrong key fails, tamper detected", () => {
  const secret = "x".repeat(40);
  const env = encryptSecret("1//refresh-token-value", secret);
  assert.equal(decryptSecret(env, secret), "1//refresh-token-value");
  assert.throws(() => decryptSecret(env, "y".repeat(40)));
  assert.throws(() => decryptSecret(env.slice(0, -4) + "AAAA", secret));
});

test("xoauth2Token encodes the SASL initial-response", () => {
  const encoded = xoauth2Token("me@gmail.com", "ya29.abc");
  assert.equal(
    Buffer.from(encoded, "base64").toString("utf8"),
    "user=me@gmail.com\x01auth=Bearer ya29.abc\x01\x01",
  );
});

test("google token provider: refresh parses token + expiry, errors on non-2xx", async () => {
  const okFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = new URLSearchParams(init!.body as string);
    assert.equal(body.get("grant_type"), "refresh_token");
    assert.equal(body.get("refresh_token"), "1//rt");
    return new Response(JSON.stringify({ access_token: "ya29.new", expires_in: 3600 }), { status: 200 });
  }) as typeof fetch;
  const p = createGoogleTokenProvider({ clientId: "cid", clientSecret: "sec" }, okFetch);
  const before = Date.now();
  const tok = await p.refresh("1//rt");
  assert.equal(tok.token, "ya29.new");
  // expires ~1h out, refreshed a minute early
  assert.ok(tok.expiresAt > before + 3500 * 1000 && tok.expiresAt <= before + 3600 * 1000);

  const badFetch = (async () => new Response("nope", { status: 400 })) as typeof fetch;
  await assert.rejects(() => createGoogleTokenProvider({ clientId: "c", clientSecret: "s" }, badFetch).refresh("x"));
});
