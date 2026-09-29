#!/usr/bin/env node
// VS Code normally starts a private Codex app-server, which locks open threads.
// This executable keeps normal Codex commands intact, but connects the extension's
// app-server transport to the shared daemon used by Agent Bridge.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { defaultCodexSocket, isNamedPipe, readCmdShimTarget, spawnCommand, spawnCommandSync } from '../src/platform.js';

const args = process.argv.slice(2);
const ownFile = fs.realpathSync(fileURLToPath(import.meta.url));
// On Windows the CLI is codex.exe or an npm codex.cmd shim; skip shims that point back here.
const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
const isSelf = (file) => {
  try {
    if (fs.realpathSync(file) === ownFile) return true;
    const target = /\.(cmd|bat)$/i.test(file) ? readCmdShimTarget(file) : null;
    return !!target && fs.realpathSync(target) === ownFile;
  } catch { return false; }
};
const realCodex = process.env.AGENT_BRIDGE_REAL_CODEX || (process.env.PATH || process.env.Path || '')
  .split(path.delimiter)
  .filter(Boolean)
  .flatMap((dir) => exts.map((ext) => path.join(dir, `codex${ext}`)))
  .find((candidate) => {
    try { return fs.statSync(candidate).isFile() && !isSelf(candidate); } catch { return false; }
  });
if (!realCodex) {
  process.stderr.write('Original Codex executable not found on PATH\n');
  process.exit(1);
}

if (!args.includes('app-server')) {
  const child = spawnCommand(realCodex, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => signal ? process.kill(process.pid, signal) : process.exit(code ?? 1));
} else {
  // Unix socket path, Windows named pipe (\\.\pipe\name) or ws:// URL.
  const link = process.env.CODEX_APP_SERVER_SOCKET || defaultCodexSocket();
  const direct = /^wss?:\/\//i.test(link) || isNamedPipe(link);
  if (!direct && !fs.existsSync(link)) {
    const result = spawnCommandSync(realCodex, ['app-server', 'daemon', 'start'], { encoding: 'utf8', timeout: 30_000 });
    if (result.status !== 0) {
      process.stderr.write(result.stderr || 'Could not start the shared Codex daemon\n');
      process.exit(1);
    }
  }
  const socket = direct ? link : fs.realpathSync(link);
  const ws = /^wss?:\/\//i.test(socket)
    ? new WebSocket(socket)
    : new WebSocket('ws://localhost/', { createConnection: () => net.createConnection(socket) });
  const queued = [];
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    input += chunk;
    let newline;
    while ((newline = input.indexOf('\n')) >= 0) {
      const line = input.slice(0, newline);
      input = input.slice(newline + 1);
      if (!line.trim()) continue;
      if (ws.readyState === WebSocket.OPEN) ws.send(line);
      else queued.push(line);
    }
  });
  ws.on('open', () => {
    for (const line of queued.splice(0)) ws.send(line);
  });
  ws.on('message', (data) => process.stdout.write(`${String(data)}\n`));
  ws.on('error', (error) => process.stderr.write(`Codex daemon: ${error.message}\n`));
  ws.on('close', () => process.exit(0));
  const close = () => { try { ws.close(); } catch { /* closed */ } };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
}
