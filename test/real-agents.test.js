// End-to-end with the REAL Claude Code and Codex CLIs, signed in as you.
// Off by default (it uses your plan / tokens):  AB_REAL_AGENTS=1 npm test
// Each prompt is tiny and read-only, in a throw-away git repository.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { which } from '../src/platform.js';
import { startServer } from './harness.js';

const wanted = process.env.AB_REAL_AGENTS === '1';
const skip = !wanted ? 'set AB_REAL_AGENTS=1 to run against the real CLIs'
  : !which('claude') || !which('codex') ? 'claude or codex is not installed' : false;

test.describe('real Claude Code and Codex', { skip, concurrency: false }, () => {
  let s;
  test.before(async () => {
    s = await startServer({ real: true, config: { jobTimeoutMinutes: 8 } });
    fs.writeFileSync(path.join(s.PROJECT, 'math.js'), 'export const add = (a, b) => a - b; // bug: should be a + b\n');
    await s.login();
  });
  test.after(() => s?.stop());

  const reply = (events) => events.filter((e) => e.role === 'assistant').map((e) => e.text).join('\n');

  test('versions are detected', async () => {
    await new Promise((r) => setTimeout(r, 4000));
    const info = await s.authed('GET', '/api/server-info');
    assert.match(info.json.versions.claude || '', /Claude Code/);
    assert.match(info.json.versions.codex || '', /codex/i);
  });

  test('Claude Code answers a prompt', async () => {
    const r = await s.authed('POST', '/api/jobs', { agent: 'claude', cwd: s.PROJECT, prompt: 'Reply with exactly the word PONG and nothing else.', mode: 'plan', model: 'haiku' });
    assert.equal(r.status, 200, r.text);
    const done = await s.waitJob(r.json.job.id);
    assert.equal(done.job.status, 'done', JSON.stringify(done.events.slice(-3)));
    assert.match(reply(done.events), /PONG/);
    assert.ok(done.job.sessionId, 'Claude reported its session id');
  });

  test('Codex answers a prompt', async () => {
    const r = await s.authed('POST', '/api/jobs', { agent: 'codex', cwd: s.PROJECT, prompt: 'Reply with exactly the word PONG and nothing else. Do not run any command.', mode: 'read-only', effort: 'low' });
    assert.equal(r.status, 200, r.text);
    const done = await s.waitJob(r.json.job.id);
    assert.equal(done.job.status, 'done', JSON.stringify(done.events.slice(-3)));
    assert.match(reply(done.events), /PONG/);
    assert.ok(done.job.sessionId, 'Codex reported its thread id');
  });

  test('a second prompt continues the same Claude chat', async () => {
    const r = await s.authed('POST', '/api/jobs', { agent: 'claude', cwd: s.PROJECT, prompt: 'What word did you just reply with? Answer with that word only.', mode: 'plan', model: 'haiku' });
    const done = await s.waitJob(r.json.job.id);
    assert.equal(done.job.status, 'done');
    assert.ok(done.job.resumeOf, 'resumed the previous chat');
    assert.match(reply(done.events), /PONG/i);
  });

  test('Codex reads a file and Claude reviews its answer (duo, read-only)', async () => {
    const r = await s.authed('POST', '/api/duos', {
      kind: 'review', lead: 'codex', cwd: s.PROJECT, apply: false,
      prompt: 'Read math.js and say in one sentence what the bug is. Do not edit anything.',
      options: { codex: { mode: 'read-only', effort: 'low' }, claude: { model: 'haiku' } },
      reviewInstruction: 'In one or two sentences: is the report above correct? Do not edit files.',
    });
    assert.equal(r.status, 200, r.text);
    const done = await s.waitDuo(r.json.duo.id);
    assert.equal(done.duo.status, 'done', JSON.stringify(done.duo));
    const [work, review] = await Promise.all(done.jobs.map((j) => s.authed('GET', `/api/jobs/${j.id}`).then((x) => x.json)));
    assert.match(reply(work.events), /\+|add|subtract|minus/i);
    assert.ok(reply(review.events).length > 10, 'Claude wrote a review');
    assert.equal(fs.readFileSync(path.join(s.PROJECT, 'math.js'), 'utf8').includes('a - b'), true, 'nothing was edited');
  });

  test('handoff: Claude explains what Codex said', async () => {
    const jobs = (await s.authed('GET', '/api/jobs')).json.jobs;
    const codexJob = jobs.find((j) => j.agent === 'codex' && j.status === 'done');
    const r = await s.authed('POST', '/api/handoff', { jobId: codexJob.id, to: 'claude', instruction: 'Repeat the key point of this reply in five words or fewer.', options: { mode: 'plan', model: 'haiku' } });
    assert.equal(r.status, 200, r.text);
    const done = await s.waitJob(r.json.job.id);
    assert.equal(done.job.status, 'done');
    assert.ok(reply(done.events).length > 0);
  });
});
