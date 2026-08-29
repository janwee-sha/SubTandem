#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
STAGE_PARENT="$ROOT_DIR/build/package"
STAGE_DIR="$STAGE_PARENT/SubTandem"
PLUGIN_CLI=${IINA_PLUGIN_BIN:-/Applications/IINA.app/Contents/MacOS/iina-plugin}
ARTIFACT="$STAGE_PARENT/SubTandem-0.1.1.iinaplgz"

if [ ! -x "$PLUGIN_CLI" ]; then
  echo "IINA plugin CLI not found or not executable: $PLUGIN_CLI" >&2
  exit 1
fi

case "$STAGE_DIR" in
  "$ROOT_DIR"/build/package/SubTandem) ;;
  *) echo "Refusing to clean unexpected staging path: $STAGE_DIR" >&2; exit 1 ;;
esac
case "$ARTIFACT" in
  "$ROOT_DIR"/build/package/SubTandem-0.1.1.iinaplgz) ;;
  *) echo "Refusing to replace unexpected artifact path: $ARTIFACT" >&2; exit 1 ;;
esac

mkdir -p "$STAGE_DIR"
find "$STAGE_DIR" -mindepth 1 -delete
cp -p "$ROOT_DIR/Info.json" "$ROOT_DIR/README.md" "$ROOT_DIR/LICENSE" "$ROOT_DIR/THIRD_PARTY_NOTICES.txt" "$STAGE_DIR/"
cp -R "$ROOT_DIR/dist" "$STAGE_DIR/dist"

"$ROOT_DIR/scripts/verify-package.sh" "$STAGE_DIR"
rm -f "$ARTIFACT"

(
  cd "$STAGE_PARENT"
  "$PLUGIN_CLI" pack SubTandem
)

for required in Info.json README.md LICENSE THIRD_PARTY_NOTICES.txt dist/main.js dist/global.js dist/ui/sidebar.html dist/ui/overlay.html dist/native/subtandem-transport dist/native/subtandem-subtitle-extractor; do
  if ! unzip -Z1 "$ARTIFACT" | grep -Fqx "$required"; then
    echo "Packed artifact is missing $required" >&2
    exit 1
  fi
done

if unzip -Z1 "$ARTIFACT" | grep -Eq '(^|/)(node_modules|\.git|\.parcel-cache|specs|tests|src|@data|@tmp)(/|$)|^native/|credentials\.json$|(^|/)\.env|\.(a|o|h)$|ffmpeg-.*\.tar\.'; then
  echo "Packed artifact contains a forbidden development or runtime path" >&2
  exit 1
fi

echo "Packed artifact: $ARTIFACT"
