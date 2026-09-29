import { execFile } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { SessionStore, audit, lockStatus, verifyLogin } from './auth.js';
import { AUDIT_PATH, CONFIG_PATH, DATA_DIR, loadConfig, loadSecrets, resolveWorkspaceDir, writePrivateJson } from './config.js';
import { forgetConversation, getConversation, setConversation } from './conversations.js';
import { JobManager, agentList } from './jobs.js';
import { deliver, listLive } from './live.js';
import { findSession, listSessions, readSession, tailSession } from './transcripts.js';
import { MAX_AUDIO_BYTES, Voice } from './voice.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const COOKIE = '__Host-ab_session';
const MAX_BODY = 64 * 1024;
const MAX_JOB_BODY = 34 * 1024 * 1024; // prompt + up to 4 base64 images
const BUSY_MS = 5 * 60 * 1000;

const cfg = loadConfig();
if (!cfg || !loadSecrets()) {
  console.error('Agent Bridge non è configurato. Esegui prima:  npm run setup');
  process.exit(1);
}

const sessions = new SessionStore(cfg);
const jobs = new JobManager(cfg);
const voice = new Voice();

function canonicalConversation(agent, cwd) {
  if (!['claude', 'codex'].includes(agent)) return null;
  const remembered = getConversation(agent, cwd);
  if (remembered) {
    const info = findSession(agent, remembered);
    if (info && info.cwd && path.resolve(info.cwd) === cwd) return info;
    forgetConversation(agent, cwd);
  }
  // On the first run after this feature is installed, adopt the most recently
  // used thread for this exact agent + project instead of creating one more.
  const latest = listSessions({ limit: 1000 }).find((item) => item.agent === agent && item.cwd && path.resolve(item.cwd) === cwd);
  if (latest) setConversation(agent, cwd, latest.id);
  return latest || null;
}

function rememberJobConversation(job) {
  const remember = (summary = job.summary()) => {
    if (summary.sessionId) setConversation(job.agent, job.cwd, summary.sessionId);
  };
  remember();
  job.on('update', remember);
}

// ---------- local mirror channel (VS Code companion extension) ----------
// Read-only live feed of jobs for programs running on this PC as this user. Auth is a
// random token in a 0600 file; anything that came through Tailscale Serve is refused.
const LOCAL_TOKEN_PATH = path.join(DATA_DIR, 'local-token.json');
let localToken;
try { localToken = JSON.parse(fs.readFileSync(LOCAL_TOKEN_PATH, 'utf8')).token; } catch { /* create below */ }
if (typeof localToken !== 'string' || localToken.length < 40) {
  localToken = crypto.randomBytes(32).toString('base64url');
  writePrivateJson(LOCAL_TOKEN_PATH, { token: localToken, port: cfg.port });
}
const localClients = new Set();

function localAuthorized(req) {
  const remote = req.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return false;
  if (req.headers['x-forwarded-for'] || req.headers['tailscale-user-login'] || req.headers.origin) return false;
  if (!localOrigins.some((o) => new URL(o).host === req.headers.host)) return false;
  const got = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  const want = Buffer.from(localToken);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function localBroadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of localClients) res.write(frame);
}

function handleLocalEvents(req, res) {
  if (!localAuthorized(req)) { res.writeHead(403); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(`event: hello\ndata: ${JSON.stringify({ host: os.hostname(), running: jobs.running().map((j) => ({ ...j.summary(), prompt: j.prompt })) })}\n\n`);
  localClients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); localClients.delete(res); });
}

jobs.on('job', (job) => {
  const info = job.resumeOf ? findSession(job.agent, job.resumeOf) : null;
  localBroadcast('job-start', { ...job.summary(), prompt: job.prompt, device: job.device, sessionTitle: info?.title || null });
  job.on('event', (ev) => localBroadcast('job-event', { id: job.id, event: ev }));
  job.on('update', (summary) => localBroadcast('job-update', summary));
});
const versions = {};
for (const [id, a] of [['claude', cfg.agents.claude], ['codex', cfg.agents.codex]]) {
  if (a?.enabled) execFile(a.command, ['--version'], { timeout: 10000 }, (e, out) => { versions[id] = e ? null : String(out).trim().split('\n')[0]; });
}

