// Delivery of prompts into a *live* Claude Code session (the one open in VS Code),
// instead of spawning a separate headless process that would branch the transcript.
//
// /phone arms a working directory (the session id is unknown at that point);
// the Stop hook (scripts/hooks/stop.js) picks the arm up, parks at the end of the
// turn and polls the inbox, which the server writes to. Both sides only ever touch
// files inside the data dir (~/.agent-bridge, mode 0700), so nothing is reachable from the network.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, replaceFile } from './config.js';

const ARMED_DIR = path.join(DATA_DIR, 'armed'); // keyed by cwd, written by /phone
const LIVE_DIR = path.join(DATA_DIR, 'live'); // keyed by session id, written by the parked hook
const INBOX_DIR = path.join(DATA_DIR, 'inbox'); // keyed by session id, written by the server
// A parked hook refreshes its heartbeat every 5 s; allow three misses.
const HEARTBEAT_STALE_MS = 16 * 1000;
const UUID = /^[0-9a-f-]{36}$/i;
// A prompt that nobody picked up in this time is dropped instead of surfacing much later.
export const INBOX_TTL_MS = 30 * 1000;

// Windows paths are case-insensitive (the hook may report c:\\ where /phone saw C:\\).
const normCwd = (cwd) => (process.platform === 'win32' ? path.resolve(cwd).toLowerCase() : path.resolve(cwd));
const key = (cwd) => crypto.createHash('sha256').update(normCwd(cwd)).digest('hex').slice(0, 32);
const armedPath = (cwd) => path.join(ARMED_DIR, `${key(cwd)}.json`);
const livePath = (id) => path.join(LIVE_DIR, `${id}.json`);
const inboxPath = (id) => path.join(INBOX_DIR, `${id}.json`);

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  replaceFile(tmp, file);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// ---------- /phone side ----------

/** Arm (or, with minutes = 0, disarm) the chat running in `cwd`. */
export function setArmed(cwd, minutes) {
  if (typeof cwd !== 'string' || !cwd.trim()) throw new Error('invalid folder');
  if (!minutes) {
    fs.rmSync(armedPath(cwd), { force: true });
    return null;
  }
  const rec = { cwd: path.resolve(cwd), armedUntil: Date.now() + minutes * 60 * 1000 };
  writeJson(armedPath(cwd), rec);
  return rec;
}

export function getArmed(cwd) {
  if (typeof cwd !== 'string' || !cwd) return null;
  const rec = readJson(armedPath(cwd));
  if (!rec || rec.armedUntil < Date.now()) return null;
  return rec;
}

// ---------- hook side ----------

/** Called by the parked hook: "I am waiting and will pick a prompt up now". */
export function heartbeat(sessionId, cwd, armedUntil) {
  if (!UUID.test(sessionId || '')) return;
  writeJson(livePath(sessionId), { sessionId, cwd, armedUntil, waitingUntil: Date.now() + HEARTBEAT_STALE_MS });
}

export function clearLive(sessionId) {
  if (UUID.test(sessionId || '')) fs.rmSync(livePath(sessionId), { force: true });
}

export function takeInbox(sessionId) {
  if (!UUID.test(sessionId || '')) return null;
  const file = inboxPath(sessionId);
  const msg = readJson(file);
  if (!msg) return null;
  fs.rmSync(file, { force: true });
  return Date.now() - (msg.ts || 0) > INBOX_TTL_MS ? null : msg;
}

// ---------- server side ----------

/** Sessions whose Stop hook is parked right now and can accept a prompt. */
export function listLive() {
  let names = [];
  try { names = fs.readdirSync(LIVE_DIR); } catch { return []; }
  const now = Date.now();
  const out = [];
  for (const name of names) {
    const file = path.join(LIVE_DIR, name);
    const rec = readJson(file);
    if (!rec?.sessionId) continue;
    if (rec.waitingUntil > now) out.push(rec);
    else if (rec.waitingUntil < now - 60 * 60 * 1000) fs.rmSync(file, { force: true });
  }
  return out;
}

export const isLive = (sessionId) => listLive().some((r) => r.sessionId === sessionId);

/** Hand a prompt to the parked session. Throws if it is not listening. */
export function deliver(sessionId, prompt) {
  if (!isLive(sessionId)) throw new Error('The VS Code chat is no longer listening');
  const pending = readJson(inboxPath(sessionId));
  if (pending && Date.now() - (pending.ts || 0) <= INBOX_TTL_MS) throw new Error('Another prompt is already being delivered');
  const msg = { id: crypto.randomUUID(), prompt, ts: Date.now() };
  writeJson(inboxPath(sessionId), msg);
  return msg;
}
