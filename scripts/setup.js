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
  console.error('Esegui il setup da un terminale interattivo.');
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
  if (p.length < 14) issues.push('almeno 14 caratteri');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  if (classes < 3 && p.length < 20) issues.push('almeno 3 tipi tra minuscole, maiuscole, numeri, simboli (o 20+ caratteri)');
  return issues;
}

async function main() {
  console.log('\n=== Agent Bridge — configurazione sicura ===\n');
  ensureDataDir();

  if (fs.existsSync(SECRETS_PATH)) {
    const a = await ask('Esiste già una configurazione. Reimpostare password e 2FA? (tutti i dispositivi dovranno rifare il login) s/N', 'N');
    if (a.toLowerCase() !== 's') { rl.close(); return; }
  }

  // --- config ---
  let cfg = DEFAULT_CONFIG;
  if (fs.existsSync(CONFIG_PATH)) {
    cfg = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    console.log(`Config esistente mantenuta: ${CONFIG_PATH}`);
  } else {
    let workspaces;
    while (true) {
      const ws = await ask('Cartelle in cui gli agenti possono lavorare (separate da virgola)', path.join(os.homedir(), 'workspace'));
      workspaces = ws.split(',').map((s) => s.trim()).filter(Boolean).map((s) => path.resolve(s.replace(/^~/, os.homedir())));
      const missing = workspaces.filter((w) => !fs.existsSync(w) || !fs.statSync(w).isDirectory());
      if (workspaces.length && !missing.length) break;
      console.log(`  Cartella inesistente: ${missing.join(', ') || '(nessuna)'} — riprova.`);
    }
    let allowedOrigins;
    while (true) {
      const origin = await ask('URL remoto HTTPS (es. https://mio-pc.tailXXXX.ts.net) — premi Invio per lasciarlo vuoto', '');
      if (!origin) { allowedOrigins = []; break; }
      try {
        const u = new URL(origin);
        if (u.protocol !== 'https:') throw new Error();
        allowedOrigins = [u.origin];
        break;
      } catch {
        console.log('  Deve essere un indirizzo https://… valido.');
      }
    }
    cfg = { ...DEFAULT_CONFIG, workspaces, allowedOrigins };
    writePrivateJson(CONFIG_PATH, cfg);
    console.log(`Config salvata in ${CONFIG_PATH}`);
  }

  // --- password ---
  let password;
  while (true) {
    password = await askHidden('Nuova password');
    const issues = passwordProblems(password);
    if (issues.length) { console.log(`  Password debole: ${issues.join('; ')}`); continue; }
    if ((await askHidden('Ripeti password')) !== password) { console.log('  Le password non coincidono.'); continue; }
    break;
  }

  // --- TOTP ---
  const secret = generateSecret();
  const uri = otpauthUri(secret, `${os.userInfo().username}@${os.hostname()}`);
  console.log('\nScansiona questo QR con un\'app di autenticazione (Aegis, Google Authenticator, 1Password, Authy…):\n');
  console.log(await QRCode.toString(uri, { type: 'terminal', small: true, errorCorrectionLevel: 'M' }));
  console.log(`Oppure inserisci a mano la chiave: ${secret.match(/.{1,4}/g).join(' ')}\n`);
  while (true) {
    const code = (await ask('Inserisci il codice a 6 cifre mostrato dall\'app')).replace(/\s+/g, '');
    if (verifyTotp(secret, code) !== null) break;
    console.log('  Codice non valido, riprova (controlla che l\'ora del telefono sia corretta).');
  }

  // --- recovery codes ---
  const recovery = generateRecoveryCodes();
  console.log('\nCodici di recupero (monouso, usali al posto del codice 2FA se perdi il telefono).');
  console.log('Salvali in un password manager: NON verranno mostrati di nuovo.\n');
  for (const c of recovery) console.log(`   ${c}`);
  console.log('');

  console.log('Derivazione chiave (scrypt)…');
  const secrets = await createSecrets(password, secret, recovery);
  writePrivateJson(SECRETS_PATH, secrets);
  console.log(`\nFatto. Segreti salvati (cifrati/hash) in ${SECRETS_PATH}`);
  console.log('Avvia il server con:  npm start\n');
  rl.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
