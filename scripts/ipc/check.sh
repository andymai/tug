#!/usr/bin/env bash
# Run it in the dev container while `pnpm --filter @tug/desktop dev` serves the UI.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
mkdir -m 700 "$work/runtime"
# Tug's default folder comes from user-dirs.dirs; without one it is the real ~/Downloads.
mkdir -p "$work/config" "$work/downloads"
printf 'XDG_DOWNLOAD_DIR="%s"\n' "$work/downloads" > "$work/config/user-dirs.dirs"
# `tug browsers` gets its own home with one browser of each kind, and a stand-in
# flatpak that grants the Flatpak Chrome flatpak-spawn and the Flatpak Vivaldi nothing.
chrome="$work/home/.var/app/com.google.Chrome"
vivaldi="$work/home/.var/app/com.vivaldi.Vivaldi"
mkdir -p "$work/bin" "$work/config/google-chrome" "$work/home/.mozilla/firefox" \
  "$chrome/config/google-chrome" "$vivaldi/config/vivaldi"
touch "$work/config/google-chrome/Local State" "$work/home/.mozilla/firefox/profiles.ini" \
  "$chrome/config/google-chrome/Local State" "$vivaldi/config/vivaldi/Local State"
cat > "$work/bin/flatpak" <<'EOF'
#!/bin/sh
[ "$3" = com.google.Chrome ] && echo org.freedesktop.Flatpak=talk
exit 0
EOF
chmod +x "$work/bin/flatpak"
cd "$repo"
RUSTFLAGS="" PKG_CONFIG=/usr/bin/pkg-config cargo build -p tug-desktop -p tug-host --quiet

