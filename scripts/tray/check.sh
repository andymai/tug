#!/usr/bin/env bash
# Run it in the dev container while `pnpm --filter @tug/desktop dev` serves the UI.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
cd "$repo"
RUSTFLAGS="" PKG_CONFIG=/usr/bin/pkg-config cargo build -p tug-desktop --quiet

env -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS GDK_BACKEND=x11 GSETTINGS_BACKEND=memory \
  XDG_CONFIG_HOME="$work/config" XDG_DATA_HOME="$work/data" XDG_CACHE_HOME="$work/cache" \
  dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" bash -euo pipefail -c '
    here='"$repo"'/scripts/tray
    work='"$work"'
    fail() { echo "FAIL: $*" >&2; exit 1; }
    expect() { [ "$2" = "$3" ] || fail "$1: expected $3, got $2"; echo "ok: $1"; }
    visible() { xdotool search --onlyvisible --name "^Tug$" 2>/dev/null | wc -l; }

    /usr/bin/python3 "$here/watcher.py" "$work/registered" & watcher=$!
    sleep 1
    ./target/debug/tug > "$work/app.log" 2>&1 & app=$!
    trap "kill $app $watcher 2>/dev/null || true" EXIT
    for _ in $(seq 1 30); do [ -s "$work/registered" ] && break; sleep 0.5; done
    [ -s "$work/registered" ] || fail "the tray never registered"
    item=$(cut -d" " -f1 "$work/registered")
    prop() { busctl --user get-property "$item" /StatusNotifierItem org.kde.StatusNotifierItem "$1"; }

    expect "id" "$(prop Id)" "s \"io.github.andymai.Tug\""
    expect "category" "$(prop Category)" "s \"ApplicationStatus\""
    expect "icon name" "$(prop IconName)" "s \"io.github.andymai.Tug-symbolic\""
    icons=$(prop IconThemePath | cut -d" " -f2 | tr -d \")
    grep -q ColorScheme-Text "$icons/io.github.andymai.Tug-symbolic.svg" || fail "the symbolic icon is missing"
    echo "ok: symbolic icon in $icons"

    menu=$(prop Menu | cut -d" " -f2 | tr -d \")
    layout=$(busctl --user call -- "$item" "$menu" com.canonical.dbusmenu GetLayout iias 0 -1 1 label)
    case "$layout" in *"\"Open Tug\""*"\"Quit Tug\""*) echo "ok: menu";; *) fail "menu: $layout";; esac

    expect "visible at start" "$(visible)" 1
    for window in $(xdotool search --onlyvisible --name "^Tug$"); do /usr/bin/python3 "$here/close.py" "$window"; done
    sleep 2
    kill -0 "$app" 2>/dev/null || fail "closing the window quit Tug"
    expect "visible after close" "$(visible)" 0
    busctl --user call "$item" /StatusNotifierItem org.kde.StatusNotifierItem Activate ii 0 0
    sleep 2
    expect "visible after activate" "$(visible)" 1

    quit=$(grep -o "[0-9]* 1 \"label\" s \"Quit Tug\"" <<<"$layout" | cut -d" " -f1)
    busctl --user call -- "$item" "$menu" com.canonical.dbusmenu Event isvu "$quit" clicked s "" 0
    sleep 2
    kill -0 "$app" 2>/dev/null && fail "Quit Tug left Tug running"
    echo "ok: Quit Tug exits"

    kill "$watcher"
    wait "$watcher" 2>/dev/null || true
    rm -f "$work/registered"
    /usr/bin/python3 "$here/watcher.py" "$work/registered" & watcher=$!
    ./target/debug/tug > "$work/app.log" 2>&1 & app=$!
    trap "kill $app $watcher 2>/dev/null || true" EXIT
    for _ in $(seq 1 30); do [ -s "$work/registered" ] && break; sleep 0.5; done
    sleep 1
    for window in $(xdotool search --onlyvisible --name "^Tug$"); do /usr/bin/python3 "$here/close.py" "$window"; done
    sleep 2
    expect "hidden in the tray" "$(visible)" 0
    kill "$watcher"
    for _ in $(seq 1 20); do [ "$(visible)" = 1 ] && break; sleep 0.5; done
    expect "visible when the tray host leaves" "$(visible)" 1
    for window in $(xdotool search --onlyvisible --name "^Tug$"); do /usr/bin/python3 "$here/close.py" "$window"; done
    sleep 2
    kill -0 "$app" 2>/dev/null && fail "closing without a tray host left Tug running"
    echo "ok: closing without a tray host quits"
  '
rm -rf "$work"
