// Reads Claude Code and Codex session transcripts (the same files the VS Code
// extensions write) and normalizes them into a common message format.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR
  ? path.join(process.env.CLAUDE_CONFIG_DIR, 'projects')
  : path.join(os.homedir(), '.claude', 'projects');
const CODEX_DIR = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 6000;
const MAX_MESSAGES = 400;
const HEAD_BYTES = 512 * 1024;

export const isSessionId = (id) => typeof id === 'string' && UUID_RE.test(id);

const clip = (s, n = MAX_TEXT) => {
  s = typeof s === 'string' ? s : s == null ? '' : JSON.stringify(s);
  return s.length > n ? `${s.slice(0, n)}\n… [${s.length - n} caratteri omessi]` : s;
};

const isMetaText = (t) => {
  const s = t.trim();
  return s.startsWith('<') || s.startsWith('# AGENTS.md') || s.startsWith('Caveat:');
};

function toolSummary(name, input) {
  if (!input || typeof input !== 'object') return clip(input, 1500);
  const pick = input.command ?? input.cmd ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.description;
  if (typeof pick === 'string') return clip(pick, 1500);
  return clip(JSON.stringify(input), 1500);
}

function flattenContent(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x?.text ?? (x?.type === 'image' ? '[immagine]' : ''))).join('\n');
  return c == null ? '' : JSON.stringify(c);
}

// ---------- line parsers ----------

export function parseClaudeLine(d) {
  const out = [];
  if (!d || d.isSidechain) return out;
  const ts = d.timestamp;
  const m = d.message;
  if (d.type === 'user' && m) {
    const content = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content || [];
    content.forEach((c, i) => {
      const id = `${d.uuid}:${i}`;
      if (c.type === 'text' && c.text) {
        out.push({ id, role: 'user', text: clip(c.text), ts, meta: !!d.isMeta || isMetaText(c.text) });
      } else if (c.type === 'tool_result') {
        out.push({ id, role: 'tool_result', text: clip(flattenContent(c.content), 3000), ts, error: !!c.is_error });
      } else if (c.type === 'image') {
        out.push({ id, role: 'user', text: '[immagine]', ts });
      }
    });
  } else if (d.type === 'assistant' && m) {
    (m.content || []).forEach((c, i) => {
      const id = `${d.uuid}:${i}`;
      if (c.type === 'text' && c.text) out.push({ id, role: 'assistant', text: clip(c.text), ts });
      else if (c.type === 'thinking' && c.thinking) out.push({ id, role: 'thinking', text: clip(c.thinking, 3000), ts });
      else if (c.type === 'tool_use') out.push({ id, role: 'tool', name: c.name, text: toolSummary(c.name, c.input), ts });
    });
  }
  return out;
}

export function parseCodexLine(d, lineNo) {
  const out = [];
  if (!d || d.type !== 'response_item') return out;
  const p = d.payload || {};
  const ts = d.timestamp;
  const id = p.id || `L${lineNo}`;
  switch (p.type) {
    case 'message': {
      if (p.role === 'developer' || p.role === 'system') break;
      (p.content || []).forEach((c, i) => {
        const text = c.text || '';
        if (!text) return;
        if (p.role === 'user') out.push({ id: `${id}:${i}`, role: 'user', text: clip(text), ts, meta: isMetaText(text) });
        else out.push({ id: `${id}:${i}`, role: 'assistant', text: clip(text), ts });
      });
      break;
    }
    case 'reasoning': {
      const text = (p.summary || []).map((s) => s.text).filter(Boolean).join('\n');
      if (text) out.push({ id, role: 'thinking', text: clip(text, 3000), ts });
      break;
    }
    case 'function_call': {
      let args = p.arguments;
      try { args = JSON.parse(args); } catch { /* keep string */ }
      out.push({ id, role: 'tool', name: p.name, text: toolSummary(p.name, args), ts });
      break;
    }
    case 'custom_tool_call':
      out.push({ id, role: 'tool', name: p.name, text: clip(p.input, 1500), ts });
      break;
    case 'local_shell_call':
      out.push({ id, role: 'tool', name: 'shell', text: clip((p.action?.command || []).join(' '), 1500), ts });
      break;
    case 'function_call_output':
    case 'custom_tool_call_output': {
      const o = p.output;
      const text = typeof o === 'string' ? o : o?.content ?? flattenContent(o);
      out.push({ id, role: 'tool_result', text: clip(text, 3000), ts });
      break;
    }
    default:
      break;
  }
  return out;
}

const PARSERS = { claude: parseClaudeLine, codex: parseCodexLine };

/** Parse complete JSONL lines from `buf`. Returns messages and bytes consumed. */
export function parseChunk(agent, buf, startLine = 0) {
  const parser = PARSERS[agent];
  const messages = [];
  let consumed = 0;
  let line = startLine;
  let pos = 0;
  while (true) {
    const nl = buf.indexOf(10, pos);
    if (nl < 0) break;
    const raw = buf.subarray(pos, nl).toString('utf8');
    pos = nl + 1;
    consumed = pos;
    line++;
    if (!raw.trim()) continue;
    let d;
    try { d = JSON.parse(raw); } catch { continue; }
    messages.push(...parser(d, line));
  }
  return { messages, consumed, lines: line };
}

