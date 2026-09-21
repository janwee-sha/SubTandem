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
DESTINATION_DIR="$SWIFT_BUILD_DIR/destinations"
SWIFT_CACHE_STAMP="$SWIFT_BUILD_DIR/build-context.sha256"
TOOLCHAIN_CHECK="$ROOT_DIR/scripts/verify-native-toolchain.sh"
FFMPEG_BUILD="$ROOT_DIR/scripts/build-ffmpeg.sh"
FFMPEG_CACHE_STAMP="$ROOT_DIR/native/.build/ffmpeg/build-context.sha256"
FORCE_REBUILD=${SUBTANDEM_FORCE_REBUILD:-0}

case "$FORCE_REBUILD" in
  0|1) ;;
  *) echo "SUBTANDEM_FORCE_REBUILD must be 0 or 1" >&2; exit 1 ;;
esac

"$TOOLCHAIN_CHECK"

mkdir -p "$OUTPUT_DIR" "$SWIFT_BUILD_DIR"
find "$OUTPUT_DIR" -mindepth 1 -delete
export MACOSX_DEPLOYMENT_TARGET=12.0
SWIFT_SDK=$(xcrun --sdk macosx --show-sdk-path)
SWIFT_TOOLCHAIN_BIN=$(dirname "$(xcrun --find swift)")
SWIFT_VERSION=$(swift --version 2>&1)
SDK_VERSION=$(xcrun --sdk macosx --show-sdk-version)
SCRIPT_SHA=$(shasum -a 256 "$0" | awk '{print $1}')
TOOLCHAIN_CHECK_SHA=$(shasum -a 256 "$TOOLCHAIN_CHECK" | awk '{print $1}')
HOST_ARCH=$(uname -m)

"$FFMPEG_BUILD" "${SUBTANDEM_FFMPEG_SOURCE:-$ROOT_DIR/native/.build/ffmpeg/downloads/ffmpeg-8.1.2.tar.xz}"
if [ ! -f "$FFMPEG_CACHE_STAMP" ]; then
  echo "FFmpeg build context is missing" >&2
  exit 1
fi
FFMPEG_CACHE_KEY=$(cat "$FFMPEG_CACHE_STAMP")

SWIFT_CACHE_KEY=$(printf '%s\n' \
  "schema=1" \
  "script=$SCRIPT_SHA" \
  "toolchain-check=$TOOLCHAIN_CHECK_SHA" \
  "ffmpeg=$FFMPEG_CACHE_KEY" \
  "swift=$SWIFT_VERSION" \
  "sdk=$SDK_VERSION" \
  "host=$HOST_ARCH" \
  "target=macos12.0" | shasum -a 256 | awk '{print $1}')

if [ "$FORCE_REBUILD" = 1 ] || [ ! -f "$SWIFT_CACHE_STAMP" ] || [ "$(cat "$SWIFT_CACHE_STAMP")" != "$SWIFT_CACHE_KEY" ]; then
  find "$SWIFT_BUILD_DIR" -mindepth 1 -delete
  if [ -d "$MODULE_CACHE" ]; then
    find "$MODULE_CACHE" -mindepth 1 -delete
  fi
fi

mkdir -p "$MODULE_CACHE" "$ROOT_DIR/build" "$DESTINATION_DIR"
export CLANG_MODULE_CACHE_PATH="$MODULE_CACHE"
export SWIFTPM_MODULECACHE_OVERRIDE="$MODULE_CACHE"

build_package() {
  PACKAGE_DIR=$1
  SCRATCH_PATH=$2
  ARCH=$3
  DESTINATION_PATH=$4
  FFMPEG_PREFIX=${5:-}

  SUBTANDEM_FFMPEG_PREFIX="$FFMPEG_PREFIX" \
    swift build --build-system swiftbuild --disable-sandbox --package-path "$PACKAGE_DIR" --scratch-path "$SCRATCH_PATH" -c release --destination "$DESTINATION_PATH" --arch "$ARCH"
  SWIFT_BIN_PATH=$(SUBTANDEM_FFMPEG_PREFIX="$FFMPEG_PREFIX" \
    swift build --build-system swiftbuild --disable-sandbox --package-path "$PACKAGE_DIR" --scratch-path "$SCRATCH_PATH" -c release --destination "$DESTINATION_PATH" --arch "$ARCH" --show-bin-path)
}

for ARCH in arm64 x86_64; do
  DESTINATION_PATH="$DESTINATION_DIR/$ARCH.json"
  TRANSPORT_SCRATCH="$SWIFT_BUILD_DIR/transport/$ARCH"
  EXTRACTOR_SCRATCH="$SWIFT_BUILD_DIR/subtitle-extractor/$ARCH"
  STYLE_PICKER_SCRATCH="$SWIFT_BUILD_DIR/style-picker/$ARCH"
  node -e 'const fs=require("node:fs");const [path,sdk,bin,target]=process.argv.slice(1);fs.writeFileSync(path,JSON.stringify({version:1,sdk,"toolchain-bin-dir":bin,target,"extra-cc-flags":[],"extra-swiftc-flags":[],"extra-cpp-flags":[]},null,2)+"\n")' "$DESTINATION_PATH" "$SWIFT_SDK" "$SWIFT_TOOLCHAIN_BIN" "$ARCH-apple-macosx12.0"

  build_package "$TRANSPORT_PACKAGE" "$TRANSPORT_SCRATCH" "$ARCH" "$DESTINATION_PATH"
  TRANSPORT_BIN_PATH=$SWIFT_BIN_PATH
  build_package "$EXTRACTOR_PACKAGE" "$EXTRACTOR_SCRATCH" "$ARCH" "$DESTINATION_PATH" "$ROOT_DIR/native/.build/ffmpeg/$ARCH"
  EXTRACTOR_BIN_PATH=$SWIFT_BIN_PATH
  build_package "$STYLE_PICKER_PACKAGE" "$STYLE_PICKER_SCRATCH" "$ARCH" "$DESTINATION_PATH"
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

SWIFT_CACHE_STAMP_TMP="$SWIFT_CACHE_STAMP.tmp.$$"
printf '%s\n' "$SWIFT_CACHE_KEY" > "$SWIFT_CACHE_STAMP_TMP"
mv "$SWIFT_CACHE_STAMP_TMP" "$SWIFT_CACHE_STAMP"
