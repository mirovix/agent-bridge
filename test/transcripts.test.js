import assert from 'node:assert/strict';
import test from 'node:test';
import { parseChunk } from '../src/transcripts.js';

test('parses Claude transcript lines', () => {
  const lines = [
    { type: 'user', uuid: 'u1', message: { role: 'user', content: 'ciao' } },
    { type: 'user', uuid: 'u2', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>x</system-reminder>' }] } },
    { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } }] } },
    { type: 'user', uuid: 'u3', message: { content: [{ type: 'tool_result', content: 'file.txt', is_error: false }] } },
    { type: 'assistant', uuid: 'a2', message: { content: [{ type: 'text', text: 'fatto' }] } },
    { type: 'assistant', uuid: 'a3', isSidechain: true, message: { content: [{ type: 'text', text: 'subagent' }] } },
  ];
  const buf = Buffer.from(lines.map((l) => JSON.stringify(l)).join('\n') + '\n{"partial":');
  const { messages, consumed } = parseChunk('claude', buf);
  assert.deepEqual(messages.map((m) => [m.role, m.text, !!m.meta]), [
    ['user', 'ciao', false], ['user', '<system-reminder>x</system-reminder>', true],
    ['tool', 'ls -la', false], ['tool_result', 'file.txt', false], ['assistant', 'fatto', false],
  ]);
  assert.equal(buf.subarray(consumed).toString(), '{"partial":');
});

test('parses Codex rollout lines', () => {
  const lines = [
    { type: 'session_meta', payload: { id: '01a0e741-861b-7cf1-893a-46a5619434a9', cwd: '/x' } },
    { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'sys' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>…' }, { type: 'input_text', text: 'fai X' }] } },
    { type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":"make"}' } },
    { type: 'response_item', payload: { type: 'function_call_output', output: 'ok' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'fatto X' }] } },
  ];
  const { messages } = parseChunk('codex', Buffer.from(lines.map((l) => JSON.stringify(l)).join('\n') + '\n'));
  assert.deepEqual(messages.map((m) => [m.role, m.text, !!m.meta]), [
    ['user', '<environment_context>…', true], ['user', 'fai X', false], ['tool', 'make', false], ['tool_result', 'ok', false], ['assistant', 'fatto X', false],
  ]);
});
