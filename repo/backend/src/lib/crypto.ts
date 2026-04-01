/**
 * AES-256-GCM encrypt/decrypt helpers for sensitive data at rest.
 *
 * SPEC: "encrypted secrets and sensitive notes at rest."
 *
 * Algorithm choice — AES-256-GCM:
 *   - 256-bit key satisfies the "AES-256" requirement.
 *   - GCM mode provides authenticated encryption: any tampering with the
 *     ciphertext, auth tag, or IV causes decryption to throw, preventing
 *     silent corruption or padding-oracle attacks.
 *   - No external dependencies — uses Node.js built-in `crypto` module.
 *
 * Key format:
 *   ENCRYPTION_KEY env var must be exactly 64 lowercase hex characters
 *   (= 32 raw bytes).  Generate with:
 *     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Stored value format (single DB column string):
 *   <iv_hex>:<authTag_hex>:<ciphertext_hex>
 *   ├─ iv_hex        24 hex chars  (12 random bytes, unique per encryption)
 *   ├─ authTag_hex   32 hex chars  (16-byte GCM authentication tag)
 *   └─ ciphertext_hex variable     (UTF-8 plaintext encrypted with AES-256-GCM)
 *
 * USAGE — apply to fields before INSERT/UPDATE; reverse after SELECT:
 *   // write path
 *   const encryptedNote = encrypt(rawNote);
 *   await db.insert(ticketEvents).values({ note: encryptedNote, ... });
 *
 *   // read path
 *   const row = await db.select().from(ticketEvents).where(...);
 *   const rawNote = decrypt(row.note);
 *
 *   // nullable column shorthand (most DB fields are nullable)
 *   const stored = encryptNullable(rawNote);   // null → null
 *   const plain  = decryptNullable(row.note);  // null → null
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm' as const;
const IV_BYTES = 12;   // GCM recommended IV length
const TAG_BYTES = 16;  // GCM authentication tag length

/**
 * Resolve and validate the encryption key from the environment.
 * Called lazily so that tests that never touch crypto don't need the var set.
 * Throws clearly if the variable is missing or malformed.
 */
function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). ' +
      `Got ${raw.length} characters.`,
    );
  }
  return Buffer.from(raw, 'hex');
}

/**
 * Encrypt a UTF-8 plaintext string using AES-256-GCM.
 *
 * A fresh random IV is generated for every call — the same plaintext
 * will produce different ciphertext each time, which is correct.
 *
 * @returns Storable string: `iv_hex:authTag_hex:ciphertext_hex`
 * @throws  If ENCRYPTION_KEY is missing or malformed.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Decrypt a string produced by `encrypt()`.
 *
 * @throws If the stored value is malformed (wrong format or wrong segment lengths).
 * @throws If GCM authentication fails (data was tampered with or wrong key used).
 */
export function decrypt(stored: string): string {
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error(
      `Invalid encrypted value: expected 3 colon-separated segments, got ${parts.length}.`,
    );
  }

  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];

  if (ivHex.length !== IV_BYTES * 2) {
    throw new Error(`Invalid IV length: expected ${IV_BYTES * 2} hex chars, got ${ivHex.length}.`);
  }
  if (authTagHex.length !== TAG_BYTES * 2) {
    throw new Error(
      `Invalid auth tag length: expected ${TAG_BYTES * 2} hex chars, got ${authTagHex.length}.`,
    );
  }

  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(), // throws ERR_CRYPTO_GCM_AUTH_TAG_MISMATCH if tampered
  ]);

  return plaintext.toString('utf8');
}

/**
 * Nullable variant of `encrypt`.
 * Passes `null` through unchanged — useful for optional DB columns.
 */
export function encryptNullable(value: string | null): string | null {
  return value === null ? null : encrypt(value);
}

/**
 * Nullable variant of `decrypt`.
 * Passes `null` through unchanged — useful for optional DB columns.
 */
export function decryptNullable(stored: string | null): string | null {
  return stored === null ? null : decrypt(stored);
}
