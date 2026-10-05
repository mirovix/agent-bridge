# Architecture

Agent Bridge keeps credentials, conversations, and agent processes on the PC.
There is one client, the installable web app the server itself serves, so every
device runs the same code and updates with the server.

```text
phone · tablet · laptop
 (web app on the home screen) ─ HTTPS/Tailscale ─ Agent Bridge ─ Codex / Claude
 VS Code companion ─ 127.0.0.1 ─────────────────────┘    │
                                                        ├─ ~/.codex/sessions
                                                        └─ ~/.claude/projects
```

## Components

- `src/`: HTTP/WebSocket server, authentication, jobs, and conversation reader.
- `public/`: the installable web app, with no build step (`happydev/` is the bundled waiting-room games).
- `vscode-extension/`: companion that connects the editor chat.
- `scripts/`: setup, autostart for each OS, Claude hook, Codex bridge.
- `examples/`: ready-made configurations.
- `test/`: unit, integration, UI (headless Chrome) and opt-in real-agent tests.
- `.github/workflows/`: tests on Linux, macOS and Windows, and the release packaging.

## Shared conversations

Codex uses one app-server daemon shared by VS Code and Agent Bridge. A phone
prompt adds a turn to the same thread instead of starting a second writer.
Claude Code uses the `/phone` hook to deliver a prompt to the VS Code
conversation currently listening.

## Claude and Codex together

`src/duo.js` plans a duo as ordinary jobs, so limits, permissions, timeouts and the
audit log are the same as for a single prompt:

- **review**: the lead runs in its usual chat for the folder. Before it starts, a
  `git stash create` snapshot records the working tree without touching it; afterwards
  the reviewer gets the task, the lead's final reply and the exact diff since that
  snapshot, and runs read-only (`manual` for Claude, `read-only` for Codex) in a
  separate chat. With "apply", the review goes back to the lead in the same chat.
- **compare**: both agents get the same prompt at once, read-only.
- **handoff** (`POST /api/handoff`): the latest reply of a chat or job is passed to the
  other agent with an instruction.

Web app settings (`/api/prefs`) are stored in `~/.agent-bridge/ui-prefs.json` and pushed
to every open device over the WebSocket.

## Security boundaries

The server listens only on `127.0.0.1`; remote access goes through Tailscale
Serve. Passwords, 2FA keys, sessions, and audit events remain in
`~/.agent-bridge/`, which is not versioned. On a device the web app keeps only
its session cookie and a copy of the settings, inside the browser's storage for
that origin. ZIP and VSIX files are generated build artifacts excluded from Git.
