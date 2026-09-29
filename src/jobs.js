// Runs agent CLIs headlessly. Commands are spawned directly (never through a
// shell) and the prompt is passed on stdin, so prompt text can never become shell syntax.
// On Windows, npm .cmd shims are unwrapped to `node script.js` (see platform.js).
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { audit } from './auth.js';
import { CodexDaemonTurn, codexDaemonEnabled } from './codex-daemon.js';
import { DATA_DIR } from './config.js';
import { killTree, spawnCommand, treeSpawnOptions } from './platform.js';
import { parseClaudeLine } from './transcripts.js';

export const MODES = {
  claude: { safe: ['plan', 'manual', 'acceptEdits', 'auto'], dangerous: ['bypassPermissions'], default: 'acceptEdits' },
  codex: { safe: ['read-only', 'workspace-write'], dangerous: ['danger-full-access'], default: 'workspace-write' },
};

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const CLAUDE_MODELS = [
  { id: '', label: 'Default', efforts: CLAUDE_EFFORTS },
  { id: 'fable', label: 'Fable — most capable', efforts: CLAUDE_EFFORTS },
  { id: 'opus', label: 'Opus', efforts: CLAUDE_EFFORTS },
  { id: 'sonnet', label: 'Sonnet — balanced', efforts: CLAUDE_EFFORTS },
  { id: 'haiku', label: 'Haiku — fast and cheap', efforts: CLAUDE_EFFORTS },
];

// Model names and effort levels end up as CLI arguments: only plain tokens are allowed,
// so a value can never be parsed as an extra flag.
const SAFE_TOKEN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

// Codex refuses to resume a thread another process already holds open (typically
// the Codex panel in VS Code). Retry that same thread: silently forking here would
// split the conversation the user expects to find later on the desktop.
const CODEX_LOCKED = /already has an active writer|thread[- ]store conflict|session (?:is )?locked by another|already being used by another codex/i;

const MAX_EVENTS = 3000;
const clip = (s, n = 3000) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n)}…` : s ?? '');

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
let codexCache = { mtime: 0, models: null };

function codexModels() {
  let defaultModel = '';
  let defaultEffort = '';
  try {
    const toml = fs.readFileSync(path.join(CODEX_HOME, 'config.toml'), 'utf8');
    defaultModel = toml.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] || '';
    defaultEffort = toml.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m)?.[1] || '';
  } catch { /* no config */ }
  let list = [];
  try {
    const file = path.join(CODEX_HOME, 'models_cache.json');
    const mtime = fs.statSync(file).mtimeMs;
    if (codexCache.mtime !== mtime) {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      const models = Array.isArray(d) ? d : d.models || [];
      codexCache = {
        mtime,
        models: models
          .filter((m) => m.visibility === 'list' && SAFE_TOKEN.test(m.slug || ''))
          .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
          .map((m) => ({
            id: m.slug,
            label: m.display_name || m.slug,
            description: m.description || '',
            efforts: (m.supported_reasoning_levels || []).map((r) => r.effort).filter((e) => SAFE_TOKEN.test(e || '')),
          })),
      };
    }
    list = codexCache.models;
  } catch { /* no cache */ }
  const def = list.find((m) => m.id === defaultModel);
  const fallbackEfforts = ['low', 'medium', 'high', 'xhigh'];
  return [
    { id: '', label: `Default${defaultModel ? ` (${defaultModel}${defaultEffort ? `, ${defaultEffort}` : ''})` : ''}`, efforts: def?.efforts || fallbackEfforts },
    ...list,
  ];
}

export function agentList(cfg) {
  const list = [];
  if (cfg.agents.claude?.enabled) {
    list.push({ id: 'claude', name: 'Claude Code', resumable: true, fork: true, images: true, modes: allowedModes(cfg, 'claude'), defaultMode: cfg.agents.claude.defaultMode || MODES.claude.default, models: CLAUDE_MODELS });
  }
  if (cfg.agents.codex?.enabled) {
    list.push({ id: 'codex', name: 'Codex', resumable: true, fork: true, images: true, modes: allowedModes(cfg, 'codex'), defaultMode: cfg.agents.codex.defaultMode || MODES.codex.default, models: codexModels() });
  }
  for (const c of cfg.agents.custom || []) {
    list.push({ id: c.id, name: c.name || c.id, resumable: false, fork: false, images: false, modes: [], defaultMode: null, models: [] });
  }
  return list;
}

function allowedModes(cfg, agent) {
  const m = MODES[agent];
  return cfg.allowDangerousModes ? [...m.safe, ...m.dangerous] : [...m.safe];
}

/** Validate base64 images from the client. Returns [{ mediaType, data, bytes }]. */
export function validateImages(images) {
  if (images == null) return [];
  if (!Array.isArray(images) || images.length > MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} images`);
  return images.map((img) => {
    const mediaType = img?.mediaType;
    if (!IMAGE_TYPES[mediaType] || typeof img.data !== 'string') throw new Error('Unsupported image format');
    const bytes = Buffer.from(img.data, 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Image too large');
    const magic = {
      'image/png': bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      'image/jpeg': bytes[0] === 0xff && bytes[1] === 0xd8,
      'image/gif': bytes.subarray(0, 3).toString('latin1') === 'GIF',
      'image/webp': bytes.subarray(8, 12).toString('latin1') === 'WEBP',
    }[mediaType];
    if (!magic) throw new Error('Content does not match the image type');
    return { mediaType, data: bytes.toString('base64'), bytes };
  });
}

