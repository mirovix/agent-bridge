# Agent Bridge per iPhone

Questa cartella contiene una vera app iOS in SwiftUI: login, sessioni, messaggi,
prompt, attività, cartelle e impostazioni sono viste native che comunicano
direttamente con le API del server Agent Bridge. Solo il minigioco HappyDEV usa
una `WKWebView` locale isolata; Instagram Reels viene aperto con Safari protetto.
Supporta inoltre foto, registrazione vocale con trascrizione Whisper sul PC,
cookie di login persistenti e 2FA.

## Requisiti comuni

- iPhone con iOS 16 o successivo.
- Lo stesso account Tailscale attivo su PC e iPhone.
- Il server configurato con un URL HTTPS Tailscale in `allowedOrigins`.

## Installazione diretta sul proprio iPhone

1. Sul Mac apri `ios/AgentBridge.xcodeproj` con Xcode.
2. Seleziona il progetto **AgentBridge**, target **Agent Bridge**, scheda
   **Signing & Capabilities**.
3. Scegli il tuo **Team** Apple. Se Xcode segnala che l'identificatore è già in
   uso, cambia `com.agentbridge.ios` con un valore unico, ad esempio
   `it.tuonome.agentbridge`.
4. Collega l'iPhone al Mac, autorizza il computer e seleziona l'iPhone come
   destinazione in alto.
5. Premi **Run** (`⌘R`). Xcode compila, firma e installa l'app sul telefono.

Con un account Apple gratuito la firma per uso personale scade normalmente dopo
7 giorni; con Apple Developer Program dura più a lungo e puoi distribuire l'app
con TestFlight.

Al primo avvio inserisci l'indirizzo mostrato sul PC da:

```bash
tailscale serve status
```

Deve essere un indirizzo `https://…ts.net`. Per cambiarlo in seguito apri la
scheda **Impostazioni → Cambia indirizzo** dentro Agent Bridge.

## Senza Mac: GitHub Actions + SideStore su Linux

Questa strada mantiene l'app completamente nativa e non richiede un Mac né
l'abbonamento Apple Developer:

1. Carica il progetto in un repository GitHub. Può essere privato.
2. Nel repository apri **Actions → Build iPhone app (unsigned) → Run workflow**.
3. Al termine scarica l'artefatto **AgentBridge-unsigned-ipa** e decomprimilo:
   contiene `AgentBridge-unsigned.ipa`.
4. Sul PC Linux installa SideStore seguendo la guida ufficiale per Linux. Serve
   collegare l'iPhone via USB solo per l'installazione iniziale di SideStore.
5. Trasferisci `AgentBridge-unsigned.ipa` sull'iPhone, per esempio con Taildrop di
   Tailscale, iCloud Drive o l'app File.
6. Nell'app **File** condividi l'IPA con **SideStore**, oppure importalo da
   SideStore. L'app verrà firmata con il tuo Apple Account.
7. In **Impostazioni → Generali → VPN e gestione dispositivo**, autorizza il tuo
   Apple Account se iOS lo richiede.

Con un Apple Account gratuito la firma dura 7 giorni. SideStore può rinnovarla
dall'iPhone tramite LocalDevVPN; aprilo e premi **Refresh All** prima della
scadenza. Questa procedura usa strumenti di sideloading esterni ad Apple: usa
soltanto i siti e i download ufficiali di SideStore e, se preferisci, un Apple
Account dedicato.

## Distribuzione con TestFlight

In Xcode seleziona **Any iOS Device (arm64)**, poi **Product → Archive**. Dalla
finestra Organizer scegli **Distribute App → App Store Connect → Upload**. Servono
l'Apple Developer Program e una scheda dell'app creata in App Store Connect.

In alternativa, con Apple Developer Program puoi automatizzare compilazione,
firma e pubblicazione TestFlight con un servizio cloud come Codemagic, senza
possedere un Mac.
