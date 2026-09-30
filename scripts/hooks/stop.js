// Claude Code "Stop" hook: at the end of a turn, if this working directory was
// armed with /telefono, park here and wait for a prompt sent from the Agent Bridge
// app. When one arrives, block stopping so Claude answers it right in this chat.
//
// Not armed (the normal case) => exits in a few milliseconds, nothing changes.
import { clearLive, getArmed, heartbeat, takeInbox } from '../../src/live.js';

const POLL_MS = 500;
const BEAT_MS = 5000;
// Stay well under the hook timeout configured in settings.json (600 s).
const MAX_WAIT_MS = 9 * 60 * 1000;

const readStdin = () => new Promise((resolve) => {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (buf += c));
  process.stdin.on('end', () => resolve(buf));
  setTimeout(() => resolve(buf), 5000).unref();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (process.env.AGENT_BRIDGE_JOB) return; // this agent was started by the app itself
  let input = {};
  try { input = JSON.parse(await readStdin()); } catch { /* run with defaults */ }
  const { session_id: sessionId, cwd } = input;
  const armed = getArmed(cwd);
  if (!armed || !sessionId) return; // not listening: let the turn end immediately
  // Claude Code kills the hook when you type in the chat: stop listening at once,
  // so the app never reports a prompt as delivered to a chat that is gone.
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { clearLive(sessionId); process.exit(0); });

  try {
    const deadline = Math.min(Date.now() + MAX_WAIT_MS, armed.armedUntil);
    let lastBeat = 0;
    while (Date.now() < deadline) {
      if (Date.now() - lastBeat > BEAT_MS) {
        heartbeat(sessionId, cwd, armed.armedUntil);
        lastBeat = Date.now();
      }
      const msg = takeInbox(sessionId);
      if (msg) {
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason: `Prompt sent from the phone with Agent Bridge:\n\n${msg.prompt}\n\n`
            + '(Answer here as you would a normal user message. The reply is also shown on the phone.)',
          systemMessage: '📱 Prompt received from the phone',
        }));
        return;
      }
      if (!getArmed(cwd)) return; // disarmed while waiting
      await sleep(POLL_MS);
    }
  } finally {
    clearLive(sessionId);
  }
}

main().catch(() => process.exit(0));
