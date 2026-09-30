'use strict';
// Agent Bridge client. All untrusted text is rendered with textContent / DOM nodes — never innerHTML.

const state = {
  csrf: null,
  me: null,
  ws: null,
  wsRetry: 0,
  jobs: [],
  jobStatus: new Map(),
  onWs: null,
  cleanup: null,
  resubscribe: null,
  sessionsCache: null,
  filter: 'all',
  search: '',
  route: '',
  installPrompt: null,
  duos: [],
};

const MODE_LABELS = {
  plan: 'Plan — read-only, proposes a plan',
  manual: 'Manual — denies actions that need permission',
  acceptEdits: 'Edit files',
  auto: 'Auto — runs safe commands',
  bypassPermissions: '⚠ Bypass all permissions',
  'read-only': 'Read-only',
  'workspace-write': 'Write to workspace',
  'danger-full-access': '⚠ Full system access',
};
const EFFORT_LABELS = { '': 'Default', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Very high', max: 'Max', ultra: 'Ultra' };
const AGENT_LETTER = { claude: 'C', codex: 'X' };
const SHORT_NAME = { claude: 'Claude', codex: 'Codex' };
const otherAgent = (id) => (id === 'claude' ? 'codex' : 'claude');

// ---------- settings (kept on the PC and shared by every device) ----------

const DEFAULT_QUICK_PROMPTS = ['Continue', 'Run the tests and fix what fails', 'Explain what you changed', 'Commit with a clear message'];
const HANDOFF_PRESETS = [
  ['Review this and tell me what you would change.', 'Review it'],
  ['Continue from here and finish the task.', 'Continue the work'],
  ['Write tests for this.', 'Write tests'],
  ['Explain this simply, in a few lines.', 'Explain it'],
];
// Per-device only: whether to sync at all.
const LOCAL_PREFS = new Set(['sync']);

const prefs = {
  cache: {},
  timer: null,
  load() {
    try { this.cache = JSON.parse(localStorage.getItem('ab.prefs') || 'null') || null; } catch { this.cache = null; }
    if (!this.cache) {
      // Older versions stored one localStorage key per setting.
      this.cache = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k.startsWith('ab.') && k !== 'ab.prefs') { try { this.cache[k.slice(3)] = JSON.parse(localStorage.getItem(k)); } catch { /* skip */ } }
        }
      } catch { /* storage blocked */ }
    }
  },
  get(k, d) { return Object.hasOwn(this.cache, k) ? this.cache[k] : d; },
  set(k, v) {
    if (v === undefined) delete this.cache[k]; else this.cache[k] = v;
    this.saveLocal();
    if (!LOCAL_PREFS.has(k)) this.schedulePush();
  },
  saveLocal() { try { localStorage.setItem('ab.prefs', JSON.stringify(this.cache)); } catch { /* ignore */ } },
  shared() { return Object.fromEntries(Object.entries(this.cache).filter(([k]) => !LOCAL_PREFS.has(k))); },
  schedulePush() {
    if (!this.get('sync', true) || !state.csrf) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => api('PUT', '/api/prefs', { prefs: this.shared() }).catch(() => {}), 500);
  },
  /** Settings changed on another device (or first load): the PC copy wins. */
  adopt(remote) {
    if (!this.get('sync', true) || !remote || typeof remote !== 'object') return false;
    if (JSON.stringify(remote) === JSON.stringify(this.shared())) return false;
    const local = Object.fromEntries(Object.entries(this.cache).filter(([k]) => LOCAL_PREFS.has(k)));
    this.cache = { ...remote, ...local };
    this.saveLocal();
    return true;
  },
};
prefs.load();

async function syncPrefs() {
  if (!prefs.get('sync', true)) return;
  try {
    const { prefs: remote } = await api('GET', '/api/prefs');
    if (remote && Object.keys(remote).length) { if (prefs.adopt(remote)) applyAppearance(); } else if (Object.keys(prefs.shared()).length) prefs.schedulePush();
  } catch { /* offline: keep the local copy */ }
}

// ---------- DOM helpers ----------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function fill(el, ...kids) {
  el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
}

const ICONS = {
  chats: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  plus: 'M12 5v14M5 12h14',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  back: 'M15 18l-6-6 6-6',
  send: 'M12 19V5M5 12l7-7 7 7',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  clip: 'M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5',
  stop: 'M6 6h12v12H6z',
  down: 'M12 5v14M19 12l-7 7-7-7',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  link: 'M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  screen: 'M3 4h18v12H3zM8 20h8M12 16v4',
  duo: 'M8 7a4 4 0 1 0 0 8M16 7a4 4 0 1 1 0 8M8 11h8',
  swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  pin: 'M12 17v5M9 3h6l-1 6 4 4H6l4-4z',
  edit: 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6 6 18',
};

function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `ic ${cls}`);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name]);
  svg.append(p);
  return svg;
}

// Each navigation gets a number: a view that finishes loading after the user has
// moved on must not replace the new page or take over its live updates.
let viewSeq = 0;
const viewGuard = () => { const mine = viewSeq; return () => mine !== viewSeq; };

function mount(...nodes) {
  if (state.cleanup) { state.cleanup(); state.cleanup = null; }
  state.onWs = null;
  state.resubscribe = null;
  document.getElementById('app').replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function relTime(ms) {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return 'now';
  if (d < 3600) return `${Math.floor(d / 60)} min`;
  if (d < 86400) return `${Math.floor(d / 3600)} h`;
  if (d < 7 * 86400) return `${Math.floor(d / 86400)} d`;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const ago = (ms) => { const r = relTime(ms); return r === 'now' ? 'just now' : /^\d+ (min|h|d)$/.test(r) ? `${r} ago` : r; };

function dayBucket(ms) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const t = start.getTime();
  if (ms >= t) return 'Today';
  if (ms >= t - 86400000) return 'Yesterday';
  if (ms >= t - 6 * 86400000) return 'Previous 7 days';
  if (ms >= t - 30 * 86400000) return 'Previous 30 days';
  return 'Older';
}

// Home folders on Linux (/home/x), macOS (/Users/x) and Windows (C:\\Users\\x).
const shortPath = (p) => (p || '').replace(/^(\/home\/[^/]+|\/Users\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=$|[\\/])/, '~');
const baseName = (p) => (p || '').split(/[\\/]/).filter(Boolean).pop() || p || '';
const joinPath = (dir, name) => `${dir}${/[\\/]$/.test(dir) ? '' : dir.includes('\\') && !dir.includes('/') ? '\\' : '/'}${name}`;
const agentById = (id) => state.me?.agents.find((a) => a.id === id);
const agentName = (id) => agentById(id)?.name || id;
const agentClass = (id) => (id === 'claude' || id === 'codex' ? id : 'custom');
const avatar = (agent) => h('span', { class: `avatar ${agentClass(agent)}`, 'aria-hidden': 'true' }, AGENT_LETTER[agent] || (agent || '?')[0].toUpperCase());
const runningFor = (sessionId) => state.jobs.filter((j) => j.status === 'running' && (j.sessionId === sessionId || (j.resumeOf === sessionId && !j.fork)));
const STATUS_LABELS = { running: 'running', done: 'done', failed: 'failed', cancelled: 'stopped', waiting: 'waiting', skipped: 'skipped' };
const ROLE_LABELS = { work: 'does the task', review: 'reviews', apply: 'applies the fixes', answer: 'answers' };

// ---------- toasts ----------

function toast(message, { kind = 'info', action, onAction, timeout = 5000 } = {}) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'grow' }, message),
    action ? h('button', { class: 'toast-action', onclick: () => { t.remove(); onAction?.(); } }, action) : null,
    h('button', { class: 'toast-close', 'aria-label': 'Close', onclick: () => t.remove() }, '×'));
  box.append(t);
  if (timeout) setTimeout(() => t.remove(), timeout);
}

// ---------- waiting activity ----------

function showWaitingRoom(initialJob) {
  if (prefs.get('waitingActivity', 'happydev') === 'none') return;
  const previous = document.querySelector('.waiting-dialog');
  if (previous) previous.close?.();
  let job = initialJob;
  let mode = prefs.get('waitingActivity', 'happydev');
  let renderedMode = null;
  let reelsWindow = null;
  let closeTimer = null;
  if (!['reels', 'happydev'].includes(mode)) mode = 'happydev';
  const stage = h('div', { class: 'waiting-stage' });
  const status = h('div', { class: 'waiting-status' });
  const reels = h('button', { type: 'button', class: 'waiting-tab', role: 'tab' }, '▶ Reels');
  const games = h('button', { type: 'button', class: 'waiting-tab', role: 'tab' }, '🎮 HappyDEV');
  const close = h('button', { type: 'button', class: 'icon-btn waiting-close', 'aria-label': 'Close' }, '×');
  const dialog = h('dialog', { class: 'waiting-dialog', 'aria-label': 'Activity while waiting' },
    h('div', { class: 'waiting-head' },
      h('div', { class: 'grow' }, h('strong', {}, 'While the agent works'), status), close),
    h('div', { class: 'waiting-tabs', role: 'tablist' }, reels, games), stage);

  const finish = () => {
    try { if (reelsWindow && !reelsWindow.closed) reelsWindow.close(); } catch { /* cross-origin tab already closed */ }
    if (dialog.open) dialog.close(); else dialog.remove();
  };
  const openReels = () => {
    reelsWindow = window.open('https://www.instagram.com/reels/', 'agentbridge-reels');
    try { if (reelsWindow) reelsWindow.opener = null; } catch { /* ignored */ }
    if (!reelsWindow) toast('The browser blocked the window. Allow pop-ups to open Instagram.', { kind: 'error' });
  };

  const draw = () => {
    const running = ['queued', 'running'].includes(job.status);
    status.textContent = running ? `${agentName(job.agent)} is working…` : job.status === 'done' ? '✓ Prompt done' : `✕ ${STATUS_LABELS[job.status] || 'Ended'}`;
    status.className = `waiting-status ${running ? 'running' : job.status === 'done' ? 'done' : 'failed'}`;
    reels.setAttribute('aria-selected', String(mode === 'reels'));
    games.setAttribute('aria-selected', String(mode === 'happydev'));
    if (!running && !closeTimer) closeTimer = setTimeout(finish, 450);
    if (renderedMode === mode) return;
    renderedMode = mode;
    if (mode === 'happydev') {
      fill(stage, h('iframe', { src: '/happydev/', title: 'HappyDEV', class: 'happydev-frame', sandbox: 'allow-scripts allow-same-origin' }));
    } else {
      fill(stage, h('div', { class: 'reels-card' },
        h('div', { class: 'reels-mark', 'aria-hidden': 'true' }, '◎'),
        h('h2', {}, 'Instagram Reels'),
        h('p', {}, 'Instagram keeps sign-in and videos on its own official site.'),
        h('button', { class: 'btn primary big', type: 'button', onclick: openReels }, 'Open Reels'),
        h('p', { class: 'muted small' }, 'Come back any time. The prompt keeps running on the PC.')));
    }
  };
  const select = (value) => { mode = value; prefs.set('waitingActivity', value); draw(); };
  reels.addEventListener('click', () => select('reels'));
  games.addEventListener('click', () => select('happydev'));
  close.addEventListener('click', () => dialog.close());
  const update = (event) => { if (event.detail?.id === job.id) { job = event.detail; draw(); } };
  document.addEventListener('agentbridge:job', update);
  const poll = setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const current = await api('GET', `/api/jobs/${job.id}`);
      job = current.job;
      draw();
      if (!['queued', 'running'].includes(job.status)) clearInterval(poll);
    } catch { /* websocket may recover */ }
  }, 2500);
  dialog.addEventListener('close', () => {
    clearInterval(poll);
    clearTimeout(closeTimer);
    try { if (reelsWindow && !reelsWindow.closed) reelsWindow.close(); } catch { /* ignored */ }
    document.removeEventListener('agentbridge:job', update);
    dialog.remove();
  });
  document.body.append(dialog);
  draw();
  if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
}

