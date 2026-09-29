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

const settings = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
const mine = (entry) => JSON.stringify(entry).includes('scripts/hooks/stop.js');

const hooks = settings.hooks || {};
const stop = (hooks.Stop || []).filter((e) => !mine(e)); // drop a previous install, keep the rest
if (!off) {
  stop.push({
    hooks: [{
      type: 'command',
      command: 'node',
      args: [HOOK],
      timeout: 600,
      statusMessage: 'In ascolto dei prompt dal telefono…',
    }],
  });
}
if (stop.length) hooks.Stop = stop; else delete hooks.Stop;
if (Object.keys(hooks).length) settings.hooks = hooks; else delete settings.hooks;

fs.copyFileSync(FILE, `${FILE}.bak`);
fs.writeFileSync(FILE, JSON.stringify(settings, null, 2) + '\n');
console.log(`${off ? 'Hook rimosso da' : 'Hook installato in'} ${FILE} (copia di sicurezza: ${path.basename(FILE)}.bak)`);
console.log('Apri /hooks in Claude Code (o riavvialo) perché la modifica venga letta.');
