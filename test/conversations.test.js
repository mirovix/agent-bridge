import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bridge-conversations-'));
process.env.AGENT_BRIDGE_HOME = tmp;
const { forgetConversation, getConversation, setConversation } = await import('../src/conversations.js');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('one canonical conversation is persisted per agent and project', () => {
  const cwd = '/workspace/example';
  const first = '11111111-2222-3333-4444-555555555555';
  const next = '99999999-2222-3333-4444-555555555555';
  assert.equal(getConversation('codex', cwd), null);
  assert.equal(setConversation('codex', cwd, first), true);
  assert.equal(getConversation('codex', cwd), first);
  assert.equal(getConversation('claude', cwd), null, 'agents keep their own native thread');
  assert.equal(setConversation('codex', cwd, next), true);
  assert.equal(getConversation('codex', cwd), next, 'the canonical thread can be deliberately replaced');
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'conversations.json'), 'utf8'));
  assert.equal(saved.conversations.length, 1, 'never accumulates duplicate mappings for a project');
  assert.equal(fs.statSync(path.join(tmp, 'conversations.json')).mode & 0o077, 0);
  assert.equal(forgetConversation('codex', cwd), true);
  assert.equal(getConversation('codex', cwd), null);
});

test('invalid agents and session ids are never persisted', () => {
  assert.equal(setConversation('echo', '/x', '11111111-2222-3333-4444-555555555555'), false);
  assert.equal(setConversation('codex', '/x', '--not-a-session'), false);
});