function buildCommand(cfg, { agent, sessionId, fork, mode, model, effort, prompt, images, imageDir }) {
  if (agent === 'claude') {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', mode];
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (sessionId) args.push('--resume', sessionId);
    if (sessionId && fork) args.push('--fork-session');
    if (!images.length) return { command: cfg.agents.claude.command, args, stdin: prompt };
    args.push('--input-format', 'stream-json');
    const content = [{ type: 'text', text: prompt }, ...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } }))];
    return { command: cfg.agents.claude.command, args, stdin: `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n` };
  }
  if (agent === 'codex') {
    // Codex reads images from files. -i must come first: in `exec` it is greedy.
    const imgArgs = [];
    images.forEach((img, n) => {
      const file = path.join(imageDir, `image-${n + 1}.${IMAGE_TYPES[img.mediaType]}`);
      fs.writeFileSync(file, img.bytes, { mode: 0o600 });
      imgArgs.push('-i', file);
    });
    const opts = ['--json', '--skip-git-repo-check', '-c', `sandbox_mode="${mode}"`];
    if (model) opts.push('-m', model);
    if (effort) opts.push('-c', `model_reasoning_effort="${effort}"`);
    let args;
    if (!sessionId) args = ['exec', ...imgArgs, ...opts, '-'];
    else if (fork) args = ['exec', 'fork', ...imgArgs, ...opts, sessionId, '-'];
    else args = ['exec', 'resume', ...imgArgs, ...opts, sessionId, '-'];
    return { command: cfg.agents.codex.command, args, stdin: prompt };
  }
  const c = (cfg.agents.custom || []).find((x) => x.id === agent);
  if (!c) return null;
  const args = c.args || [];
  const inline = args.some((a) => a.includes('{prompt}'));
  return {
    command: c.command,
    args: args.map((a) => a.replaceAll('{prompt}', prompt)),
    stdin: inline ? null : prompt,
  };
}

// ---------- stdout normalizers ----------

function normalizeClaude(job, d) {
  if (d.type === 'system' && d.subtype === 'init') {
    if (d.session_id) job.setSession(d.session_id);
    return [{ role: 'system', text: `Session ${d.session_id} · model ${d.model || '?'} · permissions ${d.permissionMode || job.mode}` }];
  }
  if (d.type === 'assistant' || d.type === 'user') {
    return parseClaudeLine({ ...d, uuid: d.uuid || crypto.randomUUID(), timestamp: new Date().toISOString() });
  }
  if (d.type === 'result') {
    const cost = typeof d.total_cost_usd === 'number' ? ` · $${d.total_cost_usd.toFixed(4)}` : '';
    return [{ role: d.is_error ? 'error' : 'system', text: `Done (${d.subtype || 'ok'})${cost}${d.is_error && d.result ? `: ${clip(d.result)}` : ''}` }];
  }
  return [];
}

