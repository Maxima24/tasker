import crypto from 'node:crypto';

/**
 * AES-256-GCM envelope for external-platform account credentials at rest.
 * Ported from SwiftHum's credential-crypto, with one addition the PRD requires:
 * a key VERSION travels with every row so the key can be rotated without a
 * flag day (section 22 - "key version stored per row to permit rotation").
 *
 * Packed format: base64(iv):base64(authTag):base64(ciphertext).
 * The key material lives in the environment, never in the database.
 */
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

export const CURRENT_KEY_VERSION = 1;

function deriveKey(secret: string, version: number): Buffer {
  if (!secret) throw new Error('VAULT_KEY_SECRET is not set');
  // Versioned derivation: rotating the version yields a different key from the
  // same secret, so v1 rows stay readable after v2 rows start being written.
  return crypto.createHash('sha256').update(`v${version}:${secret}`).digest();
}

export function encryptCredential(
  plaintext: string,
  secret: string,
  version: number = CURRENT_KEY_VERSION,
): { ciphertext: string; keyVersion: number } {
  const key = deriveKey(secret, version);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':'),
    keyVersion: version,
  };
}

export function decryptCredential(packed: string, secret: string, version: number): string {
  const parts = packed.split(':');
  if (parts.length !== 3) throw new Error('malformed credential ciphertext');
  const [ivB64, tagB64, ctB64] = parts;
  const key = deriveKey(secret, version);
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
