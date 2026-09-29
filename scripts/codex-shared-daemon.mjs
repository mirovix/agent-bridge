#!/usr/bin/env node
// VS Code normally starts a private Codex app-server, which locks open threads.
// This executable keeps normal Codex commands intact, but connects the extension's
// app-server transport to the shared daemon used by Agent Bridge.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const args = process.argv.slice(2);
const ownFile = fs.realpathSync(fileURLToPath(import.meta.url));
const realCodex = process.env.AGENT_BRIDGE_REAL_CODEX || (process.env.PATH || '')
  .split(path.delimiter)
  .map((dir) => path.join(dir, 'codex'))
  .find((candidate) => {
    try { return fs.realpathSync(candidate) !== ownFile && fs.statSync(candidate).isFile(); } catch { return false; }
  });
if (!realCodex) {
  process.stderr.write('Eseguibile Codex originale non trovato nel PATH\n');
  process.exit(1);
}

if (!args.includes('app-server')) {
  const child = spawn(realCodex, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => signal ? process.kill(process.pid, signal) : process.exit(code ?? 1));
} else {
  const link = process.env.CODEX_APP_SERVER_SOCKET
    || path.join(os.homedir(), '.codex', 'app-server-control', 'app-server-control.sock');
  if (!fs.existsSync(link)) {
    const result = spawnSync(realCodex, ['app-server', 'daemon', 'start'], { encoding: 'utf8', timeout: 30_000 });
    if (result.status !== 0) {
      process.stderr.write(result.stderr || 'Impossibile avviare il daemon Codex condiviso\n');
      process.exit(1);
    }
  }
  const socket = fs.realpathSync(link);
  const ws = new WebSocket('ws://localhost/', { createConnection: () => net.createConnection(socket) });
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
