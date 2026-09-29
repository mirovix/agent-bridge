// Arms (or disarms) the Claude Code chat running in a directory, so prompts sent
// from the Agent Bridge app land in that chat. Called by the /telefono command.
//
// Usage: node arm.js <cwd> [minutes|off]
import { setArmed } from '../../src/live.js';

const [cwd, arg = '60'] = process.argv.slice(2);
// 'spegni' (Italian for "off") is still accepted for existing /telefono users.
const off = /^(off|0|no|stop|spegni)$/i.test(arg.trim());
const minutes = off ? 0 : Math.min(240, Math.max(1, parseInt(arg, 10) || 60));

try {
  setArmed(cwd, minutes);
  console.log(off
    ? 'Listening off: prompts from the phone will run in a separate process again.'
    : `Listening for ${minutes} minutes: in the app, open this session and turn on "Send to the VS Code chat".`);
} catch (e) {
  console.log(`Could not start listening: ${e.message}`);
}
