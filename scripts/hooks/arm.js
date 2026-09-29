// Arms (or disarms) the Claude Code chat running in a directory, so prompts sent
// from the Agent Bridge app land in that chat. Called by the /telefono command.
//
// Usage: node arm.js <cwd> [minutes|off]
import { setArmed } from '../../src/live.js';

const [cwd, arg = '60'] = process.argv.slice(2);
const off = /^(off|0|no|stop|spegni)$/i.test(arg.trim());
const minutes = off ? 0 : Math.min(240, Math.max(1, parseInt(arg, 10) || 60));

try {
  setArmed(cwd, minutes);
  console.log(off
    ? 'Ascolto disattivato: i prompt dal telefono torneranno a girare in un processo separato.'
    : `In ascolto per ${minutes} minuti: dall'app, in questa sessione, attiva "Invia alla chat di VS Code".`);
} catch (e) {
  console.log(`Non sono riuscito ad attivare l'ascolto: ${e.message}`);
}
