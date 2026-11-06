#!/bin/bash
# Captures App Store screenshots of the real app in iOS Simulators, using the Debug-only
# screenshot mode (ios/ScholarMark/Support/ScreenshotMode.swift): an in-memory library of
# synthetic sample sources, so nothing on the simulator's saved library is read or changed.
#
#   ios/Tools/capture-app-store-screenshots.sh [output-dir]      (default: build/AppStoreScreenshots)
#
# Needs macOS with Xcode 26+ and Node 18+. Run from anywhere inside the repository. Override the
# simulators with IPHONE_DEVICES, IPHONE_LARGE_DEVICES, and IPAD_DEVICES (comma-separated names,
# first available wins). Set SKIP_BUILD=1 with APP_PATH=/path/ScholarMark.app to reuse a build.
#
# Written for the bash 3.2 that ships with macOS: no associative arrays or mapfile.
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
out="${1:-$repo/build/AppStoreScreenshots}"
derived="${DERIVED_DATA:-$repo/build/ScreenshotDerivedData}"
scenes="${SCENES:-library project source review export capture settings}"
settle_seconds="${SETTLE_SECONDS:-5}"

# Display classes App Store Connect asks for, with simulators whose native pixel size matches
# (https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications):
#   iphone-6.3  required: iPhone with Dynamic Island (medium display), 1206 x 2622
#   iphone-6.9  optional: iPhone with Dynamic Island (large display),  1320 x 2868
#   ipad-13     required because the app runs on iPad: iPad 13" display, 2064 x 2752
slots="iphone-6.3 iphone-6.9 ipad-13"
devices_for() {
  case "$1" in
    iphone-6.3) echo "${IPHONE_DEVICES:-iPhone 17 Pro,iPhone 17,iPhone 16 Pro}" ;;
    iphone-6.9) echo "${IPHONE_LARGE_DEVICES:-iPhone 17 Pro Max,iPhone 16 Pro Max}" ;;
    ipad-13) echo "${IPAD_DEVICES:-iPad Pro 13-inch (M5),iPad Pro 13-inch (M4)}" ;;
  esac
}

log() { printf '==> %s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v xcrun >/dev/null || fail "xcrun not found; this script needs macOS with Xcode."
command -v node >/dev/null || fail "node not found; it checks the screenshots against Apple's sizes."

if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  app="${APP_PATH:?set APP_PATH when SKIP_BUILD=1}"
else
  log "Building ScholarMark (Debug, iOS Simulator)"
  # Debug is required: the screenshot mode is compiled out of Release builds.
  xcodebuild build \
    -project "$repo/ios/ScholarMark.xcodeproj" \
    -scheme ScholarMark \
    -configuration Debug \
    -destination "generic/platform=iOS Simulator" \
    -derivedDataPath "$derived" \
    -skipPackagePluginValidation \
    -skipMacroValidation \
    CODE_SIGN_IDENTITY=- \
    CODE_SIGN_STYLE=Manual \
    DEVELOPMENT_TEAM= \
    PROVISIONING_PROFILE_SPECIFIER= \
    COMPILER_INDEX_STORE_ENABLE=NO \
    -quiet
  app="$derived/Build/Products/Debug-iphonesimulator/ScholarMark.app"
fi
[[ -d "$app" ]] || fail "built app not found at $app"
bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")"
log "App: $app ($bundle_id)"

# Newest installed iOS runtime.
runtime="$(xcrun simctl list runtimes available --json | node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    const ios = JSON.parse(s).runtimes.filter(r => r.platform === "iOS" && r.isAvailable);
    ios.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
    if (ios.length) console.log(ios[ios.length - 1].identifier + "\t" + ios[ios.length - 1].version);
  });')"
[[ -n "$runtime" ]] || fail "no iOS simulator runtime is installed"
runtime_id="${runtime%%$'\t'*}"
log "Runtime: $runtime_id"

# Prints "<udid>" of an existing device named $1 on the runtime, creating one if needed.
device_udid() {
  local name="$1" udid
  udid="$(xcrun simctl list devices available --json | RUNTIME="$runtime_id" NAME="$name" node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      const list = JSON.parse(s).devices[process.env.RUNTIME] || [];
      const hit = list.find(d => d.name === process.env.NAME && d.isAvailable);
      if (hit) console.log(hit.udid);
    });')"
  if [[ -z "$udid" ]]; then
    # simctl accepts a device type name; this fails if the runtime does not support it.
    udid="$(xcrun simctl create "$name" "$name" "$runtime_id" 2>/dev/null)" || return 1
  fi
  echo "$udid"
}

case "$out" in
  ""|"/"|"$HOME"|"$repo") fail "refusing to use $out as the output directory (it is emptied first)" ;;
esac
rm -rf "$out"
mkdir -p "$out"
for slot in $slots; do
  udid=""
  chosen=""
  IFS=',' read -r -a candidates <<<"$(devices_for "$slot")"
  for name in "${candidates[@]}"; do
    if udid="$(device_udid "$name")" && [[ -n "$udid" ]]; then chosen="$name"; break; fi
  done
  [[ -n "$chosen" ]] || fail "no simulator available for $slot (tried: $(devices_for "$slot"))"
  log "$slot: $chosen ($udid)"

  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl ui "$udid" appearance light
  # Apple's marketing status bar: 9:41, full signal and battery.
  if ! xcrun simctl status_bar "$udid" override --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100; then
    log "  warning: status bar override failed; screenshots show the real status bar"
  fi
  xcrun simctl install "$udid" "$app"

  mkdir -p "$out/$slot"
  index=1
  for scene in $scenes; do
    file="$(printf '%s/%s/%02d-%s.png' "$out" "$slot" "$index" "$scene")"
    xcrun simctl launch --terminate-running-process "$udid" "$bundle_id" -ScholarMarkScreenshot "$scene" >/dev/null
    sleep "$settle_seconds"
    xcrun simctl io "$udid" screenshot --type=png "$file" >/dev/null 2>&1
    log "  $(basename "$file")"
    index=$((index + 1))
  done

  xcrun simctl terminate "$udid" "$bundle_id" 2>/dev/null || true
  xcrun simctl status_bar "$udid" clear || true
  xcrun simctl shutdown "$udid" || true
done

log "Checking sizes and removing alpha channels"
node "$repo/ios/Tools/check-app-store-screenshots.mjs" --flatten --require iphone-6.3,ipad-13 "$out"
log "Screenshots are in $out"
