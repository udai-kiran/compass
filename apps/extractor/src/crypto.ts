import { createDecipheriv, scryptSync } from "node:crypto";

/**
 * Decrypts short secrets stored by the API (here: the per-user AI API key in
 * ai_settings). AES-256-GCM, scrypt-derived key. Envelope:
 *   "v1:" + base64( salt(16) | iv(12) | authTag(16) | ciphertext )
 *
 * IMPORTANT: must stay byte-for-byte identical to apps/api/src/lib/secret-box.ts
 * and apps/ingestor/src/crypto.ts — all three share the MAILBOX_SECRET envelope.
 */
const PREFIX = "v1:";

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32);
}

export function decryptSecret(envelope: string, secret: string): string {
  if (!envelope.startsWith(PREFIX)) throw new Error("Unrecognized secret envelope");
  const buf = Buffer.from(envelope.slice(PREFIX.length), "base64");
  const salt = buf.subarray(0, 16);
  const iv = buf.subarray(16, 28);
  const authTag = buf.subarray(28, 44);
  const ciphertext = buf.subarray(44);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret, salt), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
