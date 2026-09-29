// Installs (or removes) the Stop hook in ~/.claude/settings.json, so prompts sent
// from the app can land in a live Claude Code chat armed with /telefono.
// Run it yourself:  npm run hook:install   /   npm run hook:install -- off
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hooks', 'stop.js');
const FILE = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
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
console.log('Open /hooks in Claude Code (or restart it) so the change is picked up.');
