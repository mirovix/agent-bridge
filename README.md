<p align="center"><img src="branding/agent-bridge-icon-v2.png" width="112" alt="Agent Bridge"></p>

<h1 align="center">Agent Bridge</h1>

<p align="center">Use Codex, Claude Code and other coding agents running on your computer from your phone or any other device.<br>
Server: Linux · macOS · Windows. Clients: web, iPhone, Android, VS Code.</p>

<p align="center"><a href="https://github.com/mirovix/agent-bridge/releases/latest"><b>Download the latest release</b></a></p>

![Agent Bridge on desktop, with demo data](docs/images/agent-bridge-desktop.png)

Agent Bridge is a small server that runs next to your agents. You reach it privately through Tailscale, sign in with a password and 2FA, and keep working in the **same** conversation you started in VS Code. Agents, credentials and transcripts never leave your computer.

## Download

Everything is on the **[Releases page](https://github.com/mirovix/agent-bridge/releases/latest)**.

| Part | File | Runs on |
| --- | --- | --- |
| Server | `agent-bridge-server-<version>.zip` (or `.tar.gz`) | Linux, macOS, Windows, with Node.js 20+ |
| Android app | `AgentBridge-<version>-android.apk` | Android 8 and newer |
| iPhone / iPad app | `AgentBridge-<version>-ios-unsigned.ipa` | iOS 16 and newer, installed with a sideloading tool (or build it with Xcode) |
| VS Code companion | `agent-bridge-companion-<version>.vsix` | VS Code 1.80+ |
| Web app | nothing to download | any browser: open your server's address, then **Add to Home Screen** |

`SHA256SUMS.txt` lists the checksums of every file.

## Quick start

**1. On the computer with your agents** (Terminal, or PowerShell on Windows). You need Node.js 20+, [Tailscale](https://tailscale.com/download), and Codex CLI or Claude Code signed in. Download and extract the server, then run:

```bash
npm ci
npm run setup            # folders, password, 2FA
npm run service:install  # start automatically (systemd / launchd / Task Scheduler)
tailscale serve --bg 8765
tailscale serve status   # shows your private https://…ts.net address
```

Add that address to `allowedOrigins` in `~/.agent-bridge/config.json` and restart the service.

**2. On your phone**, install Tailscale and the Agent Bridge app (or just open the address in the browser), enter the address, then your password and 2FA code.

Full guides: **[Server (Linux, macOS, Windows)](docs/INSTALL_SERVER.md)** · **[Android](docs/INSTALL_ANDROID.md)** · **[iPhone and iPad](docs/INSTALL_IOS.md)**

## Features

- Continues the same Codex or Claude conversation you use in VS Code.
- Streams replies and running jobs live.
- Sends text, screenshots, photos and voice notes. Voice is transcribed on your computer with Whisper, and the language is detected automatically.
- Lets you pick the model, the reasoning level and the permission mode for each prompt.
- Something to do while you wait: HappyDEV mini-games or Reels, closed automatically when the agent finishes.
- Security: password, 2FA with recovery codes, CSRF protection, a lockout after failed attempts, an audit log, and access only through your tailnet.

<p align="center">
  <img src="docs/images/agent-bridge-mobile.png" width="390" alt="Agent Bridge on a phone, with demo data">
</p>

## Keep one conversation with VS Code

- **Codex**: install the `.vsix` companion (`code --install-extension agent-bridge-companion-<version>.vsix`) and set `chatgpt.cliExecutable` to the path it shows. VS Code and Agent Bridge then share one Codex app-server, so a phone prompt becomes the next turn of the same thread.
- **Claude Code**: run `npm run hook:install`, then type `/telefono` in the conversation that should receive phone prompts.

## Security

Anyone who can reach Agent Bridge and sign in can run agent commands on your computer. Keep the server bound to `127.0.0.1`, reach it only through **Tailscale Serve** (never Funnel), use a long password with 2FA, and leave the dangerous permission modes off unless you need them.

## Repository layout

```text
src/               server and agent integration (Node.js)
public/            web app / installable PWA (no build step)
ios/               native SwiftUI app
android/           native Android app
vscode-extension/  VS Code companion
scripts/           setup, autostart for each OS, hooks, emulator launchers
test/              server, security, session and job tests
```

See [Architecture](docs/ARCHITECTURE.md) for the data flow and security boundaries.

## Development

```bash
git clone https://github.com/mirovix/agent-bridge.git
cd agent-bridge
npm ci
npm test
npm start
```

CI runs the tests on Linux, macOS and Windows. To publish a release, bump the versions and push a tag:

```bash
git tag v1.4.0
git push origin v1.4.0
```

The [Release workflow](.github/workflows/release.yml) builds the server package, the Android APK, the unsigned iPhone IPA and the VS Code companion, then publishes them together.

MIT licensed.
