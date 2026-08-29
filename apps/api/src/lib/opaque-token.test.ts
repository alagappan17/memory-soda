import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearerToken, hashToken, issueToken } from './opaque-token.ts';

test('issueToken: prefixed plaintext, sha256 stored, preview is not usable', () => {
  const t = issueToken('ms_');
  assert.match(t.plaintext, /^ms_[0-9a-f]{64}$/);
  assert.equal(t.hash, hashToken(t.plaintext));
  assert.notEqual(t.hash, t.plaintext);
  assert.match(t.preview, /^ms_[0-9a-f]{7}\.\.\.[0-9a-f]{4}$/);
  assert.notEqual(issueToken('ms_').plaintext, t.plaintext);
});

test('bearerToken parses only a well-formed header', () => {
  assert.equal(bearerToken('Bearer abc'), 'abc');
  assert.equal(bearerToken('Bearer  abc '), 'abc');
  assert.equal(bearerToken('Bearer '), null);
  assert.equal(bearerToken('Basic abc'), null);
  assert.equal(bearerToken(undefined), null);
});
