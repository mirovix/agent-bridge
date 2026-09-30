// Installs (or removes) the Stop hook in ~/.claude/settings.json and the /phone
// command in ~/.claude/commands, so prompts sent from the app can land in a live
// Claude Code chat. Run it yourself:  npm run hook:install   /   npm run hook:install -- off
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hooks');
const HOOK = path.join(HOOKS_DIR, 'stop.js');
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const FILE = path.join(CLAUDE_DIR, 'settings.json');
const COMMAND = path.join(CLAUDE_DIR, 'commands', 'phone.md');

/** The /phone slash command: arms this chat for N minutes (default 60) or `off`. */
function phoneCommand(armScript) {
  return [
    '---',
    'description: Receive the prompts sent from your phone (Agent Bridge) in this chat',
    'argument-hint: "[minutes | off]"',
    '---',
    'While this is on, a prompt sent from the Agent Bridge app lands in this conversation instead of running in a separate process.',
    'Argument: how many minutes to listen (default 60), or `off`.',
    '',
    `!\`node ${JSON.stringify(armScript)} "$PWD" "$ARGUMENTS"\``,
    '',
    'Tell the user the result above in one line, nothing else.',
    '',
  ].join('\n');
}
const off = /^(off|remove|uninstall)$/i.test(process.argv[2] || '');

const exists = fs.existsSync(FILE);
const settings = exists ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
// Match both separators: on Windows the path is stored as scripts\\hooks\\stop.js.
const mine = (entry) => /scripts(?:\/|\\\\)+hooks(?:\/|\\\\)+stop\.js/.test(JSON.stringify(entry));

const hooks = settings.hooks || {};
const stop = (hooks.Stop || []).filter((e) => !mine(e)); // drop a previous install, keep the rest
if (!off) {
  stop.push({
    hooks: [{
      type: 'command',
      command: 'node',
      args: [HOOK],
      timeout: 600,
      statusMessage: 'Listening for prompts from the phone…',
    }],
  });
}
if (stop.length) hooks.Stop = stop; else delete hooks.Stop;
if (Object.keys(hooks).length) settings.hooks = hooks; else delete settings.hooks;

if (exists) fs.copyFileSync(FILE, `${FILE}.bak`);
else fs.mkdirSync(path.dirname(FILE), { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(settings, null, 2) + '\n');
console.log(`${off ? 'Hook removed from' : 'Hook installed in'} ${FILE}${exists ? ` (backup: ${path.basename(FILE)}.bak)` : ''}`);
if (off) {
  fs.rmSync(COMMAND, { force: true });
} else {
  fs.mkdirSync(path.dirname(COMMAND), { recursive: true });
  fs.writeFileSync(COMMAND, phoneCommand(path.join(HOOKS_DIR, 'arm.js')));
  console.log(`Command installed: type /phone in a Claude Code chat to receive prompts from the app (${COMMAND}).`);
}
console.log('Open /hooks in Claude Code (or restart it) so the change is picked up.');