// ---------- index ----------

const cache = new Map(); // file -> { mtimeMs, size, info }
let index = new Map(); // `${agent}:${id}` -> info

function readHead(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

function firstPrompt(messages) {
  const m = messages.find((x) => x.role === 'user' && !x.meta && x.text && x.text !== '[immagine]');
  return m ? m.text.replace(/\s+/g, ' ').trim().slice(0, 140) : '';
}

function summarizeClaude(file) {
  const id = path.basename(file, '.jsonl');
  if (!isSessionId(id)) return null;
  const head = readHead(file);
  let cwd = null, entrypoint = null, slug = null;
  const { messages } = parseChunk('claude', head);
  for (const raw of head.toString('utf8').split('\n', 200)) {
    try {
      const d = JSON.parse(raw);
      cwd ||= d.cwd;
      entrypoint ||= d.entrypoint;
      if (d.type === 'summary' && d.summary) slug ||= d.summary;
      if (cwd && entrypoint) break;
    } catch { /* partial line */ }
  }
  return { agent: 'claude', id, file, cwd, origin: entrypoint, title: slug || firstPrompt(messages) };
}

function summarizeCodex(file) {
  const head = readHead(file);
  const firstNl = head.indexOf(10);
  let meta;
  try { meta = JSON.parse(head.subarray(0, firstNl < 0 ? head.length : firstNl).toString('utf8')); } catch { return null; }
  if (meta?.type !== 'session_meta') return null;
  const id = meta.payload?.id || meta.payload?.session_id;
  if (!isSessionId(id)) return null;
  const { messages } = parseChunk('codex', head);
  return { agent: 'codex', id, file, cwd: meta.payload?.cwd, origin: meta.payload?.originator, title: firstPrompt(messages) };
}

function walk(dir, depth, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && !e.isSymbolicLink() && depth > 0) walk(p, depth - 1, acc);
    else if (e.isFile() && e.name.endsWith('.jsonl')) acc.push(p);
  }
  return acc;
}

export function listSessions({ limit = 150 } = {}) {
  const files = [
    ...walk(CLAUDE_DIR, 1, []).map((f) => ['claude', f]),
    ...walk(CODEX_DIR, 3, []).map((f) => ['codex', f]),
  ];
  const withStat = [];
  for (const [agent, file] of files) {
    try {
      const st = fs.statSync(file);
      if (st.size > 0) withStat.push({ agent, file, st });
    } catch { /* removed meanwhile */ }
  }
  withStat.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  const next = new Map();
  const result = [];
  for (const { agent, file, st } of withStat.slice(0, limit)) {
    let c = cache.get(file);
    if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
      let info = null;
      try { info = agent === 'claude' ? summarizeClaude(file) : summarizeCodex(file); } catch { /* unreadable */ }
      c = { mtimeMs: st.mtimeMs, size: st.size, info };
      cache.set(file, c);
    }
    if (!c.info) continue;
    const info = { ...c.info, updated: st.mtimeMs, size: st.size };
    next.set(`${info.agent}:${info.id}`, info);
    result.push(info);
  }
  index = next;
  return result;
}

/** Look up a session by agent + id. Paths never come from the client. */
export function findSession(agent, id) {
  if (!PARSERS[agent] || !isSessionId(id)) return null;
  let info = index.get(`${agent}:${id}`);
  if (!info) {
    listSessions({ limit: 1000 });
    info = index.get(`${agent}:${id}`);
  }
  return info || null;
}

export function readSession(info) {
  const buf = fs.readFileSync(info.file);
  const { messages, consumed, lines } = parseChunk(info.agent, buf);
  const truncated = messages.length > MAX_MESSAGES;
  return { messages: truncated ? messages.slice(-MAX_MESSAGES) : messages, truncated, offset: consumed, lines };
}

/** Tail a transcript: calls onMessages(newMessages) as the file grows. Returns a stop function. */
export function tailSession(info, offset, lines, onMessages) {
  let pos = offset;
  let lineNo = lines;
  let reading = false;
  const tick = () => {
    if (reading) return;
    reading = true;
    try {
      const st = fs.statSync(info.file);
      if (st.size < pos) { pos = 0; lineNo = 0; }
      if (st.size > pos) {
        const fd = fs.openSync(info.file, 'r');
        try {
          const len = Math.min(st.size - pos, 8 * 1024 * 1024);
          const buf = Buffer.alloc(len);
          fs.readSync(fd, buf, 0, len, pos);
          const r = parseChunk(info.agent, buf, lineNo);
          pos += r.consumed;
          lineNo = r.lines;
          if (r.messages.length) onMessages(r.messages);
        } finally {
          fs.closeSync(fd);
        }
      }
    } catch { /* file rotated/removed */ }
    reading = false;
  };
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}
