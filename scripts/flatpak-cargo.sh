#!/usr/bin/env bash
# Builds Tug's binary inside flatpak-builder and installs it in /app.
#
# flatpak-builder mounts its ccache folder at /run/ccache when the SDK has
# ccache, and the Flatpak workflow caches that folder between releases. There,
# cargo keeps its registry and the dependencies' builds. Tug's own crates change
# with each release, so they leave the cache after the build. A new rustc, or a
# cache over 4 GiB, starts it again from nothing.
set -euo pipefail

target=target
if [[ -d /run/ccache ]]; then
  export CARGO_HOME=/run/ccache/cargo CARGO_TARGET_DIR=/run/ccache/target
  target=$CARGO_TARGET_DIR
  stamp=$target/rustc-version
  size=$(du -sm "$target" 2> /dev/null | cut -f1)
  if [[ $(rustc -vV) != "$(cat "$stamp" 2> /dev/null)" ]] || ((${size:-0} > 4096)); then
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
