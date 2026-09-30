// Integration: Claude Code and Codex working together through a real server,
// with fake CLIs that print the same JSON streams as the real ones.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { startServer } from './harness.js';

let s;
test.before(async () => { s = await startServer(); await s.login(); });
test.after(() => s?.stop());

test('both agents are listed and the duo feature is advertised', async () => {
  const me = await s.authed('GET', '/api/me');
  assert.equal(me.status, 200);
  assert.deepEqual(me.json.agents.map((a) => a.id).sort(), ['claude', 'codex']);
  assert.equal(me.json.duo, true);
});

test('Claude runs headless with stream-json and the prompt on stdin', async () => {
  const r = await s.authed('POST', '/api/jobs', { agent: 'claude', cwd: s.PROJECT, prompt: 'hello claude', mode: 'plan', model: 'sonnet', effort: 'high' });
  assert.equal(r.status, 200, r.text);
  const done = await s.waitJob(r.json.job.id);
  assert.equal(done.job.status, 'done');
  assert.equal(done.prompt, 'hello claude');
  assert.ok(done.events.some((e) => e.role === 'assistant' && e.text === 'Claude did the task.'));
  assert.ok(done.events.some((e) => /Done \(success\) · \$0\.0012/.test(e.text)));
  const call = s.calls().find((c) => c.agent === 'claude' && c.input === 'hello claude');
  for (const flag of ['-p', '--output-format', 'stream-json', '--verbose']) assert.ok(call.args.includes(flag), flag);
  assert.deepEqual(call.args.slice(call.args.indexOf('--permission-mode'), call.args.indexOf('--permission-mode') + 2), ['--permission-mode', 'plan']);
  assert.ok(call.args.includes('sonnet') && call.args.includes('high'));
  assert.equal(fs.realpathSync(call.cwd), fs.realpathSync(s.PROJECT));
});

test('Codex runs `exec --json` with the sandbox mode and streams its steps', async () => {
  const r = await s.authed('POST', '/api/jobs', { agent: 'codex', cwd: s.PROJECT, prompt: 'hello codex', mode: 'read-only' });
  assert.equal(r.status, 200, r.text);
  const done = await s.waitJob(r.json.job.id);
  assert.equal(done.job.status, 'done');
  assert.ok(done.events.some((e) => e.role === 'tool' && e.name === 'shell' && e.text === 'ls'));
  assert.ok(done.events.some((e) => e.role === 'assistant' && e.text === 'Codex did the task.'));
  assert.ok(done.events.some((e) => /token in 10 \/ out 5/.test(e.text)));
  const call = s.calls().find((c) => c.agent === 'codex' && c.input === 'hello codex');
  assert.equal(call.args[0], 'exec');
  assert.ok(call.args.includes('--json'));
  assert.ok(call.args.includes('sandbox_mode="read-only"'));
  assert.equal(call.args.at(-1), '-');
});

test('a failing Codex turn is reported as failed with the error', async () => {
  const r = await s.authed('POST', '/api/jobs', { agent: 'codex', cwd: s.PROJECT, prompt: 'fail please' });
  const done = await s.waitJob(r.json.job.id);
  assert.equal(done.job.status, 'failed');
  assert.ok(done.events.some((e) => e.role === 'error' && /fake failure/.test(e.text)));
});

