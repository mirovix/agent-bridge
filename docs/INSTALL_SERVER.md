# Server installation (Linux, macOS, Windows)

The server runs on the computer where Codex and Claude Code live. The web app,
the phone apps and the VS Code companion all connect to it; agent credentials
never leave that computer.

## Requirements

- Node.js 20 or newer (22 recommended).
- Codex CLI and/or Claude Code, installed and signed in.
- [Tailscale](https://tailscale.com/download) on this computer and on every device
  that should reach it.

Check them:

```bash
node --version
codex --version     # if you use Codex
claude --version    # if you use Claude Code
```

## 1. Get the server

Download `agent-bridge-server-<version>.zip` from the
[latest release](https://github.com/mirovix/agent-bridge/releases/latest) and
extract it, or clone the repository:

```bash
git clone https://github.com/mirovix/agent-bridge.git
cd agent-bridge
```

## 2. Install and configure

Run these in the extracted folder (Terminal on macOS/Linux, PowerShell on Windows):

```bash
npm ci
npm test
npm run setup
```

Setup asks for the folders the agents may work in, a password of at least
14 characters and a 2FA code from your authenticator app. Keep the recovery
codes in a password manager. Configuration and secrets are stored outside the
project folder, in `~/.agent-bridge/` (`%USERPROFILE%\.agent-bridge\` on Windows).

Try it:

```bash
npm start
```

Open `http://127.0.0.1:8765`, sign in, then stop the server with `Ctrl+C`.

## 3. Start automatically

```bash
npm run service:install
```

| System | What gets installed | Status | Logs |
| --- | --- | --- | --- |
| Linux | systemd user service `agent-bridge` | `systemctl --user status agent-bridge` | `journalctl --user -u agent-bridge -f` |
| macOS | LaunchAgent `it.agentbridge.server` | `launchctl print gui/$(id -u)/it.agentbridge.server` | `tail -f ~/Library/Logs/agent-bridge.log` |
| Windows | Scheduled Task `AgentBridge`, at logon, for your user | `schtasks /Query /TN AgentBridge /V /FO LIST` | — |

Preview what the installer would do without changing anything:

```bash
npm run service:install -- --dry-run
```

Remove it with `npm run service:uninstall`.

Notes:

- **Linux**: to keep the server running after you log out, run `loginctl enable-linger "$USER"`.
- **Windows**: if your organisation blocks per-user scheduled tasks ("Access denied"), run the command from an elevated PowerShell. The task restarts the server if it stops, at most once a minute.

## 4. Private remote access

Tailscale Serve publishes the server inside your private tailnet only:

```bash
tailscale serve --bg 8765
tailscale serve status
```

On Linux prefix the commands with `sudo`. On macOS, if `tailscale` is not on your
PATH, use `/Applications/Tailscale.app/Contents/MacOS/Tailscale`.

Add the `https://…ts.net` address it shows to `allowedOrigins` in
`~/.agent-bridge/config.json`, then restart Agent Bridge. Use **Serve**, never
**Funnel**: Funnel would put the server on the public internet.

On the phone or other computer, install Tailscale, sign in to the same tailnet and
open that address, or enter it in the Agent Bridge app.

## 5. VS Code: keep one conversation

Install the companion from the release (`agent-bridge-companion-<version>.vsix`):

```bash
code --install-extension agent-bridge-companion-<version>.vsix --force
```

- **Codex**: set `chatgpt.cliExecutable` to the bridge path the extension shows,
  then reload the VS Code window once. VS Code and Agent Bridge then share one
  Codex daemon, so phone prompts continue the same thread.
- **Claude Code**: run `npm run hook:install`, then type `/telefono` in the Claude
  conversation that should receive phone prompts.

## Voice notes (optional)

With a local faster-whisper install, voice notes are transcribed on this computer
and the audio never leaves it. Without it, the web app falls back to the browser's
speech recognition. The server looks for the Python environment in
`~/.agent-bridge/whisper/` (`bin/python` on macOS/Linux, `Scripts\python.exe` on
Windows).

## Update

Download the new release (or `git pull --ff-only`), then:

```bash
npm ci
npm test
npm run service:install
```

## Troubleshooting

- Server log: see the table above for your system.
- `tailscale status` and `tailscale serve status` show whether remote access is up.
- After repeated failed sign-ins, check `~/.agent-bridge/audit.log`. Run
  `npm run unlock` only once you're sure the attempts were yours.
