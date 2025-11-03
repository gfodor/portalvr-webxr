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
  HELLO_WEBXR_NODE_OPTIONS="${NODE_OPTIONS:-}"
  if [[ "$HELLO_WEBXR_NODE_OPTIONS" != *"--openssl-legacy-provider"* ]]; then
    HELLO_WEBXR_NODE_OPTIONS="${HELLO_WEBXR_NODE_OPTIONS:+$HELLO_WEBXR_NODE_OPTIONS }--openssl-legacy-provider"
  fi
  echo "[run.sh] Building Hello WebXR example bundle..."
  (cd "$ROOT_DIR/hello-webxr" && NODE_OPTIONS="$HELLO_WEBXR_NODE_OPTIONS" npm run build)

  echo "[run.sh] Launching Hello WebXR dev server (Ctrl+C to rebuild, Ctrl+C again to quit)..."
  cd "$ROOT_DIR/hello-webxr"
  NODE_OPTIONS="$HELLO_WEBXR_NODE_OPTIONS" npm run start &
  server_pid=$!
  wait "$server_pid" || true
  server_pid=0
  cd "$ROOT_DIR"

  echo "[run.sh] Webpack dev server stopped. Rebuilding..."
done