// ---------- API ----------

class AuthError extends Error {}

async function handleResponse(res, path) {
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && path !== '/api/login') {
    if (state.csrf) onLoggedOut();
    throw new AuthError('Session expired');
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { data, status: res.status });
  return data;
}

async function api(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.csrf && method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
  return handleResponse(res, path);
}

async function apiRaw(method, path, blob) {
  const res = await fetch(path, { method, headers: { 'Content-Type': blob.type || 'application/octet-stream', 'X-CSRF-Token': state.csrf }, body: blob, credentials: 'same-origin', cache: 'no-store' });
  return handleResponse(res, path);
}

const quiet = (e) => { if (!(e instanceof AuthError)) toast(e.message, { kind: 'error' }); };

const ACCENTS = [['violet', 'Violet'], ['blue', 'Blue'], ['teal', 'Teal'], ['green', 'Green'], ['amber', 'Amber'], ['rose', 'Rose'], ['graphite', 'Graphite']];

/** Appearance lives in data-* attributes on <html>: our CSP forbids inline styles. */
function applyAppearance() {
  const root = document.documentElement;
  const t = prefs.get('theme', 'auto');
  if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
  root.setAttribute('data-accent', prefs.get('accent', 'violet'));
  root.setAttribute('data-text', prefs.get('textSize', 'm'));
  root.setAttribute('data-density', prefs.get('density', 'comfortable'));
  root.setAttribute('data-chat', prefs.get('chatStyle', 'bubbles'));
  const dark = t === 'dark' || t === 'black' || (t === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'black' ? '#000000' : dark ? '#0b0d12' : '#f5f6fa');
}
const applyTheme = applyAppearance;
applyAppearance();
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyAppearance);

function onLoggedOut() {
  state.csrf = null;
  state.me = null;
  if (state.ws) { state.ws.onclose = null; state.ws.close(); state.ws = null; }
  renderLogin('Session ended. Sign in again.');
}

// ---------- WebSocket ----------

function trackJobs(jobs) {
  for (const j of jobs) {
    const prev = state.jobStatus.get(j.id);
    state.jobStatus.set(j.id, j.status);
    if (prev === 'running' && j.status !== 'running') notifyJobEnd(j);
    document.dispatchEvent(new CustomEvent('agentbridge:job', { detail: j }));
  }
}

function trackDuos(duos) {
  for (const d of duos) {
    const prev = state.duos.find((x) => x.id === d.id);
    if (prev?.status === 'running' && d.status !== 'running' && state.route !== `#/d/${d.id}`) {
      const ok = d.status === 'done';
      toast(`${ok ? '✓' : '✕'} Duo ${ok ? 'finished' : STATUS_LABELS[d.status] || 'ended'}: ${d.promptPreview}`, { kind: ok ? 'ok' : 'error', action: 'Open', onAction: () => { location.hash = `#/d/${d.id}`; }, timeout: 9000 });
    }
  }
  state.duos = duos;
}

function notifyJobEnd(j) {
  // Steps of a duo are announced once, when the whole duo ends.
  if (j.duo) return;
  const r = state.route;
  const here = r === `#/j/${j.id}` || (j.sessionId && r.endsWith(`/${j.sessionId}`)) || (j.resumeOf && !j.fork && r.endsWith(`/${j.resumeOf}`));
  if (here) return;
  const ok = j.status === 'done';
  const target = j.sessionId && (j.agent === 'claude' || j.agent === 'codex') ? `#/s/${j.agent}/${j.sessionId}` : `#/j/${j.id}`;
  toast(`${ok ? '✓' : '✕'} ${agentName(j.agent)} ${ok ? 'finished' : 'stopped'}: ${j.promptPreview}`, { kind: ok ? 'ok' : 'error', action: 'Open', onAction: () => { location.hash = target; }, timeout: 9000 });
}

function connectWs() {
  if (state.ws || !state.csrf) return;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  state.ws = ws;
  ws.onopen = () => { state.wsRetry = 0; state.resubscribe?.(); };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'jobs') { state.jobs = msg.jobs; trackJobs(msg.jobs); updateJobsBadge(); }
    if (msg.type === 'duos') trackDuos(msg.duos);
    if (msg.type === 'prefs' && prefs.adopt(msg.prefs)) applyAppearance();
    state.onWs?.(msg);
  };
  ws.onclose = (e) => {
    state.ws = null;
    if (e.code === 4001) return onLoggedOut();
    if (!state.csrf) return;
    setTimeout(connectWs, Math.min(15000, 500 * 2 ** state.wsRetry++));
  };
}

function wsSend(msg) {
  if (state.ws?.readyState === 1) state.ws.send(JSON.stringify(msg));
}

setInterval(() => wsSend({ type: 'ping', active: document.visibilityState === 'visible' }), 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.csrf) {
    wsSend({ type: 'ping', active: true });
    api('GET', '/api/me').catch(() => {});
    if (!state.ws) connectWs();
  }
});

// ---------- login ----------

async function renderLogin(message) {
  mount();
  let status = {};
  try { status = await api('GET', '/api/status'); } catch { /* offline */ }
  const expired = message && message.startsWith('Session'); // also matches legacy 'Sessione'
  const err = h('p', { class: 'error', role: 'alert' }, expired ? '' : message || '');
  const pw = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, maxlength: '1024', id: 'pw' });
  const eye = h('button', { type: 'button', class: 'eye', 'aria-label': 'Show password', onclick: () => { pw.type = pw.type === 'password' ? 'text' : 'password'; } }, icon('eye'));
  const code = h('input', { type: 'text', name: 'code', autocomplete: 'one-time-code', inputmode: 'numeric', pattern: '[0-9 ]*', maxlength: '64', required: true, placeholder: '• • • • • •', id: 'code', class: 'otp' });
  const codeLabel = h('span', {}, 'Authenticator app code');
  let recovery = false;
  const toggle = h('button', { type: 'button', class: 'link', onclick: () => {
    recovery = !recovery;
    code.setAttribute('inputmode', recovery ? 'text' : 'numeric');
    if (recovery) code.removeAttribute('pattern'); else code.setAttribute('pattern', '[0-9 ]*');
    code.classList.toggle('otp', !recovery);
    code.placeholder = recovery ? 'XXXX-XXXX-XXXX-XXXX' : '• • • • • •';
    codeLabel.textContent = recovery ? 'Recovery code' : 'Authenticator app code';
    toggle.textContent = recovery ? 'Use the 2FA code' : 'Lost your phone? Use a recovery code';
    code.value = '';
    code.focus();
  } }, 'Lost your phone? Use a recovery code');
  const submit = h('button', { class: 'btn primary big', type: 'submit' }, 'Sign in');
  if (status.lockedUntil) err.textContent = `Sign-in blocked until ${new Date(status.lockedUntil).toLocaleTimeString('en-GB')} after too many failed attempts.`;

  let busy = false;
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    submit.disabled = true;
    submit.textContent = 'Verifying…';
    err.textContent = '';
    try {
      const r = await api('POST', '/api/login', { password: pw.value, code: code.value });
      pw.value = '';
      state.csrf = r.csrf;
      if (r.usedRecovery) toast(`You used a recovery code. ${r.recoveryCodesLeft} left. Reset 2FA on the PC with "npm run setup".`, { kind: 'error', timeout: 0 });
      await boot();
    } catch (ex) {
      err.textContent = ex.data?.lockUntil ? `Too many attempts. Blocked until ${new Date(ex.data.lockUntil).toLocaleTimeString('en-GB')}.` : ex.message;
      code.value = '';
      code.focus();
      submit.disabled = false;
      submit.textContent = 'Sign in';
    } finally {
      busy = false;
    }
  } },
  h('label', { class: 'field', for: 'pw' }, h('span', {}, 'Password'), h('div', { class: 'pw-wrap' }, pw, eye)),
  h('label', { class: 'field', for: 'code' }, codeLabel, code),
  err, submit, h('div', { class: 'center mt12' }, toggle));
  // Submit as soon as the 6th digit is typed.
  code.addEventListener('input', () => { if (!recovery && /^\d{6}$/.test(code.value.replace(/\s/g, '')) && pw.value) form.requestSubmit(); });

  mount(h('div', { class: 'login' },
    h('div', { class: 'login-card' },
      h('img', { src: '/icon.svg', class: 'logo', alt: '' }),
      h('h1', {}, 'Agent Bridge'),
      h('p', { class: 'muted' }, 'Claude Code, Codex and your agents, from your phone.'),
      expired ? h('p', { class: 'notice small' }, message) : null,
      form),
    h('p', { class: 'muted small center login-foot' }, icon('shield', 'xs'), ' Password + 2FA · encrypted connection')));
  pw.focus();
}

// ---------- chrome ----------

function updateJobsBadge() {
  const n = state.jobs.filter((j) => j.status === 'running').length;
  for (const el of document.querySelectorAll('.jobs-badge')) {
    el.textContent = n ? String(n) : '';
    el.hidden = !n;
  }
}

function tabbar(active) {
  const tab = (id, href, ic, label, extra) => h('a', { class: `tab${active === id ? ' active' : ''}`, href, 'aria-current': active === id ? 'page' : null, 'data-tab': id }, icon(ic), h('span', {}, label), extra);
  const bar = h('nav', { class: 'tabbar', 'aria-label': 'Navigation' },
    h('a', { class: 'brand', href: '#/', 'aria-label': 'Agent Bridge' }, h('img', { src: '/icon.svg', alt: '' }), h('span', {}, 'Agent Bridge')),
    tab('sessions', '#/', 'chats', 'Chats'),
    tab('new', '#/new', 'plus', 'New'),
    state.me?.duo ? tab('duo', '#/duo', 'duo', 'Duo') : null,
    tab('jobs', '#/jobs', 'activity', 'Activity', h('span', { class: 'jobs-badge', hidden: true })),
    tab('settings', '#/settings', 'settings', 'Settings'),
    h('div', { class: 'rail-foot muted small' }, state.me?.host || ''));
  queueMicrotask(updateJobsBadge);
  return bar;
}

function header({ title, subtitle, back, actions }) {
  return h('header', { class: 'topbar' },
    back ? h('a', { class: 'icon-btn ghost', href: back, 'aria-label': 'Back' }, icon('back')) : null,
    h('div', { class: 'title-wrap' }, h('div', { class: 'title' }, title), subtitle ? h('div', { class: 'subtitle' }, subtitle) : null),
    actions || null);
}

