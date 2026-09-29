#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
node_bin="$(command -v node || true)"

if [[ -z "$node_bin" ]]; then
  echo "Node.js non trovato. Installa Node.js 20 o successivo e riprova." >&2
  exit 1
fi

node_major="$($node_bin -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 20 )); then
  echo "Serve Node.js 20 o successivo; versione trovata: $($node_bin --version)." >&2
  exit 1
fi

escape_sed() {
  printf '%s' "$1" | sed 's/[&|]/\\&/g'
}

unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit_file="$unit_dir/agent-bridge.service"
mkdir -p "$unit_dir"

sed \
  -e "s|@PROJECT_ROOT@|$(escape_sed "$project_root")|g" \
  -e "s|@NODE_BIN@|$(escape_sed "$node_bin")|g" \
  -e "s|@NODE_DIR@|$(escape_sed "$(dirname "$node_bin")")|g" \
  "$script_dir/agent-bridge.service" > "$unit_file"
chmod 600 "$unit_file"

systemctl --user daemon-reload
systemctl --user enable --now agent-bridge

echo "Agent Bridge è attivo. Stato: systemctl --user status agent-bridge"
echo "Log: journalctl --user -u agent-bridge -f"
