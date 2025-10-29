#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(
  cd "$(dirname "${BASH_SOURCE[0]}")"
  pwd
)"

server_pid=0

handle_sigint() {
  if [[ $server_pid -ne 0 ]]; then
    echo "[run.sh] Ctrl+C detected — stopping webpack dev server..."
    kill -INT "$server_pid" 2>/dev/null || true
  else
    echo "[run.sh] Ctrl+C detected — exiting run loop."
    exit 0
  fi
}

trap handle_sigint INT

while true; do
  echo "[run.sh] Building core emulator..."
  (cd "$ROOT_DIR" && npm run build)

  if [[ -d "$ROOT_DIR/devui" ]]; then
    echo "[run.sh] Building DevUI bundle..."
    (cd "$ROOT_DIR/devui" && npm run build)
  fi

  echo "[run.sh] Launching webpack dev server (Ctrl+C to rebuild, Ctrl+C again to quit)..."
  cd "$ROOT_DIR/example"
  npm run serve &
  server_pid=$!
  wait "$server_pid" || true
  server_pid=0
  cd "$ROOT_DIR"

  echo "[run.sh] Webpack dev server stopped. Rebuilding..."
done
