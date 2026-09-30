// UI test: the real web app in headless Chrome against a real server with fake
// Claude Code and Codex CLIs. Every screen and button a user touches is exercised.
// Skipped when Chrome is not installed (set CHROME_BIN to point at it).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { findChrome, launchChrome } from './browser.js';
import { PASSWORD, startServer } from './harness.js';

const skip = !findChrome() && 'Chrome not installed';
let s;
let browser;
let page;
const shots = process.env.AB_SCREENSHOTS;
const shot = async (name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await new Promise((r) => setTimeout(r, 700)); await page.screenshot(`${shots}/${name}.png`); } };
const hash = () => page.eval('return location.hash;');
const closeWaiting = () => page.eval("document.querySelector('.waiting-dialog')?.close(); return true;");

test.describe('web app', { skip }, () => {
  test.before(async () => {
    s = await startServer();
    browser = await launchChrome({ width: 1300, height: 900 });
    page = browser.page;
  });
  test.after(async () => { await browser?.close(); await s?.stop(); });

  test('sign in with password and 2FA', async () => {
    await page.goto(`${s.origin}/`);
    await page.waitFor("document.querySelector('#pw')");
    await shot('01-login');
    await page.click('button', 'Show password');
    assert.equal(await page.eval("return document.querySelector('#pw').type;"), 'text');
    await page.click('button', 'Lost your phone');
    assert.match(await page.text('.login'), /Recovery code/);
    await page.click('button', 'Use the 2FA code');
    await page.type('#pw', 'wrong-password');
    await page.type('#code', s.nextCode());
    await page.waitFor("/Wrong|invalid|incorrect/i.test(document.querySelector('.error')?.textContent || '')");
    await page.type('#pw', PASSWORD);
    await page.type('#code', s.nextCode());
    await page.waitFor("document.querySelector('.tabbar')", { timeout: 20000 });
    assert.equal(await page.text('.title'), 'Chats');
  });

  test('chats list shows the existing Claude chat with search and filters', async () => {
    await page.waitFor("document.body.innerText.includes('Fix the login page')");
    await shot('02-chats');
    await page.type('input[type=search]', 'nothing-matches-this');
    await page.waitFor("document.body.innerText.includes('No results')");
    await page.type('input[type=search]', 'login');
    await page.waitFor("document.body.innerText.includes('Fix the login page')");
    await page.click('.chip', 'Codex');
    await page.waitFor("!document.querySelector('.groups').innerText.includes('Fix the login page')");
    await page.click('.chip', 'All');
    await page.waitFor("document.querySelector('.groups').innerText.includes('Fix the login page')");
  });

  test('open a chat, rename it, pin it', async () => {
    await page.click('.row-item', 'Fix the login page');
    await page.waitFor("document.body.innerText.includes('I fixed the login page in login.js.')");
    await shot('03-chat');
    await page.click('button', 'Rename chat');
    await page.waitFor("document.querySelector('dialog.sheet[open] input')");
    await page.type('dialog.sheet[open] input', 'Login fix');
    await page.click('dialog.sheet[open] button', 'Save');
    await page.waitFor("document.querySelector('.title').innerText === 'Login fix'");
    await page.click('button', 'Pin chat');
    await page.waitFor("document.querySelector('[aria-label=\"Pin chat\"]').getAttribute('aria-pressed') === 'true'");
    await page.click('a', 'Back');
    await page.waitFor("/pinned/i.test(document.querySelector('.groups')?.textContent) && document.querySelector('.groups').textContent.includes('Login fix')");
  });

  test('continue the chat from the composer, with a quick prompt', async () => {
    await page.click('.row-item', 'Login fix');
    await page.waitFor("document.querySelector('.composer textarea')");
    await page.click('.quick .chip', 'Explain what you changed');
    assert.equal(await page.eval("return document.querySelector('.composer textarea').value;"), 'Explain what you changed');
    await page.click('button.send');
    await page.waitFor("document.querySelector('.waiting-dialog')");
    await closeWaiting();
    let resumed;
    for (let i = 0; i < 100 && !resumed; i++) {
      resumed = s.calls().find((c) => c.agent === 'claude' && c.input === 'Explain what you changed');
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(resumed, 'Claude was called');
    await page.waitFor("document.body.innerText.includes('Claude did the task.')");
    assert.ok(resumed.args.includes('--resume') && resumed.args.includes(s.CLAUDE_SESSION), 'the same chat was resumed');
  });

  test('ask Codex about the Claude chat (handoff)', async () => {
    await page.click('button', 'Ask Codex');
    await page.waitFor("document.querySelector('dialog.sheet[open]')");
    await shot('04-handoff');
    await page.click('dialog.sheet[open] .choice', 'Write tests');
    await page.click('dialog.sheet[open] button', 'Send to Codex');
    await page.waitFor("location.hash.startsWith('#/j/')");
    await page.waitFor("document.body.innerText.includes('Codex read the handoff.')");
    const call = s.calls().find((c) => c.agent === 'codex' && c.input.startsWith('Write tests for this.'));
    assert.match(call.input, /latest reply from Claude/);
  });

  test('new prompt: pick agent, folder and options, then follow the job', async () => {
    await page.click('.tab', 'New');
    await page.waitFor("document.querySelector('.segmented')");
    await page.click('.segmented button', 'Codex');
    await page.click('button', 'Browse folders');
    await page.waitFor("document.querySelector('.dirs:not([hidden])')");
    await page.click('.dirs button', 'Parent folder');
    await page.waitFor("[...document.querySelectorAll('.dirs button')].some((b) => b.innerText.trim() === 'other')");
    await page.click('.dirs button', 'proj');
    await page.waitFor("!document.querySelector('.dirs').innerText.includes('other')");
    await page.click('.dirs button', 'Use');
    await page.waitFor("document.querySelector('.folder.big').innerText.includes('proj')");
    await page.eval("const s = [...document.querySelectorAll('.pill select')].find((x) => x.getAttribute('aria-label') === 'Permissions'); s.value = 'read-only'; s.dispatchEvent(new Event('change')); return true;");
    await page.type('.composer textarea', 'hello from the new page');
    await shot('05-new');
    await page.click('button.send');
    await page.waitFor("location.hash.startsWith('#/j/')");
    await closeWaiting();
    await page.waitFor("document.body.innerText.includes('Codex did the task.')");
    await page.waitFor("document.querySelector('.tag.status-done')");
    const call = s.calls().find((c) => c.agent === 'codex' && c.input === 'hello from the new page');
    assert.ok(call.args.includes('sandbox_mode="read-only"'));
    await page.click('.toggle', 'steps');
    await page.click('.toggle', 'steps');
  });

  test('duo: Codex works, Claude reviews, Codex applies, all live', async () => {
    await page.click('.tab', 'Duo');
    await page.waitFor("document.querySelector('.duo-plan')");
    await page.click('.segmented button', 'Review');
    await page.click('.segmented button', 'Codex leads');
    assert.match(await page.text('.duo-plan'), /Codex does the task[\s\S]*Claude reviews[\s\S]*Codex applies the fixes/);
    await page.type('.composer textarea', 'please edit the readme');
    await shot('06-duo-new');
    await page.click('button.send');
    await page.waitFor("location.hash.startsWith('#/d/')");
    await page.waitFor("document.querySelectorAll('.duo-step.status-done').length === 3", { timeout: 25000 });
    await page.waitFor("document.querySelectorAll('.duo-panel').length === 3");
    await page.waitFor("document.body.innerText.includes('Applied the review.') && document.body.innerText.includes('Review: looks correct')");
    await shot('07-duo');
    await page.click('.tab', 'Activity');
    await page.waitFor("/duos/i.test(document.body.textContent) && document.body.textContent.includes('please edit the readme')");
  });

  test('compare duo on a phone-sized screen, switching tabs', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await page.goto(`${s.origin}/#/duo`);
    await page.waitFor("document.querySelector('.duo-plan')");
    await page.click('.segmented button', 'Compare');
    await page.type('.composer textarea', 'which approach is better?');
    await page.click('button.send');
    await page.waitFor("location.hash.startsWith('#/d/')");
    await page.waitFor("document.querySelectorAll('.duo-step.status-done').length === 2", { timeout: 20000 });
    await page.waitFor("document.querySelectorAll('.duo-tabs button').length === 2");
    await page.click('.duo-tabs button', '2.');
    await page.waitFor("document.querySelectorAll('.duo-panel.active').length === 1 && document.querySelector('.duo-panel.active').innerText.includes('2.')");
    await shot('08-duo-phone');
    await page.send('Emulation.clearDeviceMetricsOverride');
  });

  test('settings: theme, accent, text size, density, chat style are applied and synced', async () => {
    await page.goto(`${s.origin}/#/settings`);
    await page.waitFor("document.querySelector('.swatches')");
    await page.click('.segmented button', 'Dark');
    await page.click('.swatch', 'Green');
    await page.click('.segmented button', 'Large');
    await page.click('.segmented button', 'Compact');
    await page.click('.segmented button', 'Minimal');
    const attrs = await page.eval("const r = document.documentElement; return ['theme', 'accent', 'text', 'density', 'chat'].map((k) => r.getAttribute('data-' + k)).join(',');");
    assert.equal(attrs, 'dark,green,l,compact,minimal');
    await shot('09-settings');
    // Saved on the PC, so another device gets the same look.
    await page.waitFor("fetch('/api/prefs').then((r) => r.json()).then((d) => d.prefs.accent === 'green' && d.prefs.theme === 'dark')");
    await page.click('.segmented button', 'Auto');
    await page.click('.swatch', 'Violet');
  });

  test('settings: edit quick prompts and use them in the composer', async () => {
    await page.click('.chip', 'Personalize');
    await page.click('#personalize button', 'Add');
    await page.eval("const inputs = document.querySelectorAll('#personalize .list-editor')[0].querySelectorAll('input'); const last = inputs[inputs.length - 1]; last.value = 'Deploy to staging'; last.dispatchEvent(new Event('change')); return true;");
    await page.waitFor("[...document.querySelectorAll('#personalize input')].some((i) => i.value === 'Deploy to staging')");
    await page.click('.tab', 'New');
    await page.waitFor("[...document.querySelectorAll('.quick .chip')].some((c) => c.innerText === 'Deploy to staging')");
    await page.click('.tab', 'Settings');
    await page.click('#personalize button', 'Reset to defaults');
  });

  test('settings: devices, security log and server info load', async () => {
    await page.waitFor("document.querySelector('.device') && document.body.innerText.includes('this device')");
    await page.waitFor("document.querySelectorAll('.audit li').length > 3");
    assert.match(await page.text('.audit'), /Duo started|Reply passed/);
    assert.match(await page.text('.kv'), /Folders/);
  });

  test('sign out returns to the login screen', async () => {
    await page.click('button', 'Sign out of this device');
    await page.waitFor("document.querySelector('#pw')");
    assert.equal((await s.request('GET', '/api/me')).status, 401);
  });

  test('no JavaScript errors on any screen', () => {
    assert.deepEqual(page.problems.filter((p) => !/401|Not authenticated|Session expired|Failed to load resource/.test(p)), []);
  });
});
