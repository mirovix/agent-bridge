// Small OS abstraction layer: command lookup, safe spawning of Windows .cmd shims,
// process-tree kills and per-OS paths. On Linux/macOS every helper is a no-op
// passthrough, so POSIX behaviour stays exactly as before.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const IS_WINDOWS = process.platform === 'win32';

// ---------- command lookup ----------

/**
 * Find `command` on PATH the way a shell would. Returns an absolute path, or null.
 * On Windows this honours PATHEXT (claude -> claude.cmd / claude.exe).
 */
export function which(command, { env = process.env, platform = process.platform } = {}) {
  if (typeof command !== 'string' || !command) return null;
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const exts = win
    ? (env.PATHEXT || env.Pathext || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const hasExt = win && exts.some((e) => command.toLowerCase().endsWith(e.toLowerCase()));
  const candidates = (base) => (win ? (hasExt ? [base] : [base, ...exts.map((e) => base + e)]) : [base]);
  const isFile = (f) => {
    try {
      const st = fs.statSync(f);
      if (!st.isFile()) return false;
      if (!win) fs.accessSync(f, fs.constants.X_OK);
      return true;
    } catch { return false; }
  };
  if (command.includes('/') || (win && command.includes('\\'))) {
    // A path (absolute or relative): only try the extensions, never search PATH.
    const base = p.resolve(command);
    return candidates(base).find(isFile) || null;
  }
  const dirs = (env.PATH || env.Path || '').split(win ? ';' : ':').filter(Boolean);
  for (const dir of dirs) {
    const hit = candidates(p.join(dir.replace(/^"(.*)"$/, '$1'), command)).find(isFile);
    if (hit) return hit;
  }
  return null;
}

// ---------- spawning ----------

// cmd.exe metacharacters (same set cross-spawn uses).
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** Quote one argument for cmd.exe running a batch file (escaped twice: the batch
 *  file re-parses %* once more). Follows the well-tested cross-spawn algorithm. */
export function escapeCmdArg(arg) {
  let s = String(arg);
  s = s.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  s = s.replace(/(?=(\\+?)?)\1$/, '$1$1');
  s = `"${s}"`;
  return s.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

const escapeCmdCommand = (cmd) => String(cmd).replace(CMD_META, '^$1');

/** npm "cmd-shim" wrappers end in: "%_prog%"  "%dp0%\node_modules\pkg\cli.js" %*
 *  Returns the absolute target script/binary, or null if the file is not such a shim. */
export function readCmdShimTarget(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const m = text.match(/"%(?:~)?dp0%\\?([^"%]+)"\s+%\*/i);
  if (!m) return null;
  const target = path.win32.resolve(path.win32.dirname(file), m[1]);
  try { return fs.statSync(target).isFile() ? target : null; } catch { return null; }
}

/**
 * Turn (command, args) into something child_process.spawn can run without a shell.
 * - POSIX: returned unchanged.
 * - Windows .exe/.com: resolved absolute path, spawned directly.
 * - Windows npm .cmd shim pointing at a JS file: run that file with node directly.
 * - Other .cmd/.bat: run through `cmd.exe /d /s /c` with every argument escaped;
 *   callers can forbid this with { allowBatch: false } (e.g. for free-form prompt text).
 * Throws an Error with code 'ENOENT' when the command cannot be found.
 */
export function resolveSpawn(command, args = [], { env = process.env, platform = process.platform, allowBatch = true } = {}) {
  if (platform !== 'win32') return { command, args, options: {} };
  const file = which(command, { env, platform });
  if (!file) throw Object.assign(new Error(`Command not found: ${command}`), { code: 'ENOENT' });
  const ext = path.win32.extname(file).toLowerCase();
  if (ext !== '.cmd' && ext !== '.bat') return { command: file, args, options: { windowsHide: true } };
  const target = readCmdShimTarget(file);
  if (target && /\.(c|m)?js$/i.test(target)) {
    const localNode = path.win32.join(path.win32.dirname(file), 'node.exe');
    const node = fs.existsSync(localNode) ? localNode : process.execPath;
    return { command: node, args: [target, ...args], options: { windowsHide: true } };
  }
  if (target && /\.(exe|com)$/i.test(target)) return { command: target, args, options: { windowsHide: true } };
  if (!allowBatch) {
    throw Object.assign(new Error(`${path.win32.basename(file)} is a batch file: pass the prompt on stdin instead of in the arguments`), { code: 'EBATCH' });
  }
  const line = [escapeCmdCommand(file), ...args.map(escapeCmdArg)].join(' ');
  return {
    command: env.ComSpec || env.COMSPEC || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    options: { windowsHide: true, windowsVerbatimArguments: true },
  };
}

/** spawn() with Windows command resolution. POSIX: identical to child_process.spawn. */
export function spawnCommand(command, args, options = {}, { allowBatch = true } = {}) {
  const r = resolveSpawn(command, args, { env: options.env || process.env, allowBatch });
  return spawn(r.command, r.args, { ...options, ...r.options });
}

/** spawnSync() counterpart of spawnCommand. Errors are returned in `.error`. */
export function spawnCommandSync(command, args, options = {}) {
  let r;
  try { r = resolveSpawn(command, args, { env: options.env || process.env }); } catch (error) { return { error, status: null, stdout: '', stderr: '' }; }
  return spawnSync(r.command, r.args, { ...options, ...r.options });
}

// ---------- killing ----------

/** Options that let killTree() reach grandchildren. POSIX: own process group. */
export const treeSpawnOptions = () => (IS_WINDOWS ? { windowsHide: true } : { detached: true });

/**
 * Terminate a child and everything it started.
 * POSIX: signal the process group (child must be spawned with treeSpawnOptions()).
 * Windows: there are no signals or process groups; `taskkill /T` ends the tree.
 */
export function killTree(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  if (IS_WINDOWS) {
    if (child.exitCode !== null || child.signalCode !== null) return; // pid may be reused
    const args = ['/pid', String(child.pid), '/T'];
    if (signal === 'SIGKILL') args.push('/F');
    const tk = spawn('taskkill', args, { stdio: 'ignore', windowsHide: true });
    tk.on('error', () => { try { child.kill(); } catch { /* already gone */ } });
    tk.on('close', (code) => {
      // Console programs often ignore the polite request: force it straight away.
      if (code !== 0 && signal !== 'SIGKILL' && child.exitCode === null) killTree(child, 'SIGKILL');
    });
    return;
  }
  try { process.kill(-child.pid, signal); } catch { /* already gone */ }
}

// ---------- paths ----------

/** Case-insensitive file systems compare paths without case (Windows). */
export function samePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  a = path.resolve(a);
  b = path.resolve(b);
  return IS_WINDOWS ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** True when `child` equals `root` or lies inside it. */
export function isInside(child, root) {
  const norm = (p) => (IS_WINDOWS ? p.toLowerCase() : p);
  const c = norm(child);
  const r = norm(root);
  if (c === r) return true;
  return c.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/** Python executable inside a virtualenv. */
export function venvPython(venvDir, platform = process.platform) {
  return platform === 'win32'
    ? path.win32.join(venvDir, 'Scripts', 'python.exe')
    : path.posix.join(venvDir, 'bin', 'python');
}

/** Windows named pipes (\\.\pipe\name) are not files: no realpath/stat on them. */
export const isNamedPipe = (p) => typeof p === 'string' && /^\\\\[.?]\\pipe\\/i.test(p);

/** Default Codex app-server control socket. */
export function defaultCodexSocket() {
  return path.join(os.homedir(), '.codex', 'app-server-control', 'app-server-control.sock');
}

/** How to see whether the background service is running, for error hints. */
export function serviceStatusHint(platform = process.platform) {
  if (platform === 'win32') return 'schtasks /Query /TN AgentBridge';
  if (platform === 'darwin') return 'launchctl print gui/$(id -u)/it.agentbridge.server';
  return 'systemctl --user status agent-bridge';
}
