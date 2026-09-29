# Architettura

Agent Bridge mantiene sul PC credenziali, conversazioni e processi degli agenti.
I client inviano richieste autenticate allo stesso server locale.

```text
iPhone SwiftUI ─┐
Android nativo ─┼─ HTTPS/Tailscale ─ Agent Bridge su Linux ─ Codex / Claude
Web app / PWA ──┘                         │
                                         ├─ ~/.codex/sessions
                                         └─ ~/.claude/projects
```

## Componenti

- `src/`: server HTTP/WebSocket, autenticazione, job e lettura conversazioni.
- `public/`: web app/PWA senza fase di compilazione.
- `ios/`: app SwiftUI e progetto Xcode.
- `android/`: app Android nativa.
- `vscode-extension/`: companion per collegare la chat dell'editor.
- `scripts/`: setup, servizio Linux, hook Claude, bridge Codex e simulatori.
- `test/`: test Node end-to-end e unitari.
- `.github/workflows/`: build riproducibili di APK e IPA non firmato.

## Conversazioni condivise

Codex usa un unico app-server daemon condiviso da VS Code e Agent Bridge. Il
telefono aggiunge un turno alla stessa sessione invece di avviare un secondo
writer. Claude Code usa l'hook `/telefono` per consegnare il prompt alla chat di
VS Code attualmente in ascolto.

## Confini di sicurezza

Il server ascolta solo su `127.0.0.1`; l'accesso remoto passa da Tailscale Serve.
Password, chiavi 2FA, sessioni e audit restano in `~/.agent-bridge/`, che non è
versionata. Le app mobili memorizzano soltanto URL, preferenze e cookie di
sessione nei rispettivi sandbox. I file APK, IPA, ZIP e VSIX sono artefatti di
build esclusi da Git.