const localOrigins = [`http://127.0.0.1:${cfg.port}`, `http://localhost:${cfg.port}`];
const allowedOrigins = new Set([...localOrigins, ...cfg.allowedOrigins]);
const allowedHosts = new Set([...allowedOrigins].map((o) => new URL(o).host));

// ---------- static files (fixed allowlist, no path joining from user input) ----------

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/service-worker.js': ['service-worker.js', 'text/javascript; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
  '/happydev/': ['../android/app/src/main/assets/happydev/index.html', 'text/html; charset=utf-8'],
  '/happydev/core.js': ['../android/app/src/main/assets/happydev/core.js', 'text/javascript; charset=utf-8'],
  '/happydev/games/flappy.js': ['../android/app/src/main/assets/happydev/games/flappy.js', 'text/javascript; charset=utf-8'],
  '/happydev/games/dash.js': ['../android/app/src/main/assets/happydev/games/dash.js', 'text/javascript; charset=utf-8'],
  '/happydev/games/wings.js': ['../android/app/src/main/assets/happydev/games/wings.js', 'text/javascript; charset=utf-8'],
  '/happydev/games/stack.js': ['../android/app/src/main/assets/happydev/games/stack.js', 'text/javascript; charset=utf-8'],
  '/happydev/games/snake.js': ['../android/app/src/main/assets/happydev/games/snake.js', 'text/javascript; charset=utf-8'],
};

// ---------- helpers ----------

