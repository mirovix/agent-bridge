// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — compatible with Google Authenticator, Aegis, 1Password, Authy…
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = str.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function hotp(secretBuf, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secretBuf).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const code = (h.readUInt32BE(off) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, '0');
}

export function currentCounter(nowMs = Date.now(), step = 30) {
  return Math.floor(nowMs / 1000 / step);
}

/**
 * Verify a code within ±1 step. Returns the matched counter, or null.
 * Callers must reject counters <= the last accepted one (replay protection).
 */
export function verifyTotp(secretB32, code, nowMs = Date.now()) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const now = currentCounter(nowMs);
  let match = null;
  for (const c of [now - 1, now, now + 1]) {
    const expected = Buffer.from(hotp(secret, c));
    // Check every window with a constant-time compare, no early exit.
    if (crypto.timingSafeEqual(expected, Buffer.from(code)) && match === null) match = c;
  }
  return match;
}

export function otpauthUri(secretB32, account, issuer = 'AgentBridge') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
