// The autostart installer is only ever exercised in dry-run / plan mode here:
// nothing is written and no systemctl, launchctl or powershell command is run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildPlan, formatPlan, parseArgs } from '../scripts/install-service.js';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'install-service.js');
const POSIX = { projectRoot: '/opt/agent bridge', nodeBin: '/usr/local/bin/node', home: '/home/ada', env: {}, uid: 501 };
const WIN = { projectRoot: 'C:\\Users\\ada\\agent-bridge', nodeBin: 'C:\\Program Files\\nodejs\\node.exe', home: 'C:\\Users\\ada', env: {} };
const runs = (plan) => plan.steps.filter((s) => s.kind === 'run').map((s) => [s.command, ...s.args].join(' '));

test('linux dry run: systemd user unit, then daemon-reload and enable --now', () => {
  const plan = buildPlan({ platform: 'linux', ...POSIX });
  const unit = plan.steps.find((s) => s.kind === 'write');
  assert.equal(unit.path, '/home/ada/.config/systemd/user/agent-bridge.service');
  assert.equal(unit.mode, 0o600);
  assert.match(unit.content, /^WorkingDirectory=\/opt\/agent bridge$/m);
  assert.match(unit.content, /^ExecStart=\/usr\/local\/bin\/node src\/server\.js$/m);
  assert.match(unit.content, /^Environment=PATH=\/usr\/local\/bin:%h\/\.local\/bin:/m);
  assert.doesNotMatch(unit.content, /@[A-Z_]+@/, 'every placeholder is replaced');
  assert.deepEqual(runs(plan), ['systemctl --user daemon-reload', 'systemctl --user enable --now agent-bridge']);
  const out = formatPlan(plan);
  assert.match(out, /\[dry-run\] Nothing will be changed/);
  assert.match(out, /run: systemctl --user enable --now agent-bridge/);
});

test('linux honours XDG_CONFIG_HOME, and uninstall disables and removes the unit', () => {
  const plan = buildPlan({ platform: 'linux', ...POSIX, env: { XDG_CONFIG_HOME: '/cfg' }, action: 'uninstall' });
  assert.deepEqual(plan.steps.find((s) => s.kind === 'remove'), { kind: 'remove', path: '/cfg/systemd/user/agent-bridge.service' });
  assert.deepEqual(runs(plan), ['systemctl --user disable --now agent-bridge', 'systemctl --user daemon-reload']);
});

test('macOS dry run: LaunchAgent plist loaded with launchctl bootstrap', () => {
  const plan = buildPlan({ platform: 'darwin', ...POSIX });
  const plist = plan.steps.find((s) => s.kind === 'write');
  assert.equal(plist.path, '/home/ada/Library/LaunchAgents/it.agentbridge.server.plist');
  assert.match(plist.content, /<key>Label<\/key>\s*<string>it\.agentbridge\.server<\/string>/);
  assert.match(plist.content, /<string>\/usr\/local\/bin\/node<\/string>\s*<string>src\/server\.js<\/string>/);
  assert.match(plist.content, /<key>WorkingDirectory<\/key>\s*<string>\/opt\/agent bridge<\/string>/);
  assert.match(plist.content, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.deepEqual(runs(plan), [
    'launchctl bootout gui/501/it.agentbridge.server',
    'launchctl enable gui/501/it.agentbridge.server',
    'launchctl bootstrap gui/501 /home/ada/Library/LaunchAgents/it.agentbridge.server.plist',
  ]);
  const un = buildPlan({ platform: 'darwin', ...POSIX, action: 'uninstall' });
  assert.deepEqual(runs(un), ['launchctl bootout gui/501/it.agentbridge.server']);
  assert.equal(un.steps.find((s) => s.kind === 'remove').path, plist.path);
});

test('Windows dry run: per-user Scheduled Task through the PowerShell helper', () => {
  const plan = buildPlan({ platform: 'win32', ...WIN });
  assert.equal(plan.steps.length, 1);
  const [step] = plan.steps;
  assert.equal(step.command, 'powershell.exe');
  const arg = (name) => step.args[step.args.indexOf(name) + 1];
  assert.equal(arg('-File'), 'C:\\Users\\ada\\agent-bridge\\scripts\\windows\\agent-bridge-task.ps1');
  assert.equal(arg('-Action'), 'Install');
  assert.equal(arg('-TaskName'), 'AgentBridge');
  assert.equal(arg('-ProjectRoot'), WIN.projectRoot);
  assert.equal(arg('-NodePath'), WIN.nodeBin);
  assert.match(formatPlan(plan), /"C:\\Program Files\\nodejs\\node\.exe"/, 'paths with spaces are quoted');
  const un = buildPlan({ platform: 'win32', ...WIN, action: 'uninstall' });
  assert.equal(un.steps[0].args[un.steps[0].args.indexOf('-Action') + 1], 'Uninstall');
});

test('argument parsing and refusal of unknown values', () => {
  assert.deepEqual(parseArgs(['uninstall', '--dry-run', '--platform=darwin']), { action: 'uninstall', dryRun: true, platform: 'darwin' });
  assert.throws(() => parseArgs(['--force']), /Unknown argument/);
  assert.throws(() => buildPlan({ platform: 'aix' }), /Unsupported platform/);
});

test('the CLI prints the dry run for every platform and changes nothing', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    for (const action of ['install', 'uninstall']) {
      const r = spawnSync(process.execPath, [SCRIPT, action, '--dry-run', `--platform=${platform}`], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, new RegExp(`service ${action} for ${platform}`));
      assert.match(r.stdout, /\[dry-run\]/);
    }
  }
  const other = ['linux', 'darwin', 'win32'].find((p) => p !== process.platform);
  const refused = spawnSync(process.execPath, [SCRIPT, `--platform=${other}`], { encoding: 'utf8' });
  assert.equal(refused.status, 1, 'another OS can only be previewed, never executed');
  assert.match(refused.stderr, /only be used with --dry-run/);
});
