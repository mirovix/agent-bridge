# Agent Bridge

Use Codex, Claude Code, and other coding agents running on your Linux PC from
your phone or another computer.

Agent Bridge includes a responsive web app, native iPhone and Android clients,
and a VS Code companion. Your agents, credentials, and conversation files stay
on your computer.

![Agent Bridge desktop chat with demo data](docs/images/agent-bridge-desktop.png)

> This is the real Agent Bridge interface populated with demo data. It is not a
> concept redesign.

## What it does

- Continues the same Codex or Claude conversation used in VS Code.
- Streams responses and running jobs in real time.
- Sends text, screenshots, photos, and locally transcribed voice prompts.
- Lets you select the model, reasoning level, and permission mode.
- Opens Reels or the bundled HappyDEV games while an agent is working, then
  closes the activity when the prompt finishes.
- Protects remote access with password, 2FA, CSRF protection, and Tailscale.

## Install on Linux

Requirements: Node.js 20+, npm, Git, Tailscale, and an authenticated Codex CLI
or Claude Code installation.

```bash
git clone https://github.com/mirovix/agent-bridge.git
cd agent-bridge
npm ci
npm test
npm run setup
npm run service:install
```

Open `http://127.0.0.1:8765` on the Linux PC.

For private remote access:

```bash
sudo tailscale up
sudo tailscale serve --bg 8765
tailscale serve status
```

Add the displayed `https://…ts.net` address to `allowedOrigins` in
`~/.agent-bridge/config.json`, then restart Agent Bridge:

```bash
systemctl --user restart agent-bridge
```

Full instructions: **[Linux installation](docs/INSTALL_LINUX.md)**

## Install the mobile apps

| Platform | Installation |
|---|---|
| iPhone / iPad | [Xcode, GitHub Actions, SideStore, and simulator](docs/INSTALL_IOS.md) |
| Android | [Android Studio, APK, and emulator](docs/INSTALL_ANDROID.md) |
| Mobile browser | Open the Tailscale URL and choose **Add to Home Screen** |

<p align="center">
  <img src="docs/images/agent-bridge-mobile.png" width="390" alt="Agent Bridge mobile chat with demo data">
</p>

## Keep one conversation

For Codex, Agent Bridge and VS Code connect to the same app-server daemon. A
phone prompt becomes a new turn in the existing thread instead of opening a
second terminal or creating a duplicate conversation.

Build and install the companion extension:

```bash
python3 scripts/build-vsix.py
code --install-extension vscode-extension/agent-bridge-companion-*.vsix --force
```

For Claude Code, install the hook and enable it in the VS Code conversation you
want to use:

```bash
npm run hook:install
```

```text
/telefono
```

## Repository layout

```text
src/               Linux server and agent integration
public/            Web app and installable PWA
ios/               Native SwiftUI app
android/           Native Android app
vscode-extension/  VS Code companion
scripts/           Setup, service, hooks, and emulator launchers
test/              Security, session, and job tests
```

See [Architecture](docs/ARCHITECTURE.md) for the data flow and security
boundaries.

## Development

```bash
npm ci
npm test
npm start
```

The web app has no build step. GitHub Actions tests the server and produces the
Android debug APK and unsigned iPhone IPA.

## Security

Anyone who can access Agent Bridge may be able to run coding-agent commands on
your PC. Keep the server bound to `127.0.0.1`, use **Tailscale Serve**, keep
dangerous permission modes disabled, and never expose it with Tailscale Funnel.

MIT licensed.
