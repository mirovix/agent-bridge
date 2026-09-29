// Shared test helpers (not a test file itself).
import fs from 'node:fs';
import path from 'node:path';

/**
 * Write a Node script that tests use as a fake agent CLI and return the command to
 * run it. POSIX: the script itself (shebang + mode 755). Windows cannot execute a
 * .mjs directly, so we add an npm-style .cmd shim next to it, just like the real
 * claude.cmd / codex.cmd that npm installs.
 */
export function fakeCli(file, source) {
  fs.writeFileSync(file, `#!${process.execPath}\n${source}`, { mode: 0o755 });
  if (process.platform !== 'win32') return file;
  const shim = file.replace(/\.m?js$/, '') + '.cmd';
  fs.writeFileSync(shim, `@ECHO off\r\nSET dp0=%~dp0\r\n"${process.execPath}"  "%dp0%\\${path.basename(file)}" %*\r\n`);
  return shim;
}

/** POSIX permission bits are meaningless on Windows (stat always reports 0666). */
export const POSIX_MODES = process.platform !== 'win32';
