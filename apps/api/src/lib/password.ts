import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const KEYLEN = 64;

/**
 * Hash a plaintext password with a per-password random salt using scrypt.
 * Returns "salt:derivedKey" (both hex). No external dependency — node:crypto only.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, KEYLEN).toString('hex');
  return `${salt}:${derived}`;
}

/**
 * Verify a plaintext password against a stored "salt:derivedKey" hash.
 * Uses a constant-time comparison to avoid timing leaks.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, derivedHex] = stored.split(':');
  if (!salt || !derivedHex) return false;

  const expected = Buffer.from(derivedHex, 'hex');
  const actual = scryptSync(password, salt, KEYLEN);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
