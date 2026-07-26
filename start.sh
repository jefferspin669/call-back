#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PORT="${PORT:-4174}"
HOST="${HOST:-0.0.0.0}"

if command -v lsof >/dev/null 2>&1; then
  if lsof -ti ":$PORT" >/dev/null 2>&1; then
    echo "Stopping existing process on port $PORT..."
    lsof -ti ":$PORT" | xargs -r kill -9 || true
    sleep 0.4
  fi
fi

export PORT HOST
export PUBLIC_HOST="${PUBLIC_HOST:-127.0.0.1}"
export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-http://127.0.0.1:${PORT}}"

echo "Starting CallbackFlow on http://${HOST}:${PORT}"
echo "Open: http://127.0.0.1:${PORT}/"
exec node server.js
