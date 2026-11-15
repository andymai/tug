#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
python3 -I build.py svg
for z in 16 22 24 32; do rsvg-convert -w $z -h $z svg/icon-$z.svg -o png/tug-$z.png; done
for z in 48 64 128 256 512 1024; do rsvg-convert -w $z -h $z svg/icon.svg -o png/tug-$z.png; done
rsvg-convert -w 128 -h 128 svg/icon-store.svg -o ../apps/extension/store/icon-128.png
