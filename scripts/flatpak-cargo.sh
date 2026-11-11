#!/usr/bin/env bash
# flatpak-builder mounts its ccache folder at /run/ccache when the SDK has ccache,
# and the Flatpak workflow caches that folder between releases. There, cargo keeps
# its registry and the dependencies' builds. Tug's own crates change with each
# release, so they leave the cache after the build. A new rustc starts the builds
# again, and a cache over FLATPAK_CARGO_CACHE_MB (4096) starts all of it again.
# FLATPAK_CARGO_CACHE points the script at another folder, for its test.
set -euo pipefail

# ccache keeps the C builds (the bundled SQLite) in the same cached folder, up to 5 GB by default.
export CCACHE_MAXSIZE=500M

cache=${FLATPAK_CARGO_CACHE:-/run/ccache}
limit=${FLATPAK_CARGO_CACHE_MB:-4096}
target=target
if [[ -d $cache ]]; then
  export CARGO_HOME=$cache/cargo CARGO_TARGET_DIR=$cache/target
  target=$CARGO_TARGET_DIR
  stamp=$target/rustc-version
  size=0
  for dir in "$CARGO_HOME" "$target"; do
    [[ ! -d $dir ]] || size=$((size + $(du -sm "$dir" | cut -f1)))
  done
  if ((size > limit)); then
    echo "flatpak-cargo: the cache has $size MiB, so it starts again from nothing"
    rm -rf "$CARGO_HOME" "$target"
  elif [[ ! -f $stamp || $(rustc -vV) != "$(< "$stamp")" ]]; then
    echo "flatpak-cargo: a new rustc, so the builds start again from nothing"
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
