import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { PassThrough, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip, gzipSync, gunzipSync } from "node:zlib";

/**
 * Envelope format for encrypted backups (all lengths fixed, then ciphertext):
 *   magic "CMPB1" (5) | salt (16) | iv (12) | authTag (16) | gzip(ciphertext)
 * AES-256-GCM with a scrypt-derived key. Self-describing so restore needs only
 * the passphrase.
 */
const MAGIC = Buffer.from("CMPB1");

/**
 * v2 envelope, used by the streamed per-user archive: the auth tag moves to the
 * END so the whole envelope can be produced without buffering or backpatching:
 *   magic "CMPB2" (5) | salt (16) | iv (12) | gzip-then-encrypted payload | authTag (16)
 */
const MAGIC_V2 = Buffer.from("CMPB2");
const V2_HEADER_BYTES = MAGIC_V2.length + 16 + 12;
const AUTH_TAG_BYTES = 16;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32);
}

/** gzip then AES-256-GCM encrypt a plaintext buffer into the envelope format. */
export function encryptBackup(plaintext: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const compressed = gzipSync(plaintext);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, authTag, ciphertext]);
}

/**
 * Encrypt a plaintext stream into a v2 envelope, constant-memory: the source is
 * gzipped and encrypted chunk by chunk, and the auth tag is appended once the
 * cipher finishes. Errors anywhere in the chain destroy the returned stream.
 */
export function encryptBackupStream(source: Readable, passphrase: string): Readable {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const gzip = createGzip();
  const out = new PassThrough();
  out.write(Buffer.concat([MAGIC_V2, salt, iv]));
  source.pipe(gzip).pipe(cipher);
  cipher.pipe(out, { end: false });
  cipher.on("end", () => out.end(cipher.getAuthTag()));
  for (const s of [source, gzip, cipher]) s.on("error", (err) => out.destroy(err as Error));
  return out;
}

/**
 * Decrypt a v2 envelope file to a plaintext file, constant-memory. Resolves only
 * after the auth tag verifies — the destination must not be read if this throws.
 */
export async function decryptBackupV2File(
  srcPath: string,
  destPath: string,
  passphrase: string,
): Promise<void> {
  const { size } = await stat(srcPath);
  if (size < V2_HEADER_BYTES + AUTH_TAG_BYTES) throw new Error("Not a Compass backup file");
  const head = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    createReadStream(srcPath, { start: 0, end: V2_HEADER_BYTES - 1 })
      .on("data", (c) => chunks.push(c as Buffer))
      .on("end", () => resolve(Buffer.concat(chunks)))
      .on("error", reject);
  });
  if (!head.subarray(0, 5).equals(MAGIC_V2)) throw new Error("Not a Compass backup file");
  const salt = head.subarray(5, 21);
  const iv = head.subarray(21, 33);
  const authTag = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    createReadStream(srcPath, { start: size - AUTH_TAG_BYTES })
      .on("data", (c) => chunks.push(c as Buffer))
      .on("end", () => resolve(Buffer.concat(chunks)))
      .on("error", reject);
  });
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(authTag);
  await pipeline(
    createReadStream(srcPath, { start: V2_HEADER_BYTES, end: size - AUTH_TAG_BYTES - 1 }),
    decipher,
    createGunzip(),
    createWriteStream(destPath),
  );
}

/** Reverse of encryptBackup; throws if the passphrase is wrong or data tampered. */
export function decryptBackup(envelope: Buffer, passphrase: string): Buffer {
  if (!envelope.subarray(0, 5).equals(MAGIC)) throw new Error("Not a Compass backup file");
  const salt = envelope.subarray(5, 21);
  const iv = envelope.subarray(21, 33);
  const authTag = envelope.subarray(33, 49);
  const ciphertext = envelope.subarray(49);
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return gunzipSync(compressed);
}
