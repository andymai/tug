#!/usr/bin/env bash
# Run it in the dev container while `pnpm --filter @tug/desktop dev` serves the UI,
# after `pnpm --filter @tug/extension build` and, once, `pnpm --filter @tug/extension
# exec playwright install chromium` on the host.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
mkdir -m 700 "$work/runtime"
mkdir -p "$work/home" "$work/config" "$work/downloads"
printf 'XDG_DOWNLOAD_DIR="%s"\n' "$work/downloads" > "$work/config/user-dirs.dirs"
cd "$repo"
RUSTFLAGS="" PKG_CONFIG=/usr/bin/pkg-config cargo build -p tug-desktop -p tug-host --quiet

env -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS GDK_BACKEND=x11 GSETTINGS_BACKEND=memory \
  HOME="$work/home" XDG_CONFIG_HOME="$work/config" XDG_DATA_HOME="$work/data" XDG_CACHE_HOME="$work/cache" \
  XDG_RUNTIME_DIR="$work/runtime" PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" \
  dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" bash -euo pipefail -c '
    fail() { echo "FAIL: $*" >&2; exit 1; }
    tug=$PWD/target/debug/tug
    binary=$(readlink -f "$tug")
    ours() {
      for p in /proc/[0-9]*; do
        [ "$(readlink -f "$p/exe" 2>/dev/null)" = "$binary" ] || continue
        tr "\0" "\n" 2>/dev/null < "$p/environ" | grep -qx "XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR" && echo "${p#/proc/}"
      done
      return 0
    }
    requests="$(dirname "$XDG_CONFIG_HOME")/requests.log"
    SLOW_SERVER_LOG="$requests" /usr/bin/python3 scripts/tray/slow_server.py 8767 & server=$!
    trap "kill \$(ours) $server 2>/dev/null || true" EXIT
    sleep 0.5

    node apps/extension/scripts/capture.ts http://127.0.0.1:8767 "$tug" "$XDG_CONFIG_HOME/chromium"

    sleep 1
    sent=$(awk -F "\t" "\$1 == \"/captured.bin\"" "$requests")
    [ "$(wc -l <<<"$sent")" -ge 2 ] || fail "Tug never fetched captured.bin: $sent"
    while IFS=$(printf "\t") read -r _ cookie referrer agent; do
      [ "$cookie" = "session=abc123" ] || fail "cookie: $cookie"
      [ "$referrer" = "http://127.0.0.1:8767/page.html" ] || fail "referrer: $referrer"
      case "$agent" in *Chrome/*) ;; *) fail "user agent: $agent";; esac
    done <<<"$sent"
    echo "ok: Tug fetches with the page as referrer, the cookie and the browser'"'"'s User-Agent"
  '
# A Tug that is still stopping can write into $work for a moment.
for _ in 1 2 3 4 5; do rm -rf "$work" 2>/dev/null && break; sleep 1; done
