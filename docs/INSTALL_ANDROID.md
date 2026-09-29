# Android installation

The native Android client supports Android 8 (API 26) and newer.

## Install the GitHub Actions APK

1. Open **Actions → Android debug APK → Run workflow**.
2. Download the `AgentBridge-Android-debug` artifact.
3. Extract `app-debug.apk`, transfer it to the phone, and open it.
4. Temporarily allow installation from that file manager or browser when
   Android asks.
5. Start Agent Bridge and enter the HTTPS URL printed by
   `tailscale serve status` on the Linux PC.

## Build with Android Studio

Requirements: Android Studio, JDK 17, and Android SDK 37.

1. Open the `android/` directory in Android Studio.
2. Wait for Gradle synchronization.
3. Select a physical or virtual device.
4. Press **Run**, or use **Build → Build APK(s)**.

The debug APK is written to
`android/app/build/outputs/apk/debug/app-debug.apk`.

## Emulator

Create an Android Virtual Device named `medium_phone`, then run:

```bash
export ANDROID_SDK_ROOT="$HOME/Android/Sdk"  # adjust when necessary
scripts/run-android-emulator.sh
```

The launcher waits for boot, installs the compiled APK, and opens Agent Bridge.
To use an APK stored elsewhere:

```bash
AGENT_BRIDGE_APK=/path/to/app-debug.apk scripts/run-android-emulator.sh
```
