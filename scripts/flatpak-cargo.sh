#!/usr/bin/env bash
# Builds Tug's binary inside flatpak-builder and installs it in /app.
#
# flatpak-builder mounts its ccache folder at /run/ccache when the SDK has
# ccache, and the Flatpak workflow caches that folder between releases. There,
# cargo keeps its registry and the dependencies' builds. Tug's own crates change
# with each release, so they leave the cache after the build. A new rustc, or a
# cache over 4 GiB, starts it again from nothing.
set -euo pipefail

cache=${FLATPAK_CARGO_CACHE:-/run/ccache}
target=target
if [[ -d $cache ]]; then
  export CARGO_HOME=$cache/cargo CARGO_TARGET_DIR=$cache/target
  target=$CARGO_TARGET_DIR
  stamp=$target/rustc-version
  size=0
  [[ ! -d $target ]] || size=$(du -sm "$target" | cut -f1)
  if [[ ! -f $stamp || $(rustc -vV) != "$(< "$stamp")" ]] || ((size > 4096)); then
    echo "flatpak-cargo: starting the cargo cache from nothing"
    rm -rf "$target"
  fi
  mkdir -p "$target"
  rustc -vV > "$stamp"
fi

cargo build --release --locked -p tug-desktop --features tauri/custom-protocol
install -Dm755 "$target/release/tug" /app/bin/tug

if [[ $target != target ]]; then
  find "$target/release" -maxdepth 2 \( -name 'tug*' -o -name 'libtug*' \) -exec rm -rf {} +
fi