// On phones the tab bar shows only on top-level pages; on wide screens it is a
// sidebar that stays visible everywhere (`section` keeps the right item lit).
function page({ tab, section, title, subtitle, back, actions, body, bottom }) {
  return h('div', { class: `shell${tab ? ' has-tabs' : ''}${bottom ? ' has-dock' : ''}` },
    tabbar(tab || section || null),
    h('div', { class: 'content' },
      header({ title, subtitle, back, actions }),
      h('main', {}, body),
      bottom || null));
}

// ---------- markdown (safe: DOM nodes only) ----------

function inline(text) {
  const out = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(h('code', {}, m[1].slice(1, -1)));
    else if (m[2]) out.push(h('strong', {}, m[2].slice(2, -2)));
    else if (m[3]) out.push(h('a', { href: m[4], target: '_blank', rel: 'noopener noreferrer' }, m[3]));
    else if (m[5]) out.push(h('a', { href: m[5], target: '_blank', rel: 'noopener noreferrer' }, m[5]));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function codeBlock(lang, code) {
  const copy = h('button', { class: 'copy', type: 'button', 'aria-label': 'Copy', onclick: async () => {
    try { await navigator.clipboard.writeText(code); copy.textContent = 'Copied'; setTimeout(() => fill(copy, icon('copy', 'xs')), 1500); } catch { /* ignore */ }
  } }, icon('copy', 'xs'));
  return h('div', { class: 'codeblock' }, h('div', { class: 'code-head' }, h('span', {}, lang || 'code'), copy), h('pre', {}, h('code', {}, code)));
}

function markdown(text) {
  const frag = document.createDocumentFragment();
  const parts = String(text).split(/^```/m);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const nl = part.indexOf('\n');
      const lang = nl >= 0 ? part.slice(0, nl).trim() : '';
      frag.append(codeBlock(lang, (nl >= 0 ? part.slice(nl + 1) : part).replace(/\n$/, '')));
      return;
    }
    const lines = part.split('\n');
    let para = [];
    let list = null;
    let table = null;
    const flushPara = () => { if (para.length) { const p = h('p', {}); para.forEach((l, k) => { if (k) p.append(h('br')); p.append(...inline(l)); }); frag.append(p); para = []; } };
    const flushList = () => { if (list) { frag.append(list); list = null; } };
    const flushTable = () => {
      if (!table) return;
      const rows = table.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r)).map((r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()));
      const [head, ...body] = rows;
      frag.append(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, head.map((c) => h('th', {}, inline(c))))),
        h('tbody', {}, body.map((r) => h('tr', {}, r.map((c) => h('td', {}, inline(c)))))))));
      table = null;
    };
    for (const line of lines) {
      let m;
      if (/^\s*\|.*\|\s*$/.test(line)) { flushPara(); flushList(); (table ||= []).push(line); continue; }
      flushTable();
      if (!line.trim()) { flushPara(); flushList(); continue; }
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { flushPara(); flushList(); frag.append(h(`h${Math.min(6, m[1].length + 2)}`, { class: 'md-h' }, inline(m[2]))); continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); flushList(); frag.append(h('hr')); continue; }
      if ((m = line.match(/^\s*>\s?(.*)$/))) { flushPara(); flushList(); frag.append(h('blockquote', {}, inline(m[1]))); continue; }
      if ((m = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/))) {
        flushPara();
        const ordered = /\d/.test(m[1]);
        if (!list || list.tagName !== (ordered ? 'OL' : 'UL')) { flushList(); list = h(ordered ? 'ol' : 'ul', {}); }
        list.append(h('li', {}, inline(m[2])));
        continue;
      }
      if (list && /^\s{2,}\S/.test(line)) { list.lastChild.append(' ', ...inline(line.trim())); continue; }
      flushList();
      para.push(line);
    }
    flushTable(); flushPara(); flushList();
  });
  return frag;
}

// ---------- thread ----------

function stepItem(m) {
  const first = (m.text || '').split('\n')[0];
  if (m.role === 'thinking') return h('details', { class: 'step thinking' }, h('summary', {}, h('span', { class: 'n' }, 'reasoning'), h('span', { class: 'p' }, first)), h('pre', {}, m.text));
  if (m.role === 'tool') return h('details', { class: 'step' }, h('summary', {}, h('span', { class: 'n' }, m.name || 'tool'), h('span', { class: 'p' }, first)), h('pre', {}, m.text));
  return h('details', { class: `step result${m.error ? ' err' : ''}` }, h('summary', {}, h('span', { class: 'n' }, m.error ? 'error' : 'output'), h('span', { class: 'p' }, first || '(empty)')), h('pre', {}, m.text || ''));
}

function bubble(m, agent) {
  if (m.role === 'user') {
    return h('div', { class: `msg user${m.meta ? ' meta' : ''}` },
      h('div', { class: 'body' }, m.meta ? m.text : markdown(m.text)),
      m.ts ? h('div', { class: 'time' }, new Date(m.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })) : null);
  }
  if (m.role === 'assistant') return h('div', { class: 'msg assistant' }, h('div', { class: 'who' }, avatar(agent), agentName(agent)), h('div', { class: 'body md' }, markdown(m.text)));
  if (m.role === 'error') return h('div', { class: 'msg error' }, h('div', { class: 'body' }, m.text));
  return h('div', { class: 'msg system' }, m.text);
}

const isStep = (m) => m.role === 'tool' || m.role === 'tool_result' || m.role === 'thinking';

function threadView(agent) {
  const el = h('div', { class: 'thread' });
  const wlabel = h('span', { class: 'muted small' });
  const working = h('div', { class: 'msg assistant working', hidden: true }, h('div', { class: 'who' }, avatar(agent), agentName(agent)), h('div', { class: 'row gap' }, h('div', { class: 'dots' }, h('i'), h('i'), h('i')), wlabel));
  const seen = new Set();
  const all = [];
  const opts = { showTools: prefs.get('showTools', true), showMeta: prefs.get('showMeta', false) };
  let group = null;
  const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 220;

  const append = (m) => {
    if (m.role === 'user' && m.meta && !opts.showMeta) return;
    if (isStep(m)) {
      if (!opts.showTools) return;
      if (!group) {
        group = { count: 0, el: h('details', { class: 'steps' }), sum: h('summary', {}), body: h('div', { class: 'steps-body' }) };
        group.el.append(group.sum, group.body);
        el.insertBefore(group.el, working);
      }
      group.count++;
      group.body.append(stepItem(m));
      if (m.role === 'tool') group.lastTool = m.name;
      fill(group.sum, h('span', { class: 'steps-ic' }, '⚙'), `${group.count} ${group.count === 1 ? 'step' : 'steps'}`, group.lastTool ? h('span', { class: 'muted' }, ` · ${group.lastTool}`) : null);
      return;
    }
    group = null;
    el.insertBefore(bubble(m, agent), working);
  };
  el.append(working);

  const add = (msgs, forceScroll) => {
    const stick = forceScroll || nearBottom();
    for (const m of msgs) {
      const key = m.id ?? m.seq;
      if (key != null) { if (seen.has(key)) continue; seen.add(key); }
      // The optimistic copy of a just-sent prompt is replaced by the real transcript entry.
      if (m.role === 'user' && !m.meta) {
        const dup = all.findIndex((x) => x.local && x.text === m.text);
        if (dup >= 0) { all.splice(dup, 1); rerender(); }
      }
      all.push(m);
      append(m);
    }
    if (stick) requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight));
  };
  const rerender = () => { group = null; fill(el, working); all.forEach(append); };
  const setWorking = (on, label = '') => {
    const wasHidden = working.hidden;
    working.hidden = !on;
    wlabel.textContent = label;
    if (on && wasHidden && nearBottom()) requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight));
  };
  const toggles = h('div', { class: 'row toggles' },
    h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: opts.showTools, onchange: (e) => { opts.showTools = e.target.checked; prefs.set('showTools', opts.showTools); rerender(); } }), 'steps'),
    h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: opts.showMeta, onchange: (e) => { opts.showMeta = e.target.checked; prefs.set('showMeta', opts.showMeta); rerender(); } }), 'system context'));
  return { el, add, toggles, setWorking };
}

function scrollDownButton() {
  const btn = h('button', { class: 'fab', 'aria-label': 'Scroll to bottom', hidden: true, onclick: () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }) }, icon('down'));
  const onScroll = () => { btn.hidden = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 300; };
  window.addEventListener('scroll', onScroll, { passive: true });
  return { btn, dispose: () => window.removeEventListener('scroll', onScroll) };
}

// ---------- composer: options, photos, voice ----------

/** A native <select> dressed as a pill: tapping it opens the iOS/Android picker. */
function pill(label, options, value, onchange) {
  const text = h('span', { class: 'pill-text' });
  const sel = h('select', { 'aria-label': label }, options.map(([v, t]) => h('option', { value: v }, t)));
  sel.value = options.some(([v]) => v === value) ? value : options[0]?.[0] ?? '';
  const show = () => { const o = options.find(([v]) => v === sel.value); text.textContent = o?.[2] || o?.[1] || ''; };
  sel.addEventListener('change', () => { show(); onchange(sel.value); });
  show();
  return h('label', { class: 'pill' }, text, h('span', { class: 'caret' }, '▾'), sel);
}

/** Model / reasoning / permission pickers for one agent, remembered per agent on this device. */
function agentOptions(agentId, { asFields = false } = {}) {
  const a = agentById(agentId);
  const el = h('div', { class: asFields ? 'opts' : 'pills' });
  const v = {
    model: prefs.get(`model.${agentId}`, ''),
    effort: prefs.get(`effort.${agentId}`, ''),
    mode: prefs.get(`mode.${agentId}`, a?.defaultMode || ''),
  };
  const draw = () => {
    if (!a) return fill(el);
    const models = a.models || [];
    if (!models.some((m) => m.id === v.model)) v.model = models[0]?.id ?? '';
    const model = models.find((m) => m.id === v.model);
    const efforts = model?.efforts || [];
    if (v.effort && !efforts.includes(v.effort)) v.effort = '';
    if (a.modes.length && !a.modes.includes(v.mode)) v.mode = a.defaultMode;
    const modelOpts = models.map((m) => [m.id, m.label, m.id ? m.label.split(' — ')[0] : 'Model']);
    const effortOpts = [['', 'Default reasoning', 'Reasoning'], ...efforts.map((e) => [e, `Reasoning: ${EFFORT_LABELS[e] || e}`, EFFORT_LABELS[e] || e])];
    const modeOpts = a.modes.map((m) => [m, MODE_LABELS[m] || m, (MODE_LABELS[m] || m).split(' — ')[0]]);
    const setModel = (x) => { v.model = x; prefs.set(`model.${agentId}`, x); draw(); };
    const setEffort = (x) => { v.effort = x; prefs.set(`effort.${agentId}`, x); };
    const setMode = (x) => { v.mode = x; prefs.set(`mode.${agentId}`, x); };
    if (asFields) {
      const field = (label, opts, value, on) => {
        const s = h('select', { 'aria-label': label }, opts.map(([x, t]) => h('option', { value: x }, t)));
        s.value = value;
        s.addEventListener('change', () => on(s.value));
        return h('label', { class: 'field' }, h('span', {}, label), s);
      };
      fill(el,
        models.length ? field('Model', modelOpts, v.model, setModel) : null,
        efforts.length ? field('Reasoning', effortOpts.map(([x, t]) => [x, t.replace('Reasoning: ', '')]), v.effort, setEffort) : null,
        a.modes.length ? field('Permissions', modeOpts, v.mode, setMode) : null);
    } else {
      fill(el,
        models.length ? pill('Model', modelOpts, v.model, setModel) : null,
        efforts.length ? pill('Reasoning', effortOpts, v.effort, setEffort) : null,
        a.modes.length ? pill('Permissions', modeOpts, v.mode, setMode) : null);
    }
  };
  draw();
  return { el, values: () => ({ model: v.model || undefined, effort: v.effort || undefined, mode: a?.modes.length ? v.mode : undefined }) };
}

async function downscale(file, maxDim = 1600) {
  const url = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read the image'));
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Unsupported image format'));
    i.src = url;
  });
  const k = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

function insertAtCursor(ta, text) {
  if (!text) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  const before = ta.value.slice(0, start);
  const sep = before && !/\s$/.test(before) ? ' ' : '';
  ta.value = before + sep + text + ta.value.slice(end);
  const pos = (before + sep + text).length;
  ta.setSelectionRange(pos, pos);
  ta.dispatchEvent(new Event('input'));
}

/** Microphone: local Whisper on the PC when installed, else the browser's own recognizer. */
function voiceButton(ta, statusEl) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canRecord = state.me.voice && navigator.mediaDevices?.getUserMedia && window.MediaRecorder;
  if (!canRecord && !SR) return null;
  const btn = h('button', { type: 'button', class: 'icon-btn ghost', 'aria-label': 'Record a voice note' }, icon('mic'));
  let rec = null;
  let timer = null;
  // Empty = let the PC's Whisper detect the language.
  const lang = () => prefs.get('voiceLang', '');
  const idle = () => { btn.classList.remove('rec'); fill(btn, icon('mic')); clearInterval(timer); };

  btn.addEventListener('click', async () => {
    if (rec) return rec.stop();
    if (canRecord) {
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('Microphone permission denied. Enable it for this site in the browser settings.', { kind: 'error' }); }
      const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported?.(t));
      const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        rec = null;
        idle();
        btn.disabled = true;
        statusEl.textContent = 'Transcribing on the PC…';
        try {
          const blob = new Blob(chunks, { type: (mr.mimeType || type || 'audio/webm').split(';')[0] });
          const r = await apiRaw('POST', `/api/transcribe?lang=${encodeURIComponent(lang())}`, blob);
          insertAtCursor(ta, r.text);
          statusEl.textContent = r.text ? '' : 'Could not understand that. Try again.';
        } catch (e) {
          statusEl.textContent = e.message;
        } finally {
          btn.disabled = false;
        }
      };
      mr.start();
      rec = mr;
      const t0 = Date.now();
      btn.classList.add('rec');
      fill(btn, icon('stop'));
      const tick = () => {
        const s = Math.floor((Date.now() - t0) / 1000);
        statusEl.textContent = `● ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} — tap ■ to finish`;
        if (s >= 180) mr.stop();
      };
      tick();
      timer = setInterval(tick, 500);
    } else {
      const r = new SR();
      r.lang = { it: 'it-IT', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE' }[lang()] || navigator.language;
      r.interimResults = false;
      r.onresult = (e) => insertAtCursor(ta, [...e.results].map((x) => x[0].transcript).join(' '));
      r.onerror = (e) => { statusEl.textContent = `Microphone error: ${e.error}`; };
      r.onend = () => { rec = null; idle(); statusEl.textContent = ''; };
      r.start();
      rec = r;
      btn.classList.add('rec');
      fill(btn, icon('stop'));
      statusEl.textContent = '● Listening…';
    }
  });
  return btn;
}

/**
 * Auto-growing textarea without inline styles: a wrapper mirrors the text in a
 * ::after pseudo-element and the grid takes the taller of the two. Setting
 * element.style is refused by our CSP in Safari, so this stays attribute-only.
 */
function autoGrow(ta, tall = false) {
  const wrap = h('div', { class: `grow-wrap${tall ? ' tall' : ''}` }, ta);
  const sync = () => wrap.setAttribute('data-value', ta.value);
  ta.addEventListener('input', sync);
  sync();
  return wrap;
}

/**
 * Prompt composer: option pills, photos, voice, textarea, send. Resumable agents
 * always continue their canonical project conversation; no accidental branches.
 */
function composer({ getAgent, placeholder, session, onSubmit, dock = true, allowImages = true }) {
  const ta = h('textarea', { placeholder, maxlength: String(state.me.maxPromptChars), rows: '1', enterkeyhint: 'enter', 'aria-label': 'Prompt' });
  const taWrap = autoGrow(ta, !dock);
  const status = h('div', { class: 'status muted small' });
  const thumbs = h('div', { class: 'thumbs' });
  const images = [];
  const pillsWrap = h('div', { class: 'pills' });
  let opts = null;
  let liveOn = !!session?.live;
  const livePill = h('button', { type: 'button', class: 'pill toggle-pill', 'aria-pressed': String(liveOn), title: 'The prompt appears in the chat open in VS Code, which replies there and here', onclick: () => {
    liveOn = !liveOn;
    livePill.setAttribute('aria-pressed', String(liveOn));
  } }, icon('screen', 'xs'), 'Chat VS Code');
  const continuousPill = h('span', { class: 'pill', title: 'Prompts stay in the same conversation per agent and folder' }, icon('link', 'xs'), 'Continuous chat');

  const quick = h('div', { class: 'quick', 'aria-label': 'Quick prompts' });
  const drawQuick = () => {
    const list = prefs.get('quickPrompts', DEFAULT_QUICK_PROMPTS).filter((q) => typeof q === 'string' && q.trim());
    fill(quick, list.map((q) => h('button', { type: 'button', class: 'chip small', title: q, onclick: () => {
      ta.value = ta.value.trim() ? `${ta.value.trimEnd()}\n${q}` : q;
      ta.dispatchEvent(new Event('input'));
      ta.focus();
    } }, q)), h('a', { class: 'chip small ghost', href: '#/settings/personalize', 'aria-label': 'Edit quick prompts', title: 'Edit quick prompts' }, icon('edit', 'xs')));
    quick.hidden = !prefs.get('showQuick', true);
  };
  drawQuick();
  const drawThumbs = () => fill(thumbs, images.map((img, i) => h('div', { class: 'thumb' },
    h('img', { src: img.url, alt: `Image ${i + 1}` }),
    h('button', { type: 'button', 'aria-label': 'Remove image', onclick: () => { images.splice(i, 1); drawThumbs(); } }, '×'))));
  const addFiles = async (files) => {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      if (images.length >= 4) { toast('Up to 4 images.', { kind: 'error' }); break; }
      try {
        const url = await downscale(f);
        images.push({ url, mediaType: 'image/jpeg', data: url.split(',')[1] });
      } catch (e) { toast(e.message, { kind: 'error' }); }
    }
    drawThumbs();
  };
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => { addFiles([...e.target.files]); e.target.value = ''; } });
  const photoBtn = h('button', { type: 'button', class: 'icon-btn ghost', 'aria-label': 'Attach a photo or screenshot', onclick: () => fileInput.click() }, icon('clip'));
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
  });

  const refresh = () => {
    const a = agentById(getAgent());
    opts = agentOptions(getAgent());
    fill(pillsWrap, session?.live ? livePill : null, a?.resumable ? continuousPill : null, [...opts.el.childNodes]);
    photoBtn.hidden = !a?.images || !allowImages;
    if ((!a?.images || !allowImages) && images.length) { images.length = 0; drawThumbs(); }
  };

  const sendBtn = h('button', { class: 'send', type: 'submit', 'aria-label': 'Send' }, icon('send'));
  const keyboardBtn = h('button', { type: 'button', class: 'icon-btn ghost keyboard-hide', 'aria-label': 'Hide keyboard', onclick: () => ta.blur() }, icon('down'));
  const mic = voiceButton(ta, status);
  const form = h('form', { class: `composer${dock ? '' : ' inline'}`, onsubmit: async (e) => {
    e.preventDefault();
    const prompt = ta.value.trim();
    if (!prompt) { ta.focus(); return; }
    sendBtn.disabled = true;
    status.textContent = '';
    try {
      await onSubmit({ prompt, toChat: liveOn && !!session?.live, ...opts.values(), fork: false, images: images.length ? images.map(({ mediaType, data }) => ({ mediaType, data })) : undefined });
      ta.value = '';
      ta.dispatchEvent(new Event('input'));
      images.length = 0;
      drawThumbs();
    } catch (ex) {
      if (!(ex instanceof AuthError)) toast(ex.message, { kind: 'error' });
    } finally {
      sendBtn.disabled = false;
    }
  } },
  pillsWrap, quick, thumbs,
  h('div', { class: 'inputbar' }, photoBtn, fileInput, taWrap, mic, keyboardBtn, sendBtn),
  status);
  refresh();
  return { form, ta, refresh };
}

// ---------- folder picker ----------

function folderPicker() {
  const ws = state.me.workspaces;
  let cwd = prefs.get('lastCwd', ws.recent[0] || ws.roots[0] || '');
  const cwdLabel = h('div', { class: 'folder big' });
  const dirList = h('div', { class: 'dirs', hidden: true });
  const recent = h('div', { class: 'chips wrap' });
  const setCwd = (p) => {
    cwd = p;
    fill(cwdLabel, icon('folder', 'xs'), shortPath(p) || '(none)');
    fill(recent, [...new Set([...ws.recent, ...ws.roots])].slice(0, 8).map((p2) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(p2 === cwd), title: p2, onclick: () => { setCwd(p2); dirList.hidden = true; } }, baseName(p2))));
  };
  setCwd(cwd);
  const browse = async (p) => {
    try {
      const r = await api('GET', `/api/dirs?path=${encodeURIComponent(p)}`);
      setCwd(r.path);
      dirList.hidden = false;
      fill(dirList,
        r.parent ? h('button', { type: 'button', onclick: () => browse(r.parent) }, '↑  Parent folder') : null,
        r.dirs.map((d) => h('button', { type: 'button', onclick: () => browse(joinPath(r.path, d)) }, icon('folder', 'xs'), d)),
        h('button', { type: 'button', class: 'done', onclick: () => { dirList.hidden = true; } }, `✓ Use “${baseName(r.path)}”`));
    } catch (e) { quiet(e); }
  };
  const el = h('div', { class: 'card pad folder-card' }, cwdLabel, recent,
    h('button', { type: 'button', class: 'btn small ghost mt8', onclick: () => browse(cwd || ws.roots[0]) }, icon('folder', 'xs'), 'Browse folders…'), dirList);
  return { el, get: () => cwd };
}

// ---------- sheets (small dialogs) ----------

function sheet(title, body, { actions = [], label } = {}) {
  const close = h('button', { type: 'button', class: 'icon-btn ghost', 'aria-label': 'Close' }, icon('x'));
  const dialog = h('dialog', { class: 'sheet', 'aria-label': label || title },
    h('div', { class: 'sheet-head' }, h('strong', { class: 'grow' }, title), close),
    h('div', { class: 'sheet-body' }, body),
    actions.length ? h('div', { class: 'sheet-actions' }, actions) : null);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  document.body.append(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  return dialog;
}

// ---------- local names and pins for chats ----------

const chatName = (s) => prefs.get('names', {})[s.id] || s.title || '(untitled)';
const isPinned = (id) => prefs.get('pinned', []).includes(id);
function togglePin(id) {
  const list = prefs.get('pinned', []).filter((x) => x !== id);
  if (!isPinned(id)) list.unshift(id);
  prefs.set('pinned', list.slice(0, 50));
}
function renameChat(s, done) {
  const input = h('input', { type: 'text', value: chatName(s), maxlength: '120', 'aria-label': 'Name' });
  const save = h('button', { type: 'button', class: 'btn primary' }, 'Save');
  const reset = h('button', { type: 'button', class: 'btn ghost' }, 'Use the original title');
  const d = sheet('Rename chat', [h('label', { class: 'field' }, h('span', {}, 'Name shown on all your devices'), input)], { actions: [reset, save] });
  const put = (value) => {
    const names = { ...prefs.get('names', {}) };
    if (value) names[s.id] = value; else delete names[s.id];
    prefs.set('names', names);
    d.close();
    done?.();
  };
  save.addEventListener('click', () => put(input.value.trim().slice(0, 120)));
  reset.addEventListener('click', () => put(''));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save.click(); } });
  input.select();
}

// ---------- Claude ⇄ Codex ----------

/** Pass the latest reply of a chat or job to the other agent, with an instruction. */
function handoff({ agent, sessionId, jobId }) {
  const to = otherAgent(agent);
  if (!state.me.duo || !agentById(to)) return toast(`${SHORT_NAME[to]} is not enabled on the PC.`, { kind: 'error' });
  const custom = prefs.get('handoffPresets', null);
  const presets = Array.isArray(custom) && custom.length ? custom.map((t) => [t, t]) : HANDOFF_PRESETS;
  let choice = presets[0][0];
  const text = h('textarea', { rows: '3', maxlength: '4000', placeholder: 'Or write your own instruction…', 'aria-label': 'Instruction' });
  const list = h('div', { class: 'choice-list', role: 'radiogroup' });
  const draw = () => fill(list, presets.map(([value, label]) => h('button', { type: 'button', role: 'radio', class: 'choice', 'aria-checked': String(choice === value && !text.value.trim()), onclick: () => { choice = value; text.value = ''; draw(); } }, h('span', { class: 'radio-dot' }), label)));
  text.addEventListener('input', draw);
  draw();
  const opts = agentOptions(to);
  const send = h('button', { type: 'button', class: 'btn primary' }, icon('swap', 'xs'), `Send to ${SHORT_NAME[to]}`);
  const d = sheet(`Ask ${SHORT_NAME[to]}`, [
    h('p', { class: 'muted small' }, `${SHORT_NAME[to]} gets ${SHORT_NAME[agent] || agentName(agent)}'s latest reply and your instruction, in its own chat for this folder.`),
    list, text, h('div', { class: 'pills mt8' }, [...opts.el.childNodes])], { actions: [send] });
  send.addEventListener('click', async () => {
    send.disabled = true;
    try {
      const r = await api('POST', '/api/handoff', { from: agent, sessionId, jobId, to, instruction: text.value.trim() || choice, options: opts.values() });
      d.close();
      state.jobStatus.set(r.job.id, 'running');
      location.hash = `#/j/${r.job.id}`;
    } catch (e) { quiet(e); send.disabled = false; }
  });
}