function normalizeCodex(job, d) {
  if (d.type === 'thread.started') {
    if (d.thread_id) job.setSession(d.thread_id);
    return [{ role: 'system', text: `Session ${d.thread_id}` }];
  }
  if (d.type === 'turn.failed' || d.type === 'error') return [{ role: 'error', text: clip(d.error?.message || d.message || JSON.stringify(d)) }];
  if (d.type === 'turn.completed') {
    const u = d.usage;
    return [{ role: 'system', text: `Turn finished${u ? ` · token in ${u.input_tokens ?? '?'} / out ${u.output_tokens ?? '?'}` : ''}` }];
  }
  if (d.type !== 'item.completed' || !d.item) return [];
  const it = d.item;
  switch (it.type) {
    case 'agent_message': return [{ role: 'assistant', text: clip(it.text, 20000) }];
    case 'reasoning': return it.text ? [{ role: 'thinking', text: clip(it.text) }] : [];
    case 'command_execution': return [
      { role: 'tool', name: 'shell', text: clip(it.command, 1500) },
      { role: 'tool_result', text: `${clip(it.aggregated_output)}${it.exit_code != null ? `\n[exit ${it.exit_code}]` : ''}`, error: it.exit_code ? true : false },
    ];
    case 'file_change': return [{ role: 'tool', name: 'file_change', text: (it.changes || []).map((c) => `${c.kind} ${c.path}`).join('\n') }];
    case 'mcp_tool_call': return [{ role: 'tool', name: `${it.server}.${it.tool}`, text: clip(JSON.stringify(it.arguments ?? ''), 1500) }];
    case 'web_search': return [{ role: 'tool', name: 'web_search', text: clip(it.query) }];
    case 'todo_list': return [{ role: 'system', text: (it.items || []).map((t) => `${t.completed ? '☑' : '☐'} ${t.text}`).join('\n') }];
    case 'error': return [{ role: 'error', text: clip(it.message) }];
    default: return [];
  }
}

// ---------- jobs ----------

class Job extends EventEmitter {
  constructor(spec) {
    super();
    Object.assign(this, spec);
    this.id = crypto.randomUUID();
    this.status = 'running';
    this.started = Date.now();
    this.ended = null;
    this.exitCode = null;
    this.events = [];
    this.seq = 0;
  }

  push(msgs) {
    for (const m of msgs) {
      const ev = { seq: ++this.seq, ts: new Date().toISOString(), ...m };
      this.events.push(ev);
      if (this.events.length > MAX_EVENTS) this.events.shift();
      this.emit('event', ev);
    }
  }

  setSession(id) {
    if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) && this.sessionId !== id) {
      this.sessionId = id;
      this.emit('update', this.summary());
    }
  }

  summary() {
    const { id, agent, sessionId, resumeOf, fork, cwd, mode, model, effort, status, started, ended, exitCode, transport } = this;
    return { id, agent, sessionId: sessionId || null, resumeOf, fork: !!fork, model: model || null, effort: effort || null, images: this.imageCount || 0, cwd, mode, transport: transport || 'cli', status, started, ended, exitCode, promptPreview: this.prompt.slice(0, 120) };
  }
}

export class JobManager extends EventEmitter {
  constructor(cfg) {
    super();
    this.cfg = cfg;
    this.jobs = new Map();
  }

  running() {
    return [...this.jobs.values()].filter((j) => j.status === 'running');
  }

