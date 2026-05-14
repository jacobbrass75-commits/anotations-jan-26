#!/usr/bin/env bash
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-deploy@89.167.10.34}"
APP_DIR="${APP_DIR:-/opt/app}"
APP_REF="${APP_REF:-origin/master}"
SKIP_PREDEPLOY_BACKUP="${SKIP_PREDEPLOY_BACKUP:-0}"
printf -v REMOTE_INNER \
  "cd %q && APP_DIR=%q APP_REF=%q SKIP_PREDEPLOY_BACKUP=%q /bin/bash %q" \
  "$APP_DIR" \
  "$APP_DIR" \
  "$APP_REF" \
  "$SKIP_PREDEPLOY_BACKUP" \
  "$APP_DIR/deploy/refresh-prod.sh"
REMOTE_COMMAND="sudo -n /bin/bash -lc $(printf "%q" "$REMOTE_INNER")"

ssh \
  -o BatchMode=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=4 \
  "$DEPLOY_HOST" \
  "$REMOTE_COMMAND"
