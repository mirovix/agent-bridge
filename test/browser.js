// Minimal Chrome DevTools Protocol driver for the UI test (no dependencies).
// Not a test file itself.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidates.find((file) => { try { return fs.statSync(file).isFile(); } catch { return false; } }) || null;
}

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});

export async function launchChrome({ width = 1280, height = 900, mobile = false } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome not found (set CHROME_BIN)');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bridge-chrome-'));
  const port = await freePort();
  const child = spawn(chrome, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--mute-audio',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank',
  ], { stdio: 'ignore' });
  const end = Date.now() + 20000;
  let target;
  while (Date.now() < end) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); if (target) break; } catch { /* starting */ }
    await sleep(150);
  }
  if (!target) { child.kill(); throw new Error('Chrome did not start'); }
  const page = await new Page(target.webSocketDebuggerUrl).connect();
  if (mobile) await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  return {
    page,
    async close() { page.close(); child.kill(); await sleep(300); fs.rmSync(profile, { recursive: true, force: true }); },
  };
}

export class Page {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.problems = []; }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg); this.pending.delete(msg.id); return; }
      if (msg.method === 'Runtime.exceptionThrown') this.problems.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') this.problems.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/favicon|401|Unauthorized/.test(msg.params.entry.text + msg.params.entry.url)) this.problems.push(`${msg.params.entry.text} ${msg.params.entry.url || ''}`);
    };
    await this.send('Runtime.enable');
    await this.send('Log.enable');
    await this.send('Page.enable');
    return this;
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve) => { this.pending.set(id, resolve); this.ws.send(JSON.stringify({ id, method, params })); });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  }

  async waitFor(expression, { timeout = 15000 } = {}) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      try { last = await this.eval(`return (${expression});`); if (last) return last; } catch (e) { last = e.message; }
      await sleep(100);
    }
    throw new Error(`Timed out waiting for: ${expression} (last: ${JSON.stringify(last)})`);
  }

  goto(url) { return this.send('Page.navigate', { url }); }

  /** Click the first element matching `selector` whose text includes `text`. */
  click(selector, text = '') {
    return this.waitFor(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => (e.innerText || e.value || e.getAttribute('aria-label') || '').includes(${JSON.stringify(text)}) && !e.disabled && e.offsetParent !== null);
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    })()`);
  }

  /** Type into an input/textarea the way a user would (fires input events). */
  type(selector, value) {
    return this.waitFor(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el || el.offsetParent === null) return false;
      el.focus();
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  }

  text(selector = 'body') { return this.eval(`return document.querySelector(${JSON.stringify(selector)})?.innerText || '';`); }

  async screenshot(file) {
    const { result } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  }

  close() { try { this.ws.close(); } catch { /* closed */ } }
}
