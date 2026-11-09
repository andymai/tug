#!/usr/bin/env bash
# Run it in the dev container while `pnpm --filter @tug/desktop dev` serves the UI.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
mkdir -m 700 "$work/runtime"
# Tug's default folder comes from user-dirs.dirs; without one it is the real ~/Downloads.
mkdir -p "$work/config" "$work/downloads"
printf 'XDG_DOWNLOAD_DIR="%s"\n' "$work/downloads" > "$work/config/user-dirs.dirs"
cd "$repo"
RUSTFLAGS="" PKG_CONFIG=/usr/bin/pkg-config cargo build -p tug-desktop --quiet

env -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS GDK_BACKEND=x11 GSETTINGS_BACKEND=memory \
  XDG_CONFIG_HOME="$work/config" XDG_DATA_HOME="$work/data" XDG_CACHE_HOME="$work/cache" \
  XDG_RUNTIME_DIR="$work/runtime" dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" bash -euo pipefail -c '
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

    expect "idle status" "$(prop Status)" "s \"Passive\""
    case "$(prop ToolTip)" in *"\"Nothing downloading\""*) echo "ok: idle tooltip";; *) fail "tooltip: $(prop ToolTip)";; esac
    rings=$(ls "$icons" | grep -c "^io.github.andymai.Tug-progress-[0-9][0-9].svg$")
    expect "progress icons" "$rings" 21

    menu=$(prop Menu | cut -d" " -f2 | tr -d \")
    layout=$(busctl --user call -- "$item" "$menu" com.canonical.dbusmenu GetLayout iias 0 -1 2 label enabled)
    case "$layout" in *"\"Open Tug\""*"\"Pause all\""*"\"Resume all\""*"\"Quit Tug\""*) echo "ok: menu";; *) fail "menu: $layout";; esac
    disabled=$(grep -o "\"enabled\" b false" <<<"$layout" | wc -l)
    expect "pause and resume wait for downloads" "$disabled" 2

    expect "visible at start" "$(visible)" 1
    for window in $(xdotool search --onlyvisible --name "^Tug$"); do /usr/bin/python3 "$here/close.py" "$window"; done
    sleep 2
    kill -0 "$app" 2>/dev/null || fail "closing the window quit Tug"
    expect "visible after close" "$(visible)" 0
    busctl --user call "$item" /StatusNotifierItem org.kde.StatusNotifierItem Activate ii 0 0
    sleep 2
    expect "visible after activate" "$(visible)" 1

    quit=$(grep -oE "\(ia\{sv\}av\) [0-9]+ [0-9]+ \"label\" s \"Quit Tug\"" <<<"$layout" | cut -d" " -f2)
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

    rm -f "$work/registered"
    /usr/bin/python3 "$here/watcher.py" "$work/registered" & watcher=$!
    /usr/bin/python3 "$here/slow_server.py" 8765 & server=$!
    trap "kill $app $watcher $server 2>/dev/null || true" EXIT
    mkdir -p "$work/downloads"
    q=$(printf "\047")
    sqlite3 "$work/data/io.github.andymai.Tug/tug.db" \
      "INSERT INTO downloads (url, dir, state, added_ms) VALUES (${q}http://127.0.0.1:8765/big.bin${q}, CAST(${q}$work/downloads${q} AS BLOB), ${q}queued${q}, 0)"
    ./target/debug/tug > "$work/app.log" 2>&1 & app=$!
    trap "kill $app $watcher $server 2>/dev/null || true" EXIT
    for _ in $(seq 1 30); do [ -s "$work/registered" ] && break; sleep 0.5; done
    item=$(cut -d" " -f1 "$work/registered")
    for _ in $(seq 1 20); do [ "$(prop Status)" = "s \"Active\"" ] && break; sleep 0.5; done
    expect "active while downloading" "$(prop Status)" "s \"Active\""
    sleep 2
    case "$(prop IconName)" in *"Tug-progress-"[0-9][0-9]*) echo "ok: ring icon $(prop IconName)";; *) fail "icon: $(prop IconName)";; esac
    case "$(prop ToolTip)" in *"1 downloading "*"/s "*"%\""*) echo "ok: tooltip while downloading";; *) fail "tooltip: $(prop ToolTip)";; esac

    menu=$(prop Menu | cut -d" " -f2 | tr -d \")
    layout=$(busctl --user call -- "$item" "$menu" com.canonical.dbusmenu GetLayout iias 0 -1 2 label enabled)
    pause=$(grep -oE "\(ia\{sv\}av\) [0-9]+ [0-9]+ \"label\" s \"Pause all\"" <<<"$layout" | cut -d" " -f2)
    busctl --user call -- "$item" "$menu" com.canonical.dbusmenu Event isvu "$pause" clicked s "" 0
    for _ in $(seq 1 20); do [ "$(prop Status)" = "s \"Passive\"" ] && break; sleep 0.5; done
    expect "passive after Pause all" "$(prop Status)" "s \"Passive\""
    case "$(prop ToolTip)" in *"\"1 paused\""*) echo "ok: tooltip after Pause all";; *) fail "tooltip: $(prop ToolTip)";; esac

    layout=$(busctl --user call -- "$item" "$menu" com.canonical.dbusmenu GetLayout iias 0 -1 2 label enabled)
    resume=$(grep -oE "\(ia\{sv\}av\) [0-9]+ [0-9]+ \"label\" s \"Resume all\"" <<<"$layout" | cut -d" " -f2)
    busctl --user call -- "$item" "$menu" com.canonical.dbusmenu Event isvu "$resume" clicked s "" 0
    for _ in $(seq 1 20); do [ "$(prop Status)" = "s \"Active\"" ] && break; sleep 0.5; done
    expect "active after Resume all" "$(prop Status)" "s \"Active\""
  '
# A Tug that is still stopping can write into $work for a moment.
for _ in 1 2 3 4 5; do rm -rf "$work" 2>/dev/null && break; sleep 1; done
