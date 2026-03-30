#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/app}"
DATA_DIR="${DATA_DIR:-$APP_DIR/data}"
DB_PATH="${DB_PATH:-$DATA_DIR/sourceannotator.db}"
UPLOADS_DIR="${UPLOADS_DIR:-$DATA_DIR/uploads}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/backups/scholarmark}"
RETENTION_COUNT="${RETENTION_COUNT:-14}"
BACKUP_TIMESTAMP="${BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$BACKUP_ROOT/$BACKUP_TIMESTAMP"
LATEST_LINK="$BACKUP_ROOT/latest"
DB_BACKUP_PATH="$BACKUP_DIR/sourceannotator.db"
UPLOADS_ARCHIVE_PATH="$BACKUP_DIR/uploads.tar.gz"
METADATA_PATH="$BACKUP_DIR/metadata.json"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[backup] missing required command: $1" >&2
    exit 1
  fi
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "[backup] missing required file: $1" >&2
    exit 1
  fi
}

require_directory() {
  if [[ ! -d "$1" ]]; then
    echo "[backup] missing required directory: $1" >&2
    exit 1
  fi
}

require_command node
require_command tar
require_file "$DB_PATH"
require_directory "$UPLOADS_DIR"

mkdir -p "$BACKUP_DIR"

echo "[backup] creating SQLite snapshot"
node "$REPO_ROOT/scripts/backup-sqlite.mjs" "$DB_PATH" "$DB_BACKUP_PATH" >/dev/null

echo "[backup] archiving uploads"
tar -czf "$UPLOADS_ARCHIVE_PATH" -C "$DATA_DIR" "$(basename "$UPLOADS_DIR")"

DB_SIZE_BYTES="$(stat -f%z "$DB_BACKUP_PATH" 2>/dev/null || stat -c%s "$DB_BACKUP_PATH")"
UPLOADS_SIZE_BYTES="$(stat -f%z "$UPLOADS_ARCHIVE_PATH" 2>/dev/null || stat -c%s "$UPLOADS_ARCHIVE_PATH")"

cat >"$METADATA_PATH" <<EOF
{
  "createdAt": "$BACKUP_TIMESTAMP",
  "appDir": "$APP_DIR",
  "dbPath": "$DB_PATH",
  "uploadsDir": "$UPLOADS_DIR",
  "dbBackupPath": "$DB_BACKUP_PATH",
  "uploadsArchivePath": "$UPLOADS_ARCHIVE_PATH",
  "dbBackupBytes": $DB_SIZE_BYTES,
  "uploadsArchiveBytes": $UPLOADS_SIZE_BYTES
}
EOF

ln -sfn "$BACKUP_DIR" "$LATEST_LINK"

backup_dir_index=0
while IFS= read -r backup_dir; do
  backup_dir_index=$((backup_dir_index + 1))
  if (( backup_dir_index > RETENTION_COUNT )); then
    rm -rf "$backup_dir"
  fi
done < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d | sort -r)

echo "[backup] backup complete: $BACKUP_DIR"