// ---------- views ----------

async function renderSessions() {
  const listEl = h('div', { class: 'groups' });
  const search = h('input', { type: 'search', placeholder: 'Search chats and folders', value: state.search, 'aria-label': 'Search chats', class: 'search' });
  const chips = h('div', { class: 'chips' });
  const agents = [['all', 'All'], ...state.me.agents.filter((a) => a.resumable).map((a) => [a.id, a.name])];

  const row = (s) => {
    const running = runningFor(s.id).length > 0;
    return h('a', { class: 'row-item', href: `#/s/${s.agent}/${s.id}` },
      avatar(s.agent),
      h('div', { class: 'grow' },
        h('div', { class: 'row-top' }, isPinned(s.id) ? icon('pin', 'xs pin-ic') : null, h('span', { class: 't' }, chatName(s)), h('span', { class: 'time' }, relTime(s.updated))),
        h('div', { class: 'row-sub' },
          running ? h('span', { class: 'tag live' }, h('span', { class: 'live-dot' }), 'running') : null,
          s.live ? h('span', { class: 'tag ok' }, icon('screen', 'xs'), 'chat listening') : null,
          s.busy ? h('span', { class: 'tag' }, 'open in VS Code') : /vscode/i.test(s.origin || '') ? h('span', { class: 'tag subtle' }, 'VS Code') : null,
          h('span', { class: 'folder', title: s.cwd || '' }, icon('folder', 'xs'), baseName(s.cwd)))));
  };

  const draw = () => {
    fill(chips, agents.map(([id, name]) => h('button', { class: 'chip', 'aria-pressed': String(state.filter === id), onclick: () => { state.filter = id; draw(); } }, name)));
    if (!state.sessionsCache) return fill(listEl, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    const q = state.search.toLowerCase();
    const items = state.sessionsCache.filter((s) => (state.filter === 'all' || s.agent === state.filter) && (!q || `${chatName(s)} ${s.title} ${s.cwd}`.toLowerCase().includes(q)));
    if (!items.length) return fill(listEl, h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, icon('chats')), h('p', {}, q ? 'No results.' : 'No chats yet. Start one from here or from VS Code.'), h('a', { class: 'btn primary', href: '#/new' }, icon('plus', 'xs'), 'New prompt')));
    const groups = new Map(items.some((s) => isPinned(s.id)) ? [['Pinned', []]] : []);
    for (const s of items) {
      const k = isPinned(s.id) ? 'Pinned' : dayBucket(s.updated);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    fill(listEl, [...groups].map(([k, arr]) => h('section', { class: 'group' }, h('h2', { class: 'group-title' }, k), h('div', { class: 'card list-card' }, arr.map(row)))));
  };
  search.addEventListener('input', () => { state.search = search.value; draw(); });

  mount(page({
    tab: 'sessions', title: 'Chats', subtitle: `Claude Code and Codex on ${state.me.host}`,
    actions: h('a', { class: 'icon-btn accent', href: '#/new', 'aria-label': 'New prompt' }, icon('plus')),
    body: [h('div', { class: 'searchbar' }, search, chips), listEl],
  }));
  draw();

  const stale = viewGuard();
  const load = async () => {
    try { const r = await api('GET', '/api/sessions'); if (!stale()) { state.sessionsCache = r.sessions; draw(); } } catch (e) { quiet(e); }
  };
  await load();
  if (stale()) return;
  // No polling from a hidden tab: it would keep the login alive forever.
  const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 10000);
  state.onWs = (msg) => { if (msg.type === 'jobs') draw(); };
  state.cleanup = () => clearInterval(t);
}

