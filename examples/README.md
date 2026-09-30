# Examples

Ready-to-copy configurations. Copy one to `~/.agent-bridge/config.json`
(`%USERPROFILE%\.agent-bridge\config.json` on Windows), change the address and
the folders, then restart the service. `npm run setup` writes a basic one for you.

| File | For |
| --- | --- |
| [config.basic.json](config.basic.json) | Linux or macOS with Claude Code and Codex. Start here. |
| [config.windows.json](config.windows.json) | Windows paths (note the doubled `\\`). |
| [config.custom-agents.json](config.custom-agents.json) | Extra agents: Gemini CLI, Aider, Ollama. |

What to change:

- `allowedOrigins`: the address `tailscale serve status` prints for this computer.
- `workspaces`: the only folders agents may work in (`~` means your home folder).
- Leave `host` as `127.0.0.1`: remote access goes through Tailscale, never an open port.

Custom agents: the prompt goes to the command's standard input, or replaces
`{prompt}` in `args`. Commands start directly, never through a shell.

## Prompts that work well from the phone

- *"Run the tests and fix what fails. Tell me in three lines what you changed."*
- *"Look at the last commit and tell me if anything is risky."*
- *"Add a `--dry-run` flag to scripts/deploy.sh, with a test."*

## Claude + Codex together (Duo)

- **Review**: *Codex leads* → "Add input validation to the signup form". Codex writes
  the code, Claude reviews the diff without editing, then Codex applies the fixes.
- **Compare**: "Should this service use SQLite or Postgres? Our load is ~50 req/s."
  Both answer side by side, read-only.
- **Ask the other agent**: in any chat, tap **Ask Codex** / **Ask Claude** →
  *Write tests* to pass the latest reply across.
