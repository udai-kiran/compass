import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { decryptBackup, decryptBackupV2File, encryptBackup, encryptBackupStream } from "./crypto-backup.ts";

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

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

test("v2 stream envelope round-trips through files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cmpb-test-"));
  try {
    const payload = Buffer.concat([Buffer.from("archive bytes "), Buffer.alloc(100_000, 7)]);
    const envelope = await collect(
      encryptBackupStream(Readable.from([payload]), "correct horse battery staple"),
    );
    assert.equal(envelope.subarray(0, 5).toString(), "CMPB2");

    const src = join(dir, "backup.cmpb");
    const dest = join(dir, "plain");
    await writeFile(src, envelope);
    await decryptBackupV2File(src, dest, "correct horse battery staple");
    assert.deepEqual(await readFile(dest), payload);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("v2 decrypt rejects a wrong passphrase and tampered bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cmpb-test-"));
  try {
    const envelope = await collect(encryptBackupStream(Readable.from([Buffer.from("secret")]), "right-key"));
    const src = join(dir, "backup.cmpb");
    await writeFile(src, envelope);
    await assert.rejects(decryptBackupV2File(src, join(dir, "p1"), "wrong-key"));

    const i = envelope.length - 20; // inside the ciphertext, not the tag
    envelope[i] = (envelope[i]! ^ 0xff) & 0xff;
    await writeFile(src, envelope);
    await assert.rejects(decryptBackupV2File(src, join(dir, "p2"), "right-key"));

    await writeFile(src, Buffer.from("not a backup at all, but long enough to pass the size check"));
    await assert.rejects(decryptBackupV2File(src, join(dir, "p3"), "right-key"), /Not a Compass backup/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