async function renderSession(agent, id) {
  mount(page({ section: 'sessions', title: agentName(agent), back: '#/', body: h('div', { class: 'empty' }, h('span', { class: 'spinner' })) }));
  const stale = viewGuard();
  let data;
  try { data = await api('GET', `/api/sessions/${agent}/${id}`); } catch (e) { quiet(e); return; }
  if (stale()) return;
  const s = data.session;
  const thread = threadView(agent);
  const runningBar = h('div', { class: 'running-bar', hidden: true });
  const fab = scrollDownButton();

  const intro = h('div', { class: 'session-intro' },
    h('div', { class: 'folder big', title: s.cwd }, icon('folder', 'xs'), shortPath(s.cwd)),
    h('div', { class: 'muted small' }, `${/vscode/i.test(s.origin || '') ? 'Started in VS Code' : s.origin || ''} · updated ${ago(s.updated)}`),
    data.truncated ? h('div', { class: 'notice small' }, 'Showing only the latest messages.') : null,
    thread.toggles);

  const drawRunning = () => {
    const mine = state.jobs.filter((j) => j.resumeOf === id || j.sessionId === id);
    const running = mine.filter((j) => j.status === 'running' && !j.fork);
    const forked = mine.find((j) => j.resumeOf === id && j.sessionId && j.sessionId !== id);
    thread.setWorking(running.length > 0 || waitingChat, running.length ? 'working…' : 'replying in the VS Code chat…');
    runningBar.hidden = !running.length && !forked;
    fill(runningBar,
      running.map((j) => h('div', { class: 'row gap' }, h('span', { class: 'live-dot' }), h('span', { class: 'grow small' }, `${agentName(agent)} is working`),
        h('a', { class: 'btn small ghost', href: `#/j/${j.id}` }, 'Details'),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => api('POST', `/api/jobs/${j.id}/cancel`, {}).catch(quiet) }, icon('stop', 'xs'), 'Stop'))),
      forked ? h('div', { class: 'small' }, forked.fork ? 'Copy created: ' : 'The reply continued in a new session: ', h('a', { href: `#/s/${agent}/${forked.sessionId}` }, 'open it')) : null);
  };

  let bottom;
  let chatWait = null;
  let waitingChat = false;
  if (s.canSend) {
    const c = composer({
      getAgent: () => agent,
      placeholder: `Message ${agentName(agent)}…`,
      session: s,
      onSubmit: async ({ toChat, ...payload }) => {
        if (toChat) {
          const r = await api('POST', '/api/jobs', { agent, sessionId: id, target: 'chat', prompt: payload.prompt });
          thread.add([{ id: `chat-${Date.now()}`, local: true, role: 'user', text: payload.prompt, ts: new Date().toISOString() }], true);
          thread.setWorking(true, 'replying in the VS Code chat…');
          // Cleared by the reply itself; the timeout covers a chat that never answers.
          clearTimeout(chatWait);
          chatWait = setTimeout(() => drawRunning(), 3 * 60 * 1000);
          waitingChat = true;
          return;
        }
        const r = await api('POST', '/api/jobs', { agent, sessionId: id, ...payload });
        state.jobs = [r.job, ...state.jobs.filter((j) => j.id !== r.job.id)];
        state.jobStatus.set(r.job.id, 'running');
        if (r.job.fork) { location.hash = `#/j/${r.job.id}`; return; }
        thread.add([{ id: `local-${r.job.id}`, local: true, role: 'user', text: payload.prompt, ts: new Date().toISOString() }], true);
        drawRunning();
        showWaitingRoom(r.job);
      },
    });
    bottom = h('div', { class: 'dock' },
      s.busy ? h('div', { class: 'notice small' }, 'Open in VS Code. The prompt goes into this same conversation and the VS Code tab refreshes when the reply ends.') : null,
      runningBar, c.form);
  } else {
    bottom = h('div', { class: 'dock' }, h('div', { class: 'notice warn small' }, 'Folder outside the allowed workspaces. Read-only.'));
  }

  const title = h('span', {}, chatName(s));
  const pin = h('button', { type: 'button', class: 'icon-btn ghost', 'aria-label': 'Pin chat', 'aria-pressed': String(isPinned(id)), onclick: () => { togglePin(id); pin.setAttribute('aria-pressed', String(isPinned(id))); toast(isPinned(id) ? 'Pinned to the top of Chats.' : 'Unpinned.', { timeout: 2000 }); } }, icon('pin'));
  const rename = h('button', { type: 'button', class: 'icon-btn ghost', 'aria-label': 'Rename chat', onclick: () => renameChat(s, () => { title.textContent = chatName(s); }) }, icon('edit'));
  const ask = state.me.duo && s.canSend && (agent === 'claude' || agent === 'codex')
    ? h('button', { type: 'button', class: 'btn small soft handoff-btn', onclick: () => handoff({ agent, sessionId: id }) }, icon('swap', 'xs'), h('span', {}, `Ask ${SHORT_NAME[otherAgent(agent)]}`))
    : null;
  mount(page({
    section: 'sessions', title, subtitle: `${agentName(agent)} · ${baseName(s.cwd)}`, back: '#/',
    actions: h('div', { class: 'row actions' }, ask, rename, pin),
    body: [intro, thread.el, fab.btn], bottom,
  }));
  thread.add(data.messages, true);
  waitingChat = false;
  drawRunning();

  // After a reconnect (phone locked, network change) fetch what was written meanwhile:
  // the live tail only starts from the end of the file.
  let firstSub = true;
  state.resubscribe = async () => {
    wsSend({ type: 'sub-session', agent, id });
    if (firstSub) { firstSub = false; return; }
    try { const d = await api('GET', `/api/sessions/${agent}/${id}`); thread.add(d.messages); } catch { /* next reconnect */ }
  };
  state.resubscribe();
  state.onWs = (msg) => {
    if (msg.type === 'session-messages' && msg.id === id) {
      thread.add(msg.messages);
      if (waitingChat && msg.messages.some((m) => m.role === 'assistant')) { waitingChat = false; clearTimeout(chatWait); drawRunning(); }
    }
    if (msg.type === 'jobs') drawRunning();
  };
  state.cleanup = () => { wsSend({ type: 'unsub' }); fab.dispose(); clearTimeout(chatWait); };
}

