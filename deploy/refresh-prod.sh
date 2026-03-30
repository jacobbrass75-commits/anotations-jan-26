#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/app}"
APP_REF="${APP_REF:-origin/master}"
MCP_DIR="${MCP_DIR:-/opt/app/mcp-server}"
APP_HEALTHCHECK_URL="${APP_HEALTHCHECK_URL:-http://127.0.0.1:5001/api/system/status}"
MCP_HEALTHCHECK_URL="${MCP_HEALTHCHECK_URL:-http://127.0.0.1:5002/healthz}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[deploy] missing required command: $1" >&2
    exit 1
  fi
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "[deploy] missing required file: $1" >&2
    exit 1
  fi
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempts="${3:-20}"

  for ((attempt=1; attempt<=attempts; attempt++)); do
    if curl --silent --show-error --fail "$url" >/dev/null; then
      echo "[deploy] ${label} healthy"
      return 0
    fi

    sleep 2
  done

  echo "[deploy] ${label} health check failed: ${url}" >&2
  return 1
}

require_command git
require_command npm
require_command pm2
require_command curl

cd "$APP_DIR"
require_file package-lock.json
require_file deploy/ecosystem.config.cjs

echo "[deploy] fetching latest code"
git fetch --prune origin
git reset --hard "$APP_REF"

DEPLOYED_COMMIT="$(git rev-parse --short HEAD)"
echo "[deploy] deploying commit ${DEPLOYED_COMMIT}"

echo "[deploy] installing app deps"
npm ci --no-audit --fund=false

echo "[deploy] bootstrapping database schema"
npx tsx scripts/bootstrap-db.ts

echo "[deploy] building app"
npm run build

echo "[deploy] replacing web app with built production process"
pm2 startOrReload deploy/ecosystem.config.cjs --update-env

if [[ -d "$MCP_DIR" ]]; then
  require_file "$MCP_DIR/package-lock.json"
  require_file "$MCP_DIR/deploy/ecosystem.config.cjs"
  echo "[deploy] ensuring MCP deps"
  cd "$MCP_DIR"
  npm ci --no-audit --fund=false
  pm2 startOrReload deploy/ecosystem.config.cjs --update-env
  wait_for_http "$MCP_HEALTHCHECK_URL" "MCP"
fi

wait_for_http "$APP_HEALTHCHECK_URL" "app"

echo "[deploy] saving PM2 process list"
pm2 save
