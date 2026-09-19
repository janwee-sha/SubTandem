#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TRANSPORT_PACKAGE="$ROOT_DIR/native/transport"
EXTRACTOR_PACKAGE="$ROOT_DIR/native/subtitle-extractor"
STYLE_PICKER_PACKAGE="$ROOT_DIR/native/style-picker"
OUTPUT_DIR="$ROOT_DIR/dist/native"
HASH_FILE="$ROOT_DIR/build/native-hashes.json"
MODULE_CACHE="$ROOT_DIR/native/.build/module-cache"
SWIFT_BUILD_DIR="$ROOT_DIR/native/.build/swiftbuild"

mkdir -p "$OUTPUT_DIR" "$SWIFT_BUILD_DIR"
find "$OUTPUT_DIR" -mindepth 1 -delete
find "$SWIFT_BUILD_DIR" -mindepth 1 -delete
mkdir -p "$MODULE_CACHE" "$ROOT_DIR/build"
export MACOSX_DEPLOYMENT_TARGET=12.0
export CLANG_MODULE_CACHE_PATH="$MODULE_CACHE"
export SWIFTPM_MODULECACHE_OVERRIDE="$MODULE_CACHE"

build_package() {
  PACKAGE_DIR=$1
  SCRATCH_PATH=$2
  ARCH=$3
  FFMPEG_PREFIX=${4:-}

  SUBTANDEM_FFMPEG_PREFIX="$FFMPEG_PREFIX" \
    swift build --build-system swiftbuild --disable-sandbox --package-path "$PACKAGE_DIR" --scratch-path "$SCRATCH_PATH" -c release --triple "$ARCH-apple-macosx12.0"
  SWIFT_BIN_PATH=$(SUBTANDEM_FFMPEG_PREFIX="$FFMPEG_PREFIX" \
    swift build --build-system swiftbuild --disable-sandbox --package-path "$PACKAGE_DIR" --scratch-path "$SCRATCH_PATH" -c release --triple "$ARCH-apple-macosx12.0" --show-bin-path)
}

"$ROOT_DIR/scripts/build-ffmpeg.sh" "${SUBTANDEM_FFMPEG_SOURCE:-$ROOT_DIR/native/.build/ffmpeg/downloads/ffmpeg-8.1.2.tar.xz}"

for ARCH in arm64 x86_64; do
  TRANSPORT_SCRATCH="$SWIFT_BUILD_DIR/transport/$ARCH"
  EXTRACTOR_SCRATCH="$SWIFT_BUILD_DIR/subtitle-extractor/$ARCH"
  STYLE_PICKER_SCRATCH="$SWIFT_BUILD_DIR/style-picker/$ARCH"

  build_package "$TRANSPORT_PACKAGE" "$TRANSPORT_SCRATCH" "$ARCH"
  TRANSPORT_BIN_PATH=$SWIFT_BIN_PATH
  build_package "$EXTRACTOR_PACKAGE" "$EXTRACTOR_SCRATCH" "$ARCH" "$ROOT_DIR/native/.build/ffmpeg/$ARCH"
  EXTRACTOR_BIN_PATH=$SWIFT_BIN_PATH
  build_package "$STYLE_PICKER_PACKAGE" "$STYLE_PICKER_SCRATCH" "$ARCH"
  STYLE_PICKER_BIN_PATH=$SWIFT_BIN_PATH

  if [ "$ARCH" = arm64 ]; then
    TRANSPORT_ARM="$TRANSPORT_BIN_PATH/subtandem-transport"
    EXTRACTOR_ARM="$EXTRACTOR_BIN_PATH/subtandem-subtitle-extractor"
    STYLE_PICKER_ARM="$STYLE_PICKER_BIN_PATH/subtandem-style-picker"
  else
    TRANSPORT_INTEL="$TRANSPORT_BIN_PATH/subtandem-transport"
    EXTRACTOR_INTEL="$EXTRACTOR_BIN_PATH/subtandem-subtitle-extractor"
    STYLE_PICKER_INTEL="$STYLE_PICKER_BIN_PATH/subtandem-style-picker"
  fi
done

lipo -create "$TRANSPORT_ARM" "$TRANSPORT_INTEL" -output "$OUTPUT_DIR/subtandem-transport"
lipo -create "$EXTRACTOR_ARM" "$EXTRACTOR_INTEL" -output "$OUTPUT_DIR/subtandem-subtitle-extractor"
lipo -create "$STYLE_PICKER_ARM" "$STYLE_PICKER_INTEL" -output "$OUTPUT_DIR/subtandem-style-picker"

for HELPER in "$OUTPUT_DIR/subtandem-transport" "$OUTPUT_DIR/subtandem-subtitle-extractor" "$OUTPUT_DIR/subtandem-style-picker"; do
  chmod 755 "$HELPER"
  codesign --force --sign - "$HELPER"
  lipo "$HELPER" -verify_arch arm64
  lipo "$HELPER" -verify_arch x86_64
  codesign --verify --strict "$HELPER"
  if otool -L "$HELPER" | awk '/^[[:space:]]+\//{print $1}' | grep -Ev '^(/usr/lib/|/System/Library/)' | grep -q .; then
    echo "Native executable has a non-system dynamic dependency: $HELPER" >&2
    exit 1
  fi
done

node -e 'const fs=require("node:fs"),c=require("node:crypto"),p=require("node:path");const [out,...files]=process.argv.slice(1);const hash=file=>c.createHash("sha256").update(fs.readFileSync(file)).digest("hex");fs.writeFileSync(out,JSON.stringify(Object.fromEntries(files.map(file=>[p.basename(file),hash(file)])),null,2)+"\n")' "$HASH_FILE" "$OUTPUT_DIR/subtandem-transport" "$OUTPUT_DIR/subtandem-subtitle-extractor" "$OUTPUT_DIR/subtandem-style-picker"
