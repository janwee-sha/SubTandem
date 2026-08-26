#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

mkdir -p "$ROOT_DIR/dist/ui"
find "$ROOT_DIR/dist/ui" -mindepth 1 -delete
if [ -d "$ROOT_DIR/dist/main" ]; then
  find "$ROOT_DIR/dist/main" -mindepth 1 -delete
  rmdir "$ROOT_DIR/dist/main"
fi
rm -f "$ROOT_DIR/dist/main.js" "$ROOT_DIR/dist/global.js"

cd "$ROOT_DIR"
parcel build --no-cache --target entry --target globalEntry --target sidebar --target overlay
