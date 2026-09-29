# Installazione su Linux

Il PC Linux esegue il server Agent Bridge, la web app e i programmi `codex` e
`claude`. Telefono e browser si collegano a questo PC: le credenziali degli
agenti non vengono copiate nelle app mobili.

## 1. Requisiti

- Linux con `systemd` per l'avvio automatico (l'avvio manuale funziona anche
  senza `systemd`).
- Git, Node.js 20 o successivo e npm.
- Codex CLI e/o Claude Code già installati e autenticati con il proprio account.
- Tailscale sul PC e sui dispositivi remoti.

Verifica l'ambiente:

```bash
git --version
node --version
npm --version
codex --version    # se usi Codex
claude --version   # se usi Claude Code
```

## 2. Scarica e configura

```bash
git clone https://github.com/mirovix/agent-bridge.git
cd agent-bridge
npm ci
npm test
npm run setup
```

Durante `setup` scegli le cartelle di lavoro, crea una password di almeno 14
caratteri, registra il QR 2FA e conserva i codici di recupero in un password
manager. Configurazione e segreti rimangono fuori dalla repository, dentro
`~/.agent-bridge/`.

Avvia una prima volta in foreground:

```bash
npm start
```

Apri `http://127.0.0.1:8765` sullo stesso PC e verifica il login. Interrompi con
`Ctrl+C`.

## 3. Avvio automatico

```bash
npm run service:install
systemctl --user status agent-bridge
```

L'installer crea un servizio utente con i percorsi effettivi di questa copia.
Per mantenerlo attivo anche dopo il logout:

```bash
loginctl enable-linger "$USER"
```

Comandi utili:

```bash
systemctl --user restart agent-bridge
journalctl --user -u agent-bridge -f
```

## 4. Accesso remoto privato

Installa Tailscale dai pacchetti ufficiali, poi:

```bash
sudo tailscale up
sudo tailscale serve --bg 8765
tailscale serve status
```

Copia l'URL `https://…ts.net` mostrato dal comando dentro `allowedOrigins` in
`~/.agent-bridge/config.json`, quindi riavvia il servizio. Usa **Tailscale
Serve**, non Funnel: Serve limita l'accesso ai dispositivi della tua tailnet.

Sul telefono o sul PC remoto installa Tailscale, entra nello stesso account e
apri quell'URL. Dal browser puoi installare anche la PWA.

## 5. Collegamento alle chat di VS Code

Per Codex compila e installa la companion extension:

```bash
python3 scripts/build-vsix.py
code --install-extension vscode-extension/agent-bridge-companion-*.vsix --force
```

Imposta `chatgpt.cliExecutable` sul bridge indicato dall'estensione e ricarica
una volta la finestra VS Code. Agent Bridge e VS Code useranno lo stesso daemon
Codex, evitando due writer sulla stessa conversazione.

Per Claude Code:

```bash
npm run hook:install
```

Poi digita `/telefono` nella chat Claude di VS Code che vuoi collegare.

## Aggiornamento

```bash
cd agent-bridge
git pull --ff-only
npm ci
npm test
systemctl --user restart agent-bridge
```

## Diagnostica rapida

```bash
systemctl --user status agent-bridge
journalctl --user -u agent-bridge -n 100 --no-pager
tailscale status
tailscale serve status
```

Se il login è temporaneamente bloccato dopo tentativi errati, controlla prima
il registro `~/.agent-bridge/audit.log`, quindi esegui `npm run unlock`.
