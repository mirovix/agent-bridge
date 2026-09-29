# Linux installation

The Linux PC runs Agent Bridge, the web app, and the Codex or Claude command-line
tools. Mobile clients connect to this PC; agent credentials are never copied to
the phone.

## Requirements

- Git and Node.js 20 or newer.
- Codex CLI and/or Claude Code installed and authenticated.
- Tailscale on the Linux PC and remote devices.
- `systemd` for automatic startup. Manual startup works without it.

```bash
git --version
node --version
codex --version     # if you use Codex
claude --version    # if you use Claude Code
```

## Install

```bash
git clone https://github.com/mirovix/agent-bridge.git
cd agent-bridge
npm ci
npm test
npm run setup
```

Setup asks for allowed workspaces, a password of at least 14 characters, and a
2FA code. Store the recovery codes in a password manager. Configuration and
secrets are written to `~/.agent-bridge/`, outside the repository.

Test the server:

```bash
npm start
```

Open `http://127.0.0.1:8765` on the same PC. Stop it with `Ctrl+C` after checking
the login.

## Start automatically

```bash
npm run service:install
systemctl --user status agent-bridge
```

The installer detects the project directory and Node.js path. To keep it running
after logout:

```bash
loginctl enable-linger "$USER"
```

Useful commands:

```bash
systemctl --user restart agent-bridge
journalctl --user -u agent-bridge -f
```

## Private remote access

Install Tailscale from its official packages, then run:

```bash
sudo tailscale up
sudo tailscale serve --bg 8765
tailscale serve status
```

Add the displayed `https://…ts.net` URL to `allowedOrigins` in
`~/.agent-bridge/config.json`, then restart Agent Bridge. Use **Tailscale Serve**,
not Funnel, so the service stays inside your tailnet.

Install Tailscale on the remote phone or computer, sign in to the same tailnet,
and open the URL. A mobile browser can install the web app with **Add to Home
Screen**.

## VS Code integration

For Codex:

```bash
python3 scripts/build-vsix.py
code --install-extension vscode-extension/agent-bridge-companion-*.vsix --force
```

Configure `chatgpt.cliExecutable` with the bridge path shown by the extension,
then reload the VS Code window once. Agent Bridge and VS Code will share one
Codex daemon and one conversation writer.

For Claude Code:

```bash
npm run hook:install
```

Enter `/telefono` in the Claude conversation that should receive phone prompts.

## Update

```bash
cd agent-bridge
git pull --ff-only
npm ci
npm test
systemctl --user restart agent-bridge
```

## Troubleshooting

```bash
systemctl --user status agent-bridge
journalctl --user -u agent-bridge -n 100 --no-pager
tailscale status
tailscale serve status
```

After suspicious or repeated failed logins, inspect
`~/.agent-bridge/audit.log`. Use `npm run unlock` only after confirming the
attempts were yours.
