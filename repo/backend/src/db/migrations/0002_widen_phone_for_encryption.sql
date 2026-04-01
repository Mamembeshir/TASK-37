-- Migration: widen users.phone from varchar(20) to text
--
-- Reason: AES-256-GCM encrypted values use the format
--   iv_hex:authTag_hex:ciphertext_hex
-- A 15-char plaintext phone produces ~88 chars in this format.
-- varchar(20) cannot hold encrypted content; text is unbounded.
--
-- This is a safe, non-destructive change in PostgreSQL:
-- widening varchar to text never rewrites existing rows.

ALTER TABLE "users" ALTER COLUMN "phone" TYPE text;
