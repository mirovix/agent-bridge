import crypto from 'node:crypto';
import fs from 'node:fs';
import { AUDIT_PATH, ensureDataDir, loadSecrets, saveSecrets } from './config.js';
import { verifyTotp } from './totp.js';

// ---------- audit log ----------

export function audit(event, details = {}) {
  ensureDataDir();
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...details }) + '\n';
  fs.appendFileSync(AUDIT_PATH, line, { mode: 0o600 });
}

// ---------- password + key derivation ----------

// scrypt with 128 MiB memory cost: ~0.3 s per guess, hostile to GPUs.
const KDF = { N: 2 ** 17, r: 8, p: 1, keylen: 64 };
const TOTP_AAD = Buffer.from('agent-bridge-totp-v1');

function kdf(password, salt, params = KDF) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize('NFKC'), salt, params.keylen,
      { N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/**
 * Build the secrets record. The first half of the scrypt output is the password
 * verifier, the second half is a key that encrypts the TOTP secret, so a copy of
 * secrets.json alone does not reveal the 2FA seed.
 */
export async function createSecrets(password, totpSecret, recoveryCodes) {
  const salt = crypto.randomBytes(16);
  const key = await kdf(password, salt);
  const verifier = key.subarray(0, 32);
  const kek = key.subarray(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  cipher.setAAD(TOTP_AAD);
  const ct = Buffer.concat([cipher.update(totpSecret, 'utf8'), cipher.final()]);
  return {
    version: 1,
    kdf: { alg: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p, keylen: KDF.keylen, salt: salt.toString('base64') },
    verifier: verifier.toString('base64'),
    totp: { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') },
    lastTotpCounter: 0,
    recoveryCodes: recoveryCodes.map(hashRecoveryCode),
    lockout: { failures: 0, lockUntil: 0 },
  };
}

export function generateRecoveryCodes(n = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: n }, () => {
    const bytes = crypto.randomBytes(16);
    let s = '';
    for (const b of bytes) s += alphabet[b % alphabet.length];
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
  });
}

function normalizeRecovery(code) {
  return String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(normalizeRecovery(code)).digest('hex');
}

// ---------- login ----------

const MAX_FAILURES = 5;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;
let loginBusy = false;

export function lockStatus() {
  const s = loadSecrets();
  const until = s?.lockout?.lockUntil || 0;
  return until > Date.now() ? until : 0;
}

/**
 * Verify password + (TOTP code | recovery code) in a single step, so an attacker
 * never learns which factor was wrong. Global (not per-IP) lockout, because behind
 * Tailscale Serve every request comes from 127.0.0.1.
 */
export async function verifyLogin(password, code, meta) {
  if (loginBusy) return { ok: false, status: 429, error: 'Another login attempt is in progress, try again in a few seconds.' };
  loginBusy = true;
  try {
    const secrets = loadSecrets();
    if (!secrets) return { ok: false, status: 503, error: 'Server not configured.' };
    const now = Date.now();
    if ((secrets.lockout?.lockUntil || 0) > now) {
      audit('login_blocked', meta);
      return { ok: false, status: 429, error: 'Too many failed attempts. Login temporarily locked.', lockUntil: secrets.lockout.lockUntil };
    }

    const fail = async (reason) => {
      // Re-read to avoid clobbering concurrent writes (e.g. counter updates).
      const s = loadSecrets();
      const failures = (s.lockout?.failures || 0) + 1;
      let lockUntil = 0;
      if (failures >= MAX_FAILURES) {
        lockUntil = now + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (failures - MAX_FAILURES));
      }
      s.lockout = { failures, lockUntil };
      saveSecrets(s);
      audit('login_failed', { ...meta, reason, failures, lockUntil: lockUntil ? new Date(lockUntil).toISOString() : undefined });
      // Constant extra delay on failure.
      await new Promise((r) => setTimeout(r, 500 + crypto.randomInt(500)));
      return { ok: false, status: 401, error: 'Invalid credentials.' };
    };

    if (typeof password !== 'string' || password.length < 1 || password.length > 1024 || typeof code !== 'string' || code.length > 64) {
      return fail('malformed');
    }

    const k = secrets.kdf;
    const key = await kdf(password, Buffer.from(k.salt, 'base64'), k);
    const verifier = key.subarray(0, 32);
    if (!crypto.timingSafeEqual(verifier, Buffer.from(secrets.verifier, 'base64'))) return fail('password');

    let totpSecret;
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', key.subarray(32), Buffer.from(secrets.totp.iv, 'base64'));
      d.setAAD(TOTP_AAD);
      d.setAuthTag(Buffer.from(secrets.totp.tag, 'base64'));
      totpSecret = Buffer.concat([d.update(Buffer.from(secrets.totp.ct, 'base64')), d.final()]).toString('utf8');
    } catch {
      return fail('totp_decrypt');
    }

    const cleaned = code.replace(/\s+/g, '');
    let usedRecovery = false;
    if (/^\d{6}$/.test(cleaned)) {
      const counter = verifyTotp(totpSecret, cleaned);
      if (counter === null) return fail('totp');
      if (counter <= (secrets.lastTotpCounter || 0)) return fail('totp_replay');
      secrets.lastTotpCounter = counter;
    } else {
      const h = hashRecoveryCode(cleaned);
      const idx = secrets.recoveryCodes.findIndex((x) => crypto.timingSafeEqual(Buffer.from(x, 'hex'), Buffer.from(h, 'hex')));
      if (idx < 0) return fail('recovery');
      secrets.recoveryCodes.splice(idx, 1);
      usedRecovery = true;
    }

    secrets.lockout = { failures: 0, lockUntil: 0 };
    saveSecrets(secrets);
    audit('login_ok', { ...meta, usedRecovery, recoveryCodesLeft: secrets.recoveryCodes.length });
    return { ok: true, usedRecovery, recoveryCodesLeft: secrets.recoveryCodes.length };
  } finally {
    loginBusy = false;
  }
}

