// Boots a real Agent Bridge server against a throw-away home folder, with fake
// Claude Code and Codex CLIs that speak the same JSON the real ones print.
// Not a test file itself: used by duo.test.js and ui.test.js.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeCli } from './helpers.js';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PASSWORD = 'Correct-Horse-Battery-9';
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fake Claude Code: `claude -p --output-format stream-json …`, prompt on stdin.
// "please edit" makes it change a file, like a real agent would.
const FAKE_CLAUDE = (log) => `import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const args = process.argv.slice(2);
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', async () => {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ agent: 'claude', args, cwd: process.cwd(), input }) + '\\n');
  const resume = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : null;
  const id = resume && !args.includes('--fork-session') ? resume : crypto.randomUUID();
  const mode = args[args.indexOf('--permission-mode') + 1];
  const say = (o) => console.log(JSON.stringify(o));
  say({ type: 'system', subtype: 'init', session_id: id, model: 'fake-claude', permissionMode: mode });
  if (/please edit/i.test(input) && mode !== 'manual' && mode !== 'plan') fs.appendFileSync(path.join(process.cwd(), 'notes.txt'), 'edited by claude\\n');
  if (/slowly/i.test(input)) await new Promise((r) => setTimeout(r, 4000));
  const text = /<review>/.test(input) ? 'Applied the review.' : /<diff>|<report>/.test(input) ? 'Review: looks correct, one nit in notes.txt:1.' : 'Claude did the task.';
  say({ type: 'assistant', uuid: crypto.randomUUID(), message: { role: 'assistant', content: [{ type: 'text', text }] } });
  // Like the real CLI, a resumed chat is written to its transcript, which the app follows live.
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || '', 'projects', 'proj');
  const transcript = path.join(dir, id + '.jsonl');
  if (resume && fs.existsSync(transcript)) {
    const ts = new Date().toISOString();
    fs.appendFileSync(transcript, JSON.stringify({ type: 'user', uuid: crypto.randomUUID(), timestamp: ts, message: { role: 'user', content: input } }) + '\\n'
      + JSON.stringify({ type: 'assistant', uuid: crypto.randomUUID(), timestamp: ts, message: { role: 'assistant', content: [{ type: 'text', text }] } }) + '\\n');
  }
  say({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.0012 });
});
`;

// Fake Codex: \`codex exec [resume <id>] --json … -\`, prompt on stdin.
const FAKE_CODEX = (log) => `import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const args = process.argv.slice(2);
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', async () => {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ agent: 'codex', args, cwd: process.cwd(), input }) + '\\n');
  const i = args.indexOf('resume');
  const id = i >= 0 ? args[args.length - 2] : crypto.randomUUID();
  const sandbox = (args.find((a) => a.startsWith('sandbox_mode=')) || '').split('=')[1] || '';
  const say = (o) => console.log(JSON.stringify(o));
  say({ type: 'thread.started', thread_id: id });
  if (/please edit/i.test(input) && !sandbox.includes('read-only')) fs.appendFileSync(path.join(process.cwd(), 'notes.txt'), 'edited by codex\\n');
  if (/slowly/i.test(input)) await new Promise((r) => setTimeout(r, 4000));
  if (/fail please/i.test(input)) { say({ type: 'turn.failed', error: { message: 'fake failure' } }); process.exit(1); }
  const text = /<review>/.test(input) ? 'Applied the review.' : /<diff>|<report>/.test(input) ? 'Review from Codex: fine.' : /<reply>/.test(input) ? 'Codex read the handoff.' : 'Codex did the task.';
  say({ type: 'item.completed', item: { type: 'command_execution', command: 'ls', aggregated_output: 'notes.txt', exit_code: 0 } });
  say({ type: 'item.completed', item: { type: 'agent_message', text } });
  say({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } });
});
`;

/**
 * @param real  use the installed `claude` and `codex` CLIs with your own sign-in
 *              (their transcripts then land in ~/.claude and ~/.codex as usual).
 */
