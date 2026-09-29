# Agent Bridge

Web app (PC e telefono) per leggere e inviare prompt a **Claude Code**, **Codex** e ad altri agenti CLI che girano sul tuo PC, anche quando non sei a casa.

## Installazione

| Piattaforma | Cosa installare | Guida |
|---|---|---|
| PC Linux | Server locale, web app e collegamento VS Code | [Installazione Linux](docs/INSTALL_LINUX.md) |
| iPhone / iPad | App SwiftUI nativa oppure PWA | [Installazione iPhone](docs/INSTALL_IOS.md) |
| Android | App nativa, APK o emulatore | [Installazione Android](docs/INSTALL_ANDROID.md) |

La [panoramica tecnica](docs/ARCHITECTURE.md) spiega come server, app native,
web app e conversazioni condivise lavorano insieme. I pacchetti compilati non
sono conservati nella repository: le workflow GitHub producono APK e IPA a
partire dai sorgenti, così ogni release è riproducibile.

- Vedi tutte le sessioni, comprese quelle aperte dalle estensioni di **VS Code** (Claude Code e Codex salvano le conversazioni negli stessi file che legge l'app).
- Leggi la conversazione in tempo reale mentre l'agente lavora.
- Ogni agente continua automaticamente un’unica conversazione per cartella, visibile anche dalla cronologia di VS Code.
- Per ogni prompt scegli **modello**, **livello di ragionamento** e **permessi** (⚙ accanto a "Invia"); le scelte vengono ricordate per ogni agente.
- **Dettatura vocale** (🎤) trascritta in locale sul PC con Whisper: l'audio non esce dal computer.
- **Foto e screenshot** (📎, o incolla un'immagine): vengono ridimensionate sul telefono e passate all'agente.
- **Impostazioni e sicurezza**: predefiniti, lingua della voce, tema, dispositivi collegati (disconnettibili uno per uno), registro accessi.
- Aggiungi altri agenti (Gemini CLI, Aider, …) dal file di configurazione.
- Si installa sulla schermata home del telefono come una vera PWA: manifest valido, modalità standalone e shell disponibile anche se la rete cade temporaneamente.
- Include vere app native per iPhone (`ios/`) e Android (`android/`); solo le attività opzionali Instagram Reels e HappyDEV usano viste web isolate.

### Far comparire il prompt del telefono nella chat di VS Code

La chat di Claude Code non accetta messaggi dall'esterno, ma un **hook `Stop`** può
tenerla in ascolto: a fine risposta resta in attesa e, quando arrivi un prompt
dall'app, lo consegna lì, in quella stessa conversazione.

```bash
npm run hook:install      # registra l'hook in ~/.claude/settings.json (copia di sicurezza .bak)
```

Poi, nella chat di VS Code in cui vuoi ricevere i prompt:

```
/telefono          # in ascolto per 60 minuti
/telefono 180      # per 3 ore
/telefono off      # smetti
```

Da quel momento, nell'app quella sessione mostra **chat in ascolto** e nella barra dei
prompt compare la pillola **Chat VS Code**: con quella attiva il prompt compare nella
chat aperta sul PC, che risponde lì — e la risposta si legge anche sull'app.

Dettagli: l'ascolto vale per la cartella di lavoro, dura al massimo 9 minuti per
turno (poi va riattivato con un nuovo prompt in chat) e scade da solo. Senza
`/telefono` l'hook esce in millisecondi, quindi non rallenta le altre sessioni, e non
si attiva mai negli agenti che l'app stessa avvia (niente attese circolari).

### Stessa chat Codex tra iPhone e VS Code

Codex e Agent Bridge usano lo stesso **app-server daemon**. Esiste quindi un solo writer: il prompt dell'iPhone diventa un nuovo turno della chat già aperta in VS Code, che si aggiorna in diretta. Non viene aperto alcun terminale e non viene creata una copia della conversazione.

Imposta `chatgpt.cliExecutable` sul bridge incluso e installa la companion extension:

```bash
python3 scripts/build-vsix.py        # crea vscode-extension/agent-bridge-companion-<versione>.vsix
code --install-extension vscode-extension/agent-bridge-companion-*.vsix --force
```

La companion mostra solo lo stato e le notifiche e apre la chat nativa Codex/Claude; non crea terminali. Dopo la prima configurazione ricarica una volta la finestra di VS Code.

Impostazioni disponibili: `agentBridge.notify` e `agentBridge.openInChat`.

### Se Codex dice "already has an active writer"

Ricarica una volta la finestra di VS Code dopo aver configurato il bridge condiviso.
Da quel momento VS Code e l'app parlano allo stesso daemon e il conflitto non si presenta.

### Instagram Reels o HappyDEV durante l'attesa

Dopo l'invio di un prompt l'app nativa apre Instagram Reels in un pannello interno.
Il login e i cookie sono gestiti da Safari su iPhone e dal browser protetto su Android:
Agent Bridge non legge né conserva le credenziali Instagram. Il job continua in
background; puoi passare a **Stato** e chiudere il pannello quando il lavoro è finito.

In alternativa puoi scegliere **HappyDEV**, con cinque giochi touch inclusi
(Flappy Code, Deploy Dash, Sine Glide, Stack Overflow e snake_case). La scelta
predefinita si cambia nelle impostazioni e resta modificabile mentre l'agente lavora.
La stessa esperienza è disponibile nella web app: HappyDEV resta nel pannello
interno, mentre Instagram viene aperto nel sito ufficiale perché ne impedisce
l'incorporamento diretto nelle normali pagine web. Quando il prompt termina, il
pannello e l'eventuale finestra Reels si chiudono automaticamente su web, iOS e Android.

### Voce locale (opzionale)

```bash
python3 -m venv ~/.agent-bridge/whisper
~/.agent-bridge/whisper/bin/pip install --only-binary=:all: "faster-whisper==1.0.3" "tokenizers<0.20" "av<13" "onnxruntime<1.20" "numpy<1.25"
systemctl --user restart agent-bridge
```

(Versioni fissate per Python 3.8. Il modello `small` viene scaricato al primo uso in `~/.agent-bridge/whisper-models`.) Senza Whisper l'app usa il riconoscimento vocale del browser, se presente.

## Avvio rapido

```bash
git clone https://github.com/mirovix/agent-bridge.git
cd agent-bridge
npm ci
npm run setup     # password + 2FA: scansiona il QR con l'app di autenticazione
npm start         # http://127.0.0.1:8765 (solo dal PC)
```

Per l'avvio automatico su Linux usa `npm run service:install`. La guida Linux
contiene anche aggiornamento, Tailscale e diagnostica.

Da telefono apri l'indirizzo HTTPS mostrato da `tailscale serve status`. Su iPhone
usa Safari → **Condividi → Aggiungi alla schermata Home**; su Android usa il menu
del browser → **Installa app**. La web app mantiene login, chat e preferenze sul
dispositivo e continua a usare la stessa conversazione del PC.

## App nativa per iPhone

Il progetto Xcode è in [`ios/AgentBridge.xcodeproj`](ios/AgentBridge.xcodeproj).
L'interfaccia è interamente nativa SwiftUI e comunica direttamente con le API del
server. Include configurazione HTTPS Tailscale, sessioni,
chat, nuovi prompt, attività, cartelle, foto, registrazione vocale, impostazioni,
cookie persistenti e 2FA.

Il metodo standard usa un Mac con Xcode: apri il progetto, seleziona il tuo Apple
Team e premi **Run** con l'iPhone collegato. Le istruzioni complete, inclusa la
distribuzione TestFlight, sono in [`ios/README.md`](ios/README.md).

Se non possiedi un Mac, il workflow GitHub Actions incluso compila un IPA nativo
su un runner macOS; dal PC Linux puoi poi firmarlo e installarlo con SideStore.
Con un Apple Account gratuito l'app deve essere rinnovata ogni 7 giorni.

## Simulatori nativi

Su questo PC il simulatore Android è già configurato con Google Play. Da Visual
Studio Code esegui **Tasks: Run Task → Agent Bridge: avvia simulatore Android**,
oppure:

```bash
scripts/run-android-emulator.sh
```

Il comando avvia `medium_phone`, aspetta il boot, installa l'APK aggiornato e apre
Agent Bridge. Il simulatore iPhone ufficiale richiede macOS e Xcode; su un Mac lo
stesso flusso è pronto con **Agent Bridge: avvia simulatore iPhone (solo Mac)** o:

```bash
scripts/run-ios-simulator.sh
```

Su Linux i test iOS si eseguono sull'iPhone fisico collegato.

`npm run setup` ti chiede:
1. le cartelle in cui gli agenti possono lavorare (predefinita `~/workspace`);
2. l'URL remoto (puoi lasciarlo vuoto e aggiungerlo dopo, vedi sotto);
3. una password (almeno 14 caratteri);
4. di scansionare un QR con **Aegis / Google Authenticator / 1Password / Authy** e inserire il codice;
5. mostra **8 codici di recupero**: salvali in un password manager, non verranno più mostrati.

## Accesso dal telefono / da fuori casa (Tailscale)

Il server **non è mai esposto su Internet**: ascolta solo su `127.0.0.1`. Per raggiungerlo da fuori si usa [Tailscale](https://tailscale.com), una VPN cifrata (WireGuard) tra i tuoi dispositivi.

```bash
# sul PC
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale serve --bg 8765      # HTTPS con certificato valido, solo dentro la tua tailnet
tailscale serve status              # mostra l'URL, es. https://mio-pc.tailXXXX.ts.net
```

1. Nella [console Tailscale](https://login.tailscale.com/admin/dns) abilita **MagicDNS** e **HTTPS Certificates**.
2. Aggiungi l'URL a `~/.agent-bridge/config.json`:
   ```json
   "allowedOrigins": ["https://mio-pc.tailXXXX.ts.net"]
   ```
   e riavvia il server.
3. Installa l'app Tailscale sul telefono, accedi con lo stesso account, apri l'URL.
   Da Safari/Chrome: *Condividi → Aggiungi a schermata Home*.

> ⚠️ **Non usare `tailscale funnel`**: pubblicherebbe l'app su Internet. `serve` la rende visibile solo ai tuoi dispositivi.

Per una sicurezza ancora maggiore, nelle ACL di Tailscale permetti la porta 443 del PC solo al tuo telefono e al tuo portatile.

## Avvio automatico (systemd)

```bash
npm run service:install
loginctl enable-linger $USER     # resta attivo anche senza sessione grafica aperta
journalctl --user -u agent-bridge -f
```

L'installer rileva automaticamente la cartella del progetto e il binario Node,
quindi non contiene percorsi legati al PC dello sviluppatore.

## Sicurezza

Chi entra in questa app può far eseguire comandi sul tuo PC, quindi le protezioni sono a più livelli:

| Livello | Protezione |
|---|---|
| Rete | Il server ascolta solo su `127.0.0.1` (rifiuta di partire altrimenti). Da fuori si entra solo tramite Tailscale: traffico cifrato WireGuard + HTTPS, solo dispositivi del tuo account. |
| Login | Password **e** codice TOTP verificati insieme (non si scopre quale dei due era sbagliato). Password con scrypt (128 MiB, ~0,3 s a tentativo). Il segreto 2FA è cifrato con AES-256-GCM usando una chiave derivata dalla password: rubare `secrets.json` non basta a generare codici. |
| Brute force | Dopo 5 tentativi falliti il login si blocca per 15 min, poi 30, 60… fino a 24 h. Un solo tentativo alla volta. Ogni codice TOTP vale una volta sola (anti-replay). |
| Sessione | Cookie `__Host-` `HttpOnly` `Secure` `SameSite=Strict`, token casuale a 256 bit (il server conserva solo l'hash). Scade dopo 30 min di inattività e comunque dopo 12 h. Riavviare il server disconnette tutti. |
| Richieste | Controllo `Host` (anti DNS-rebinding), controllo `Origin`, token CSRF su ogni azione, WebSocket autenticato. CSP rigorosa (nessuno script inline), niente `innerHTML`: i messaggi degli agenti non possono iniettare codice nella pagina. |
| Esecuzione | Solo gli agenti configurati, lanciati **senza shell**, con il prompt su stdin. Solo dentro le cartelle in `workspaces`. Le modalità pericolose (`bypassPermissions`, `danger-full-access`) sono disattivate di default. Max 3 job contemporanei, timeout 60 min. |
| Tracciabilità | `~/.agent-bridge/audit.log` registra login riusciti/falliti, job avviati/fermati (con hash del prompt, non il testo). |
| File | `~/.agent-bridge/` è `0700`, i file `0600`; il server non parte se sono leggibili da altri utenti. |

**Pulsante di emergenza**: menu ⋮ → *Esci da tutti i dispositivi e ferma i job*.

**Se perdi il telefono**: accedi con password + un codice di recupero, poi dal PC esegui `npm run setup` per generare una nuova 2FA (invalida anche i vecchi codici).

**Se il login è bloccato** perché qualcuno ha provato ad entrare: guarda `~/.agent-bridge/audit.log`, poi sul PC `npm run unlock`.

## Configurazione (`~/.agent-bridge/config.json`)

```jsonc
{
  "port": 8765,
  "allowedOrigins": ["https://mio-pc.tailXXXX.ts.net"],
  "workspaces": ["/home/utente/workspace"],
  "sessionIdleMinutes": 30,
  "sessionMaxHours": 12,
  "allowDangerousModes": false,
  "maxConcurrentJobs": 3,
  "jobTimeoutMinutes": 60,
  "agents": {
    "claude": { "enabled": true, "command": "claude" },
    "codex":  { "enabled": true, "command": "codex" },
    "custom": [
      // il prompt arriva su stdin, oppure al posto di "{prompt}" negli argomenti
      { "id": "gemini", "name": "Gemini CLI", "command": "gemini", "args": ["-p", "{prompt}"] },
      { "id": "aider", "name": "Aider", "command": "aider", "args": ["--yes", "--message", "{prompt}"] }
    ]
  }
}
```

Gli agenti personalizzati non hanno cronologia leggibile: l'output del job viene mostrato nella pagina del job.

## Modalità dei permessi

In remoto non puoi approvare le singole azioni come in VS Code, quindi scegli la modalità prima di inviare:

- **Claude Code**: `plan` (solo lettura, propone un piano), `manual` (le azioni che chiedono permesso vengono negate), `acceptEdits` (può modificare file; predefinita), `auto` (classificatore di sicurezza).
- **Codex**: `read-only`, `workspace-write` (predefinita).

## Come funziona il collegamento con VS Code

Le estensioni di VS Code per Claude Code e Codex salvano le conversazioni in `~/.claude/projects/` e `~/.codex/sessions/`. L'app legge quei file. Per Codex, telefono e VS Code si collegano allo stesso app-server daemon e inviano turni alla medesima sessione; per Claude resta disponibile il collegamento tramite hook `/telefono`.

Il pannello Codex aperto si aggiorna direttamente. Se un turno è già in corso, Codex gestisce il nuovo messaggio nella stessa sessione senza creare chat duplicate.

## Sviluppo

```bash
npm test    # TOTP (vettori RFC 6238), parser delle sessioni, test end-to-end di sicurezza sul server
```

Struttura: `src/server.js` (HTTP + WebSocket), `src/auth.js` (password, 2FA, sessioni, blocco), `src/jobs.js` (esecuzione agenti), `src/transcripts.js` (lettura sessioni), `public/` (web app, senza build).