async function renderNew() {
  const agents = state.me.agents;
  if (!agents.length) return mount(page({ tab: 'new', title: 'New prompt', body: h('p', {}, 'No agents enabled in the configuration.') }));
  let agent = prefs.get('lastAgent', agents[0].id);
  if (!agents.some((a) => a.id === agent)) agent = agents[0].id;
  const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Agent' });
  let c;
  const drawSeg = () => fill(seg, agents.map((a) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(a.id === agent), onclick: () => { agent = a.id; prefs.set('lastAgent', agent); drawSeg(); c.refresh(); } }, avatar(a.id), a.name)));

  const folder = folderPicker();

  c = composer({
    getAgent: () => agent,
    placeholder: 'What should the agent do?',
    dock: false,
    onSubmit: async (payload) => {
      const cwd = folder.get();
      const r = await api('POST', '/api/jobs', { agent, cwd, ...payload });
      prefs.set('lastCwd', cwd);
      state.jobStatus.set(r.job.id, 'running');
      location.hash = `#/j/${r.job.id}`;
      setTimeout(() => showWaitingRoom(r.job), 0);
    },
  });
  drawSeg();

  mount(page({
    tab: 'new', title: 'New prompt',
    body: h('div', { class: 'new-form' },
      h('div', { class: 'section-label' }, 'Agent'), seg,
      h('div', { class: 'section-label' }, 'Folder'),
      folder.el,
      h('div', { class: 'section-label' }, 'Prompt'),
      h('div', { class: 'notice small' }, icon('link', 'xs'), ' Messages continue the same chat for this agent and folder.'),
      c.form),
  }));
  c.ta.focus();
}

async function renderJob(id) {
  mount(page({ section: 'jobs', title: 'Activity', back: '#/jobs', body: h('div', { class: 'empty' }, h('span', { class: 'spinner' })) }));
  const stale = viewGuard();
  let data;
  try { data = await api('GET', `/api/jobs/${id}`); } catch (e) { quiet(e); return; }
  if (stale()) return;
  let job = data.job;
  const thread = threadView(job.agent);
  const head = h('div', { class: 'session-intro' });
  const fab = scrollDownButton();
  const drawHead = () => {
    const resumable = (job.agent === 'claude' || job.agent === 'codex') && job.sessionId;
    thread.setWorking(job.status === 'running', 'working…');
    fill(head,
      h('div', { class: 'row gap wrap' },
        h('span', { class: `tag status-${job.status}` }, job.status === 'running' ? h('span', { class: 'live-dot' }) : null, STATUS_LABELS[job.status] || job.status),
        job.fork ? h('span', { class: 'tag' }, icon('branch', 'xs'), 'copy') : null,
        h('span', { class: 'muted small' }, [job.model || 'default model', job.effort && (EFFORT_LABELS[job.effort] || job.effort), job.mode && (MODE_LABELS[job.mode] || job.mode).split(' — ')[0], job.images ? `${job.images} images` : null].filter(Boolean).join(' · '))),
      h('div', { class: 'folder big mt8' }, icon('folder', 'xs'), shortPath(job.cwd)),
      job.duo ? h('a', { class: 'notice small duo-link', href: `#/d/${job.duo.id}` }, icon('duo', 'xs'), `Part of a Claude + Codex duo (${ROLE_LABELS[job.duo.role] || job.duo.role}). Open the duo`) : null,
      h('div', { class: 'row gap wrap mt12' },
        job.status === 'running' ? h('button', { class: 'btn danger', onclick: () => api('POST', `/api/jobs/${id}/cancel`, {}).catch(quiet) }, icon('stop', 'xs'), 'Stop') : null,
        resumable ? h('a', { class: 'btn primary', href: `#/s/${job.agent}/${job.sessionId}` }, 'Open the conversation') : null,
        job.status === 'done' && state.me.duo && (job.agent === 'claude' || job.agent === 'codex')
          ? h('button', { class: 'btn soft', type: 'button', onclick: () => handoff({ agent: job.agent, jobId: job.id }) }, icon('swap', 'xs'), `Ask ${SHORT_NAME[otherAgent(job.agent)]}`) : null),
      thread.toggles);
  };
  mount(page({
    section: 'jobs', title: job.promptPreview, subtitle: `${agentName(job.agent)} · ${ago(job.started)}`, back: '#/jobs',
    body: [head, h('div', { class: 'thread' }, bubble({ role: 'user', text: data.prompt || job.promptPreview }, job.agent)), thread.el, fab.btn],
  }));
  drawHead();
  thread.add(data.events, true);

  state.resubscribe = async () => {
    wsSend({ type: 'sub-job', id });
    try { const d = await api('GET', `/api/jobs/${id}`); job = d.job; drawHead(); thread.add(d.events); } catch { /* ignore */ }
  };
  wsSend({ type: 'sub-job', id });
  state.onWs = (msg) => {
    if (msg.type === 'job-event' && msg.id === id) thread.add([msg.event]);
    if (msg.type === 'job-update' && msg.job.id === id) { job = msg.job; drawHead(); }
    if (msg.type === 'jobs') { const j = msg.jobs.find((x) => x.id === id); if (j) { job = j; drawHead(); } }
  };
  state.cleanup = () => { wsSend({ type: 'unsub' }); fab.dispose(); };
}

function renderJobs() {
  const listEl = h('div', { class: 'groups' });
  const row = (j) => h('a', { class: 'row-item', href: `#/j/${j.id}` },
    avatar(j.agent),
    h('div', { class: 'grow' },
      h('div', { class: 'row-top' }, h('span', { class: 't' }, j.promptPreview), h('span', { class: 'time' }, relTime(j.started))),
      h('div', { class: 'row-sub' },
        j.status === 'running' ? h('span', { class: 'tag live' }, h('span', { class: 'live-dot' }), 'running') : h('span', { class: `tag status-${j.status}` }, STATUS_LABELS[j.status] || j.status),
        j.fork ? h('span', { class: 'tag subtle' }, 'copy') : null,
        j.duo ? h('span', { class: 'tag subtle' }, icon('duo', 'xs'), ROLE_LABELS[j.duo.role] || 'duo') : null,
        h('span', { class: 'folder' }, icon('folder', 'xs'), baseName(j.cwd)))));
  const draw = () => {
    if (!state.jobs.length && !state.duos.length) return fill(listEl, h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, icon('activity')), h('p', {}, 'No activity since the server started.'), h('a', { class: 'btn primary', href: '#/new' }, icon('plus', 'xs'), 'New prompt')));
    const running = state.jobs.filter((j) => j.status === 'running');
    const rest = state.jobs.filter((j) => j.status !== 'running');
    fill(listEl,
      state.duos.length ? h('section', { class: 'group' }, h('h2', { class: 'group-title' }, 'Duos'), h('div', { class: 'card list-card' }, state.duos.slice(0, 5).map(duoRow))) : null,
      running.length ? h('section', { class: 'group' }, h('h2', { class: 'group-title' }, 'Running'), h('div', { class: 'card list-card' }, running.map(row))) : null,
      rest.length ? h('section', { class: 'group' }, h('h2', { class: 'group-title' }, 'Finished'), h('div', { class: 'card list-card' }, rest.map(row))) : null);
  };
  mount(page({ tab: 'jobs', title: 'Activity', subtitle: 'Prompts sent from this app', body: listEl }));
  draw();
  api('GET', '/api/jobs').then((r) => { state.jobs = r.jobs; trackJobs(r.jobs); draw(); }).catch(quiet);
  state.onWs = (msg) => { if (msg.type === 'jobs' || msg.type === 'duos') draw(); };
}

// ---------- duo: Claude + Codex together ----------

const DUO_KINDS = {
  review: { label: 'Review', hint: 'One does the task, the other checks it.' },
  compare: { label: 'Compare', hint: 'Both answer the same question. Nobody edits files.' },
};

function duoSteps(duo) {
  return h('ol', { class: 'duo-steps' }, duo.steps.map((st, i) => h('li', { class: `duo-step status-${st.status}` },
    h('span', { class: 'n' }, String(i + 1)), avatar(st.agent),
    h('div', { class: 'grow' }, h('div', { class: 't' }, `${SHORT_NAME[st.agent]} ${ROLE_LABELS[st.role] || st.role}`),
      h('div', { class: 'muted small' }, st.status === 'running' ? h('span', { class: 'row gap' }, h('span', { class: 'live-dot' }), 'working…') : STATUS_LABELS[st.status] || st.status)))));
}

function duoPlan(kind, lead, apply) {
  const partner = otherAgent(lead);
  const steps = kind === 'compare'
    ? [{ agent: lead, role: 'answer' }, { agent: partner, role: 'answer' }]
    : [{ agent: lead, role: 'work' }, { agent: partner, role: 'review' }, ...(apply ? [{ agent: lead, role: 'apply' }] : [])];
  return duoSteps({ steps: steps.map((st) => ({ ...st, status: 'waiting' })) });
}

