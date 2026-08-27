import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque bearer tokens — API keys and login sessions both.
 *
 * The plaintext is shown to the caller exactly once and only its SHA-256 is
 * stored, so a database leak does not hand over working credentials. SHA-256
 * rather than a password hash is deliberate: these are 256 bits of entropy we
 * generated, not something a human chose, so there is nothing to brute-force
 * and the lookup has to be fast enough to run on every request.
 */

const TOKEN_BYTES = 32;

export interface IssuedToken {
  /** Shown to the caller once. Never stored. */
  plaintext: string;
  /** What goes in the database. */
  hash: string;
  /** Safe to display: enough to recognise the key, not enough to use it. */
  preview: string;
}

export function issueToken(prefix: string): IssuedToken {
  const plaintext = prefix + randomBytes(TOKEN_BYTES).toString('hex');
  return {
    plaintext,
    hash: hashToken(plaintext),
    preview: `${plaintext.slice(0, 10)}...${plaintext.slice(-4)}`,
  };
}

export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Pull the token out of an `Authorization: Bearer <token>` header, or null when
 * the header is missing or malformed.
 */
export function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}
