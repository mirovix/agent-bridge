import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { CodexDaemonTurn } from '../src/codex-daemon.js';

const THREAD = '11111111-2222-3333-4444-555555555555';
const TURN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('shared Codex daemon resumes and writes to the exact open chat', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bridge-daemon-'));
  const socketPath = path.join(dir, 'codex.sock');
  const calls = [];
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket) => socket.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    calls.push(message);
    if (message.method === 'initialize') socket.send(JSON.stringify({ id: message.id, result: { userAgent: 'test' } }));
    if (message.method === 'thread/resume') socket.send(JSON.stringify({ id: message.id, result: { thread: { id: THREAD } } }));
    if (message.method === 'turn/start') {
      socket.send(JSON.stringify({ id: message.id, result: { turn: { id: TURN, status: 'inProgress' } } }));
      setImmediate(() => {
        socket.send(JSON.stringify({ method: 'item/completed', params: { threadId: THREAD, turnId: TURN, item: { type: 'agentMessage', id: 'm1', text: 'Risposta nella stessa chat' } } }));
        socket.send(JSON.stringify({ method: 'turn/completed', params: { threadId: THREAD, turn: { id: TURN, status: 'completed' } } }));
      });
    }
  }));
  await new Promise((resolve) => server.listen(socketPath, resolve));
  try {
    const turn = new CodexDaemonTurn({ socketPath, threadId: THREAD, prompt: 'dal telefono', cwd: dir });
    const messages = [];
    turn.on('messages', (batch) => messages.push(...batch));
    const completed = new Promise((resolve) => turn.once('complete', resolve));
    await turn.start();
    const result = await completed;
    assert.equal(result.code, 0);
    assert.deepEqual(calls.map((call) => call.method), ['initialize', 'thread/resume', 'turn/start']);
    assert.equal(calls[1].params.threadId, THREAD);
    assert.equal(calls[2].params.threadId, THREAD);
    assert.equal(calls[2].params.input[0].text, 'dal telefono');
    assert.equal(calls[2].params.input[0].text_elements.length, 0);
    assert.ok(messages.some((message) => message.role === 'assistant' && message.text === 'Risposta nella stessa chat'));
  } finally {
    await new Promise((resolve) => wss.close(() => server.close(resolve)));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
