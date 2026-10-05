// End-to-end security test: boots the real server against a throwaway home dir.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { POSIX_MODES, fakeCli } from './helpers.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bridge-test-'));
const HOME = path.join(tmp, 'home');
const WORK = path.join(tmp, 'work');
fs.mkdirSync(WORK);
fs.mkdirSync(path.join(WORK, 'proj'));
fs.mkdirSync(path.join(WORK, 'visible-folder'));
fs.mkdirSync(path.join(WORK, '.hidden-folder'));
fs.mkdirSync(path.join(WORK, 'node_modules'));
const PORT = 20000 + crypto.randomInt(20000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const CODEX_HOME = path.join(tmp, 'codex');
const CODEX_SESSION = '11111111-2222-3333-4444-555555555555';
const CODEX_ARGS = path.join(tmp, 'codex-args.log');
let FAKE_CODEX;

process.env.AGENT_BRIDGE_HOME = HOME;
const { createSecrets } = await import('../src/auth.js');
const { writePrivateJson, CONFIG_PATH, SECRETS_PATH } = await import('../src/config.js');
const { generateSecret, base32Decode, hotp, currentCounter } = await import('../src/totp.js');

const TOTP = generateSecret();
const codeAt = (offset = 0) => hotp(base32Decode(TOTP), currentCounter() + offset);

function request(method, p, { headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: {
      Host: host || `127.0.0.1:${PORT}`,
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      ...headers,
    } }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let server;
let cookie;
let csrf;

test.before(async () => {
  const transcriptDir = path.join(CODEX_HOME, 'sessions', '2026', '09', '28');
  fs.mkdirSync(transcriptDir, { recursive: true });
  fs.writeFileSync(path.join(transcriptDir, `rollout-${CODEX_SESSION}.jsonl`), [
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: CODEX_SESSION, cwd: path.join(WORK, 'proj'), originator: 'vscode' } }),
    JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { id: 'u1', type: 'message', role: 'user', content: [{ type: 'input_text', text: 'chat esistente' }] } }),
    '',
  ].join('\n'));
  FAKE_CODEX = fakeCli(path.join(tmp, 'fake-codex.mjs'), `import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(CODEX_ARGS)}, JSON.stringify(process.argv.slice(2)) + '\\n');
console.log(JSON.stringify({ type: 'thread.started', thread_id: ${JSON.stringify(CODEX_SESSION)} }));
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'continuazione riuscita' } }));
`);
  writePrivateJson(CONFIG_PATH, {
    port: PORT,
    workspaces: [WORK],
    agents: {
      claude: { enabled: false }, codex: { enabled: true, command: FAKE_CODEX },
      // Echo agent: prints whatever arrives on stdin.
      custom: [
        { id: 'echo', name: 'Echo', command: process.execPath, args: ['-e', 'process.stdin.pipe(process.stdout)'] },
        { id: 'slow', name: 'Slow', command: process.execPath, args: ['-e', 'process.stdin.resume(); setTimeout(() => {}, 10000)'] },
      ],
    },
  });
  writePrivateJson(SECRETS_PATH, await createSecrets(PASSWORD, TOTP, ['AAAA-BBBB-CCCC-DDDD']));
  server = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    env: { ...process.env, AGENT_BRIDGE_HOME: HOME, CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'), CODEX_HOME },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('listening on') && resolve()));
});

