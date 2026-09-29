import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bridge-jobs-'));
process.env.AGENT_BRIDGE_HOME = path.join(tmp, 'home');
process.env.CODEX_HOME = path.join(tmp, 'codex');
fs.mkdirSync(process.env.CODEX_HOME);
fs.writeFileSync(path.join(process.env.CODEX_HOME, 'config.toml'), 'model = "gpt-test"\nmodel_reasoning_effort = "high"\n');
fs.writeFileSync(path.join(process.env.CODEX_HOME, 'models_cache.json'), JSON.stringify({ models: [
  { slug: 'gpt-test', display_name: 'GPT Test', visibility: 'list', priority: 1, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
  { slug: '--evil', display_name: 'Evil', visibility: 'list', supported_reasoning_levels: [] },
  { slug: 'hidden', visibility: 'hide', supported_reasoning_levels: [] },
] }));

// Fake agent: reports its argv and stdin so we can check exactly what we pass.
const fake = path.join(tmp, 'fake-agent.mjs');
fs.writeFileSync(fake, `#!${process.execPath}
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => { console.log('ARGS ' + JSON.stringify(process.argv.slice(2))); console.log('STDIN ' + input.length + ' ' + input.slice(0, 40)); });
`, { mode: 0o755 });

const { JobManager, agentList, validateImages } = await import('../src/jobs.js');
const { DEFAULT_CONFIG } = await import('../src/config.js');
const cfg = { ...DEFAULT_CONFIG, agents: { claude: { enabled: true, command: fake }, codex: { enabled: true, command: fake }, custom: [] } };
const jm = new JobManager(cfg);
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
const run = (spec) => new Promise((resolve) => {
  const j = jm.start({ cwd: tmp, prompt: 'ciao', ...spec }, {});
  j.on('end', () => {
    const args = JSON.parse(j.events.find((e) => e.text?.startsWith('ARGS ')).text.slice(5));
    const stdin = j.events.find((e) => e.text?.startsWith('STDIN ')).text;
    resolve({ job: j, args, stdin });
  });
});

test('codex model list comes from the cache, filtered to safe visible slugs', () => {
  const codex = agentList(cfg).find((a) => a.id === 'codex');
  assert.deepEqual(codex.models.map((m) => m.id), ['', 'gpt-test']);
  assert.match(codex.models[0].label, /gpt-test, high/);
});

test('rejects models and efforts outside the allowlist (no flag injection)', () => {
  for (const [model, effort] of [['--dangerously-skip-permissions', ''], ['opus', '--x'], ['opus', 'ultra'], ['gpt-test', '']]) {
    assert.throws(() => jm.start({ agent: 'claude', cwd: tmp, prompt: 'x', model, effort }, {}), /non disponibile|non valido/);
  }
  assert.throws(() => jm.start({ agent: 'claude', cwd: tmp, prompt: 'x', mode: 'bypassPermissions' }, {}), /non consentita/);
});

test('rejects fake or oversized images', () => {
  assert.throws(() => validateImages([{ mediaType: 'image/png', data: Buffer.from('not a png').toString('base64') }]), /non corrisponde/);
  assert.throws(() => validateImages([{ mediaType: 'image/svg+xml', data: PNG }]), /non supportato/);
  assert.throws(() => validateImages(Array(5).fill({ mediaType: 'image/png', data: PNG })), /Massimo/);
  assert.equal(validateImages([{ mediaType: 'image/png', data: PNG }]).length, 1);
});

test('claude: model, effort, fork and images map to the right flags', async () => {
  const sid = '11111111-2222-3333-4444-555555555555';
  const { args, stdin, job } = await run({ agent: 'claude', sessionId: sid, fork: true, model: 'opus', effort: 'high', mode: 'plan', images: [{ mediaType: 'image/png', data: PNG }] });
  assert.deepEqual(args, ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'plan', '--model', 'opus', '--effort', 'high', '--resume', sid, '--fork-session', '--input-format', 'stream-json']);
  assert.match(stdin, /^STDIN \d+ \{"type":"user"/);
  assert.equal(job.summary().fork, true);
  assert.equal(job.summary().resumeOf, sid);
});

test('codex: images go first, then options, then session id and stdin marker', async () => {
  const sid = '11111111-2222-3333-4444-555555555555';
  const { args, stdin } = await run({ agent: 'codex', sessionId: sid, model: 'gpt-test', effort: 'low', mode: 'read-only', images: [{ mediaType: 'image/png', data: PNG }] });
  assert.equal(args[0], 'exec');
  assert.equal(args[1], 'resume');
  assert.equal(args[2], '-i');
  assert.match(args[3], /uploads\/[0-9a-f-]+\/image-1\.png$/);
  assert.deepEqual(args.slice(4), ['--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', '-m', 'gpt-test', '-c', 'model_reasoning_effort="low"', sid, '-']);
  assert.equal(stdin, 'STDIN 4 ciao');
  assert.equal(fs.existsSync(path.dirname(args[3])), false, 'uploaded images are deleted after the job');
});

test('codex fork uses exec fork', async () => {
  const sid = '11111111-2222-3333-4444-555555555555';
  const { args } = await run({ agent: 'codex', sessionId: sid, fork: true });
  assert.deepEqual(args.slice(0, 2), ['exec', 'fork']);
});

test('a transient Codex writer conflict retries the same chat', async () => {
  const marker = path.join(tmp, 'codex-lock-once');
  const locking = path.join(tmp, 'locking-codex.mjs');
  fs.writeFileSync(locking, `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('resume') && !fs.existsSync(${JSON.stringify(marker)})) {
  fs.writeFileSync(${JSON.stringify(marker)}, '1');
  console.error('ERROR codex_core::session: thread-store conflict: thread abc already has an active writer');
  process.exit(1);
}
console.log(JSON.stringify({ type: 'thread.started', thread_id: '11111111-2222-3333-4444-555555555555' }));
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'risposta nella stessa chat' } }));
`, { mode: 0o755 });
  const jm2 = new JobManager({ ...cfg, codexLockRetryMs: 5, agents: { ...cfg.agents, codex: { enabled: true, command: locking } } });
  const job = await new Promise((resolve) => {
    const j = jm2.start({ agent: 'codex', sessionId: '11111111-2222-3333-4444-555555555555', cwd: tmp, prompt: 'ciao' }, {});
    j.on('end', () => resolve(j));
  });
  assert.equal(job.status, 'done');
  assert.equal(job.summary().fork, false, 'did not create a copy');
  assert.equal(job.summary().sessionId, '11111111-2222-3333-4444-555555555555');
  assert.ok(job.events.some((e) => e.text.includes('senza creare copie')), 'told the user');
  assert.ok(job.events.some((e) => e.text === 'risposta nella stessa chat'), 'answered on retry');
  assert.ok(!job.events.some((e) => e.role === 'error'), 'no red error');
});

test('a structured Codex lock error also retries the same chat', async () => {
  const marker = path.join(tmp, 'codex-json-lock-once');
  const locking = path.join(tmp, 'locking-codex-json.mjs');
  fs.writeFileSync(locking, `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('resume') && !fs.existsSync(${JSON.stringify(marker)})) {
  fs.writeFileSync(${JSON.stringify(marker)}, '1');
  console.log(JSON.stringify({ type: 'turn.failed', error: { message: 'thread-store conflict: thread abc already has an active writer' } }));
  process.exit(1);
}
console.log(JSON.stringify({ type: 'thread.started', thread_id: '11111111-2222-3333-4444-555555555555' }));
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ripresa nella stessa chat' } }));
`, { mode: 0o755 });
  const jm2 = new JobManager({ ...cfg, codexLockRetryMs: 5, agents: { ...cfg.agents, codex: { enabled: true, command: locking } } });
  const job = await new Promise((resolve) => {
    const j = jm2.start({ agent: 'codex', sessionId: '11111111-2222-3333-4444-555555555555', cwd: tmp, prompt: 'ciao' }, {});
    j.on('end', () => resolve(j));
  });
  assert.equal(job.status, 'done');
  assert.equal(job.summary().fork, false);
  assert.equal(job.summary().sessionId, '11111111-2222-3333-4444-555555555555');
  assert.ok(job.events.some((e) => e.text === 'ripresa nella stessa chat'));
  assert.ok(!job.events.some((e) => e.role === 'error'), 'the recoverable lock stays hidden');
});
