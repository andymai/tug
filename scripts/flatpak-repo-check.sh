#!/usr/bin/env bash
# Installs Tug through the tug.flatpakrepo that flatpak-repo.sh wrote, from the
# repository on disk, and finds Tug in its AppStream data, as a store would.
# A private FLATPAK_USER_DIR keeps the real installation out of it.
#
#   scripts/flatpak-repo-check.sh SITE
set -euo pipefail

site=$(realpath "${1:?usage: flatpak-repo-check.sh SITE}")
app=io.github.andymai.Tug
FLATPAK_USER_DIR=$(mktemp -d)
export FLATPAK_USER_DIR
trap 'rm -rf "$FLATPAK_USER_DIR"' EXIT

flatpak --user remote-add check "$site/tug.flatpakrepo"
flatpak --user remote-modify --url="file://$site/repo" check
flatpak --user install -y --noninteractive --no-deps --no-related check "$app"
flatpak --user update -y --noninteractive --appstream check
flatpak --user search --columns=application "$app" | grep -qx "$app" ||
  { echo "$app is not in the repository's AppStream data" >&2; exit 1; }
flatpak --user info "$app" | grep -E 'Version|Commit'
