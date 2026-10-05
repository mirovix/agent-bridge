// Delivery of a prompt into a live Claude Code chat (the /phone path).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'stop.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bridge-live-'));
process.env.AGENT_BRIDGE_HOME = path.join(tmp, 'home');
const CWD = path.join(tmp, 'work');
fs.mkdirSync(CWD);
const SID = '11111111-2222-3333-4444-555555555555';

const { setArmed, getArmed, isLive, deliver, listLive } = await import('../src/live.js');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Run the Stop hook as Claude Code would, returning its parsed stdout. */
function runHook({ sessionId = SID, cwd = CWD, env = {} } = {}) {
  // Without this the test fails when the whole suite is itself running as an
  // Agent Bridge job (a prompt sent from the app): the hook would refuse to park.
  const clean = { ...process.env, AGENT_BRIDGE_HOME: process.env.AGENT_BRIDGE_HOME };
  delete clean.AGENT_BRIDGE_JOB;
  const p = spawn(process.execPath, [HOOK], { env: { ...clean, ...env } });
  let out = '';
  p.stdout.on('data', (c) => (out += c));
  p.stdin.end(JSON.stringify({ session_id: sessionId, cwd, hook_event_name: 'Stop', stop_hook_active: false }));
  return { proc: p, done: new Promise((r) => p.on('close', () => r(out.trim() ? JSON.parse(out) : null))) };
}

test('an unarmed session is never delayed by the hook', async () => {
  const t0 = Date.now();
  assert.equal(await runHook().done, null);
  assert.ok(Date.now() - t0 < 3000, 'the hook must return straight away');
});

test('agents started by the app never park (no feedback loop)', async () => {
  setArmed(CWD, 5);
  const t0 = Date.now();
  assert.equal(await runHook({ env: { AGENT_BRIDGE_JOB: '1' } }).done, null);
  assert.ok(Date.now() - t0 < 3000);
  setArmed(CWD, 0);
});

test('/phone arms a directory and expires on its own', () => {
  assert.equal(getArmed(CWD), null);
  setArmed(CWD, 60);
  assert.ok(getArmed(CWD).armedUntil > Date.now());
  assert.equal(getArmed(path.join(tmp, 'altrove')), null, 'another directory is not armed');
  setArmed(CWD, 0);
  assert.equal(getArmed(CWD), null);
});

test('a prompt sent from the app lands in the parked chat', async () => {
  setArmed(CWD, 5);
  const hook = runHook();
  for (let i = 0; i < 40 && !isLive(SID); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(isLive(SID), 'the parked hook advertises itself as listening');

  const msg = deliver(SID, 'Aggiungi un test di regressione');
  const out = await hook.done;
  assert.equal(out.decision, 'block', 'Claude must keep going instead of stopping');
  assert.match(out.reason, /Aggiungi un test di regressione/);
  assert.match(out.systemMessage, /phone/);
  assert.ok(msg.id);
  assert.equal(listLive().length, 0, 'the session stops advertising once it has the prompt');
  setArmed(CWD, 0);
});

test('delivery is refused when no chat is listening', () => {
  assert.equal(isLive(SID), false);
  assert.throws(() => deliver(SID, 'ciao'), /no longer listening/);
});

test('disarming while parked releases the chat', async () => {
  setArmed(CWD, 5);
  const hook = runHook();
  for (let i = 0; i < 40 && !isLive(SID); i++) await new Promise((r) => setTimeout(r, 100));
  setArmed(CWD, 0);
  assert.equal(await hook.done, null, 'the turn ends normally');
});
