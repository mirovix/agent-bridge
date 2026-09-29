import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.AGENT_BRIDGE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bridge-voice-'));
const { normalizeLang } = await import('../src/voice.js');
test.after(() => fs.rmSync(process.env.AGENT_BRIDGE_HOME, { recursive: true, force: true }));

test('any ISO 639-1 code from the device is passed through', () => {
  for (const code of ['it', 'en', 'ja', 'pt', 'uk', 'sw']) assert.equal(normalizeLang(code), code);
  assert.equal(normalizeLang('EN'), 'en');
  assert.equal(normalizeLang('pt-BR'), 'pt');
  assert.equal(normalizeLang('zh_Hant'), 'zh');
});

test('missing or invalid languages mean auto-detect (empty), never a forced default', () => {
  for (const bad of [undefined, null, '', '   ', 'eng', 'e', '1a', '--x', 'en;rm', {}, 42]) assert.equal(normalizeLang(bad), '', String(bad));
});
