# Architecture

Agent Bridge keeps credentials, conversations, and agent processes on the PC.
Every client sends authenticated requests to the same local server.

```text
iPhone SwiftUI ─┐
Native Android ─┼─ HTTPS/Tailscale ─ Agent Bridge on Linux ─ Codex / Claude
Web app / PWA ──┘                         │
                                         ├─ ~/.codex/sessions
                                         └─ ~/.claude/projects
```

## Components

- `src/`: HTTP/WebSocket server, authentication, jobs, and conversation reader.
- `public/`: web app and PWA with no build step.
- `ios/`: SwiftUI app and Xcode project.
- `android/`: native Android application.
- `vscode-extension/`: companion that connects the editor chat.
- `scripts/`: setup, Linux service, Claude hook, Codex bridge, and simulators.
- `test/`: Node.js unit and end-to-end tests.
- `.github/workflows/`: reproducible APK and unsigned IPA builds.

## Shared conversations

Codex uses one app-server daemon shared by VS Code and Agent Bridge. A phone
prompt adds a turn to the same thread instead of starting a second writer.
Claude Code uses the `/telefono` hook to deliver a prompt to the VS Code
conversation currently listening.

## Security boundaries

The server listens only on `127.0.0.1`; remote access goes through Tailscale
Serve. Passwords, 2FA keys, sessions, and audit events remain in
`~/.agent-bridge/`, which is not versioned. Mobile apps store only the server
URL, preferences, and session cookie inside their platform sandbox. APK, IPA,
ZIP, and VSIX files are generated build artifacts excluded from Git.
