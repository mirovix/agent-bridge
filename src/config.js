import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isInside } from './platform.js';

export const DATA_DIR = process.env.AGENT_BRIDGE_HOME || path.join(os.homedir(), '.agent-bridge');
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
export const SECRETS_PATH = path.join(DATA_DIR, 'secrets.json');
export const AUDIT_PATH = path.join(DATA_DIR, 'audit.log');

export const DEFAULT_CONFIG = {
  // Never change this to 0.0.0.0: remote access must go through Tailscale / a tunnel.
  host: '127.0.0.1',
  port: 8765,
  // Public origins the browser will use, e.g. "https://my-pc.tailXXXX.ts.net".
  allowedOrigins: [],
  // Agents can only run inside these directories (and their subdirectories).
  workspaces: [path.join(os.homedir(), 'workspace')],
  sessionIdleMinutes: 30,
  sessionMaxHours: 12,
  // Enables bypassPermissions (Claude) and danger-full-access (Codex). Keep false.
  allowDangerousModes: false,
  maxConcurrentJobs: 3,
  jobTimeoutMinutes: 60,
  maxPromptChars: 20000,
  // Reuse one Codex app-server with VS Code, avoiding thread writer conflicts.
  codexSharedDaemon: true,
  agents: {
    claude: { enabled: true, command: 'claude' },
    codex: { enabled: true, command: 'codex' },
    // Extra agents. The prompt is written to stdin, or substituted into args as "{prompt}".
    // Commands are spawned directly, never through a shell.
    // Example: { "id": "gemini", "name": "Gemini CLI", "command": "gemini", "args": ["-p", "{prompt}"] }
    custom: [],
  },
};

// Windows has no POSIX permission bits (chmod only toggles read-only and stat
// always reports 0666); files under the user profile are private through its ACL.
const POSIX_MODES = process.platform !== 'win32';

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (POSIX_MODES) fs.chmodSync(DATA_DIR, 0o700);
}

/** rename() that tolerates Windows' transient locks (antivirus, indexer, readers). */
export function replaceFile(tmp, file) {
  for (let attempt = 0; ; attempt++) {
    try { return fs.renameSync(tmp, file); } catch (e) {
      if (!POSIX_MODES && ['EPERM', 'EACCES', 'EBUSY'].includes(e.code) && attempt < 10) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
        continue;
      }
      try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
      throw e;
    }
  }
}

export function writePrivateJson(file, data) {
  ensureDataDir();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  replaceFile(tmp, file);
  if (POSIX_MODES) fs.chmodSync(file, 0o600);
}

function checkPrivate(file) {
  if (!POSIX_MODES) return;
  const st = fs.statSync(file);
  if (st.mode & 0o077) {
    throw new Error(`${file} is readable by other users (mode ${(st.mode & 0o777).toString(8)}). Run: chmod 600 ${file}`);
  }
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
    throw new Error(`${file} is not owned by the current user`);
  }
}

export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  checkPrivate(CONFIG_PATH);
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const cfg = { ...DEFAULT_CONFIG, ...raw, agents: { ...DEFAULT_CONFIG.agents, ...(raw.agents || {}) } };
  cfg.workspaces = cfg.workspaces.map((w) => path.resolve(w));
  cfg.allowedOrigins = cfg.allowedOrigins.map((o) => new URL(o).origin);
  if (!['127.0.0.1', '::1', 'localhost'].includes(cfg.host)) {
    throw new Error(`Refusing to listen on ${cfg.host}: bind to 127.0.0.1 and use Tailscale Serve for remote access.`);
  }
  for (const c of cfg.agents.custom || []) {
    if (!/^[a-z0-9-]{1,32}$/.test(c.id || '') || ['claude', 'codex'].includes(c.id)) {
      throw new Error(`Invalid custom agent id: ${c.id}`);
    }
    if (typeof c.command !== 'string' || !c.command) throw new Error(`Custom agent ${c.id} has no command`);
  }
  return cfg;
}

export function loadSecrets() {
  if (!fs.existsSync(SECRETS_PATH)) return null;
  checkPrivate(SECRETS_PATH);
  return JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8'));
}

export function saveSecrets(secrets) {
  writePrivateJson(SECRETS_PATH, secrets);
}

/** Resolve `dir` and return its real path only if it lies inside an allowed workspace. */
export function resolveWorkspaceDir(cfg, dir) {
  if (typeof dir !== 'string' || !dir || dir.includes('\0')) return null;
  let real;
  try {
    real = fs.realpathSync(path.resolve(dir));
    if (!fs.statSync(real).isDirectory()) return null;
  } catch {
    return null;
  }
  for (const ws of cfg.workspaces) {
    let root;
    try { root = fs.realpathSync(ws); } catch { continue; }
    if (isInside(real, root)) return real;
  }
  return null;
}
