# Android installation

The native Android client supports Android 8 (API 26) and newer.

## Install the APK

1. On the phone, download `AgentBridge-<version>-android.apk` from the
   [latest release](https://github.com/mirovix/agent-bridge/releases/latest).
2. Open it. When Android asks, allow installation from your browser or file
   manager for this one install.
3. Start Agent Bridge and enter the HTTPS address printed by
   `tailscale serve status` on your computer, then your password and 2FA code.

To update, install the newer APK over the old one: your settings are kept.

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
