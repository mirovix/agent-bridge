// Local speech-to-text through a long-lived faster-whisper worker (audio never leaves the PC).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './config.js';
import { venvPython } from './platform.js';

// venv layout differs per OS: whisper/bin/python vs whisper\Scripts\python.exe.
const PYTHON = venvPython(path.join(DATA_DIR, 'whisper'));
const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'transcribe_worker.py');
const IDLE_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 90 * 1000;
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const EXT = { 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' };

/**
 * Language hint for faster-whisper: any ISO 639-1 code (two lowercase letters).
 * Region tags are dropped ("en-US" -> "en"). Missing or invalid values give ''
 * which the worker turns into language=None, i.e. automatic detection.
 */
export function normalizeLang(lang) {
  if (typeof lang !== 'string') return '';
  const primary = lang.trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2}$/.test(primary) ? primary : '';
}

export class Voice {
  constructor() {
    this.proc = null;
    this.ready = null;
    this.pending = new Map();
    this.idleTimer = null;
  }

  available() {
    return fs.existsSync(PYTHON) && fs.existsSync(WORKER);
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const proc = spawn(PYTHON, [WORKER], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1' } });
      this.proc = proc;
      let buf = '';
      let err = '';
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.ready) { resolve(); continue; }
          const p = this.pending.get(msg.id);
          if (!p) continue;
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.text || '');
        }
      });
      proc.stderr.on('data', (c) => { err = (err + c).slice(-2000); });
      proc.stdin.on('error', () => { /* close/error below rejects pending work */ });
      proc.on('error', (e) => {
        this.proc = null;
        this.ready = null;
        reject(new Error(`Speech recognition not available: ${e.message}`));
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Speech recognition interrupted')); }
        this.pending.clear();
      });
      proc.on('close', () => {
        this.proc = null;
        this.ready = null;
        reject(new Error(`Speech recognition not available: ${err.trim().split(/\r?\n/).pop() || 'process exited'}`));
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Speech recognition interrupted')); }
        this.pending.clear();
      });
    });
    return this.ready;
  }

  stop() {
    this.proc?.kill();
  }

  async transcribe(audio, mimeType, lang) {
    if (!this.available()) throw Object.assign(new Error('Speech recognition is not installed on the PC'), { status: 501 });
    const base = String(mimeType || '').split(';')[0].trim().toLowerCase();
    const ext = EXT[base];
    if (!ext) throw Object.assign(new Error('Unsupported audio format'), { status: 415 });
    lang = normalizeLang(lang);
    clearTimeout(this.idleTimer);
    await this.start();
    const dir = path.join(DATA_DIR, 'uploads');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id = crypto.randomUUID();
    const file = path.join(dir, `voice-${id}.${ext}`);
    fs.writeFileSync(file, audio, { mode: 0o600 });
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Transcription took too long')); }, REQUEST_TIMEOUT_MS);
        this.pending.set(id, { resolve, reject, timer });
        this.proc.stdin.write(`${JSON.stringify({ id, path: file, lang })}\n`);
      });
    } finally {
      fs.rmSync(file, { force: true });
      // Only the last transcription arms the idle shutdown, never one still running.
      clearTimeout(this.idleTimer);
      if (!this.pending.size) {
        this.idleTimer = setTimeout(() => this.stop(), IDLE_MS);
        this.idleTimer.unref();
      }
    }
  }
}
