import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

interface ScryptParams {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}

/**
 * `promisify(scrypt)` cannot pick the right overload — the callback form has
 * one signature with options and one without — so it resolves to a shape that
 * has to be asserted back. Wrapping the callback directly keeps the types
 * honest for the cost of five lines.
 */
function scryptAsync(
  password: string,
  salt: string,
  keylen: number,
  options: ScryptParams,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

const KEYLEN = 64;

/**
 * OWASP Password Storage Cheat Sheet (2026) lists several scrypt configurations
 * that give a similar minimal defence, trading RAM against parallelism. We take
 * the 32 MiB rung (N=2^15, r=8, p=3) rather than the 128 MiB one: a self-hosted
 * box should not need 128 MiB of headroom per concurrent login.
 *
 * Memory is 128 * N * r, so `maxmem` (Node defaults to 32 MiB) must be raised or
 * scrypt refuses to run.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 3 };
const MAXMEM = 256 * 1024 * 1024;

/**
 * Hashes written before parameters were recorded used Node's scrypt defaults and
 * the format "salt:derivedHex". They still verify; a successful login re-hashes
 * them with the current parameters (see `needsRehash`).
 */
const LEGACY_PARAMS = { N: 16384, r: 8, p: 1 };

const PREFIX = 'scrypt';

/**
 * Hash a plaintext password. Output is
 * `scrypt$N$r$p$saltHex$derivedHex` — self-describing, so the parameters can be
 * raised later without invalidating existing hashes.
 *
 * Async: scryptSync blocks the event loop for the whole derivation, which at
 * these parameters is hundreds of milliseconds.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, KEYLEN, {
    ...PARAMS,
    maxmem: MAXMEM,
  });
  const { N, r, p } = PARAMS;
  return `${PREFIX}$${N}$${r}$${p}$${salt}$${derived.toString('hex')}`;
}

interface ParsedHash {
  params: { N: number; r: number; p: number };
  salt: string;
  derived: Buffer;
  legacy: boolean;
}

/**
 * Strict hex decode. `Buffer.from` silently truncates at the first invalid
 * character, so `Buffer.from('b', 'hex')` is empty — and an empty derived key
 * compares equal to the empty key scrypt returns for keylen 0, which would make
 * a malformed stored hash accept *any* password. Reject anything that is not a
 * full-length key.
 */
const MIN_KEYLEN = 32;

function decodeKey(hex: string): Buffer | null {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  const buf = Buffer.from(hex, 'hex');
  return buf.length >= MIN_KEYLEN ? buf : null;
}

function parseHash(stored: string): ParsedHash | null {
  if (stored.startsWith(`${PREFIX}$`)) {
    const [, n, r, p, salt, hex] = stored.split('$');
    if (!n || !r || !p || !salt || !hex) return null;
    const params = { N: Number(n), r: Number(r), p: Number(p) };
    if (!Object.values(params).every((v) => Number.isInteger(v) && v > 0)) {
      return null;
    }
    const derived = decodeKey(hex);
    return derived ? { params, salt, derived, legacy: false } : null;
  }

  // Legacy "salt:derivedHex".
  const [salt, hex] = stored.split(':');
  if (!salt || !hex) return null;
  const derived = decodeKey(hex);
  return derived
    ? { params: LEGACY_PARAMS, salt, derived, legacy: true }
    : null;
}

/**
 * Verify a plaintext password against a stored hash, in constant time with
 * respect to the derived key.
 *
 * @returns `ok` — whether the password matches. `needsRehash` — whether the
 *   stored hash used weaker parameters than the current ones, so the caller can
 *   transparently upgrade it after a successful login.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  const parsed = parseHash(stored);
  if (!parsed) return { ok: false, needsRehash: false };

  let actual: Buffer;
  try {
    actual = await scryptAsync(password, parsed.salt, parsed.derived.length, {
      ...parsed.params,
      maxmem: MAXMEM,
    });
  } catch {
    return { ok: false, needsRehash: false };
  }

  if (actual.length !== parsed.derived.length) {
    return { ok: false, needsRehash: false };
  }
  const ok = timingSafeEqual(actual, parsed.derived);
  const outdated =
    parsed.legacy ||
    parsed.params.N < PARAMS.N ||
    parsed.params.r < PARAMS.r ||
    parsed.params.p < PARAMS.p;
  return { ok, needsRehash: ok && outdated };
}
