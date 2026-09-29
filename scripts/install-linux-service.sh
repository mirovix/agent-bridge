#!/usr/bin/env bash
# Kept for existing docs/habits: the cross-platform installer does the work.
# Prefer:  npm run service:install
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node_bin="$(command -v node || true)"

if [[ -z "$node_bin" ]]; then
  echo "Node.js not found. Install Node.js 20 or later and try again." >&2
  exit 1
fi

exec "$node_bin" "$script_dir/install-service.js" install "$@"