  list() {
    return [...this.jobs.values()].sort((a, b) => b.started - a.started).slice(0, 50).map((j) => j.summary());
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  start({ agent, sessionId, fork, cwd, mode, model, effort, prompt, images }, who) {
    const cfg = this.cfg;
    const known = agentList(cfg).find((a) => a.id === agent);
    if (!known) throw new Error('Agent not available');
    if (sessionId && !known.resumable) throw new Error('This agent cannot resume sessions');
    fork = !!(fork && sessionId);
    if (fork && !known.fork) throw new Error('This agent cannot fork sessions');
    if (known.modes.length) {
      mode ||= known.defaultMode;
      if (!known.modes.includes(mode)) throw new Error('Permission mode not allowed');
    } else {
      mode = null;
    }
    model = model || '';
    effort = effort || '';
    const m = known.models.find((x) => x.id === model);
    if (known.models.length ? !m : model) throw new Error('Model not available');
    if (effort && (!m || !m.efforts.includes(effort))) throw new Error('Reasoning effort not available for this model');
    if ((model && !SAFE_TOKEN.test(model)) || (effort && !SAFE_TOKEN.test(effort))) throw new Error('Invalid value');
    images = validateImages(images);
    if (images.length && !known.images) throw new Error('This agent does not accept images');
    if (this.running().length >= cfg.maxConcurrentJobs) throw new Error('Too many jobs running');
    if (sessionId && !fork && this.running().some((j) => j.sessionId === sessionId && !j.fork)) throw new Error('This session already has a prompt running');

    const job = new Job({ agent, sessionId: fork ? null : sessionId, resumeOf: sessionId || null, fork, cwd, mode, model, effort, prompt });
    job.imageCount = images.length;
    let imageDir = null;
    if (images.length && agent === 'codex') {
      imageDir = path.join(DATA_DIR, 'uploads', job.id);
      fs.mkdirSync(imageDir, { recursive: true, mode: 0o700 });
    }
    job.device = String(who?.ua || '');
    job.transport = agent === 'codex' && sessionId && !fork && codexDaemonEnabled(cfg) ? 'shared-chat' : 'cli';
    this.jobs.set(job.id, job);
    this.prune();
    this.emit('job', job);

    audit('job_start', { job: job.id, agent, sessionId, fork, cwd, mode, model, effort, images: images.length, promptChars: prompt.length, promptSha256: crypto.createHash('sha256').update(prompt).digest('hex'), ...who });

    if (job.transport === 'shared-chat') {
      this.startCodexShared(job, { images, imageDir });
      return job;
    }

    const spec = buildCommand(cfg, { agent, sessionId, fork, mode, model, effort, prompt, images, imageDir });

    const env = { ...process.env };
    // Don't leak our own settings, and don't let agents think they run nested inside
    // the Claude Code / VS Code session that may have started this server.
    for (const k of Object.keys(env)) {
      if (k.startsWith('AGENT_BRIDGE') || k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k];
    }
    // Marks the agent as "started by Agent Bridge": the Stop hook must never park
    // one of these, or a prompt from the app would wait for a prompt from the app.
    env.AGENT_BRIDGE_JOB = '1';
    const normalize = agent === 'claude' ? normalizeClaude : agent === 'codex' ? normalizeCodex : null;
    // Plain-text agents: group output lines into one message per burst, so markdown
    // blocks (lists, code fences) stay together.
    const plain = [];
    let plainTimer = null;
    const flushPlain = () => {
      clearTimeout(plainTimer);
      plainTimer = null;
      if (plain.length) job.push([{ role: 'assistant', text: clip(plain.splice(0).join('\n'), 20000) }]);
    };
    const schedulePlain = () => { if (!plainTimer) plainTimer = setTimeout(flushPlain, 700); };
    let buf = '';
    const onStdout = (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, ''); // CRLF on Windows
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        if (!normalize) { plain.push(line); schedulePlain(); continue; }
        let d;
        try { d = JSON.parse(line); } catch { job.push([{ role: 'system', text: clip(line) }]); continue; }
        if (agent === 'codex') {
          const diagnostic = clip(JSON.stringify(d), 4000);
          if (CODEX_LOCKED.test(diagnostic)) {
            codexLock = diagnostic;
            continue;
          }
        }
        try { job.push(normalize(job, d)); } catch { /* ignore malformed event */ }
      }
      if (buf.length > 4 * 1024 * 1024) buf = '';
    };
    let errBuf = '';
    // Newer Codex versions can report a resume lock either on stderr or as a
    // structured JSON error on stdout. Keep the latter out of the visible feed
    // until the process exits so we can transparently continue on a fork.
    let codexLock = '';
    let codexLockRetries = 0;
    const maxCodexLockRetries = Number.isInteger(cfg.codexLockRetries) ? cfg.codexLockRetries : 12;
    const codexLockRetryMs = Number.isInteger(cfg.codexLockRetryMs) ? cfg.codexLockRetryMs : 2500;

    const timeout = setTimeout(() => {
      job.push([{ role: 'error', text: 'Timeout: job stopped.' }]);
      this.kill(job, 'timeout');
    }, cfg.jobTimeoutMinutes * 60 * 1000);