// ---------- sessions (memory only: a restart logs everyone out) ----------

export class SessionStore {
  constructor(cfg) {
    this.idleMs = cfg.sessionIdleMinutes * 60 * 1000;
    this.maxMs = cfg.sessionMaxHours * 60 * 60 * 1000;
    this.sessions = new Map(); // sha256(token) -> session
    this.onRevoke = () => {};
    setInterval(() => this.sweep(), 60 * 1000).unref();
  }

  static hash(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  create(meta) {
    const token = crypto.randomBytes(32).toString('base64url');
    const id = SessionStore.hash(token);
    const now = Date.now();
    const s = { id, created: now, lastSeen: now, csrf: crypto.randomBytes(24).toString('base64url'), ...meta };
    this.sessions.set(id, s);
    return { token, session: s };
  }

  get(token, touch = true) {
    if (typeof token !== 'string' || token.length > 100) return null;
    const id = SessionStore.hash(token);
    const s = this.sessions.get(id);
    if (!s) return null;
    const now = Date.now();
    if (now - s.lastSeen > this.idleMs || now - s.created > this.maxMs) {
      this.revoke(id);
      return null;
    }
    if (touch) s.lastSeen = now;
    return s;
  }

  isValid(id) {
    const s = this.sessions.get(id);
    if (!s) return false;
    const now = Date.now();
    return now - s.lastSeen <= this.idleMs && now - s.created <= this.maxMs;
  }

  revoke(id) {
    if (this.sessions.delete(id)) this.onRevoke(id);
  }

  revokeAll() {
    for (const id of [...this.sessions.keys()]) this.revoke(id);
  }

  sweep() {
    for (const id of [...this.sessions.keys()]) if (!this.isValid(id)) this.revoke(id);
  }
}
