// Sends a turn to the shared Codex app-server daemon. VS Code and Agent Bridge
// connect to the same daemon, so there is one thread writer and one conversation.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import WebSocket from 'ws';
import { defaultCodexSocket, isNamedPipe, spawnCommand } from './platform.js';

const DEFAULT_SOCKET = defaultCodexSocket();
const UUID = /^[0-9a-f-]{36}$/i;

// The daemon endpoint can be a Unix socket path (Linux/macOS), a Windows named
// pipe (\\.\pipe\name) or a ws:// URL (e.g. ws://127.0.0.1:PORT/).
const isUrl = (s) => /^wss?:\/\//i.test(s);

// The permission mode picked in the app, as the app-server's sandbox policy.
export const SANDBOX_POLICY = {
  'read-only': { type: 'readOnly' },
  'workspace-write': { type: 'workspaceWrite' },
  'danger-full-access': { type: 'dangerFullAccess' },
};

// Nobody can approve a command from the phone mid-turn: questions are declined and
// the agent continues within its sandbox (the same as `codex exec`).
export const DECLINE = {
  'item/commandExecution/requestApproval': { decision: 'decline' },
  'item/fileChange/requestApproval': { decision: 'decline' },
  'item/permissions/requestApproval': { permissions: {}, scope: 'turn' },
  'item/tool/requestUserInput': { answers: {} },
  'mcpServer/elicitation/request': { action: 'decline' },
};

function reachable(endpoint) {
  // URLs and named pipes are not files: probing a pipe would use up a connection,
  // so they are tried as-is and a connection error explains what is wrong.
  if (isUrl(endpoint) || isNamedPipe(endpoint)) return endpoint;
  try { return fs.realpathSync(endpoint); } catch { return null; }
}

/** `codex app-server daemon start`, without blocking the server's event loop. */
function startDaemon(command) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnCommand(command || 'codex', ['app-server', 'daemon', 'start'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    } catch (e) { return reject(new Error(`Codex daemon not available: ${e.message}`)); }
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Codex daemon did not start within 30 seconds')); }, 30_000);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => { err = (err + c).slice(-4000); });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Codex daemon not available: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(); else reject(new Error(`Codex daemon not available: ${err.trim() || `exit ${code}`}`));
    });
  });
}

async function daemonSocket(command, requested, { restart = false } = {}) {
  const file = requested || process.env.CODEX_APP_SERVER_SOCKET || DEFAULT_SOCKET;
  const found = !restart && reachable(file);
  if (found) return found;
  await startDaemon(command);
  const ready = reachable(file);
  if (!ready) throw new Error('Codex daemon started, but the shared socket is not available');
  return ready;
}

function connect(socket) {
  const ws = isUrl(socket)
    ? new WebSocket(socket)
    : new WebSocket('ws://localhost/', { createConnection: () => net.createConnection(socket) });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

const sameSandbox = (a, b) => !!a && !!b && a.type === b.type;

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
  constructor({ command = 'codex', socketPath, threadId, prompt, cwd, model, effort, mode, imagePaths = [] }) {
    super();
    if (!UUID.test(threadId || '')) throw new Error('Invalid Codex session');
    Object.assign(this, { command, socketPath, threadId, prompt, cwd, model, effort, mode, imagePaths });
    this.cancelRequested = false;
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
    let socket = await daemonSocket(this.command, this.socketPath);
    try {
      this.ws = await connect(socket);
    } catch (e) {
      // A socket file left behind by a crashed daemon or a reboot: start a new one once.
      if (!['ECONNREFUSED', 'ENOENT'].includes(e.code) || isUrl(socket)) throw e;
      socket = await daemonSocket(this.command, this.socketPath, { restart: true });
      this.ws = await connect(socket);
    }
    if (this.finished) { this.close(); return this; }
    this.ws.on('message', (raw) => this.onMessage(raw));
    this.ws.on('error', (error) => this.fail(error));
    this.ws.on('close', () => {
      if (!this.finished) this.fail(new Error('Connection to the Codex chat was lost'));
    });
    await this.request('initialize', {
      clientInfo: { name: 'agent-bridge', title: 'Agent Bridge', version: '1.5.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    const resumed = await this.request('thread/resume', { threadId: this.threadId, excludeTurns: true });
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
    // Enforce the permission mode picked in the app. The override also applies to
    // later turns of this chat (in VS Code too), so send it only when it changes.
    const wanted = SANDBOX_POLICY[this.mode];
    if (wanted && !sameSandbox(resumed?.sandbox, wanted)) {
      params.sandboxPolicy = wanted;
      this.emit('messages', [{ role: 'system', text: `Codex permissions for this chat set to ${this.mode} (also for the next turns in VS Code).` }]);
    }
    const response = await this.request('turn/start', params, 30_000);
    this.turnId = response?.turn?.id || this.turnId;
    this.emit('started', this.turnId);
    // Stop was pressed while the turn was being created.
    if (this.cancelRequested) this.cancel();
    return this;
  }

  /** Requests from the daemon (approvals, questions) must always get an answer. */
  answer(message) {
    const { id, method, params } = message;
    if (params?.threadId && params.threadId !== this.threadId) return;
    const result = DECLINE[method];
    if (result) {
      const what = params?.command ? `run \`${Array.isArray(params.command) ? params.command.join(' ') : params.command}\`` : method.includes('fileChange') ? 'change files' : 'continue';
      this.emit('messages', [{ role: 'system', text: `Codex asked for permission to ${what}: declined from the phone. Approve it on the PC, or pick a wider permission mode.` }]);
      this.ws.send(JSON.stringify({ id, result }));
    } else {
      this.ws.send(JSON.stringify({ id, error: { code: -32601, message: `${method} is not supported by Agent Bridge` } }));
    }
  }

  onMessage(raw) {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (message.id != null && message.method) return this.answer(message);
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
    if (!this.turnId && this.ws && !this.cancelRequested) {
      // turn/start is still in flight: interrupt as soon as its id arrives.
      this.cancelRequested = true;
      return;
    }
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
