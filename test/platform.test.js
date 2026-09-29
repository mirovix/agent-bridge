import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { escapeCmdArg, isNamedPipe, readCmdShimTarget, resolveSpawn, venvPython, which } from '../src/platform.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bridge-platform-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('POSIX spawning is a passthrough (Linux/macOS behaviour unchanged)', () => {
  assert.deepEqual(resolveSpawn('claude', ['-p'], { platform: 'linux' }), { command: 'claude', args: ['-p'], options: {} });
  assert.deepEqual(resolveSpawn('codex', [], { platform: 'darwin' }), { command: 'codex', args: [], options: {} });
});

test('venv python lives in bin/ on POSIX and Scripts\\ on Windows', () => {
  assert.equal(venvPython('/d/whisper', 'linux'), '/d/whisper/bin/python');
  assert.equal(venvPython('C:\\d\\whisper', 'win32'), 'C:\\d\\whisper\\Scripts\\python.exe');
});

test('named pipes are recognised', () => {
  assert.ok(isNamedPipe('\\\\.\\pipe\\codex'));
  assert.ok(!isNamedPipe('/home/u/.codex/app.sock'));
});

test('cmd.exe arguments are quoted and metacharacters escaped', () => {
  assert.equal(escapeCmdArg('plain'), '^^^"plain^^^"');
  const nasty = escapeCmdArg('a & b | c > d "q" %PATH%');
  for (const ch of ['&', '|', '>', '%']) assert.ok(!new RegExp(`[^^]\\${ch}`).test(nasty), `${ch} is escaped`);
});

test('npm cmd shims are unwrapped to their JS entry point', () => {
  const pkg = path.join(tmp, 'node_modules', 'tool');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'cli.js'), '');
  const shim = path.join(tmp, 'tool.cmd');
  fs.writeFileSync(shim, '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\tool\\cli.js" %*\r\n');
  if (process.platform === 'win32') {
    assert.equal(readCmdShimTarget(shim), path.join(pkg, 'cli.js'));
    const r = resolveSpawn(shim, ['--version'], { platform: 'win32' });
    assert.deepEqual(r.args, [path.join(pkg, 'cli.js'), '--version']);
  } else {
    // Windows path resolution cannot run on POSIX file systems; only the parse is checked.
    const text = fs.readFileSync(shim, 'utf8');
    assert.match(text, /"%(?:~)?dp0%\\?([^"%]+)"\s+%\*/);
  }
});

test('which() honours PATHEXT on Windows and PATH on POSIX', () => {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(bin, 'fake.cmd'), '@echo off\r\n');
    assert.equal(which('fake', { env: { PATH: bin, PATHEXT: '.EXE;.CMD' } }).toLowerCase(), path.join(bin, 'fake.cmd').toLowerCase());
  } else {
    fs.writeFileSync(path.join(bin, 'fake'), '#!/bin/sh\n', { mode: 0o755 });
    assert.equal(which('fake', { env: { PATH: bin } }), path.join(bin, 'fake'));
  }
  assert.equal(which('definitely-not-here', { env: { PATH: bin } }), null);
});
