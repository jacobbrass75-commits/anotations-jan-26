#!/usr/bin/env bash
set -euo pipefail

SM="${SM:-http://89.167.10.34:5001}"
PID="${PID:-cf547e4d-712b-42a1-a33d-6cb67e68e670}"

tmp_root="$(mktemp)"
tmp_projects="$(mktemp)"
tmp_project="$(mktemp)"
tmp_search="$(mktemp)"

cleanup() {
  rm -f "$tmp_root" "$tmp_projects" "$tmp_project" "$tmp_search"
}
trap cleanup EXIT

check_status() {
  local label="$1"
  local url="$2"
  local out_file="$3"
  local code
  code="$(curl -sS --connect-timeout 5 --max-time 30 --retry 2 --retry-connrefused \
    -o "$out_file" -w "%{http_code}" "$url")"
  if [[ "$code" != "200" ]]; then
    echo "FAIL ${label}: HTTP ${code} (${url})"
    return 1
  fi
  echo "OK   ${label}: HTTP ${code}"
}

check_status "root" "$SM/" "$tmp_root"
check_status "projects" "$SM/api/projects" "$tmp_projects"
check_status "project" "$SM/api/projects/$PID" "$tmp_project"

search_code="$(curl -sS --connect-timeout 5 --max-time 30 --retry 2 --retry-connrefused \
  -X POST "$SM/api/projects/$PID/search" \
  -H "Content-Type: application/json" \
  -d '{"query":"brainwashing Korean War","limit":3}' \
  -o "$tmp_search" -w "%{http_code}")"
if [[ "$search_code" != "200" ]]; then
  echo "FAIL project-search: HTTP ${search_code}"
  exit 1
fi

python3 - "$tmp_search" <<'PY'
import json
import sys
path = sys.argv[1]
obj = json.load(open(path, "r", encoding="utf-8"))
required = {"results", "totalResults", "searchTime"}
missing = sorted(list(required - set(obj.keys())))
if missing:
    print(f"FAIL project-search: missing keys {missing}")
    sys.exit(1)
print(f"OK   project-search: totalResults={obj.get('totalResults')}")
PY

echo "PASS ScholarMark preflight complete"