async function renderDuoNew() {
  if (!state.me.duo) {
    return mount(page({ tab: 'duo', title: 'Duo', body: h('div', { class: 'empty' }, h('p', {}, 'Duo needs both Claude Code and Codex enabled in the PC configuration.')) }));
  }
  let kind = prefs.get('duo.kind', 'review');
  let lead = prefs.get('duo.lead', 'codex');
  let apply = prefs.get('duo.apply', true);
  if (!DUO_KINDS[kind]) kind = 'review';
  if (!['claude', 'codex'].includes(lead)) lead = 'codex';
  const kindSeg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Kind' });
  const leadSeg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Who leads' });
  const plan = h('div', { class: 'card pad duo-plan' });
  const applyRow = h('label', { class: 'switch-row' }, h('span', {}, 'Then let the lead apply the fixes'),
    h('input', { type: 'checkbox', class: 'switch', checked: apply, onchange: (e) => { apply = e.target.checked; prefs.set('duo.apply', apply); draw(); } }));
  const folder = folderPicker();
  let c;
  const draw = () => {
    fill(kindSeg, Object.entries(DUO_KINDS).map(([k, v]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(k === kind), onclick: () => { kind = k; prefs.set('duo.kind', k); draw(); } }, v.label)));
    fill(leadSeg, ['codex', 'claude'].map((a) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(a === lead), onclick: () => { lead = a; prefs.set('duo.lead', a); draw(); c.refresh(); } }, avatar(a), kind === 'compare' ? `${SHORT_NAME[a]} first` : `${SHORT_NAME[a]} leads`)));
    applyRow.hidden = kind !== 'review';
    fill(plan, h('p', { class: 'muted small' }, DUO_KINDS[kind].hint), duoPlan(kind, lead, apply));
  };
  c = composer({
    getAgent: () => lead,
    placeholder: kind === 'compare' ? 'Ask both…' : 'What should they do?',
    dock: false,
    allowImages: false,
    onSubmit: async ({ prompt, model, effort, mode }) => {
      const cwd = folder.get();
      const r = await api('POST', '/api/duos', {
        kind, lead, cwd, prompt, apply,
        options: { [lead]: { model, effort, mode } },
        reviewInstruction: prefs.get('duo.reviewInstruction', '') || undefined,
      });
      prefs.set('lastCwd', cwd);
      location.hash = `#/d/${r.duo.id}`;
    },
  });
  draw();
  const recent = h('div', {});
  const drawRecent = () => fill(recent, state.duos.length ? h('section', { class: 'group' }, h('h2', { class: 'group-title' }, 'Recent duos'), h('div', { class: 'card list-card' }, state.duos.slice(0, 10).map(duoRow))) : null);
  mount(page({
    tab: 'duo', title: 'Duo', subtitle: 'Claude Code and Codex on the same task',
    body: h('div', { class: 'new-form' },
      h('div', { class: 'section-label' }, 'How'), kindSeg,
      h('div', { class: 'section-label' }, 'Who starts'), leadSeg,
      plan, h('div', { class: 'card pad' }, applyRow),
      h('div', { class: 'section-label' }, 'Folder'), folder.el,
      h('div', { class: 'section-label' }, 'Task'), c.form,
      recent),
  }));
  drawRecent();
  api('GET', '/api/duos').then((r) => { state.duos = r.duos; drawRecent(); }).catch(() => {});
  state.onWs = (msg) => { if (msg.type === 'duos') drawRecent(); };
}

function duoRow(d) {
  return h('a', { class: 'row-item', href: `#/d/${d.id}` },
    h('span', { class: 'avatar duo' }, icon('duo', 'sm')),
    h('div', { class: 'grow' },
      h('div', { class: 'row-top' }, h('span', { class: 't' }, d.promptPreview), h('span', { class: 'time' }, relTime(d.started))),
      h('div', { class: 'row-sub' },
        h('span', { class: `tag status-${d.status}` }, d.status === 'running' ? h('span', { class: 'live-dot' }) : null, STATUS_LABELS[d.status] || d.status),
        h('span', {}, `${DUO_KINDS[d.kind]?.label || d.kind} · ${SHORT_NAME[d.lead]} + ${SHORT_NAME[d.partner]}`),
        h('span', { class: 'folder' }, icon('folder', 'xs'), baseName(d.cwd)))));
}

async function renderDuo(id) {
  mount(page({ section: 'duo', title: 'Duo', back: '#/duo', body: h('div', { class: 'empty' }, h('span', { class: 'spinner' })) }));
  const stale = viewGuard();
  let data;
  try { data = await api('GET', `/api/duos/${id}`); } catch (e) { quiet(e); return; }
  if (stale()) return;
  let duo = data.duo;
  const head = h('div', { class: 'session-intro' });
  const tabs = h('div', { class: 'segmented duo-tabs', role: 'tablist' });
  const panels = h('div', { class: 'duo-panels' });
  const views = new Map(); // jobId -> { panel, thread }
  let active = 0;

  const drawHead = () => {
    fill(head,
      h('div', { class: 'row gap wrap' },
        h('span', { class: `tag status-${duo.status}` }, duo.status === 'running' ? h('span', { class: 'live-dot' }) : null, STATUS_LABELS[duo.status] || duo.status),
        h('span', { class: 'muted small' }, `${DUO_KINDS[duo.kind]?.label || duo.kind} · ${ago(duo.started)}`)),
      h('div', { class: 'folder big mt8' }, icon('folder', 'xs'), shortPath(duo.cwd)),
      h('div', { class: 'card pad mt12 duo-task' }, h('div', { class: 'muted small' }, 'Task'), h('div', { class: 'md' }, markdown(data.prompt || duo.promptPreview))),
      duoSteps(duo),
      duo.error ? h('div', { class: 'notice warn small' }, duo.error) : null,
      duo.status === 'running' ? h('button', { class: 'btn danger mt8', type: 'button', onclick: () => api('POST', `/api/duos/${id}/cancel`, {}).catch(quiet) }, icon('stop', 'xs'), 'Stop the duo') : null);
    const started = duo.steps.filter((st) => st.jobId);
    fill(tabs, started.map((st, i) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(i === active), onclick: () => { active = i; drawHead(); } }, avatar(st.agent), `${i + 1}. ${SHORT_NAME[st.agent]}`)));
    tabs.hidden = started.length < 2;
    panels.setAttribute('data-count', String(started.length));
    started.forEach((st, i) => {
      let v = views.get(st.jobId);
      if (!v) {
        const thread = threadView(st.agent);
        const panel = h('section', { class: 'duo-panel' },
          h('div', { class: 'duo-panel-head' }, avatar(st.agent), h('strong', {}, `${i + 1}. ${SHORT_NAME[st.agent]} ${ROLE_LABELS[st.role] || st.role}`),
            h('a', { class: 'btn small ghost', href: `#/j/${st.jobId}` }, 'Details')),
          thread.el);
        v = { panel, thread };
        views.set(st.jobId, v);
        panels.append(panel);
        api('GET', `/api/jobs/${st.jobId}`).then((d) => { thread.add(d.events, false); thread.setWorking(d.job.status === 'running', 'working…'); }).catch(() => {});
        subscribe();
      }
      v.panel.classList.toggle('active', i === active);
      v.thread.setWorking(st.status === 'running', 'working…');
    });
  };
  const subscribe = () => wsSend({ type: 'sub-jobs', ids: [...views.keys()] });

  mount(page({
    section: 'duo', title: duo.promptPreview, subtitle: `${SHORT_NAME[duo.lead]} + ${SHORT_NAME[duo.partner]}`, back: '#/duo',
    body: [head, tabs, panels],
  }));
  drawHead();
  state.resubscribe = subscribe;
  state.onWs = (msg) => {
    if (msg.type === 'duos') {
      const d = msg.duos.find((x) => x.id === id);
      if (d) { duo = d; drawHead(); }
    }
    if (msg.type === 'job-event') views.get(msg.id)?.thread.add([msg.event]);
  };
  state.cleanup = () => wsSend({ type: 'unsub' });
}

// ---------- settings ----------

function describeUa(ua = '') {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Code\/[\d.]+/.test(ua) ? 'VS Code' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}

const AUDIT_LABELS = {
  login_ok: ['✓', 'Signed in'], login_failed: ['✕', 'Sign-in failed'], login_blocked: ['⛔', 'Sign-in blocked'],
  logout: ['↩', 'Signed out'], logout_all: ['⏻', 'All devices signed out'], device_revoked: ['⏻', 'Device signed out'],
  job_start: ['▶', 'Prompt sent'], job_end: ['■', 'Job ended'], job_cancel: ['■', 'Job stopped'],
  server_start: ['⚙', 'Server started'], lockout_cleared_locally: ['🔓', 'Lockout cleared on the PC'],
  duo_start: ['⇄', 'Duo started'], duo_end: ['⇄', 'Duo ended'], duo_cancel: ['■', 'Duo stopped'], handoff: ['⇄', 'Reply passed to the other agent'],
  chat_delivery: ['▶', 'Prompt sent to the VS Code chat'], codex_locked_retry: ['↻', 'Codex chat busy, retrying'],
};
const FAIL_REASONS = { password: 'wrong password', totp: 'wrong 2FA code', totp_replay: '2FA code already used', recovery: 'wrong recovery code', malformed: 'invalid request', totp_decrypt: '2FA secret error' };

/** A row of buttons bound to one setting. */
function segmentedPref(key, def, options, after) {
  const el = h('div', { class: 'segmented small', role: 'radiogroup' });
  const draw = () => fill(el, options.map(([v, label]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(prefs.get(key, def) === v), 'data-value': v, onclick: () => { prefs.set(key, v); draw(); after?.(v); } }, label)));
  draw();
  return el;
}

/** Editable list of short texts (quick prompts, handoff instructions). */
function listEditor(key, defaults, { placeholder, max = 12, maxLength = 300 } = {}) {
  const el = h('div', { class: 'list-editor' });
  const read = () => { const v = prefs.get(key, null); return Array.isArray(v) ? v : [...defaults]; };
  const write = (list) => prefs.set(key, list.map((x) => x.slice(0, maxLength)).slice(0, max));
  const draw = () => {
    const list = read();
    fill(el,
      list.map((item, i) => {
        const input = h('input', { type: 'text', value: item, maxlength: String(maxLength), 'aria-label': `Item ${i + 1}`, placeholder });
        input.addEventListener('change', () => { const next = read(); next[i] = input.value.trim(); write(next.filter(Boolean)); draw(); });
        return h('div', { class: 'list-row' }, input,
          h('button', { type: 'button', class: 'icon-btn ghost', 'aria-label': `Move item ${i + 1} up`, disabled: i === 0, onclick: () => { const next = read(); [next[i - 1], next[i]] = [next[i], next[i - 1]]; write(next); draw(); } }, '↑'),
          h('button', { type: 'button', class: 'icon-btn ghost', 'aria-label': `Remove item ${i + 1}`, onclick: () => { const next = read(); next.splice(i, 1); write(next); draw(); } }, icon('trash', 'sm')));
      }),
      h('div', { class: 'row gap mt8' },
        list.length < max ? h('button', { type: 'button', class: 'btn small soft', onclick: () => { write([...read(), 'New prompt']); draw(); el.querySelector('.list-row:last-of-type input')?.select(); } }, icon('plus', 'xs'), 'Add') : null,
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => { prefs.set(key, undefined); draw(); } }, 'Reset to defaults')));
  };
  draw();
  return el;
}

