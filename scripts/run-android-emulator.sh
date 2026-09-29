#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Android/Sdk}}"
export DISPLAY="${DISPLAY:-:1}"
adb="$sdk_root/platform-tools/adb"
emulator="$sdk_root/emulator/emulator"
apk="${AGENT_BRIDGE_APK:-$project_root/android/app/build/outputs/apk/debug/app-debug.apk}"

for required in "$adb" "$emulator"; do
  if [[ ! -e "$required" ]]; then
    echo "Required file not found: $required" >&2
    exit 1
  fi
done

if [[ ! -f "$apk" ]]; then
  echo "APK not found: $apk" >&2
  echo "Build it in Android Studio or download it from the GitHub Actions artifacts." >&2
  echo "You can also point to it with AGENT_BRIDGE_APK=/path/to/app-debug.apk." >&2
  exit 1
fi

if ! "$adb" devices | awk '$1 ~ /^emulator-/ && $2 == "device" { found=1 } END { exit !found }'; then
  echo "Starting the Android virtual phone…"
  # Quick Boot snapshots can become incompatible after an emulator update.
  # A cold boot keeps this launcher repeatable and reliable.
  nohup "$emulator" -avd medium_phone -no-snapshot-load -no-snapshot-save \
    -gpu software \
    > /tmp/agentbridge-android-emulator.log 2>&1 &
fi

echo "Waiting for boot to complete…"
"$adb" wait-for-device
for _ in $(seq 1 120); do
  if [[ "$("$adb" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then
    break
  fi
  sleep 2
done

if [[ "$("$adb" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]]; then
  echo "The emulator did not finish booting. Log: /tmp/agentbridge-android-emulator.log" >&2
  exit 1
fi

echo "Installing Agent Bridge…"
if install_output="$("$adb" install -r "$apk" 2>&1)"; then
  echo "$install_output"
elif grep -q "INSTALL_FAILED_UPDATE_INCOMPATIBLE" <<<"$install_output"; then
  echo "The test build signature changed: reinstalling Agent Bridge only…"
  "$adb" uninstall it.agentbridge.app >/dev/null
  "$adb" install "$apk"
else
  echo "$install_output" >&2
  exit 1
fi
"$adb" shell am force-stop it.agentbridge.app
"$adb" shell am start -n it.agentbridge.app/.MainActivity >/dev/null
echo "Agent Bridge is open in the Android emulator."
