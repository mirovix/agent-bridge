// Local-only: clear the login lockout (e.g. after someone hammered the login page).
import { audit } from '../src/auth.js';
import { loadSecrets, saveSecrets } from '../src/config.js';

const s = loadSecrets();
if (!s) {
  console.error('Nessuna configurazione trovata. Esegui: npm run setup');
  process.exit(1);
}
const prev = s.lockout;
s.lockout = { failures: 0, lockUntil: 0 };
saveSecrets(s);
audit('lockout_cleared_locally', { previous: prev });
console.log(`Blocco rimosso (tentativi falliti registrati: ${prev?.failures || 0}). Controlla ~/.agent-bridge/audit.log per capire chi ci ha provato.`);