    let child;
    const launch = () => {
      try {
        // Own process group on POSIX, so cancel reaches everything the agent started.
        // Inline {prompt} arguments must never go through a Windows batch file.
        child = spawnCommand(spec.command, spec.args, { cwd, env, shell: false, ...treeSpawnOptions(), stdio: ['pipe', 'pipe', 'pipe'] }, { allowBatch: spec.stdin != null });
      } catch (e) {
        clearTimeout(timeout);
        job.status = 'failed';
        job.ended = Date.now();
        job.push([{ role: 'error', text: `Failed to start: ${e.message}` }]);
        job.emit('update', job.summary());
        job.emit('end');
        return false;
      }
      job.child = child;
      child.stdin.on('error', () => {});
      child.stdin.end(spec.stdin ?? '');
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', onStdout);
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { errBuf = (errBuf + chunk).slice(-8000); });
      child.on('error', (e) => job.push([{ role: 'error', text: `Process error: ${e.message}` }]));
      child.on('close', onClose);
      return true;
    };

    const onClose = (code, signal) => {
      // A transient writer conflict must not create another chat. Retry the exact
      // same thread for up to ~30 seconds, then fail with an actionable message.
      const codexDiagnostic = `${errBuf}\n${codexLock}`;
      if (code !== 0 && agent === 'codex' && sessionId && !job.fork && job.status === 'running' && CODEX_LOCKED.test(codexDiagnostic) && codexLockRetries < maxCodexLockRetries) {
        codexLockRetries += 1;
        errBuf = '';
        codexLock = '';
        buf = '';
        if (codexLockRetries === 1) job.push([{ role: 'system', text: 'The same chat is busy on the PC right now. Waiting and retrying without creating a copy.' }]);
        audit('codex_locked_retry', { job: job.id, sessionId, attempt: codexLockRetries });
        job.emit('update', job.summary());
        setTimeout(() => {
          if (job.status === 'running') launch();
        }, codexLockRetryMs).unref();
        return;
      }
      if (code !== 0 && agent === 'codex' && sessionId && !job.fork && CODEX_LOCKED.test(codexDiagnostic)) {
        codexLock = '';
        job.push([{ role: 'error', text: 'The Codex chat is still open on the PC. Close it and send the prompt again: no duplicate conversation was created.' }]);
      }
      clearTimeout(timeout);
      if (imageDir) fs.rmSync(imageDir, { recursive: true, force: true });
      if (buf.trim() && !normalize) plain.push(buf);
      if (!normalize) flushPlain();
      if (code !== 0 && errBuf.trim()) job.push([{ role: 'error', text: clip(errBuf.trim(), 4000) }]);
      job.exitCode = code;
      job.ended = Date.now();
      if (job.status === 'running') job.status = code === 0 ? 'done' : signal ? 'cancelled' : 'failed';
      audit('job_end', { job: job.id, status: job.status, exitCode: code, signal });
      job.emit('update', job.summary());
      job.emit('end');
    };

    launch();
    return job;
  }

  startCodexShared(job, { images, imageDir }) {
    const finish = (code, signal = null) => {
      clearTimeout(timeout);
      if (imageDir) fs.rmSync(imageDir, { recursive: true, force: true });
      job.exitCode = code;
      job.ended = Date.now();
      if (job.status === 'running') job.status = code === 0 ? 'done' : signal ? 'cancelled' : 'failed';
      audit('job_end', { job: job.id, status: job.status, exitCode: code, signal, transport: 'shared-chat' });
      job.emit('update', job.summary());
      job.emit('end');
    };
    const imagePaths = images.map((image, index) => {
      const file = path.join(imageDir, `image-${index + 1}.${IMAGE_TYPES[image.mediaType]}`);
      fs.writeFileSync(file, image.bytes, { mode: 0o600 });
      return file;
    });
    const turn = new CodexDaemonTurn({
      command: this.cfg.agents.codex.command,
      socketPath: this.cfg.codexDaemonSocket,
      threadId: job.sessionId,
      prompt: job.prompt,
      cwd: job.cwd,
      model: job.model,
      effort: job.effort,
      imagePaths,
    });
    job.controller = turn;
    turn.on('messages', (messages) => job.push(messages));
    turn.on('started', () => {
      job.push([{ role: 'system', text: 'Connected to the same Codex chat that is open in Visual Studio Code.' }]);
      job.emit('update', job.summary());
    });
    turn.once('complete', ({ code, signal }) => finish(code, signal));
    const timeout = setTimeout(() => {
      job.push([{ role: 'error', text: 'Timeout: task stopped.' }]);
      this.kill(job, 'timeout');
    }, this.cfg.jobTimeoutMinutes * 60 * 1000);
    turn.start().catch((error) => {
      let message = error?.message || String(error);
      if (CODEX_LOCKED.test(message)) {
        message = 'Visual Studio Code is still using the old connection. Reload the VS Code window once: then phone and PC will share the same chat.';
      }
      job.push([{ role: 'error', text: message }]);
      turn.complete(1);
    });
  }

  kill(job, reason = 'cancel') {
    if (job.status !== 'running') return;
    job.status = reason === 'timeout' ? 'failed' : 'cancelled';
    if (job.controller) {
      job.controller.cancel();
      return;
    }
    if (!job.child) return;
    killTree(job.child, 'SIGTERM');
    setTimeout(() => killTree(job.child, 'SIGKILL'), 5000).unref();
  }

  killAll() {
    for (const j of this.running()) this.kill(j);
  }

  prune() {
    const done = [...this.jobs.values()].filter((j) => j.status !== 'running').sort((a, b) => a.started - b.started);
    while (this.jobs.size > 50 && done.length) this.jobs.delete(done.shift().id);
  }
}
