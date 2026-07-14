import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

/**
 * Envelope format for encrypted backups (all lengths fixed, then ciphertext):
 *   magic "CMPB1" (5) | salt (16) | iv (12) | authTag (16) | gzip(ciphertext)
 * AES-256-GCM with a scrypt-derived key. Self-describing so restore needs only
 * the passphrase.
 */
const MAGIC = Buffer.from("CMPB1");

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
