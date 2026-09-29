// Local-only: clear the login lockout (e.g. after someone hammered the login page).
import { audit } from '../src/auth.js';
import { AUDIT_PATH, loadSecrets, saveSecrets } from '../src/config.js';

const s = loadSecrets();
if (!s) {
  console.error('No configuration found. Run: npm run setup');
  process.exit(1);
}
const prev = s.lockout;
s.lockout = { failures: 0, lockUntil: 0 };
saveSecrets(s);
audit('lockout_cleared_locally', { previous: prev });
console.log(`Lockout cleared (failed attempts recorded: ${prev?.failures || 0}). Check ${AUDIT_PATH} to see who tried.`);