test('review duo: Codex works, Claude reviews the real diff read-only, Codex applies', async () => {
  const r = await s.authed('POST', '/api/duos', { kind: 'review', lead: 'codex', cwd: s.PROJECT, prompt: 'please edit the notes', apply: true });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.duo.steps.map((x) => `${x.agent}:${x.role}`), ['codex:work', 'claude:review', 'codex:apply']);
  const done = await s.waitDuo(r.json.duo.id);
  assert.equal(done.duo.status, 'done', JSON.stringify(done.duo));
  assert.deepEqual(done.duo.steps.map((x) => x.status), ['done', 'done', 'done']);
  assert.equal(done.prompt, 'please edit the notes');
  assert.ok(done.jobs.every((j) => j && j.duo?.id === r.json.duo.id));

  const calls = s.calls();
  const review = calls.find((c) => c.agent === 'claude' && c.input.includes('<report>'));
  assert.ok(review, 'Claude received the review prompt');
  assert.match(review.input, /Codex did the task\./, 'the report is the lead reply');
  assert.match(review.input, /<diff>[\s\S]*\+edited by codex[\s\S]*<\/diff>/, 'the diff shows what Codex changed');
  assert.equal(review.args[review.args.indexOf('--permission-mode') + 1], 'manual', 'the reviewer cannot edit');
  assert.ok(!review.args.includes('--resume'), 'the reviewer uses a separate chat');

  const work = calls.find((c) => c.agent === 'codex' && c.input === 'please edit the notes');
  const apply = calls.find((c) => c.agent === 'codex' && c.input.includes('<review>'));
  assert.match(apply.input, /Review: looks correct/);
  assert.deepEqual(apply.args.slice(0, 2), ['exec', 'resume'], 'fixes go into the same Codex chat');
  const workJob = done.jobs[0];
  assert.ok(apply.args.includes(workJob.sessionId));
  assert.ok(work);
});

test('review duo with Claude leading and no apply step', async () => {
  const r = await s.authed('POST', '/api/duos', { kind: 'review', lead: 'claude', cwd: s.PROJECT, prompt: 'please edit again', options: { claude: { mode: 'acceptEdits' } } });
  assert.equal(r.status, 200, r.text);
  const done = await s.waitDuo(r.json.duo.id);
  assert.equal(done.duo.status, 'done');
  assert.deepEqual(done.duo.steps.map((x) => `${x.agent}:${x.role}:${x.status}`), ['claude:work:done', 'codex:review:done']);
  const review = s.calls().find((c) => c.agent === 'codex' && c.input.includes('please edit again'));
  assert.ok(review.args.includes('sandbox_mode="read-only"'));
  assert.match(review.input, /\+edited by claude/);
});

test('compare duo runs both agents at once, read-only', async () => {
  const r = await s.authed('POST', '/api/duos', { kind: 'compare', lead: 'claude', cwd: s.PROJECT, prompt: 'which is better, please edit?' });
  assert.equal(r.status, 200, r.text);
  const done = await s.waitDuo(r.json.duo.id);
  assert.equal(done.duo.status, 'done');
  assert.deepEqual(done.jobs.map((j) => j.agent).sort(), ['claude', 'codex']);
  const both = s.calls().filter((c) => c.input === 'which is better, please edit?');
  assert.equal(both.length, 2);
  assert.equal(fs.readFileSync(path.join(s.PROJECT, 'notes.txt'), 'utf8').match(/edited/g).length, 2, 'compare did not edit files');
});

test('a failing step stops the duo and skips the rest', async () => {
  const r = await s.authed('POST', '/api/duos', { kind: 'review', lead: 'codex', cwd: s.PROJECT, prompt: 'fail please', apply: true });
  const done = await s.waitDuo(r.json.duo.id);
  assert.equal(done.duo.status, 'failed');
  assert.deepEqual(done.duo.steps.map((x) => x.status), ['failed', 'skipped', 'skipped']);
  assert.match(done.duo.error, /Codex did not finish/);
});

test('a duo can be cancelled while it runs', async () => {
  const r = await s.authed('POST', '/api/duos', { kind: 'review', lead: 'claude', cwd: s.PROJECT, prompt: 'work slowly', apply: true });
  assert.equal(r.status, 200);
  await new Promise((res) => setTimeout(res, 300));
  assert.equal((await s.authed('POST', `/api/duos/${r.json.duo.id}/cancel`, {})).status, 200);
  const done = await s.waitDuo(r.json.duo.id);
  assert.equal(done.duo.status, 'cancelled');
  assert.equal(done.duo.steps[0].status, 'cancelled');
  assert.deepEqual(done.duo.steps.slice(1).map((x) => x.status), ['skipped', 'skipped']);
});

