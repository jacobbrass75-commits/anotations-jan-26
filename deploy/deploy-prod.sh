#!/usr/bin/env bash
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-deploy@89.167.10.34}"
APP_DIR="${APP_DIR:-/opt/app}"
APP_REF="${APP_REF:-origin/master}"
SKIP_PREDEPLOY_BACKUP="${SKIP_PREDEPLOY_BACKUP:-0}"
APP_REF_FILE="${APP_REF_FILE:-/tmp/scholarmark-app-ref}"
SKIP_PREDEPLOY_BACKUP_FILE="${SKIP_PREDEPLOY_BACKUP_FILE:-/tmp/scholarmark-skip-predeploy-backup}"
printf -v REMOTE_INNER \
  "set -euo pipefail; cd %q; git fetch origin; git reset --hard %q; printf '%%s\n' %q > %q; printf '%%s\n' %q > %q; sudo -n /bin/bash %q" \
  "$APP_DIR" \
  "$APP_REF" \
  "$APP_REF" \
  "$APP_REF_FILE" \
  "$SKIP_PREDEPLOY_BACKUP" \
  "$SKIP_PREDEPLOY_BACKUP_FILE" \
  "$APP_DIR/deploy/refresh-prod.sh"
REMOTE_COMMAND="/bin/bash -lc $(printf "%q" "$REMOTE_INNER")"

ssh \
  -o BatchMode=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=4 \
  "$DEPLOY_HOST" \
  "$REMOTE_COMMAND"
