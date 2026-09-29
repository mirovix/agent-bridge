# Installazione su iPhone e iPad

Il client iOS è una vera app SwiftUI. Richiede iOS 16 o successivo e l'URL HTTPS
del server Agent Bridge raggiungibile tramite Tailscale.

## Metodo consigliato: Mac con Xcode

1. Clona la repository sul Mac e apri `ios/AgentBridge.xcodeproj`.
2. Seleziona il target **Agent Bridge**, poi **Signing & Capabilities**.
3. Scegli il tuo Apple Team. Se necessario, cambia il bundle identifier
   `com.agentbridge.ios` con uno univoco.
4. Collega e autorizza l'iPhone, selezionalo come destinazione e premi **Run**.
5. Al primo avvio inserisci l'URL restituito sul PC Linux da
   `tailscale serve status`, poi password e codice 2FA.

Con un account Apple gratuito la firma di sviluppo deve normalmente essere
rinnovata ogni 7 giorni. TestFlight richiede l'Apple Developer Program.

## Senza Mac: build GitHub Actions

1. Apri la scheda **Actions** della repository.
2. Avvia **Build iPhone app (unsigned)**.
3. Scarica l'artefatto `AgentBridge-unsigned-ipa` al termine della workflow.
4. Firma e installa l'IPA con SideStore o un altro strumento di sideloading
   affidabile. Inserisci Apple ID, password e 2FA soltanto nell'app ufficiale
   scelta, mai in una issue o in un file della repository.
5. Se iOS lo richiede, abilita **Modalità sviluppatore** e autorizza il profilo
   in **Impostazioni → Generali → VPN e gestione dispositivo**.

Un IPA non firmato non si può avviare direttamente: la firma lega la build al
dispositivo e all'account Apple.

## Simulatore iPhone

Il simulatore ufficiale esiste soltanto su macOS con Xcode:

```bash
scripts/run-ios-simulator.sh
```

Su Linux usa un iPhone fisico oppure la build cloud. Non esiste un emulatore iOS
ufficiale per Linux capace di sostituire la verifica sul dispositivo reale.

Per ulteriori dettagli su SideStore e TestFlight consulta anche
[`ios/README.md`](../ios/README.md).