env -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS GDK_BACKEND=x11 GSETTINGS_BACKEND=memory \
  XDG_CONFIG_HOME="$work/config" XDG_DATA_HOME="$work/data" XDG_CACHE_HOME="$work/cache" \
  XDG_RUNTIME_DIR="$work/runtime" dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" bash -euo pipefail -c '
    fail() { echo "FAIL: $*" >&2; exit 1; }
    expect() { [ "$2" = "$3" ] || fail "$1: expected $3, got $2"; echo "ok: $1"; }
    visible() { xdotool search --onlyvisible --name "^Tug$" 2>/dev/null | wc -l; }
    tug=./target/debug/tug
    dir="$XDG_RUNTIME_DIR/app/io.github.andymai.Tug.Devel"
    binary=$(readlink -f "$tug")
    ours() {
      for p in /proc/[0-9]*; do
        [ "$(readlink -f "$p/exe" 2>/dev/null)" = "$binary" ] || continue
        tr "\0" "\n" < "$p/environ" 2>/dev/null | grep -qx "XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR" && echo "${p#/proc/}"
      done
      return 0
    }

    requests="$(dirname "$XDG_CONFIG_HOME")/requests.log"
    SLOW_SERVER_LOG="$requests" /usr/bin/python3 scripts/tray/slow_server.py 8766 & server=$!
    trap "kill \$(ours) $server 2>/dev/null || true" EXIT

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

    talk() { /usr/bin/python3 scripts/host/talk.py ./target/debug/tug-host "$@"; }
    replies=$(talk '"'"'{"id":1,"type":"ping"}'"'"' '"'"'{"id":2,"type":"list"}'"'"' '"'"'{"id":3,"type":"add","urls":["http://127.0.0.1:8766/two.bin"]}'"'"')
    expect "tug-host answers each message" "$(wc -l <<<"$replies")" 3
    python3 -c "
import json, sys
ping, listed, added = (json.loads(l) for l in sys.stdin)
assert ping == {\"id\": 1, \"ok\": True, \"running\": True, \"type\": \"pong\"}, ping
assert listed[\"id\"] == 2 and listed[\"downloads\"][0][\"name\"] == \"big.bin\", listed
assert added[\"id\"] == 3 and added[\"added\"][0][\"name\"] == \"two.bin\", added
" <<<"$replies" || fail "tug-host replies: $replies"
    echo "ok: tug-host pings, lists and adds"

    replies=$(talk "{\"id\":4,\"type\":\"add\",\"urls\":[\"http://127.0.0.1:8766/origin.bin\"],\"referrer\":\"http://127.0.0.1:8766/page#top\",\"cookies\":\"session=abc123\",\"user_agent\":\"Mozilla/5.0 TugCheck\"}" \
      "{\"id\":5,\"type\":\"add\",\"urls\":[\"http://127.0.0.1:8766/bad.bin\"],\"cookies\":\"a=1\\r\\nX: y\"}")
    python3 -c "
import json, sys
good, bad = (json.loads(l) for l in sys.stdin)
assert good[\"added\"][0][\"name\"] == \"origin.bin\", good
assert bad[\"failed\"] == [{\"url\": \"http://127.0.0.1:8766/bad.bin\", \"reason\": \"the cookies can'"'"'t be sent as a header\"}], bad
" <<<"$replies" || fail "adds with an origin: $replies"
    sleep 1
    sent=$(awk -F "\t" "\$1 == \"/origin.bin\"" "$requests")
    [ -n "$sent" ] || fail "the server never saw origin.bin"
    expect "every origin.bin request carries the origin" \
      "$(cut -f2- <<<"$sent" | sort -u)" "$(printf "session=abc123\thttp://127.0.0.1:8766/page\tMozilla/5.0 TugCheck")"
    echo "ok: a bad origin fails that link with the reason"

    root=$(dirname "$XDG_CONFIG_HOME")
    browsers=$(HOME="$root/home" PATH="$root/bin:$PATH" $tug browsers)
    expect "tug browsers finds four" "$(wc -l <<<"$browsers")" 4
    for line in "Google Chrome  *Registered" "Google Chrome (Flatpak)  *Registered" "Firefox  *Registered" \
      "Vivaldi (Flatpak)  *Needs permission.* com.vivaldi.Vivaldi"; do
      grep -qx "$line" <<<"$browsers" || fail "tug browsers, no \"$line\": $browsers"
    done
    echo "ok: tug browsers registers each browser that ran"
    manifest="$XDG_CONFIG_HOME/google-chrome/NativeMessagingHosts/io.github.andymai.tug.json"
    path=$(python3 -c "import json, sys; print(json.load(open(sys.argv[1]))[\"path\"])" "$manifest")
    expect "the manifest names tug-host" "$path" "$(readlink -f ./target/debug/tug-host)"
    pong=$(/usr/bin/python3 scripts/host/talk.py "$path" "{\"id\":7,\"type\":\"ping\"}")
    expect "the registered host reaches Tug" "$pong" "{\"id\": 7, \"ok\": true, \"running\": true, \"type\": \"pong\"}"
    wrapper="$root/home/.var/app/com.google.Chrome/data/io.github.andymai.Tug/tug-host"
    [ -x "$wrapper" ] && sh -n "$wrapper" && grep -qF "flatpak-spawn --host" "$wrapper" && grep -qF "$path" "$wrapper" \
      || fail "the Flatpak bridge: $(cat "$wrapper")"
    echo "ok: the Flatpak bridge runs the same tug-host"
    [ ! -e "$root/home/.var/app/com.vivaldi.Vivaldi/data" ] || fail "Vivaldi got a bridge without permission"
    echo "ok: a Flatpak without permission gets nothing"

    sleep 2
    expect "one window" "$(visible)" 1
    status=0; timeout 10 $tug || status=$?
    expect "a second tug hands off and exits" "$status" 0
    expect "still one window" "$(visible)" 1
    expect "still one Tug" "$(ours | wc -l)" 1

    kill -9 $(ours)
    sleep 1
    [ -S "$dir/tug.sock" ] || fail "the socket file should outlive a killed Tug"
    status=0; out=$($tug list 2>&1) || status=$?
    expect "list without Tug fails" "$status" 1
    expect "and says so" "$out" "Tug isn'"'"'t running"
    $tug > /dev/null 2>&1 &
    for _ in $(seq 1 40); do $tug list > /dev/null 2>&1 && break; sleep 0.5; done
    grep -q " big.bin$" <<<"$($tug list)" || fail "after restart: $($tug list)"
    echo "ok: a new Tug replaces the stale socket"

    kill $(ours)
    for _ in $(seq 1 20); do [ -z "$(ours)" ] && break; sleep 0.5; done
    $tug > /dev/null 2>&1 &
    $tug > /dev/null 2>&1 &
    for _ in $(seq 1 40); do $tug list > /dev/null 2>&1 && break; sleep 0.5; done
    sleep 6
    expect "two launches at once leave one Tug" "$(ours | wc -l)" 1
    grep -q " big.bin$" <<<"$($tug list)" || fail "after the race: $($tug list)"
    echo "ok: and it answers"
  '
# A Tug that is still stopping can write into $work for a moment.
for _ in 1 2 3 4 5; do rm -rf "$work" 2>/dev/null && break; sleep 1; done
