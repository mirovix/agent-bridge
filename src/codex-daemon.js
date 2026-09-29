// Sends a turn to the shared Codex app-server daemon. VS Code and Agent Bridge
// connect to the same daemon, so there is one thread writer and one conversation.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import WebSocket from 'ws';
import { defaultCodexSocket, isNamedPipe, spawnCommandSync } from './platform.js';

const DEFAULT_SOCKET = defaultCodexSocket();
const UUID = /^[0-9a-f-]{36}$/i;

// The daemon endpoint can be a Unix socket path (Linux/macOS), a Windows named
// pipe (\\.\pipe\name) or a ws:// URL (e.g. ws://127.0.0.1:PORT/).
const isUrl = (s) => /^wss?:\/\//i.test(s);

function reachable(endpoint) {
  // URLs and named pipes are not files: probing a pipe would use up a connection,
  // so they are tried as-is and a connection error explains what is wrong.
  if (isUrl(endpoint) || isNamedPipe(endpoint)) return endpoint;
  try { return fs.realpathSync(endpoint); } catch { return null; }
}

function daemonSocket(command, requested) {
  const file = requested || process.env.CODEX_APP_SERVER_SOCKET || DEFAULT_SOCKET;
  const found = reachable(file);
  if (found) return found;
  const started = spawnCommandSync(command || 'codex', ['app-server', 'daemon', 'start'], {
    encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (started.error || started.status !== 0) {
    throw new Error(`Codex daemon not available: ${(started.stderr || started.error?.message || '').trim()}`);
  }
  const ready = reachable(file);
  if (!ready) throw new Error('Codex daemon started, but the shared socket is not available');
  return ready;
}

function itemMessages(item) {
  if (!item || typeof item !== 'object') return [];
  switch (item.type) {
    case 'agentMessage': return item.text ? [{ role: 'assistant', text: item.text }] : [];
    case 'reasoning': {
      const text = [...(item.summary || []), ...(item.content || [])].filter(Boolean).join('\n');
      return text ? [{ role: 'thinking', text }] : [];
    }
    case 'commandExecution': return [
      { role: 'tool', name: 'shell', text: item.command || '' },
      ...(item.aggregatedOutput ? [{ role: 'tool_result', text: item.aggregatedOutput, error: item.exitCode ? true : false }] : []),
    ];
    case 'fileChange': return [{ role: 'tool', name: 'file_change', text: (item.changes || []).map((c) => `${c.kind || 'change'} ${c.path || ''}`).join('\n') }];
    case 'mcpToolCall': return [{ role: 'tool', name: `${item.server || 'mcp'}.${item.tool || 'tool'}`, text: JSON.stringify(item.arguments ?? '') }];
    case 'webSearch': return [{ role: 'tool', name: 'web_search', text: item.query || '' }];
    case 'plan': return item.text ? [{ role: 'system', text: item.text }] : [];
    case 'error': return [{ role: 'error', text: item.message || 'Codex error' }];
    default: return [];
  }
}

export class CodexDaemonTurn extends EventEmitter {
  constructor({ command = 'codex', socketPath, threadId, prompt, cwd, model, effort, imagePaths = [] }) {
    super();
    if (!UUID.test(threadId || '')) throw new Error('Invalid Codex session');
    Object.assign(this, { command, socketPath, threadId, prompt, cwd, model, effort, imagePaths });
    this.pending = new Map();
    this.seq = 0;
    this.turnId = null;
    this.finished = false;
  }

  request(method, params, timeoutMs = 20_000) {
    const id = `agent-bridge-${process.pid}-${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex did not answer ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ method, id, params }));
    });
  }

  async start() {
    const socket = daemonSocket(this.command, this.socketPath);
    this.ws = isUrl(socket)
      ? new WebSocket(socket)
      : new WebSocket('ws://localhost/', { createConnection: () => net.createConnection(socket) });
    this.ws.on('message', (raw) => this.onMessage(raw));
    this.ws.on('error', (error) => this.fail(error));
    this.ws.on('close', () => {
      if (!this.finished) this.fail(new Error('Connection to the Codex chat was lost'));
    });
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    await this.request('initialize', {
      clientInfo: { name: 'agent-bridge', title: 'Agent Bridge', version: '1.1.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    await this.request('thread/resume', { threadId: this.threadId, excludeTurns: true });
    const input = [
      { type: 'text', text: this.prompt, text_elements: [] },
      ...this.imagePaths.map((imagePath) => ({ type: 'localImage', path: imagePath })),
    ];
    const params = {
      threadId: this.threadId,
      clientUserMessageId: crypto.randomUUID(),
      input,
      turnTrigger: 'agent-bridge-mobile',
    };
    if (this.cwd) params.cwd = this.cwd;
    if (this.model) params.model = this.model;
    if (this.effort) params.effort = this.effort;
    const response = await this.request('turn/start', params, 30_000);
    this.turnId = response?.turn?.id || this.turnId;
    this.emit('started', this.turnId);
    return this;
  }

  onMessage(raw) {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (message.id != null) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    const { method, params } = message;
    if (params?.threadId && params.threadId !== this.threadId) return;
    if (params?.turnId && this.turnId && params.turnId !== this.turnId) return;
    if (method === 'turn/started') this.turnId ||= params?.turn?.id || null;
    else if (method === 'item/completed') this.emit('messages', itemMessages(params?.item));
    else if (method === 'error') this.emit('messages', [{ role: 'error', text: params?.error?.message || params?.message || 'Codex error' }]);
    else if (method === 'turn/completed' && (!this.turnId || params?.turn?.id === this.turnId)) {
      const status = params?.turn?.status;
      if (status === 'completed') this.complete(0);
      else if (status === 'interrupted') this.complete(null, 'SIGTERM');
      else this.complete(1, null, params?.turn?.error?.message || 'The Codex turn failed');
    }
  }

  async cancel() {
    if (this.finished) return;
    if (this.turnId) {
      try { await this.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }, 10_000); } catch { /* closing still cancels our job */ }
    }
    this.complete(null, 'SIGTERM');
  }

  complete(code, signal = null, error = null) {
    if (this.finished) return;
    this.finished = true;
    if (error) this.emit('messages', [{ role: 'error', text: error }]);
    this.emit('complete', { code, signal });
    this.close();
  }

  fail(error) {
    if (!this.finished) this.complete(1, null, error?.message || String(error));
  }

  close() {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error('Codex connection closed'));
    }
    this.pending.clear();
    try { this.ws?.close(); } catch { /* closed */ }
  }
}

// On Windows the daemon's default Unix socket is not reachable from Node, so the
// shared chat is used there only with an explicit named pipe or ws:// endpoint
// (config codexDaemonSocket or CODEX_APP_SERVER_SOCKET); otherwise jobs use the CLI.
export const codexDaemonEnabled = (cfg, platform = process.platform) => cfg.codexSharedDaemon !== false
  && cfg.agents?.codex?.command === 'codex'
  && (platform !== 'win32' || !!(cfg.codexDaemonSocket || process.env.CODEX_APP_SERVER_SOCKET));
