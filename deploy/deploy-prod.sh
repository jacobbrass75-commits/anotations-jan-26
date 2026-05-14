#!/usr/bin/env bash
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-deploy@89.167.10.34}"
APP_DIR="${APP_DIR:-/opt/app}"
APP_REF="${APP_REF:-origin/master}"
SKIP_PREDEPLOY_BACKUP="${SKIP_PREDEPLOY_BACKUP:-0}"
REMOTE_COMMAND="cd '$APP_DIR' && sudo -n APP_DIR='$APP_DIR' APP_REF='$APP_REF' SKIP_PREDEPLOY_BACKUP='$SKIP_PREDEPLOY_BACKUP' /bin/bash '$APP_DIR/deploy/refresh-prod.sh'"

ssh \
  -o BatchMode=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=4 \
  "$DEPLOY_HOST" \
  "$REMOTE_COMMAND"
