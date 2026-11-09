#!/usr/bin/env bash
# Run it in the dev container while `pnpm --filter @tug/desktop dev` serves the UI.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
mkdir -m 700 "$work/runtime"
cd "$repo"
RUSTFLAGS="" PKG_CONFIG=/usr/bin/pkg-config cargo build -p tug-desktop --quiet

env -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS GDK_BACKEND=x11 GSETTINGS_BACKEND=memory \
  XDG_CONFIG_HOME="$work/config" XDG_DATA_HOME="$work/data" XDG_CACHE_HOME="$work/cache" \
  XDG_RUNTIME_DIR="$work/runtime" dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" bash -euo pipefail -c '
    fail() { echo "FAIL: $*" >&2; exit 1; }
    expect() { [ "$2" = "$3" ] || fail "$1: expected $3, got $2"; echo "ok: $1"; }
    visible() { xdotool search --onlyvisible --name "^Tug$" 2>/dev/null | wc -l; }
    tug=./target/debug/tug
    dir="$XDG_RUNTIME_DIR/app/io.github.andymai.Tug.Devel"

    /usr/bin/python3 scripts/tray/slow_server.py 8766 & server=$!
    trap "kill \$(pidof tug) $server 2>/dev/null || true" EXIT

    expect "tug add starts Tug and adds" "$($tug add http://127.0.0.1:8766/big.bin)" "Added big.bin"
    expect "socket folder" "$(stat -c %a "$dir")" 700
    expect "socket" "$(stat -c %a "$dir/tug.sock")" 600
    expect "token" "$(stat -c %a "$dir/token")" 600

    sleep 1
    case "$($tug list)" in "Downloading "*" big.bin") echo "ok: tug list";; *) fail "list: $($tug list)";; esac
    expect "tug list --json" "$($tug list --json | python3 -c "import json,sys; print(json.load(sys.stdin)[0][\"name\"])")" big.bin

    status=0; err=$($tug add not-a-link 2>&1 >/dev/null) || status=$?
    expect "a bad link fails" "$status" 1
    case "$err" in "Couldn'"'"'t add not-a-link: "*) echo "ok: the reason";; *) fail "reason: $err";; esac
    status=0; $tug frobnicate 2>/dev/null || status=$?
    expect "an unknown command is a usage error" "$status" 2

    sleep 2
    expect "one window" "$(visible)" 1
    status=0; timeout 10 $tug || status=$?
    expect "a second tug hands off and exits" "$status" 0
    expect "still one window" "$(visible)" 1
    expect "still one Tug" "$(pidof tug | wc -w)" 1

    kill -9 $(pidof tug)
    sleep 1
    [ -S "$dir/tug.sock" ] || fail "the socket file should outlive a killed Tug"
    status=0; out=$($tug list 2>&1) || status=$?
    expect "list without Tug fails" "$status" 1
    expect "and says so" "$out" "Tug isn'"'"'t running"
    $tug > /dev/null 2>&1 &
    for _ in $(seq 1 40); do $tug list > /dev/null 2>&1 && break; sleep 0.5; done
    case "$($tug list)" in *" big.bin") echo "ok: a new Tug replaces the stale socket";; *) fail "after restart: $($tug list)";; esac
  '
rm -rf "$work"
