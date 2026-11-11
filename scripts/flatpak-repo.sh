#!/usr/bin/env bash
# Builds Tug's Flatpak repository for GitHub Pages from a release's bundle,
# signed with the one secret key in gpg's keyring.
#
#   scripts/flatpak-repo.sh BUNDLE SITE URL
#
# SITE must not exist. It gets the OSTree repository in repo/, tug.flatpakrepo
# and io.github.andymai.Tug.flatpakref. URL is where SITE is served.
#
# The new commit goes on top of the last commits at URL, checked with the key
# in PUBLISHED_KEY (Tug's public key by default). A client that read a cached
# summary still finds its commit, and an update gets a delta from the one before.
set -euo pipefail

usage="usage: flatpak-repo.sh BUNDLE SITE URL"
bundle=${1:?$usage}
site=${2:?$usage}
url=${3:?$usage}
url=${url%/}
published_key=${PUBLISHED_KEY:-$(dirname "$0")/../packaging/flatpak/tug-repo.asc}
app=io.github.andymai.Tug
ref=app/$app/x86_64/master
parents=2

[[ ! -e $site ]] || { echo "$site exists: give a folder that doesn't" >&2; exit 1; }

mapfile -t keys < <(gpg --batch --list-secret-keys --with-colons |
  awk -F: '$1 == "sec" { primary = 1 } $1 == "fpr" && primary { print $10; primary = 0 }')
[[ ${#keys[@]} -eq 1 ]] || { echo "expected one secret key, found ${#keys[@]}" >&2; exit 1; }
key=${keys[0]}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
repo=$site/repo
mkdir -p "$site"
ostree init --mode=archive-z2 --repo="$repo"

# Only a missing repository starts a new one: without the old commits, a client
# that read a cached summary would find nothing to pull.
status=$(curl -sL --retry 3 -o /dev/null -w '%{http_code}' "$url/repo/summary") || status=000
case $status in
  200)
    ostree remote add --repo="$repo" --gpg-import="$published_key" published "$url/repo/"
    ostree pull --repo="$repo" --mirror --depth="$parents" published "$ref"
    ostree remote delete --repo="$repo" published
    ;;
  404) echo "nothing published at $url yet: a new repository" ;;
  *) echo "can't read $url/repo/summary (HTTP $status)" >&2; exit 1 ;;
esac

ostree init --mode=archive-z2 --repo="$work/bundle"
flatpak build-import-bundle "$work/bundle" "$bundle"
flatpak build-commit-from --gpg-sign="$key" --src-repo="$work/bundle" --no-update-summary "$repo" "$ref"
flatpak build-update-repo --gpg-sign="$key" --generate-static-deltas --prune --prune-depth="$parents" \
  --title="Tug" --comment="Fast, resumable downloads for Linux" \
  --homepage="https://github.com/andymai/tug" "$repo"

public=$(gpg --batch --export "$key" | base64 -w0)

cat > "$site/tug.flatpakrepo" <<EOF
[Flatpak Repo]
Title=Tug
Url=$url/repo/
Homepage=https://github.com/andymai/tug
Comment=Fast, resumable downloads for Linux
DefaultBranch=master
GPGKey=$public
EOF

cat > "$site/$app.flatpakref" <<EOF
[Flatpak Ref]
Name=$app
Branch=master
Title=Tug
Url=$url/repo/
SuggestRemoteName=tug
RuntimeRepo=https://dl.flathub.org/repo/flathub.flatpakrepo
IsRuntime=false
GPGKey=$public
EOF