test('duo input is validated', async () => {
  const bad = [
    [{ kind: 'nope', lead: 'claude', cwd: s.PROJECT, prompt: 'x' }, 400, /kind/],
    [{ kind: 'review', lead: 'gemini', cwd: s.PROJECT, prompt: 'x' }, 400, /lead/],
    [{ kind: 'review', lead: 'claude', cwd: '/etc', prompt: 'x' }, 403, /outside/],
    [{ kind: 'review', lead: 'claude', cwd: s.PROJECT, prompt: '  ' }, 400, /empty/i],
    [{ kind: 'review', lead: 'claude', cwd: s.PROJECT, prompt: 'x', reviewInstruction: 'y'.repeat(5000) }, 400, /too long/],
    [{ kind: 'review', lead: 'claude', cwd: s.PROJECT, prompt: 'x', options: { claude: { mode: 'bypassPermissions' } } }, 400, /not allowed/],
  ];
  for (const [body, status, error] of bad) {
    const r = await s.authed('POST', '/api/duos', body);
    if (status === 400 && error.source === 'not allowed') {
      // A bad option only fails when the step starts: the duo itself reports it.
      const done = r.status === 200 ? await s.waitDuo(r.json.duo.id) : null;
      assert.ok(r.status === 400 || /not allowed/.test(done.duo.error), JSON.stringify(body));
      continue;
    }
    assert.equal(r.status, status, JSON.stringify(body));
    assert.match(r.json.error, error);
  }
  assert.equal((await s.authed('GET', '/api/duos/00000000-0000-0000-0000-000000000000')).status, 404);
});

test('handoff passes the last Codex reply to Claude with the instruction', async () => {
  const first = await s.authed('POST', '/api/jobs', { agent: 'codex', cwd: s.PROJECT, prompt: 'describe the project' });
  await s.waitJob(first.json.job.id);
  const r = await s.authed('POST', '/api/handoff', { jobId: first.json.job.id, to: 'claude', instruction: 'Write tests for this.', options: { mode: 'plan' } });
  assert.equal(r.status, 200, r.text);
  const done = await s.waitJob(r.json.job.id);
  assert.equal(done.job.status, 'done');
  assert.equal(done.job.agent, 'claude');
  const call = s.calls().find((c) => c.agent === 'claude' && c.input.startsWith('Write tests for this.'));
  assert.match(call.input, /latest reply from Codex/);
  assert.match(call.input, /<reply>\nCodex did the task\.\n<\/reply>/);
});

test('handoff refuses unknown sources and targets', async () => {
  assert.equal((await s.authed('POST', '/api/handoff', { jobId: '00000000-0000-0000-0000-000000000000', to: 'claude' })).status, 404);
  assert.equal((await s.authed('POST', '/api/handoff', { from: 'codex', sessionId: '00000000-0000-0000-0000-000000000000', to: 'claude' })).status, 404);
  assert.equal((await s.authed('POST', '/api/handoff', { jobId: '00000000-0000-0000-0000-000000000000', to: 'bash' })).status, 400);
});

test('settings are stored on the PC and shared by every device', async () => {
  assert.deepEqual((await s.authed('GET', '/api/prefs')).json.prefs, {});
  const prefs = { theme: 'dark', accent: 'green', quickPrompts: ['Run the tests', 'Commit'], 'model.claude': 'opus' };
  assert.equal((await s.authed('PUT', '/api/prefs', { prefs })).status, 200);
  assert.deepEqual((await s.authed('GET', '/api/prefs')).json.prefs, prefs);
  assert.equal((await s.authed('PUT', '/api/prefs', { prefs: [1, 2] })).status, 400);
  assert.equal((await s.authed('PUT', '/api/prefs', { prefs: { 'bad key!': 1 } })).status, 400);
  assert.equal((await s.authed('PUT', '/api/prefs', { prefs: { big: 'x'.repeat(33 * 1024) } })).status, 400);
  assert.equal((await s.request('GET', '/api/prefs')).status, 401);
});

test('the audit log records duos and handoffs without prompt text', () => {
  const log = fs.readFileSync(path.join(s.HOME, 'audit.log'), 'utf8');
  for (const event of ['duo_start', 'duo_end', 'duo_cancel', 'handoff']) assert.match(log, new RegExp(`"${event}"`), event);
  assert.ok(!log.includes('please edit the notes'));
});
