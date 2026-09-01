#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TRANSPORT_PACKAGE="$ROOT_DIR/native/transport"
EXTRACTOR_PACKAGE="$ROOT_DIR/native/subtitle-extractor"
STYLE_PICKER_PACKAGE="$ROOT_DIR/native/style-picker"
OUTPUT_DIR="$ROOT_DIR/dist/native"
HASH_FILE="$ROOT_DIR/build/native-hashes.json"
MODULE_CACHE="$ROOT_DIR/native/.build/module-cache"

mkdir -p "$OUTPUT_DIR"
find "$OUTPUT_DIR" -mindepth 1 -delete
mkdir -p "$MODULE_CACHE" "$ROOT_DIR/build"
export MACOSX_DEPLOYMENT_TARGET=12.0
export CLANG_MODULE_CACHE_PATH="$MODULE_CACHE"
export SWIFTPM_MODULECACHE_OVERRIDE="$MODULE_CACHE"

swift package --package-path "$TRANSPORT_PACKAGE" clean
swift package --package-path "$EXTRACTOR_PACKAGE" clean
swift package --package-path "$STYLE_PICKER_PACKAGE" clean

"$ROOT_DIR/scripts/build-ffmpeg.sh" "${SUBTANDEM_FFMPEG_SOURCE:-$ROOT_DIR/native/.build/ffmpeg/downloads/ffmpeg-8.1.2.tar.xz}"

for ARCH in arm64 x86_64; do
  swift build --disable-sandbox --package-path "$TRANSPORT_PACKAGE" -c release --arch "$ARCH"
  SUBTANDEM_FFMPEG_PREFIX="$ROOT_DIR/native/.build/ffmpeg/$ARCH" \
    swift build --disable-sandbox --package-path "$EXTRACTOR_PACKAGE" -c release --arch "$ARCH"
  swift build --disable-sandbox --package-path "$STYLE_PICKER_PACKAGE" -c release --arch "$ARCH"
done

TRANSPORT_ARM="$TRANSPORT_PACKAGE/.build/arm64-apple-macosx/release/subtandem-transport"
TRANSPORT_INTEL="$TRANSPORT_PACKAGE/.build/x86_64-apple-macosx/release/subtandem-transport"
EXTRACTOR_ARM="$EXTRACTOR_PACKAGE/.build/arm64-apple-macosx/release/subtandem-subtitle-extractor"
EXTRACTOR_INTEL="$EXTRACTOR_PACKAGE/.build/x86_64-apple-macosx/release/subtandem-subtitle-extractor"
STYLE_PICKER_ARM="$STYLE_PICKER_PACKAGE/.build/arm64-apple-macosx/release/subtandem-style-picker"
STYLE_PICKER_INTEL="$STYLE_PICKER_PACKAGE/.build/x86_64-apple-macosx/release/subtandem-style-picker"
lipo -create "$TRANSPORT_ARM" "$TRANSPORT_INTEL" -output "$OUTPUT_DIR/subtandem-transport"
lipo -create "$EXTRACTOR_ARM" "$EXTRACTOR_INTEL" -output "$OUTPUT_DIR/subtandem-subtitle-extractor"
lipo -create "$STYLE_PICKER_ARM" "$STYLE_PICKER_INTEL" -output "$OUTPUT_DIR/subtandem-style-picker"

for HELPER in "$OUTPUT_DIR/subtandem-transport" "$OUTPUT_DIR/subtandem-subtitle-extractor" "$OUTPUT_DIR/subtandem-style-picker"; do
  chmod 755 "$HELPER"
  codesign --force --sign - "$HELPER"
  lipo "$HELPER" -verify_arch arm64 x86_64
  codesign --verify --strict "$HELPER"
  if otool -L "$HELPER" | awk '/^[[:space:]]+\//{print $1}' | grep -Ev '^(/usr/lib/|/System/Library/)' | grep -q .; then
    echo "Native executable has a non-system dynamic dependency: $HELPER" >&2
    exit 1
  fi
done

node -e 'const fs=require("node:fs"),c=require("node:crypto"),p=require("node:path");const [out,...files]=process.argv.slice(1);const hash=file=>c.createHash("sha256").update(fs.readFileSync(file)).digest("hex");fs.writeFileSync(out,JSON.stringify(Object.fromEntries(files.map(file=>[p.basename(file),hash(file)])),null,2)+"\n")' "$HASH_FILE" "$OUTPUT_DIR/subtandem-transport" "$OUTPUT_DIR/subtandem-subtitle-extractor" "$OUTPUT_DIR/subtandem-style-picker"
