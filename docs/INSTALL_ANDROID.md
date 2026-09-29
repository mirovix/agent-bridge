# Installazione su Android

Il client Android è nativo e supporta Android 8 (API 26) e successivi.

## Build con GitHub Actions

1. Apri **Actions → Android debug APK → Run workflow**.
2. Scarica l'artefatto `AgentBridge-Android-debug`.
3. Estrai `app-debug.apk`, trasferiscilo sul telefono e aprilo.
4. Consenti temporaneamente l'installazione da quella sorgente quando Android lo
   richiede.
5. Avvia Agent Bridge e inserisci l'URL HTTPS mostrato sul PC da
   `tailscale serve status`.

## Build locale con Android Studio

Requisiti: Android Studio, JDK 17 e Android SDK 37.

1. Apri la cartella `android/` in Android Studio.
2. Attendi la sincronizzazione Gradle.
3. Seleziona un dispositivo fisico o virtuale.
4. Premi **Run**, oppure usa **Build → Build APK(s)**.

L'APK di debug viene creato in
`android/app/build/outputs/apk/debug/app-debug.apk`.

## Emulatore Android

Crea da Android Studio un AVD chiamato `medium_phone`, quindi:

```bash
export ANDROID_SDK_ROOT="$HOME/Android/Sdk"  # adatta se necessario
scripts/run-android-emulator.sh
```

Lo script aspetta il boot, installa l'APK già compilato e apre Agent Bridge. Se
l'APK è in un altro percorso:

```bash
AGENT_BRIDGE_APK=/percorso/app-debug.apk scripts/run-android-emulator.sh
```

Nel simulatore, per raggiungere un server avviato sullo stesso PC puoi usare
Tailscale oppure l'URL appropriato alla rete dell'emulatore, purché sia HTTPS e
presente in `allowedOrigins`.
