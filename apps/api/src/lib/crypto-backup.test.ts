import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptBackup, encryptBackup } from "./crypto-backup.ts";

test("encrypt/decrypt round-trips arbitrary data", () => {
  const data = Buffer.from(JSON.stringify({ hello: "world", n: 42, arr: [1, 2, 3] }));
  const enc = encryptBackup(data, "correct horse battery staple");
  assert.ok(enc.subarray(0, 5).toString() === "CMPB1");
  const dec = decryptBackup(enc, "correct horse battery staple");
  assert.deepEqual(dec, data);
});

test("wrong passphrase fails authentication", () => {
  const enc = encryptBackup(Buffer.from("secret"), "right-key");
  assert.throws(() => decryptBackup(enc, "wrong-key"));
});

test("tampered ciphertext fails the auth tag", () => {
  const enc = encryptBackup(Buffer.from("secret data here"), "k");
  const i = enc.length - 1;
  enc[i] = (enc[i]! ^ 0xff) & 0xff;
  assert.throws(() => decryptBackup(enc, "k"));
});

test("rejects a non-backup file", () => {
  assert.throws(() => decryptBackup(Buffer.from("not a backup"), "k"), /Not a Compass backup/);
});
