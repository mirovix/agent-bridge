// Every example configuration must load exactly as the server would load it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-examples-'));
process.env.AGENT_BRIDGE_HOME = home;
const { CONFIG_PATH, loadConfig, writePrivateJson } = await import('../src/config.js');

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  test(`examples/${file} is a valid configuration`, () => {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    writePrivateJson(CONFIG_PATH, raw);
    const cfg = loadConfig();
    assert.equal(cfg.host, '127.0.0.1');
    assert.ok(cfg.workspaces.length > 0);
    for (const w of cfg.workspaces) assert.ok(path.isAbsolute(w) && !w.includes('~'), w);
    if (raw.workspaces.some((w) => w.startsWith('~'))) assert.ok(cfg.workspaces.some((w) => w.startsWith(os.homedir())));
    assert.ok(cfg.allowedOrigins.every((o) => o.startsWith('https://')));
    assert.equal(cfg.allowDangerousModes, false, 'examples never enable dangerous modes');
  });
}

test.after(() => fs.rmSync(home, { recursive: true, force: true }));
