#!/usr/bin/env bash
# Run it in the dev container while `pnpm --filter @tug/desktop dev` serves the UI.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
# A Tug that is still stopping can write into $work for a moment.
cleanup() { for _ in 1 2 3 4 5; do rm -rf "$work" 2>/dev/null && return; sleep 1; done; }
trap cleanup EXIT
mkdir -m 700 "$work/runtime"
# Tug's default folder comes from user-dirs.dirs; without one it is the real ~/Downloads.
mkdir -p "$work/config" "$work/downloads" "$work/bin"
printf 'XDG_DOWNLOAD_DIR="%s"\n' "$work/downloads" > "$work/config/user-dirs.dirs"
# Tug opens a file through xdg-open; this one only writes down what it gets.
printf '#!/bin/sh\necho "$@" >> "%s"\n' "$work/opened" > "$work/bin/xdg-open"
chmod +x "$work/bin/xdg-open"
cd "$repo"
RUSTFLAGS="" PKG_CONFIG=/usr/bin/pkg-config cargo build -p tug-desktop --quiet

env -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS GDK_BACKEND=x11 GSETTINGS_BACKEND=memory PATH="$work/bin:$PATH" \
  XDG_CONFIG_HOME="$work/config" XDG_DATA_HOME="$work/data" XDG_CACHE_HOME="$work/cache" \
  XDG_RUNTIME_DIR="$work/runtime" dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" bash -euo pipefail -c '
    work='"$work"'
    fail() { echo "FAIL: $*" >&2; exit 1; }
    expect() { [ "$2" = "$3" ] || fail "$1: expected $3, got $2"; echo "ok: $1"; }
    visible() { xdotool search --onlyvisible --name "^Tug$" 2>/dev/null | wc -l; }
    notice() { /usr/bin/python3 scripts/notify/notice.py "$work/notified" "$@" || fail "notification $1"; }
    invoke() { busctl --user call org.freedesktop.Notifications /org/freedesktop/Notifications io.github.andymai.Tug.Test Invoke us "$1" "$2"; }
    waitfor() { for _ in $(seq 1 40); do grep -qF "$2" "$1" 2>/dev/null && return; sleep 0.5; done; fail "no $2 in $1"; }
    tug=./target/debug/tug
    file="file://$work/downloads/note.bin"

    /usr/bin/python3 scripts/tray/watcher.py "$work/registered" & watcher=$!
    /usr/bin/python3 scripts/notify/server.py "$work/notified" & server=$!
    /usr/bin/python3 scripts/notify/launcher.py "$work/launcher" & launcher=$!
    /usr/bin/python3 scripts/tray/slow_server.py 8769 & files=$!
    sleep 1
    $tug > "$work/app.log" 2>&1 & app=$!
    trap "kill $app $watcher $server $launcher $files 2>/dev/null || true" EXIT
    for _ in $(seq 1 30); do [ -s "$work/registered" ] && $tug list > /dev/null 2>&1 && break; sleep 0.5; done

    $tug add "http://127.0.0.1:8769/note.bin?size=65536" > /dev/null
    waitfor "$work/notified" "Download finished"
    id=$(notice 0 "{\"app\": \"Tug\", \"icon\": \"io.github.andymai.Tug\", \"summary\": \"Download finished\", \"body\": \"note.bin\",
      \"actions\": [\"default\", \"Show in Tug\", \"open\", \"Open\", \"folder\", \"Show in folder\"],
      \"hints.desktop-entry\": \"io.github.andymai.Tug\", \"hints.category\": \"transfer.complete\", \"hints.x-kde-urls\": [\"$file\"]}")
    echo "ok: a finished download notifies with Open, Show in folder and a preview"

    invoke "$id" open > /dev/null
    waitfor "$work/opened" "$file"
    echo "ok: Open opens the file"
    invoke "$id" folder > /dev/null
    waitfor "$work/notified" "\"show_items\": [\"$file\"]"
    echo "ok: Show in folder shows the file in the file manager"

    expect "visible at start" "$(visible)" 1
    for window in $(xdotool search --onlyvisible --name "^Tug$"); do /usr/bin/python3 scripts/tray/close.py "$window"; done
    for _ in $(seq 1 20); do [ "$(visible)" = 0 ] && break; sleep 0.5; done
    expect "hidden to the tray" "$(visible)" 0
    invoke "$id" default > /dev/null
    for _ in $(seq 1 20); do [ "$(visible)" = 1 ] && break; sleep 0.5; done
    expect "Show in Tug brings the window back" "$(visible)" 1

    $tug add "http://127.0.0.1:8769/gone.bin?status=404" > /dev/null
    waitfor "$work/notified" "Download failed"
    notice 1 "{\"summary\": \"Download failed\", \"actions\": [\"default\", \"Show in Tug\"], \"hints.category\": \"transfer.error\", \"hints.x-kde-urls\": null}" > /dev/null
    grep "Download failed" "$work/notified" | grep -q "\"body\": \"gone.bin: " || fail "the failure body: $(grep "Download failed" "$work/notified")"
    echo "ok: a failed download notifies with the reason and only Show in Tug"

    start=$(wc -l < "$work/launcher")
    $tug add "http://127.0.0.1:8769/paced.bin?size=4194304" > /dev/null
    for _ in $(seq 1 60); do grep -q " paced.bin$" <<<"$($tug list)" && grep -q "^Done" <<<"$($tug list | grep " paced.bin$")" && break; sleep 0.5; done
    sleep 1
    /usr/bin/python3 -c "
import json, sys
updates = [json.loads(line) for line in open(sys.argv[1]).readlines()[int(sys.argv[2]):]]
assert updates, \"no Update signal\"
assert all(u[\"uri\"] == \"application://io.github.andymai.Tug.desktop\" for u in updates), updates
running = [u for u in updates if u[\"progress-visible\"]]
assert running and all(u[\"count\"] == 1 and u[\"count-visible\"] for u in running), updates
shares = [u[\"progress\"] for u in running]
assert len(set(shares)) > 2 and shares == sorted(shares) and 0 <= shares[0] < shares[-1] <= 1, shares
assert not updates[-1][\"progress-visible\"] and not updates[-1][\"count-visible\"], updates[-1]
print(len(updates), \"updates, progress\", shares[0], \"to\", shares[-1])
" "$work/launcher" "$start" || fail "task manager updates: $(cat "$work/launcher")"
    echo "ok: the task manager shows progress and the count while it runs, and nothing after"
  '