function securityHeaders(res, req) {
  const host = req.headers.host;
  res.setHeader('Content-Security-Policy', [
    "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
    `connect-src 'self' wss://${host} ws://${host}`, "manifest-src 'self'", "frame-src 'self'",
    "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()');
}

function send(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(data);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function clientMeta(req) {
  return {
    ip: req.socket.remoteAddress,
    forwardedFor: req.headers['x-forwarded-for'],
    tailscaleUser: req.headers['tailscale-user-login'],
    ua: String(req.headers['user-agent'] || '').slice(0, 200),
  };
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error('Richiesta troppo grande'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readJson(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return reject(Object.assign(new Error('JSON richiesto'), { status: 415 }));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error('Richiesta troppo grande'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('JSON non valido'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function originOk(req) {
  const o = req.headers.origin;
  return typeof o === 'string' && allowedOrigins.has(o);
}

function sessionFrom(req) {
  return sessions.get(parseCookies(req.headers.cookie)[COOKIE]);
}

function workspaceChoices() {
  const roots = cfg.workspaces.filter((w) => fs.existsSync(w));
  const recent = new Set();
  for (const s of listSessions()) {
    if (s.cwd && resolveWorkspaceDir(cfg, s.cwd)) recent.add(s.cwd);
    if (recent.size >= 15) break;
  }
  return { roots, recent: [...recent] };
}

function listDirs(dir) {
  const real = resolveWorkspaceDir(cfg, dir);
  if (!real) return null;
  const entries = fs.readdirSync(real, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 300);
  const parent = resolveWorkspaceDir(cfg, path.dirname(real));
  return { path: real, parent: parent && parent !== real ? parent : null, dirs: entries };
}

const liveIds = () => new Set(listLive().map((r) => r.sessionId));

const sessionView = (s, live = liveIds()) => ({
  agent: s.agent, id: s.id, cwd: s.cwd, title: s.title, origin: s.origin, updated: s.updated,
  canSend: !!(s.cwd && resolveWorkspaceDir(cfg, s.cwd)),
  // The session's Stop hook is parked: a prompt can be dropped straight into that chat.
  live: live.has(s.id),
  // Probably open in VS Code right now: writing to it from here would create a separate branch.
  busy: /vscode/i.test(s.origin || '') && Date.now() - s.updated < BUSY_MS,
});

function recentAudit(limit = 80) {
  let text = '';
  try {
    const st = fs.statSync(AUDIT_PATH);
    const len = Math.min(st.size, 256 * 1024);
    const fd = fs.openSync(AUDIT_PATH, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch { return []; }
  const keep = ['ts', 'event', 'forwardedFor', 'tailscaleUser', 'ua', 'reason', 'agent', 'mode', 'model', 'effort', 'status', 'fork', 'images', 'usedRecovery'];
  return text.split('\n').slice(1).filter(Boolean).slice(-limit).reverse().map((l) => {
    try {
      const d = JSON.parse(l);
      return Object.fromEntries(keep.filter((k) => d[k] !== undefined).map((k) => [k, k === 'ua' ? String(d[k]).slice(0, 160) : d[k]]));
    } catch { return null; }
  }).filter(Boolean);
}

// ---------- API ----------

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const meta = clientMeta(req);

  if (req.method !== 'GET' && !originOk(req)) return send(res, 403, { error: 'Origine non consentita' });

  if (route === 'POST /api/login') {
    const body = await readJson(req);
    const r = await verifyLogin(body.password, body.code, meta);
    if (!r.ok) return send(res, r.status, { error: r.error, lockUntil: r.lockUntil });
    const { token, session } = sessions.create(meta);
    const maxAge = Math.floor(cfg.sessionMaxHours * 3600);
    return send(res, 200, { ok: true, csrf: session.csrf, usedRecovery: r.usedRecovery, recoveryCodesLeft: r.recoveryCodesLeft }, {
      'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`,
    });
  }

  if (route === 'GET /api/status') {
    return send(res, 200, { lockedUntil: lockStatus() || null });
  }

  const s = sessionFrom(req);
  if (!s) return send(res, 401, { error: 'Non autenticato' });
  if (req.method !== 'GET' && req.headers['x-csrf-token'] !== s.csrf) return send(res, 403, { error: 'Token CSRF non valido' });

  if (route === 'POST /api/logout') {
    sessions.revoke(s.id);
    audit('logout', meta);
    return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  }
  if (route === 'POST /api/logout-all') {
    jobs.killAll();
    sessions.revokeAll();
    audit('logout_all', meta);
    return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  }
  if (route === 'GET /api/me') {
    return send(res, 200, {
      csrf: s.csrf, agents: agentList(cfg), workspaces: workspaceChoices(), host: os.hostname(),
      idleMinutes: cfg.sessionIdleMinutes, expiresAt: s.created + cfg.sessionMaxHours * 3600 * 1000, maxPromptChars: cfg.maxPromptChars,
      voice: voice.available(),
    });
  }
  if (route === 'GET /api/server-info') {
    return send(res, 200, {
      host: os.hostname(), workspaces: cfg.workspaces, allowedOrigins: cfg.allowedOrigins,
      sessionIdleMinutes: cfg.sessionIdleMinutes, sessionMaxHours: cfg.sessionMaxHours,
      allowDangerousModes: cfg.allowDangerousModes, maxConcurrentJobs: cfg.maxConcurrentJobs, jobTimeoutMinutes: cfg.jobTimeoutMinutes,
      versions, voice: voice.available(), configPath: CONFIG_PATH,
    });
  }
  if (route === 'GET /api/devices') {
    const list = [...sessions.sessions.values()].filter((x) => sessions.isValid(x.id)).map((x) => ({
      id: x.id, current: x.id === s.id, created: x.created, lastSeen: x.lastSeen,
      from: x.forwardedFor || x.ip, tailscaleUser: x.tailscaleUser || null, ua: x.ua,
    })).sort((a, b) => b.lastSeen - a.lastSeen);
    return send(res, 200, { devices: list });
  }
  if (route === 'POST /api/devices/revoke') {
    const b = await readJson(req);
    if (typeof b.id !== 'string' || !/^[0-9a-f]{64}$/.test(b.id)) return send(res, 400, { error: 'Dispositivo non valido' });
    sessions.revoke(b.id);
    audit('device_revoked', { revoked: b.id.slice(0, 12), ...meta });
    return send(res, 200, { ok: true, self: b.id === s.id });
  }
  if (route === 'GET /api/audit') {
    return send(res, 200, { events: recentAudit() });
  }
  if (route === 'POST /api/transcribe') {
    const audio = await readBody(req, MAX_AUDIO_BYTES);
    if (!audio.length) return send(res, 400, { error: 'Audio vuoto' });
    try {
      const text = await voice.transcribe(audio, req.headers['content-type'], url.searchParams.get('lang') ?? 'it');
      return send(res, 200, { text });
    } catch (e) {
      return send(res, e.status || 500, { error: e.message });
    }
  }
  if (route === 'GET /api/sessions') {
    const live = liveIds();
    return send(res, 200, { sessions: listSessions().map((s) => sessionView(s, live)) });
  }
  let m = url.pathname.match(/^\/api\/sessions\/(claude|codex)\/([0-9a-f-]{36})$/i);
  if (m && req.method === 'GET') {
    const info = findSession(m[1], m[2]);
    if (!info) return send(res, 404, { error: 'Sessione non trovata' });
    const { messages, truncated } = readSession(info);
    return send(res, 200, { session: sessionView(info), messages, truncated });
  }
  if (route === 'GET /api/dirs') {
    const r = listDirs(url.searchParams.get('path') || cfg.workspaces[0]);
    return r ? send(res, 200, r) : send(res, 403, { error: 'Cartella non consentita' });
  }
  if (route === 'GET /api/jobs') return send(res, 200, { jobs: jobs.list() });
  m = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})$/);
  if (m && req.method === 'GET') {
    const j = jobs.get(m[1]);
    return j ? send(res, 200, { job: j.summary(), events: j.events }) : send(res, 404, { error: 'Job non trovato' });
  }
  m = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})\/cancel$/);
  if (m && req.method === 'POST') {
    const j = jobs.get(m[1]);
    if (!j) return send(res, 404, { error: 'Job non trovato' });
    jobs.kill(j);
    audit('job_cancel', { job: j.id, ...meta });
    return send(res, 200, { ok: true });
  }
  if (route === 'POST /api/jobs') {
    const b = await readJson(req, MAX_JOB_BODY);
    const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
    if (!prompt) return send(res, 400, { error: 'Prompt vuoto' });
    if (prompt.length > cfg.maxPromptChars) return send(res, 400, { error: 'Prompt troppo lungo' });
    let cwd;
    let sessionId = null;
    if (b.sessionId) {
      const info = findSession(b.agent, b.sessionId);
      if (!info) return send(res, 404, { error: 'Sessione non trovata' });
      cwd = info.cwd && resolveWorkspaceDir(cfg, info.cwd);
      sessionId = info.id;
    } else {
      cwd = resolveWorkspaceDir(cfg, b.cwd);
      const existing = cwd && canonicalConversation(b.agent, cwd);
      if (existing) sessionId = existing.id;
    }
    if (!cwd) return send(res, 403, { error: 'Cartella di lavoro fuori dai workspace consentiti' });
    if (b.target === 'chat') {
      if (!sessionId) return send(res, 400, { error: 'Serve una sessione esistente' });
      try {
        const msg = deliver(sessionId, prompt);
        audit('chat_delivery', { sessionId, delivery: msg.id, promptChars: prompt.length, ...meta });
        return send(res, 200, { delivered: msg.id });
      } catch (e) {
        return send(res, 409, { error: e.message });
      }
    }
    try {
      const job = jobs.start({ agent: b.agent, sessionId, fork: !!b.fork, cwd, mode: b.mode, model: b.model, effort: b.effort, prompt, images: b.images }, meta);
      rememberJobConversation(job);
      broadcastJobs();
      job.on('update', broadcastJobs);
      return send(res, 200, { job: job.summary() });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }
  return send(res, 404, { error: 'Non trovato' });
}

// ---------- HTTP server ----------

const server = http.createServer(async (req, res) => {
  securityHeaders(res, req);
  if (!allowedHosts.has(req.headers.host)) {
    // Blocks DNS-rebinding and requests that did not come through an allowed origin.
    res.writeHead(421, { 'Content-Type': 'text/plain' });
    return res.end('Host non consentito');
  }
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }

  try {
    if (url.pathname === '/local/events' && req.method === 'GET') return handleLocalEvents(req, res);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const st = STATIC[url.pathname];
    if (st && req.method === 'GET') {
      if (url.pathname.startsWith('/happydev/')) {
        // HappyDEV is trusted bundled code, framed only by this same-origin app.
        // Its upstream single-file shell uses small inline style/script blocks.
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'");
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      }
      res.writeHead(200, { 'Content-Type': st[1], 'Cache-Control': 'no-cache' });
      return res.end(fs.readFileSync(path.join(PUBLIC_DIR, st[0])));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Errore interno' });
    if (!e.status) console.error(e);
  }
});
server.headersTimeout = 20000;
server.requestTimeout = 30000;

// ---------- WebSocket (live updates) ----------

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
const sockets = new Set();

server.on('upgrade', (req, socket, head) => {
  const reject = (code) => { socket.write(`HTTP/1.1 ${code} Rejected\r\n\r\n`); socket.destroy(); };
  if (!allowedHosts.has(req.headers.host) || !originOk(req)) return reject(403);
  if (new URL(req.url, 'http://x').pathname !== '/ws') return reject(404);
  const s = sessionFrom(req);
  if (!s) return reject(401);
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.sessionId = s.id;
    wss.emit('connection', ws, req);
  });
});

function wsSend(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcastJobs() {
  const list = jobs.list();
  for (const ws of sockets) wsSend(ws, { type: 'jobs', jobs: list });
}

wss.on('connection', (ws) => {
  sockets.add(ws);
  const subs = { stopTail: null, job: null, jobListener: null };
  const clear = () => {
    subs.stopTail?.();
    subs.stopTail = null;
    if (subs.job) {
      subs.job.off('event', subs.jobListener);
      subs.job.off('update', subs.updateListener);
    }
    subs.job = null;
  };
  wsSend(ws, { type: 'jobs', jobs: jobs.list() });

  ws.on('message', (raw) => {
    if (!sessions.isValid(ws.sessionId)) return ws.close(4001, 'expired');
    let msg;
    try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }
    if (msg.type === 'ping') {
      // Only pings from a visible tab keep the login alive.
      if (msg.active) { const s = sessions.sessions.get(ws.sessionId); if (s) s.lastSeen = Date.now(); }
      return wsSend(ws, { type: 'pong' });
    }
    if (msg.type === 'sub-session') {
      clear();
      const info = findSession(msg.agent, msg.id);
      if (!info) return;
      const { offset, lines } = readSession(info);
      subs.stopTail = tailSession(info, offset, lines, (messages) => wsSend(ws, { type: 'session-messages', agent: info.agent, id: info.id, messages }));
    } else if (msg.type === 'sub-job') {
      clear();
      const job = typeof msg.id === 'string' ? jobs.get(msg.id) : null;
      if (!job) return;
      subs.job = job;
      subs.jobListener = (event) => wsSend(ws, { type: 'job-event', id: job.id, event });
      subs.updateListener = (summary) => wsSend(ws, { type: 'job-update', job: summary });
      job.on('event', subs.jobListener);
      job.on('update', subs.updateListener);
    } else if (msg.type === 'unsub') {
      clear();
    }
  });
  ws.on('close', () => { clear(); sockets.delete(ws); });
});

sessions.onRevoke = (id) => {
  for (const ws of sockets) if (ws.sessionId === id) ws.close(4001, 'logged out');
};
setInterval(() => {
  for (const ws of sockets) if (!sessions.isValid(ws.sessionId)) ws.close(4001, 'expired');
}, 15000).unref();

// ---------- start ----------

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`La porta ${cfg.port} è già in uso: Agent Bridge è probabilmente già in esecuzione (systemctl --user status agent-bridge).`);
    process.exit(1);
  }
  throw e;
});

server.listen(cfg.port, cfg.host, () => {
  audit('server_start', { host: cfg.host, port: cfg.port });
  console.log(`Agent Bridge in ascolto su http://${cfg.host}:${cfg.port} (solo locale)`);
  if (cfg.allowedOrigins.length) console.log(`Origini remote consentite: ${cfg.allowedOrigins.join(', ')}`);
  else console.log(`Nessuna origine remota configurata: aggiungi l'URL di Tailscale in ${CONFIG_PATH} (allowedOrigins).`);
});

function shutdown() {
  jobs.killAll();
  voice.stop();
  server.close();
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
