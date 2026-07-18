import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Symmetric encryption for a short secret (the OAuth2 refresh token) stored in
 * mailbox_accounts.refresh_token_enc. AES-256-GCM with a scrypt-derived key, the
 * same primitives the backup envelope uses. Serialized as:
 *   "v1:" + base64( salt(16) | iv(12) | authTag(16) | ciphertext )
 */
const PREFIX = "v1:";

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32);
}

export function encryptSecret(plaintext: string, secret: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([salt, iv, authTag, ciphertext]).toString("base64");
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
