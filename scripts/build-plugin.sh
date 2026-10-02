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
node "$ROOT_DIR/scripts/finalize-webview.mjs" "$ROOT_DIR/dist/ui"

case "${SUBTANDEM_CREDENTIAL_HOST_PROBE:-0}" in
  0) ;;
  1)
    node "$ROOT_DIR/tests/helpers/build-credential-host-probe.mjs" "$ROOT_DIR"
    (cd "$ROOT_DIR/build/credential-probe/ui" && "$ROOT_DIR/node_modules/.bin/parcel" build --no-cache --target sidebar)
    node "$ROOT_DIR/tests/helpers/build-credential-host-probe.mjs" "$ROOT_DIR" prune
    ;;
  *) echo "SUBTANDEM_CREDENTIAL_HOST_PROBE must be 0 or 1" >&2; exit 1 ;;
esac
