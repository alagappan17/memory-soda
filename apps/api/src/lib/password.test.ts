import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { hashPassword, verifyPassword } from './password.ts';

/** A hash in the pre-versioning format: Node's scrypt defaults, "salt:hex". */
function legacyHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

test('round-trips a correct password', async () => {
  const stored = await hashPassword('correct horse battery staple');
  const { ok, needsRehash } = await verifyPassword(
    'correct horse battery staple',
    stored,
  );
  assert.equal(ok, true);
  assert.equal(needsRehash, false, 'a fresh hash is already current');
});

test('rejects a wrong password', async () => {
  const stored = await hashPassword('right');
  assert.equal((await verifyPassword('wrong', stored)).ok, false);
});

test('records its parameters so they can be raised later', async () => {
  const stored = await hashPassword('pw');
  const [prefix, n, r, p, salt, hex] = stored.split('$');
  assert.equal(prefix, 'scrypt');
  assert.equal(Number(n), 2 ** 15);
  assert.equal(Number(r), 8);
  assert.equal(Number(p), 3);
  assert.equal(salt.length, 32, '16 random bytes, hex');
  assert.equal(hex.length, 128, '64-byte derived key, hex');
});

test('salts, so the same password hashes differently each time', async () => {
  assert.notEqual(await hashPassword('same'), await hashPassword('same'));
});

test('still verifies legacy hashes, and flags them for upgrade', async () => {
  const stored = legacyHash('old-password');
  const { ok, needsRehash } = await verifyPassword('old-password', stored);
  assert.equal(ok, true, 'existing users must not be locked out');
  assert.equal(needsRehash, true);

  const bad = await verifyPassword('nope', stored);
  assert.equal(bad.ok, false);
  assert.equal(bad.needsRehash, false, 'never rehash on a failed verify');
});

test('returns false rather than throwing on malformed input', async () => {
  const junk = [
    '',
    'nonsense',
    'scrypt$$$$',
    'scrypt$x$8$3$aa$bb',
    'scrypt$0$8$3$aa$' + 'ab'.repeat(64),
    // A short/undecodable key must not authenticate: Buffer.from truncates at
    // the first non-hex character, and an empty key compares equal to the empty
    // key scrypt returns for keylen 0.
    'a:b',
    'aa:zz',
    'aa:' + 'ab'.repeat(8), // valid hex, but only 8 bytes
  ];
  for (const stored of junk) {
    const { ok } = await verifyPassword('pw', stored);
    assert.equal(ok, false, `expected false for ${JSON.stringify(stored)}`);
  }
});
