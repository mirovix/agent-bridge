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
    echo "File necessario non trovato: $required" >&2
    exit 1
  fi
done

if [[ ! -f "$apk" ]]; then
  echo "APK non trovato: $apk" >&2
  echo "Compilalo da Android Studio oppure scaricalo dagli artefatti GitHub Actions." >&2
  echo "Puoi anche indicarlo con AGENT_BRIDGE_APK=/percorso/app-debug.apk." >&2
  exit 1
fi

if ! "$adb" devices | awk '$1 ~ /^emulator-/ && $2 == "device" { found=1 } END { exit !found }'; then
  echo "Avvio il telefono virtuale Android…"
  # Gli snapshot Quick Boot possono diventare incompatibili dopo un aggiornamento
  # dell'emulatore. Un avvio freddo rende questo launcher ripetibile e affidabile.
  nohup "$emulator" -avd medium_phone -no-snapshot-load -no-snapshot-save \
    -gpu software \
    > /tmp/agentbridge-android-emulator.log 2>&1 &
fi

echo "Attendo il completamento dell'avvio…"
"$adb" wait-for-device
for _ in $(seq 1 120); do
  if [[ "$("$adb" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then
    break
  fi
  sleep 2
done

if [[ "$("$adb" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]]; then
  echo "Il simulatore non ha completato l'avvio. Log: /tmp/agentbridge-android-emulator.log" >&2
  exit 1
fi

echo "Installazione Agent Bridge…"
if install_output="$("$adb" install -r "$apk" 2>&1)"; then
  echo "$install_output"
elif grep -q "INSTALL_FAILED_UPDATE_INCOMPATIBLE" <<<"$install_output"; then
  echo "La firma della build di test è cambiata: reinstallo solo Agent Bridge…"
  "$adb" uninstall it.agentbridge.app >/dev/null
  "$adb" install "$apk"
else
  echo "$install_output" >&2
  exit 1
fi
"$adb" shell am force-stop it.agentbridge.app
"$adb" shell am start -n it.agentbridge.app/.MainActivity >/dev/null
echo "Agent Bridge è aperta nel simulatore Android."