export async function startServer({ config = {}, gitRepo = true, real = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bridge-harness-'));
  const HOME = path.join(tmp, 'home');
  const WORK = path.join(tmp, 'work');
  const PROJECT = path.join(WORK, 'proj');
  fs.mkdirSync(PROJECT, { recursive: true });
  fs.mkdirSync(path.join(WORK, 'other'));
  fs.writeFileSync(path.join(PROJECT, 'notes.txt'), 'first line\n');
  if (gitRepo) {
    const git = (...args) => spawn('git', ['-C', PROJECT, ...args], { stdio: 'ignore' });
    const run = (...args) => new Promise((resolve) => git(...args).on('close', resolve));
    await run('init', '-q');
    await run('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
    await run('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  }
  // One existing Claude Code chat in the project, as VS Code or the CLI would leave it.
  const CLAUDE_SESSION = '0f5c1a9e-7b1d-4c3e-9a51-2f3e4d5c6b7a';
  const claudeProjects = path.join(tmp, 'claude', 'projects', 'proj');
  fs.mkdirSync(claudeProjects, { recursive: true });
  const cwdReal = fs.realpathSync(PROJECT);
  fs.writeFileSync(path.join(claudeProjects, `${CLAUDE_SESSION}.jsonl`), [
    { type: 'user', uuid: 'u1', cwd: cwdReal, entrypoint: 'cli', sessionId: CLAUDE_SESSION, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Fix the login page' } },
    { type: 'assistant', uuid: 'a1', cwd: cwdReal, sessionId: CLAUDE_SESSION, timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: 'I fixed the login page in login.js.' }] } },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const LOG = path.join(tmp, 'calls.log');
  const port = 20000 + crypto.randomInt(20000);
  const origin = `http://127.0.0.1:${port}`;

  process.env.AGENT_BRIDGE_HOME = HOME;
  const { createSecrets } = await import('../src/auth.js');
  const { writePrivateJson } = await import('../src/config.js');
  const { generateSecret, base32Decode, hotp, currentCounter } = await import('../src/totp.js');
  const totp = generateSecret();
  let counterOffset = 0;
  // Every login needs a fresh code: a used one is refused as a replay.
  const nextCode = () => hotp(base32Decode(totp), currentCounter() + (counterOffset++ % 2));

  const claude = fakeCli(path.join(tmp, 'fake-claude.mjs'), FAKE_CLAUDE(LOG));
  const codex = fakeCli(path.join(tmp, 'fake-codex.mjs'), FAKE_CODEX(LOG));
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  writePrivateJson(path.join(HOME, 'config.json'), {
    port, workspaces: [WORK], codexSharedDaemon: false, maxConcurrentJobs: 4,
    agents: { claude: { enabled: true, command: real ? 'claude' : claude }, codex: { enabled: true, command: real ? 'codex' : codex }, custom: [] },
    ...config,
  });
  writePrivateJson(path.join(HOME, 'secrets.json'), await createSecrets(PASSWORD, totp, ['AAAA-BBBB-CCCC-DDDD']));
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    env: { ...process.env, AGENT_BRIDGE_HOME: HOME, ...(real ? {} : { CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'), CODEX_HOME: path.join(tmp, 'codex') }) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { output += d; if (String(d).includes('listening on')) resolve(); });
    child.on('exit', (code) => reject(new Error(`server exited (${code}): ${output}`)));
  });

  const request = (method, p, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: {
      Host: `127.0.0.1:${port}`, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers,
    } }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, json, text: buf }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });

  const session = { cookie: null, csrf: null };
  const api = {
    tmp, HOME, WORK, PROJECT, LOG, CLAUDE_SESSION, port, origin, totp, output: () => output, nextCode, request,
    calls: () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    async login() {
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await request('POST', '/api/login', { headers: { Origin: origin }, body: { password: PASSWORD, code: nextCode() } });
        if (r.status === 200) {
          session.cookie = r.headers['set-cookie'][0].split(';')[0];
          session.csrf = r.json.csrf;
          return r;
        }
        await sleep(300);
      }
      throw new Error('login failed');
    },
    authed: (method, p, body) => request(method, p, { body, headers: { Cookie: session.cookie, Origin: origin, 'X-CSRF-Token': session.csrf } }),
    async waitJob(id, timeout = real ? 240000 : 15000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const r = await api.authed('GET', `/api/jobs/${id}`);
        if (r.json?.job?.status !== 'running') return r.json;
        await sleep(real ? 1000 : 80);
      }
      throw new Error('job did not finish');
    },
    async waitDuo(id, timeout = real ? 480000 : 20000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const r = await api.authed('GET', `/api/duos/${id}`);
        if (r.json?.duo?.ended) return r.json;
        await sleep(100);
      }
      throw new Error('duo did not finish');
    },
    async stop() {
      child.kill();
      await sleep(200);
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
  return api;
}