async function renderSettings(sub = '') {
  const section = (title, id, ...body) => h('section', { class: 'group', id: id || null }, h('h2', { class: 'group-title' }, title), h('div', { class: 'card pad' }, ...body));
  const defaults = state.me.agents.filter((a) => a.models.length || a.modes.length).map((a) =>
    h('div', { class: 'sub' }, h('div', { class: 'sub-title' }, avatar(a.id), a.name), agentOptions(a.id, { asFields: true }).el));
  const select = (label, options, value, on) => {
    const s = h('select', { 'aria-label': label }, options.map(([v, t]) => h('option', { value: v }, t)));
    s.value = value;
    s.addEventListener('change', () => on(s.value));
    return s;
  };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voiceInfo = state.me.voice
    ? 'Local transcription on the PC (Whisper). Audio never leaves your computer.'
    : SR ? 'Whisper is not installed on the PC, so the browser\'s speech recognition is used (audio goes through Apple or Google servers).'
      : 'Microphone not available. Use the keyboard\'s microphone key.';
  const check = (key, def, label, after) => h('label', { class: 'switch-row' }, h('span', {}, label), h('input', { type: 'checkbox', class: 'switch', checked: prefs.get(key, def), onchange: (e) => { prefs.set(key, e.target.checked); after?.(e.target.checked); } }));
  const field = (label, control, hint) => h('div', { class: 'field' }, h('span', {}, label), control, hint ? h('p', { class: 'muted small mt8' }, hint) : null);

  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Accent colour' });
  const drawSwatches = () => fill(swatches, ACCENTS.map(([v, label]) => h('button', { type: 'button', role: 'radio', class: 'swatch', 'data-swatch': v, 'aria-label': label, title: label, 'aria-checked': String(prefs.get('accent', 'violet') === v), onclick: () => { prefs.set('accent', v); applyAppearance(); drawSwatches(); } }, icon('check', 'xs'))));
  drawSwatches();

  const review = h('textarea', { rows: '4', maxlength: '4000', placeholder: 'Default: list concrete problems from most to least severe, each with file:line and a fix. Do not edit files.', 'aria-label': 'Review instruction' });
  review.value = prefs.get('duo.reviewInstruction', '');
  review.addEventListener('change', () => prefs.set('duo.reviewInstruction', review.value.trim()));

  const devicesEl = h('div', {}, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
  const auditEl = h('ul', { class: 'audit' });
  const serverEl = h('dl', { class: 'kv' });
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
  const names = Object.keys(prefs.get('names', {})).length;

  mount(page({
    tab: 'settings', title: 'Settings', subtitle: 'Saved on the PC, the same on all your devices',
    body: [
      h('nav', { class: 'chips settings-nav', 'aria-label': 'Sections' },
        [['appearance', 'Appearance'], ['personalize', 'Personalize'], ['agents', 'Agents'], ['devices', 'Devices'], ['security', 'Security'], ['server', 'Server']]
          .map(([id, label]) => h('a', { class: 'chip', href: `#/settings/${id}` }, label))),
      standalone ? null : section('Install as an app', 'install',
        h('p', { class: 'small' }, 'iPhone: in Safari tap ', h('strong', {}, 'Share → Add to Home Screen'), '. Android: menu ⋮ → ', h('strong', {}, 'Add to Home screen'), '. It opens full screen, like an app.'),
        state.installPrompt ? h('button', { class: 'btn primary full mt12', onclick: async () => {
          await state.installPrompt.prompt();
          state.installPrompt = null;
        } }, 'Install Agent Bridge') : null),
      section('Appearance', 'appearance',
        field('Theme', segmentedPref('theme', 'auto', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark'], ['black', 'Black']], applyAppearance)),
        field('Accent colour', swatches),
        field('Text size', segmentedPref('textSize', 'm', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'Extra large']], applyAppearance)),
        field('Density', segmentedPref('density', 'comfortable', [['comfortable', 'Comfortable'], ['compact', 'Compact']], applyAppearance)),
        field('Chat style', segmentedPref('chatStyle', 'bubbles', [['bubbles', 'Bubbles'], ['minimal', 'Minimal']], applyAppearance)),
        check('showTools', true, 'Show steps (commands, files, output)'), check('showMeta', false, 'Show system context')),
      section('Personalize', 'personalize',
        field('Open the app on', segmentedPref('startPage', 'sessions', [['sessions', 'Chats'], ['new', 'New'], ...(state.me.duo ? [['duo', 'Duo']] : []), ['jobs', 'Activity']])),
        field('Quick prompts', listEditor('quickPrompts', DEFAULT_QUICK_PROMPTS, { placeholder: 'e.g. Run the tests' }), 'Shown above the text box: tap one to insert it.'),
        check('showQuick', true, 'Show quick prompts above the text box'),
        state.me.duo ? field('“Ask the other agent” instructions', listEditor('handoffPresets', HANDOFF_PRESETS.map(([t]) => t), { placeholder: 'e.g. Review this', max: 8, maxLength: 400 })) : null,
        state.me.duo ? field('Duo review instruction', review, 'What the reviewer is asked to do. Leave empty for the default.') : null,
        names ? h('button', { type: 'button', class: 'btn small ghost mt8', onclick: () => { prefs.set('names', {}); renderSettings('personalize'); } }, `Forget ${names} custom chat name${names === 1 ? '' : 's'}`) : null),
      section('Defaults for new prompts', 'agents', h('p', { class: 'muted small' }, 'You can change them for each prompt with the pills above the text box.'), defaults),
      section('While waiting', 'waiting', h('label', { class: 'field' }, h('span', {}, 'Activity after sending a prompt'),
        select('Activity while waiting', [['happydev', 'HappyDEV · 5 games'], ['reels', 'Instagram Reels'], ['none', 'Nothing, stay in the chat']], prefs.get('waitingActivity', 'happydev'), (v) => prefs.set('waitingActivity', v))),
        h('p', { class: 'muted small' }, 'You can also change this in the panel that appears after sending.')),
      section('Voice', 'voice', h('label', { class: 'field' }, h('span', {}, 'Voice note language'),
        select('Language', [['', 'Automatic'], ['en', 'English'], ['it', 'Italiano'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch']], prefs.get('voiceLang', ''), (v) => prefs.set('voiceLang', v))),
        h('p', { class: 'muted small' }, voiceInfo)),
      section('Sync', 'sync',
        check('sync', true, 'Use the same settings on all my devices', (on) => { if (on) syncPrefs().then(() => renderSettings()); }),
        h('p', { class: 'muted small' }, 'Settings are stored on the PC. Turn this off to keep this device different.')),
      section('Connected devices', 'devices', devicesEl,
        h('button', { class: 'btn danger full mt12', onclick: async () => {
          if (!confirm('Sign out ALL devices and stop all running jobs?')) return;
          await api('POST', '/api/logout-all', {}).catch(() => {});
          onLoggedOut();
        } }, 'Sign out all and stop jobs'),
        h('button', { class: 'btn ghost full mt8', onclick: async () => { await api('POST', '/api/logout', {}).catch(() => {}); onLoggedOut(); } }, 'Sign out of this device')),
      section('Security log', 'security', h('p', { class: 'muted small' }, 'Recent sign-ins and prompts (prompt text is not stored).'), auditEl),
      section('Server', 'server', h('p', { class: 'muted small' }, 'Read-only. For security, these settings can only be changed on the PC.'), serverEl),
    ],
  }));
  if (sub) requestAnimationFrame(() => document.getElementById(sub)?.scrollIntoView({ block: 'start' }));

  const loadDevices = async () => {
    const { devices } = await api('GET', '/api/devices');
    fill(devicesEl, devices.map((d) => h('div', { class: 'device' },
      h('span', { class: 'device-ic' }, icon('screen', 'sm')),
      h('div', { class: 'grow' },
        h('div', { class: 't' }, describeUa(d.ua), d.current ? h('span', { class: 'tag status-done ml6' }, 'this device') : null),
        h('div', { class: 'muted small' }, `active ${ago(d.lastSeen)} · ${d.from || '?'}`)),
      h('button', { class: 'btn small danger', onclick: async () => {
        const r = await api('POST', '/api/devices/revoke', { id: d.id });
        if (r.self) onLoggedOut(); else loadDevices();
      } }, 'Sign out'))));
  };
  const loadAudit = async () => {
    const { events } = await api('GET', '/api/audit');
    fill(auditEl, events.slice(0, 60).map((e) => {
      const [ic, label] = AUDIT_LABELS[e.event] || ['•', e.event];
      const detail = [e.reason && (FAIL_REASONS[e.reason] || e.reason), e.agent, e.model, e.status, e.fork && 'copy', e.images && `${e.images} img`, e.ua && describeUa(e.ua), e.forwardedFor].filter(Boolean).join(' · ');
      return h('li', { class: e.event === 'login_failed' || e.event === 'login_blocked' ? 'bad' : '' },
        h('span', { class: 'aic' }, ic), h('div', { class: 'grow' }, h('div', {}, label), h('div', { class: 'muted small' }, `${new Date(e.ts).toLocaleString('en-GB')}${detail ? ` · ${detail}` : ''}`)));
    }));
  };
  const loadServer = async () => {
    const i = await api('GET', '/api/server-info');
    fill(serverEl, [
      ['PC', i.host], ['Folders', i.workspaces.map(shortPath).join(', ')], ['Remote address', i.allowedOrigins.join(', ') || '—'],
      ['Sign-in expiry', `${i.sessionIdleMinutes} min idle · max ${i.sessionMaxHours} h`], ['Dangerous modes', i.allowDangerousModes ? '⚠ on' : 'off'],
      ['Jobs', `max ${i.maxConcurrentJobs} at once · timeout ${i.jobTimeoutMinutes} min`], ['Claude Code', i.versions.claude || '—'], ['Codex', i.versions.codex || '—'],
      ['Local voice', i.voice ? 'Whisper installed' : 'not installed'], ['Configuration', shortPath(i.configPath)],
    ].flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  };
  await Promise.all([loadDevices(), loadAudit(), loadServer()].map((p) => p.catch(quiet)));
}

// ---------- router ----------

function route() {
  if (!state.csrf) return;
  const hash = location.hash || '#/';
  state.route = hash;
  viewSeq++;
  let m;
  if ((m = hash.match(/^#\/s\/(claude|codex)\/([0-9a-f-]{36})$/i))) return renderSession(m[1], m[2]);
  if ((m = hash.match(/^#\/j\/([0-9a-f-]{36})$/))) return renderJob(m[1]);
  if ((m = hash.match(/^#\/d\/([0-9a-f-]{36})$/))) return renderDuo(m[1]);
  if (hash === '#/duo') return renderDuoNew();
  if (hash.startsWith('#/settings')) return renderSettings(hash.split('/')[2] || '');
  if (hash === '#/new') return renderNew();
  if (hash === '#/jobs') return renderJobs();
  return renderSessions();
}

async function boot() {
  const hadSession = !!state.csrf;
  try {
    state.me = await api('GET', '/api/me');
    state.csrf = state.me.csrf;
  } catch (e) {
    if (!(e instanceof AuthError)) renderLogin(e.message);
    else if (!hadSession) renderLogin();
    return;
  }
  await syncPrefs();
  applyAppearance();
  connectWs();
  if (!hadSession && (location.hash || '#/') === '#/' && prefs.get('startPage', 'sessions') !== 'sessions') {
    history.replaceState(null, '', { new: '#/new', duo: '#/duo', jobs: '#/jobs' }[prefs.get('startPage')] || '#/');
  }
  route();
}

window.addEventListener('hashchange', route);
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.installPrompt = event;
});
document.addEventListener('pointerdown', (event) => {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement && !event.target.closest('.inputbar')) active.blur();
}, { passive: true });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
boot();
