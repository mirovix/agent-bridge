// Interactive first-time setup. Runs only locally in a terminal: there is no web
// setup page, so an unconfigured server can never be claimed remotely.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import QRCode from 'qrcode';
import { createSecrets, generateRecoveryCodes } from '../src/auth.js';
import { CONFIG_PATH, DEFAULT_CONFIG, SECRETS_PATH, ensureDataDir, writePrivateJson } from '../src/config.js';
import { generateSecret, otpauthUri, verifyTotp } from '../src/totp.js';

if (!process.stdin.isTTY) {
  console.error('Run the setup from an interactive terminal.');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, def = '') => new Promise((r) => rl.question(def ? `${q} [${def}]: ` : `${q}: `, (a) => r(a.trim() || def)));

function askHidden(q) {
  return new Promise((resolve) => {
    const out = process.stdout;
    out.write(`${q}: `);
    const orig = rl._writeToOutput;
    rl._writeToOutput = () => {};
    rl.question('', (a) => {
      rl._writeToOutput = orig;
      out.write('\n');
      resolve(a);
    });
  });
}

function passwordProblems(p) {
  const issues = [];
  if (p.length < 14) issues.push('at least 14 characters');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  if (classes < 3 && p.length < 20) issues.push('at least 3 of lowercase, uppercase, digits, symbols (or 20+ characters)');
  return issues;
}

async function main() {
  console.log('\n=== Agent Bridge — secure setup ===\n');
  ensureDataDir();

  if (fs.existsSync(SECRETS_PATH)) {
    const a = await ask('A configuration already exists. Reset password and 2FA? (every device will have to log in again) y/N', 'N');
    if (!/^y(es)?$/i.test(a)) { rl.close(); return; }
  }

  // --- config ---
  let cfg = DEFAULT_CONFIG;
  if (fs.existsSync(CONFIG_PATH)) {
    cfg = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    console.log(`Keeping existing config: ${CONFIG_PATH}`);
  } else {
    let workspaces;
    while (true) {
      const ws = await ask('Folders the agents may work in (comma separated)', path.join(os.homedir(), 'workspace'));
      workspaces = ws.split(',').map((s) => s.trim()).filter(Boolean).map((s) => path.resolve(s.replace(/^~(?=$|[\\/])/, os.homedir())));
      const missing = workspaces.filter((w) => !fs.existsSync(w) || !fs.statSync(w).isDirectory());
      if (workspaces.length && !missing.length) break;
      console.log(`  Folder not found: ${missing.join(', ') || '(none)'} — try again.`);
    }
    let allowedOrigins;
    while (true) {
      const origin = await ask('Remote HTTPS URL (e.g. https://my-pc.tailXXXX.ts.net) — press Enter to leave empty', '');
      if (!origin) { allowedOrigins = []; break; }
      try {
        const u = new URL(origin);
        if (u.protocol !== 'https:') throw new Error();
        allowedOrigins = [u.origin];
        break;
      } catch {
        console.log('  It must be a valid https://… address.');
      }
    }
    cfg = { ...DEFAULT_CONFIG, workspaces, allowedOrigins };
    writePrivateJson(CONFIG_PATH, cfg);
    console.log(`Config saved to ${CONFIG_PATH}`);
  }

  // --- password ---
  let password;
  while (true) {
    password = await askHidden('New password');
    const issues = passwordProblems(password);
    if (issues.length) { console.log(`  Weak password: ${issues.join('; ')}`); continue; }
    if ((await askHidden('Repeat password')) !== password) { console.log('  Passwords do not match.'); continue; }
    break;
  }

  // --- TOTP ---
  const secret = generateSecret();
  const uri = otpauthUri(secret, `${os.userInfo().username}@${os.hostname()}`);
  console.log('\nScan this QR code with an authenticator app (Aegis, Google Authenticator, 1Password, Authy…):\n');
  console.log(await QRCode.toString(uri, { type: 'terminal', small: true, errorCorrectionLevel: 'M' }));
  console.log(`Or enter the key by hand: ${secret.match(/.{1,4}/g).join(' ')}\n`);
  while (true) {
    const code = (await ask('Enter the 6-digit code shown by the app')).replace(/\s+/g, '');
    if (verifyTotp(secret, code) !== null) break;
    console.log('  Invalid code, try again (check that the phone clock is correct).');
  }

  // --- recovery codes ---
  const recovery = generateRecoveryCodes();
  console.log('\nRecovery codes (single use, enter one instead of the 2FA code if you lose your phone).');
  console.log('Store them in a password manager: they will NOT be shown again.\n');
  for (const c of recovery) console.log(`   ${c}`);
  console.log('');

  console.log('Deriving key (scrypt)…');
  const secrets = await createSecrets(password, secret, recovery);
  writePrivateJson(SECRETS_PATH, secrets);
  console.log(`\nDone. Secrets saved (encrypted/hashed) to ${SECRETS_PATH}`);
  console.log('Start the server with:  npm start   (or start it at login: npm run service:install)\n');
  rl.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
