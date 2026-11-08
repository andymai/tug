#!/usr/bin/env bash
# Usage: install-data.sh <prefix>, e.g. /usr or ~/.local
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
prefix=${1:?usage: install-data.sh <prefix>}
share="$prefix/share"
id=io.github.andymai.Tug

install -Dm644 "$repo/packaging/$id.desktop" "$share/applications/$id.desktop"
install -Dm644 "$repo/packaging/$id.metainfo.xml" "$share/metainfo/$id.metainfo.xml"
for size in 16 22 24 32 48 64 128 256 512; do
  install -Dm644 "$repo/brand/png/tug-$size.png" "$share/icons/hicolor/${size}x${size}/apps/$id.png"
done
install -Dm644 "$repo/brand/svg/icon.svg" "$share/icons/hicolor/scalable/apps/$id.svg"
install -Dm644 "$repo/brand/svg/symbolic.svg" "$share/icons/hicolor/symbolic/apps/$id-symbolic.svg"
