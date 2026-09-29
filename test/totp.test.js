import assert from 'node:assert/strict';
import test from 'node:test';
import { base32Decode, base32Encode, hotp, verifyTotp } from '../src/totp.js';

const RFC_SECRET = Buffer.from('12345678901234567890');

test('RFC 6238 SHA-1 test vectors', () => {
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']];
  for (const [t, code] of vectors) assert.equal(hotp(RFC_SECRET, Math.floor(t / 30), 8), code);
});

test('base32 round trip', () => {
  const b = Buffer.from('hello world, totp!');
  assert.deepEqual(base32Decode(base32Encode(b)), b);
});

test('verifyTotp accepts ±1 step and rejects others', () => {
  const secret = base32Encode(RFC_SECRET);
  const now = 1_700_000_000_000;
  const c = Math.floor(now / 30000);
  assert.equal(verifyTotp(secret, hotp(RFC_SECRET, c), now), c);
  assert.equal(verifyTotp(secret, hotp(RFC_SECRET, c - 1), now), c - 1);
  assert.equal(verifyTotp(secret, hotp(RFC_SECRET, c + 2), now), null);
  assert.equal(verifyTotp(secret, 'abcdef', now), null);
  assert.equal(verifyTotp(secret, '12345', now), null);
});
