# Agent Bridge per Android

App Android nativa, compatibile con Android 8 e successivi. L'interfaccia e la chat
sono native. Durante l'attesa si può scegliere dalle impostazioni tra Instagram
Reels e HappyDEV, una raccolta di cinque minigiochi utilizzabile anche offline.
Le due attività usano WebView isolate e il lavoro dell'agente continua in background.

La tastiera si chiude con il tasto di sistema o toccando qualsiasi area esterna al
campo del messaggio. Il launcher `scripts/run-android-emulator.sh` avvia il telefono
virtuale con un cold boot, installa l'APK corrente e apre automaticamente l'app.

La build di debug viene prodotta dalla workflow GitHub `android-debug.yml`. Per
usarla, scaricare l'artefatto `AgentBridge-Android-debug`, estrarre l'APK e
installarlo sul telefono autorizzando le app provenienti dal browser o dal file
manager utilizzato.
