// Sends a turn to the shared Codex app-server daemon. VS Code and Agent Bridge
// connect to the same daemon, so there is one thread writer and one conversation.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const DEFAULT_SOCKET = path.join(os.homedir(), '.codex', 'app-server-control', 'app-server-control.sock');
const UUID = /^[0-9a-f-]{36}$/i;

function daemonSocket(command, requested) {
  const file = requested || process.env.CODEX_APP_SERVER_SOCKET || DEFAULT_SOCKET;
  try { return fs.realpathSync(file); } catch { /* start below */ }
  const started = spawnSync(command || 'codex', ['app-server', 'daemon', 'start'], {
    encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (started.error || started.status !== 0) {
    throw new Error(`Daemon Codex non disponibile: ${(started.stderr || started.error?.message || '').trim()}`);
  }
  try { return fs.realpathSync(file); } catch {
    throw new Error('Daemon Codex avviato, ma il socket condiviso non è disponibile');
  }
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
    case 'fileChange': return [{ role: 'tool', name: 'file_change', text: (item.changes || []).map((c) => `${c.kind || 'modifica'} ${c.path || ''}`).join('\n') }];
    case 'mcpToolCall': return [{ role: 'tool', name: `${item.server || 'mcp'}.${item.tool || 'tool'}`, text: JSON.stringify(item.arguments ?? '') }];
    case 'webSearch': return [{ role: 'tool', name: 'web_search', text: item.query || '' }];
    case 'plan': return item.text ? [{ role: 'system', text: item.text }] : [];
    case 'error': return [{ role: 'error', text: item.message || 'Errore Codex' }];
    default: return [];
  }
}

export class CodexDaemonTurn extends EventEmitter {
  constructor({ command = 'codex', socketPath, threadId, prompt, cwd, model, effort, imagePaths = [] }) {
    super();
    if (!UUID.test(threadId || '')) throw new Error('Sessione Codex non valida');
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
        reject(new Error(`Codex non ha risposto a ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ method, id, params }));
    });
  }

  async start() {
    const socket = daemonSocket(this.command, this.socketPath);
    this.ws = new WebSocket('ws://localhost/', { createConnection: () => net.createConnection(socket) });
    this.ws.on('message', (raw) => this.onMessage(raw));
    this.ws.on('error', (error) => this.fail(error));
    this.ws.on('close', () => {
      if (!this.finished) this.fail(new Error('Connessione alla chat Codex interrotta'));
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
    else if (method === 'error') this.emit('messages', [{ role: 'error', text: params?.error?.message || params?.message || 'Errore Codex' }]);
    else if (method === 'turn/completed' && (!this.turnId || params?.turn?.id === this.turnId)) {
      const status = params?.turn?.status;
      if (status === 'completed') this.complete(0);
      else if (status === 'interrupted') this.complete(null, 'SIGTERM');
      else this.complete(1, null, params?.turn?.error?.message || 'Il turno Codex non è riuscito');
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
      reject(new Error('Connessione Codex chiusa'));
    }
    this.pending.clear();
    try { this.ws?.close(); } catch { /* closed */ }
  }
}

export const codexDaemonEnabled = (cfg) => cfg.codexSharedDaemon !== false && cfg.agents?.codex?.command === 'codex';