test.after(() => {
  server?.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const login = (password, code) => request('POST', '/api/login', { headers: { Origin: ORIGIN }, body: { password, code } });
const authed = (method, p, body, extra = {}) => request(method, p, { body, headers: { Cookie: cookie, Origin: ORIGIN, 'X-CSRF-Token': csrf, ...extra } });

test('rejects unknown Host headers (DNS rebinding)', async () => {
  const r = await request('GET', '/', { host: 'evil.example.com' });
  assert.equal(r.status, 421);
});

test('serves the app with a strict CSP', async () => {
  const r = await request('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(r.headers['x-frame-options'], 'DENY');
});

test('serves an installable PWA shell and isolated HappyDEV activity', async () => {
  // The web app is the only client, so it has to be installable on every system.
  const manifest = await request('GET', '/manifest.webmanifest');
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers['content-type'], 'application/manifest+json');
  assert.equal(manifest.json.display, 'standalone');
  assert.equal(manifest.json.id, '/');
  assert.equal(manifest.json.start_url, '/');
  assert.ok(manifest.json.name && manifest.json.short_name.length <= 12);
  assert.ok(manifest.json.icons.some((i) => i.sizes === '512x512' && /maskable/.test(i.purpose || '')), 'a maskable 512px icon is required to install');
  for (const icon of manifest.json.icons) {
    const file = await request('GET', icon.src);
    assert.equal(file.status, 200, icon.src);
  }

  const worker = await request('GET', '/service-worker.js');
  assert.equal(worker.status, 200);
  assert.match(worker.text, /agent-bridge-shell/);

  const game = await request('GET', '/happydev/');
  assert.equal(game.status, 200);
  assert.match(game.text, /HappyDEV/);
  assert.equal(game.headers['x-frame-options'], 'SAMEORIGIN');
  assert.match(game.headers['content-security-policy'], /frame-ancestors 'self'/);
});

test('connection status is simple and available before login', async () => {
  const r = await request('GET', '/api/status');
  assert.equal(r.status, 200);
  assert.ok(Object.hasOwn(r.json, 'lockedUntil'));
});

test('login requires an allowed Origin', async () => {
  const r = await request('POST', '/api/login', { headers: { Origin: 'https://evil.example.com' }, body: { password: PASSWORD, code: codeAt() } });
  assert.equal(r.status, 403);
});

test('wrong password is rejected even with a valid TOTP', async () => {
  const r = await login('wrong-password', codeAt());
  assert.equal(r.status, 401);
  assert.equal(r.headers['set-cookie'], undefined);
});

test('correct password + TOTP logs in with a hardened cookie', async () => {
  const r = await login(PASSWORD, codeAt());
  assert.equal(r.status, 200);
  const sc = r.headers['set-cookie'][0];
  assert.match(sc, /^__Host-ab_session=/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(sc.includes(flag), flag);
  cookie = sc.split(';')[0];
  csrf = r.json.csrf;
});

test('the same TOTP code cannot be replayed', async () => {
  const r = await login(PASSWORD, codeAt());
  assert.equal(r.status, 401);
});

test('API requires the session cookie', async () => {
  assert.equal((await request('GET', '/api/me')).status, 401);
  assert.equal((await authed('GET', '/api/me')).status, 200);
});

test('state-changing requests require the CSRF token', async () => {
  const r = await authed('POST', '/api/jobs', { agent: 'echo', cwd: WORK, prompt: 'hi' }, { 'X-CSRF-Token': 'nope' });
  assert.equal(r.status, 403);
});

test('agents cannot run outside the allowed workspaces', async () => {
  for (const cwd of ['/etc', path.join(WORK, '..'), `${WORK}/../..`]) {
    const r = await authed('POST', '/api/jobs', { agent: 'echo', cwd, prompt: 'hi' });
    assert.equal(r.status, 403, cwd);
  }
  const r = await authed('GET', `/api/dirs?path=${encodeURIComponent('/')}`);
  assert.equal(r.status, 403);
});

test('folder picker only returns safe, useful directories', async () => {
  const r = await authed('GET', `/api/dirs?path=${encodeURIComponent(WORK)}`);
  assert.equal(r.status, 200);
  assert.ok(r.json.dirs.includes('visible-folder'));
  assert.ok(r.json.dirs.includes('proj'));
  assert.ok(!r.json.dirs.includes('.hidden-folder'));
  assert.ok(!r.json.dirs.includes('node_modules'));
});

test('prompts run without a shell and stream back', async () => {
  const marker = path.join(tmp, 'pwned');
  const prompt = `hello $(touch ${marker}); touch ${marker} \`touch ${marker}\``;
  const r = await authed('POST', '/api/jobs', { agent: 'echo', cwd: path.join(WORK, 'proj'), prompt });
  assert.equal(r.status, 200, r.text);
  const id = r.json.job.id;
  let job;
  for (let i = 0; i < 50; i++) {
    job = (await authed('GET', `/api/jobs/${id}`)).json;
    if (job.job.status !== 'running') break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.equal(job.job.status, 'done');
  assert.ok(job.events.some((e) => e.text.includes('hello $(touch')));
  assert.equal(fs.existsSync(marker), false);
});

test('new mobile prompts continue the canonical desktop conversation', async () => {
  const body = { agent: 'codex', cwd: path.join(WORK, 'proj'), prompt: 'continua qui', mode: 'workspace-write' };
  for (let turn = 0; turn < 2; turn++) {
    const r = await authed('POST', '/api/jobs', { ...body, prompt: `${body.prompt} ${turn}` });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.job.sessionId, CODEX_SESSION);
    assert.equal(r.json.job.resumeOf, CODEX_SESSION);
    for (let i = 0; i < 50; i++) {
      const detail = await authed('GET', `/api/jobs/${r.json.job.id}`);
      if (detail.json.job.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  const calls = fs.readFileSync(CODEX_ARGS, 'utf8').trim().split('\n').map(JSON.parse).filter((args) => args[0] === 'exec');
  assert.equal(calls.length, 2);
  for (const args of calls) {
    assert.deepEqual(args.slice(0, 2), ['exec', 'resume']);
    assert.ok(args.includes(CODEX_SESSION));
  }
  const saved = JSON.parse(fs.readFileSync(path.join(HOME, 'conversations.json'), 'utf8'));
  assert.equal(saved.conversations.length, 1);
  assert.equal(saved.conversations[0].sessionId, CODEX_SESSION);
});

test('session history lists and reads the desktop conversation', async () => {
  const list = await authed('GET', '/api/sessions');
  assert.equal(list.status, 200);
  const session = list.json.sessions.find((item) => item.id === CODEX_SESSION);
  assert.ok(session);
  assert.equal(session.agent, 'codex');
  assert.equal(session.canSend, true);
  const detail = await authed('GET', `/api/sessions/codex/${CODEX_SESSION}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.json.messages.some((message) => message.role === 'user' && message.text === 'chat esistente'));
});

test('invalid and oversized prompt input returns clear client errors', async () => {
  const blank = await authed('POST', '/api/jobs', { agent: 'echo', cwd: WORK, prompt: '   ' });
  assert.equal(blank.status, 400);
  assert.match(blank.json.error, /empty/i);
  const tooLong = await authed('POST', '/api/jobs', { agent: 'echo', cwd: WORK, prompt: 'x'.repeat(20_001) });
  assert.equal(tooLong.status, 400);
  assert.match(tooLong.json.error, /too long/i);
});

test('a running job can be cancelled from the app', async () => {
  const started = await authed('POST', '/api/jobs', { agent: 'slow', cwd: WORK, prompt: 'fermati' });
  assert.equal(started.status, 200);
  const cancelled = await authed('POST', `/api/jobs/${started.json.job.id}/cancel`, {});
  assert.equal(cancelled.status, 200);
  const detail = await authed('GET', `/api/jobs/${started.json.job.id}`);
  assert.equal(detail.json.job.status, 'cancelled');
});

test('device list identifies the current login and validates revocation ids', async () => {
  const list = await authed('GET', '/api/devices');
  assert.equal(list.status, 200);
  assert.ok(list.json.devices.some((device) => device.current));
  const invalid = await authed('POST', '/api/devices/revoke', { id: 'not-a-device' });
  assert.equal(invalid.status, 400);
  assert.match(invalid.json.error, /invalid/i);
});

test('local mirror channel streams jobs live (token only, never via proxy)', async () => {
  const { token } = JSON.parse(fs.readFileSync(path.join(HOME, 'local-token.json'), 'utf8'));
  assert.equal((await request('GET', '/local/events', { headers: { Authorization: 'Bearer wrong' } })).status, 403);
  assert.equal((await request('GET', '/local/events', { headers: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': '100.1.2.3' } })).status, 403);
  const got = await new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port: PORT, path: '/local/events', headers: { Authorization: `Bearer ${token}` } }, (res) => {
      assert.equal(res.statusCode, 200);
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        if (buf.includes('event: job-update') && buf.includes('"status":"done"')) { r.destroy(); resolve(buf); }
      });
      authed('POST', '/api/jobs', { agent: 'echo', cwd: WORK, prompt: 'mirror me' }).catch(reject);
    });
    r.on('error', () => {});
    setTimeout(() => reject(new Error('timeout')), 8000);
  });
  assert.match(got, /event: job-start\ndata: .*"prompt":"mirror me"/);
  assert.match(got, /event: job-event\ndata: .*mirror me/);
});

test('delivery to a live chat is refused when none is listening', async () => {
  const r = await authed('POST', '/api/jobs', { agent: 'echo', cwd: WORK, prompt: 'ciao', target: 'chat' });
  assert.equal(r.status, 400, 'without a session there is no chat to deliver to');
  assert.match(r.json.error, /session/i);
});

test('unknown agents are rejected', async () => {
  const r = await authed('POST', '/api/jobs', { agent: 'bash', cwd: WORK, prompt: 'id' });
  assert.equal(r.status, 400);
});

test('recovery code works once', async () => {
  assert.equal((await login(PASSWORD, 'aaaa bbbb cccc dddd')).status, 200);
  assert.equal((await login(PASSWORD, 'AAAA-BBBB-CCCC-DDDD')).status, 401);
});

test('logout-all revokes every session', async () => {
  assert.equal((await authed('POST', '/api/logout-all', {})).status, 200);
  assert.equal((await authed('GET', '/api/me')).status, 401);
});

test('repeated failures lock the login, even for the right credentials', async () => {
  for (let i = 0; i < 5; i++) await login('bad', '000000');
  const r = await login(PASSWORD, codeAt(1));
  assert.equal(r.status, 429);
  assert.ok(r.json.lockUntil > Date.now());
});

test('audit log records logins and jobs, never prompt text', () => {
  const log = fs.readFileSync(path.join(HOME, 'audit.log'), 'utf8');
  assert.match(log, /"login_failed"/);
  assert.match(log, /"login_ok"/);
  assert.match(log, /"job_start"/);
  assert.ok(!log.includes('hello $(touch'));
  if (POSIX_MODES) assert.equal(fs.statSync(path.join(HOME, 'audit.log')).mode & 0o077, 0);
});

test('voice, devices and audit endpoints require login', async () => {
  for (const [m, p] of [['GET', '/api/devices'], ['GET', '/api/audit'], ['GET', '/api/server-info']]) {
    assert.equal((await request(m, p)).status, 401, p);
  }
  const r = await request('POST', '/api/transcribe', { headers: { Origin: ORIGIN, 'Content-Type': 'audio/mp4' } });
  assert.equal(r.status, 401);
});
