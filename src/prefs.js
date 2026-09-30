// Appearance and personal settings of the web app, kept on the PC so every
// device you sign in from (phone, tablet, laptop) looks and behaves the same.
// Nothing here is security-relevant: permissions and limits live in config.json.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, writePrivateJson } from './config.js';

export const PREFS_PATH = path.join(DATA_DIR, 'ui-prefs.json');
export const MAX_PREFS_BYTES = 32 * 1024;
const KEY = /^[A-Za-z0-9._-]{1,64}$/;

function plain(value, depth = 0) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) return false;
    return true;
  }
  if (depth > 4) return false;
  if (Array.isArray(value)) return value.length <= 100 && value.every((v) => plain(v, depth + 1));
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.keys(value).every((k) => KEY.test(k)) && Object.values(value).every((v) => plain(v, depth + 1));
  }
  return false;
}

/** Throws a 400-style error unless `prefs` is a small, plain JSON object. */
export function validatePrefs(prefs) {
  const bad = (message) => Object.assign(new Error(message), { status: 400 });
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) throw bad('Settings must be an object');
  if (!plain(prefs)) throw bad('Invalid settings');
  if (Buffer.byteLength(JSON.stringify(prefs)) > MAX_PREFS_BYTES) throw bad('Settings too large');
  return prefs;
}

export function loadPrefs() {
  try {
    const data = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

export function savePrefs(prefs) {
  validatePrefs(prefs);
  writePrivateJson(PREFS_PATH, prefs);
  return prefs;
}
