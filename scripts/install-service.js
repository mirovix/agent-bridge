// Starts Agent Bridge automatically at login, with the native mechanism of each OS:
//   Linux   -> systemd user unit        ~/.config/systemd/user/agent-bridge.service
//   macOS   -> LaunchAgent              ~/Library/LaunchAgents/it.agentbridge.server.plist
//   Windows -> per-user Scheduled Task  "AgentBridge" (at logon, hidden window)
//
// Usage:  npm run service:install   [-- --dry-run]
//         npm run service:uninstall [-- --dry-run]
// --dry-run prints every file and command without touching anything.
// --platform=linux|darwin|win32 (dry run only) previews another OS.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
export const LAUNCHD_LABEL = 'it.agentbridge.server';
export const WINDOWS_TASK = 'AgentBridge';
export const SYSTEMD_UNIT = 'agent-bridge';
const PLATFORMS = ['linux', 'darwin', 'win32'];

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function systemdUnit({ projectRoot, nodeBin, template }) {
  const nodeDir = path.posix.dirname(nodeBin);
  return template
    .replace(/^(?:#.*\n)+/, '') // the template's own header comment
    .replaceAll('@PROJECT_ROOT@', projectRoot)
    .replaceAll('@NODE_BIN@', nodeBin)
    .replaceAll('@NODE_DIR@', nodeDir);
}

function launchdPlist({ projectRoot, nodeBin, home }) {
  const pathEnv = [path.posix.dirname(nodeBin), `${home}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':');
  const log = `${home}/Library/Logs/agent-bridge.log`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodeBin)}</string>
    <string>src/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(projectRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(pathEnv)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>Umask</key>
  <integer>63</integer>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
}

/**
 * Describe what installing/uninstalling means on `platform`. Pure: reads only the
 * systemd template, touches nothing, so tests can preview every OS anywhere.
 */
export function buildPlan({
  platform = process.platform,
  action = 'install',
  projectRoot = PROJECT_ROOT,
  nodeBin = process.execPath,
  home = os.homedir(),
  env = process.env,
  uid = typeof process.getuid === 'function' ? process.getuid() : 0,
} = {}) {
  if (!PLATFORMS.includes(platform)) throw new Error(`Unsupported platform: ${platform} (supported: ${PLATFORMS.join(', ')})`);
  if (!['install', 'uninstall'].includes(action)) throw new Error(`Unknown action: ${action} (use install or uninstall)`);
  const steps = [];
  const after = [];

  if (platform === 'linux') {
    const unitDir = path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(home, '.config'), 'systemd', 'user');
    const unitFile = path.posix.join(unitDir, `${SYSTEMD_UNIT}.service`);
    if (action === 'install') {
      const template = fs.readFileSync(path.join(SCRIPT_DIR, 'agent-bridge.service'), 'utf8');
      steps.push({ kind: 'mkdir', path: unitDir });
      steps.push({ kind: 'write', path: unitFile, mode: 0o600, content: systemdUnit({ projectRoot, nodeBin, template }) });
      steps.push({ kind: 'run', command: 'systemctl', args: ['--user', 'daemon-reload'] });
      steps.push({ kind: 'run', command: 'systemctl', args: ['--user', 'enable', '--now', SYSTEMD_UNIT] });
      after.push(`Status: systemctl --user status ${SYSTEMD_UNIT}`, `Logs:   journalctl --user -u ${SYSTEMD_UNIT} -f`);
    } else {
      steps.push({ kind: 'run', command: 'systemctl', args: ['--user', 'disable', '--now', SYSTEMD_UNIT], ignoreFailure: true });
      steps.push({ kind: 'remove', path: unitFile });
      steps.push({ kind: 'run', command: 'systemctl', args: ['--user', 'daemon-reload'] });
    }
    return { platform, action, mechanism: 'systemd user unit', steps, after };
  }

  if (platform === 'darwin') {
    const agentsDir = path.posix.join(home, 'Library', 'LaunchAgents');
    const plist = path.posix.join(agentsDir, `${LAUNCHD_LABEL}.plist`);
    const domain = `gui/${uid}`;
    if (action === 'install') {
      steps.push({ kind: 'mkdir', path: agentsDir });
      steps.push({ kind: 'mkdir', path: path.posix.join(home, 'Library', 'Logs') });
      // Unload a previous copy first, so a re-install picks up the new plist.
      steps.push({ kind: 'run', command: 'launchctl', args: ['bootout', `${domain}/${LAUNCHD_LABEL}`], ignoreFailure: true });
      steps.push({ kind: 'write', path: plist, mode: 0o600, content: launchdPlist({ projectRoot, nodeBin, home }) });
      steps.push({ kind: 'run', command: 'launchctl', args: ['enable', `${domain}/${LAUNCHD_LABEL}`], ignoreFailure: true });
      steps.push({ kind: 'run', command: 'launchctl', args: ['bootstrap', domain, plist] });
      after.push(`Status: launchctl print ${domain}/${LAUNCHD_LABEL}`, `Logs:   tail -f ${home}/Library/Logs/agent-bridge.log`);
    } else {
      steps.push({ kind: 'run', command: 'launchctl', args: ['bootout', `${domain}/${LAUNCHD_LABEL}`], ignoreFailure: true });
      steps.push({ kind: 'remove', path: plist });
    }
    return { platform, action, mechanism: 'launchd LaunchAgent', steps, after };
  }

  // win32: the PowerShell script registers a per-user task (no admin rights needed).
  const ps1 = path.win32.join(projectRoot, 'scripts', 'windows', 'agent-bridge-task.ps1');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Action', action === 'install' ? 'Install' : 'Uninstall', '-TaskName', WINDOWS_TASK];
  if (action === 'install') args.push('-ProjectRoot', projectRoot, '-NodePath', nodeBin);
  steps.push({ kind: 'run', command: 'powershell.exe', args });
  if (action === 'install') after.push(`Status: schtasks /Query /TN ${WINDOWS_TASK} /V /FO LIST`, `Stop:   schtasks /End /TN ${WINDOWS_TASK}`);
  return { platform, action, mechanism: 'Scheduled Task at logon', steps, after };
}

const quote = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '\\"')}"`);

/** Human-readable plan; with dryRun it is exactly what --dry-run prints. */
export function formatPlan(plan, { dryRun = true } = {}) {
  const lines = [`Agent Bridge service ${plan.action} for ${plan.platform} (${plan.mechanism})`];
  if (dryRun) lines.push('[dry-run] Nothing will be changed. It would:');
  for (const s of plan.steps) {
    if (s.kind === 'mkdir') lines.push(`  create folder ${s.path}`);
    else if (s.kind === 'remove') lines.push(`  delete ${s.path}`);
    else if (s.kind === 'run') lines.push(`  run: ${[s.command, ...s.args].map(quote).join(' ')}${s.ignoreFailure ? '   (failure ignored)' : ''}`);
    else if (s.kind === 'write') {
      lines.push(`  write ${s.path} (mode ${s.mode.toString(8)}):`);
      for (const l of s.content.replace(/\n$/, '').split('\n')) lines.push(`    | ${l}`);
    }
  }
  if (plan.after.length) lines.push('Afterwards:', ...plan.after.map((a) => `  ${a}`));
  return lines.join('\n');
}

function execute(plan) {
  for (const s of plan.steps) {
    if (s.kind === 'mkdir') fs.mkdirSync(s.path, { recursive: true });
    else if (s.kind === 'remove') fs.rmSync(s.path, { force: true });
    else if (s.kind === 'write') {
      fs.writeFileSync(s.path, s.content, { mode: s.mode });
      if (process.platform !== 'win32') fs.chmodSync(s.path, s.mode);
    } else if (s.kind === 'run') {
      console.log(`> ${[s.command, ...s.args].map(quote).join(' ')}`);
      const r = spawnSync(s.command, s.args, { stdio: 'inherit', windowsHide: true });
      if ((r.error || r.status !== 0) && !s.ignoreFailure) {
        throw new Error(`${s.command} failed${r.error ? `: ${r.error.message}` : ` (exit code ${r.status})`}`);
      }
    }
  }
}

export function parseArgs(argv) {
  const opts = { action: 'install', dryRun: false, platform: process.platform };
  for (const a of argv) {
    if (a === '--dry-run' || a === '-n') opts.dryRun = true;
    else if (a.startsWith('--platform=')) opts.platform = a.slice('--platform='.length);
    else if (a === 'install' || a === 'uninstall') opts.action = a;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node scripts/install-service.js [install|uninstall] [--dry-run] [--platform=linux|darwin|win32]');
    return;
  }
  if (opts.platform !== process.platform && !opts.dryRun) {
    throw new Error(`--platform=${opts.platform} can only be used with --dry-run (this machine is ${process.platform})`);
  }
  const major = Number(process.versions.node.split('.')[0]);
  if (opts.action === 'install' && major < 20) throw new Error(`Node.js 20 or later is required; found ${process.version}.`);

  const plan = buildPlan({ platform: opts.platform, action: opts.action });
  if (opts.dryRun) {
    console.log(formatPlan(plan));
    return;
  }
  execute(plan);
  console.log(opts.action === 'install'
    ? `Agent Bridge now starts automatically at login (${plan.mechanism}) and is running.`
    : `Agent Bridge no longer starts at login (${plan.mechanism} removed).`);
  for (const a of plan.after) console.log(a);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
