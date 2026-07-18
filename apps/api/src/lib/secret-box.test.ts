import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptSecret, encryptSecret } from "./secret-box.ts";

test("encrypt/decrypt round-trips a secret", () => {
  const enc = encryptSecret("1//refresh-token-value", "correct horse battery staple");
  assert.ok(enc.startsWith("v1:"));
  assert.equal(decryptSecret(enc, "correct horse battery staple"), "1//refresh-token-value");
});

test("each encryption is unique (random salt + iv)", () => {
  const a = encryptSecret("same", "key");
  const b = encryptSecret("same", "key");
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a, "key"), "same");
  assert.equal(decryptSecret(b, "key"), "same");
});

test("wrong key fails authentication", () => {
  const enc = encryptSecret("secret", "right-key");
  assert.throws(() => decryptSecret(enc, "wrong-key"));
});

test("tampered ciphertext fails the auth tag", () => {
  const enc = encryptSecret("secret data here", "k");
  const buf = Buffer.from(enc.slice(3), "base64");
  buf[buf.length - 1] = (buf[buf.length - 1]! ^ 0xff) & 0xff;
  assert.throws(() => decryptSecret("v1:" + buf.toString("base64"), "k"));
});

test("rejects an unrecognized envelope", () => {
  assert.throws(() => decryptSecret("not-an-envelope", "k"), /Unrecognized secret envelope/);
});
