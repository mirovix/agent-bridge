#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Il simulatore iPhone ufficiale richiede macOS e Xcode." >&2
  echo "Su Linux usa l'iPhone fisico; copia il progetto su un Mac per eseguire questo script." >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
simulator_name="${IOS_SIMULATOR_NAME:-iPhone 16 Pro}"
derived_data="$project_root/ios/build-simulator"

xcrun simctl boot "$simulator_name" 2>/dev/null || true
open -a Simulator
xcrun simctl bootstatus "$simulator_name" -b

xcodebuild \
  -project "$project_root/ios/AgentBridge.xcodeproj" \
  -scheme "Agent Bridge" \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination "platform=iOS Simulator,name=$simulator_name" \
  -derivedDataPath "$derived_data" \
  CODE_SIGNING_ALLOWED=NO \
  build

app="$derived_data/Build/Products/Debug-iphonesimulator/Agent Bridge.app"
xcrun simctl install booted "$app"
xcrun simctl launch booted com.agentbridge.ios
echo "Agent Bridge è aperta nel simulatore iPhone."
