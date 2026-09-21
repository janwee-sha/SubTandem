#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
LOCK_FILE="$ROOT_DIR/native/ffmpeg.lock.json"
BUILD_ROOT="$ROOT_DIR/native/.build/ffmpeg"
DOWNLOAD_DIR="$BUILD_ROOT/downloads"
SOURCE_DIR="$BUILD_ROOT/source"
CACHE_STAMP="$BUILD_ROOT/build-context.sha256"
SDK_PATH=$(xcrun --sdk macosx --show-sdk-path)
BUILD_JOBS=$(sysctl -n hw.logicalcpu 2>/dev/null || echo 4)
FORCE_REBUILD=${SUBTANDEM_FORCE_REBUILD:-0}

case "$FORCE_REBUILD" in
  0|1) ;;
  *) echo "SUBTANDEM_FORCE_REBUILD must be 0 or 1" >&2; exit 1 ;;
esac

if [ ! -f "$LOCK_FILE" ]; then
  echo "Missing FFmpeg lock: $LOCK_FILE" >&2
  exit 1
fi

VERSION=$(node -e 'const x=require(process.argv[1]);process.stdout.write(x.version)' "$LOCK_FILE")
SOURCE_URL=$(node -e 'const x=require(process.argv[1]);process.stdout.write(x.sourceUrl)' "$LOCK_FILE")
SOURCE_NAME=$(node -e 'const x=require(process.argv[1]);process.stdout.write(x.sourceAssetName)' "$LOCK_FILE")
EXPECTED_SHA=$(node -e 'const x=require(process.argv[1]);process.stdout.write(x.sha256)' "$LOCK_FILE")
CONFIGURE_ARGS=$(node -e 'const x=require(process.argv[1]);if(!Array.isArray(x.configure)||x.configure.some(v=>typeof v!=="string"||!/^[A-Za-z0-9_=,./+:-]+$/.test(v)))process.exit(1);process.stdout.write(x.configure.join("\n"))' "$LOCK_FILE")

if [ "$VERSION" != "8.1.2" ] || [ "$SOURCE_URL" != "https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz" ]; then
  echo "Refusing unlocked FFmpeg source" >&2
  exit 1
fi

mkdir -p "$DOWNLOAD_DIR" "$SOURCE_DIR"
SOURCE_ARCHIVE=${1:-$DOWNLOAD_DIR/$SOURCE_NAME}
if [ ! -f "$SOURCE_ARCHIVE" ]; then
  if [ "$SOURCE_ARCHIVE" != "$DOWNLOAD_DIR/$SOURCE_NAME" ]; then
    echo "Locked FFmpeg archive is missing: $SOURCE_ARCHIVE" >&2
    exit 1
  fi
  curl --fail --location --silent --show-error "$SOURCE_URL" --output "$SOURCE_ARCHIVE"
fi

ACTUAL_SHA=$(shasum -a 256 "$SOURCE_ARCHIVE" | awk '{print $1}')
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  echo "FFmpeg source checksum mismatch" >&2
  exit 1
fi

LOCK_SHA=$(shasum -a 256 "$LOCK_FILE" | awk '{print $1}')
SCRIPT_SHA=$(shasum -a 256 "$0" | awk '{print $1}')
SDK_VERSION=$(xcrun --sdk macosx --show-sdk-version)
CLANG_VERSION=$(xcrun --sdk macosx clang --version)
HOST_ARCH=$(uname -m)
CACHE_KEY=$(printf '%s\n' \
  "schema=1" \
  "lock=$LOCK_SHA" \
  "script=$SCRIPT_SHA" \
  "sdk=$SDK_VERSION" \
  "clang=$CLANG_VERSION" \
  "host=$HOST_ARCH" \
  "target=macos12.0" | shasum -a 256 | awk '{print $1}')

validate_outputs() {
  for ARCH in arm64 x86_64; do
    PREFIX="$BUILD_ROOT/$ARCH"
    for HEADER in libavformat/avformat.h libavcodec/avcodec.h libavutil/avutil.h; do
      test -f "$PREFIX/include/$HEADER" || return 1
    done
    for LIBRARY in libavformat.a libavcodec.a libavutil.a; do
      LIBRARY_PATH="$PREFIX/lib/$LIBRARY"
      test -f "$LIBRARY_PATH" || return 1
      xcrun lipo "$LIBRARY_PATH" -verify_arch "$ARCH" >/dev/null 2>&1 || return 1
    done
  done
}

if [ "$FORCE_REBUILD" = 0 ] && [ -f "$CACHE_STAMP" ] && [ "$(cat "$CACHE_STAMP")" = "$CACHE_KEY" ] && validate_outputs; then
  echo "Reusing locked FFmpeg $VERSION build"
  exit 0
fi

rm -f "$CACHE_STAMP"

case "$SOURCE_DIR" in
  "$ROOT_DIR"/native/.build/ffmpeg/source) ;;
  *) echo "Refusing unexpected FFmpeg source path" >&2; exit 1 ;;
esac
find "$SOURCE_DIR" -mindepth 1 -delete
tar -xf "$SOURCE_ARCHIVE" -C "$SOURCE_DIR" --strip-components=1

for ARCH in arm64 x86_64; do
  ARCH_BUILD="$BUILD_ROOT/build-$ARCH"
  ARCH_PREFIX="$BUILD_ROOT/$ARCH"
  mkdir -p "$ARCH_BUILD" "$ARCH_PREFIX"
  find "$ARCH_BUILD" -mindepth 1 -delete
  find "$ARCH_PREFIX" -mindepth 1 -delete
  (
    cd "$ARCH_BUILD"
    CC="xcrun --sdk macosx clang -arch $ARCH -mmacosx-version-min=12.0" \
      AR="xcrun --sdk macosx ar" \
      RANLIB="xcrun --sdk macosx ranlib" \
      PKG_CONFIG=false \
      "$SOURCE_DIR/configure" \
        --prefix="$ARCH_PREFIX" \
        --target-os=darwin \
        --arch="$ARCH" \
        --enable-cross-compile \
        --sysroot="$SDK_PATH" \
        --extra-cflags="-arch $ARCH -mmacosx-version-min=12.0" \
        --extra-ldflags="-arch $ARCH -mmacosx-version-min=12.0" \
        $CONFIGURE_ARGS
    make -j"$BUILD_JOBS"
    make install
  )
done

if ! validate_outputs; then
  echo "FFmpeg build output validation failed" >&2
  exit 1
fi

CACHE_STAMP_TMP="$CACHE_STAMP.tmp.$$"
printf '%s\n' "$CACHE_KEY" > "$CACHE_STAMP_TMP"
mv "$CACHE_STAMP_TMP" "$CACHE_STAMP"

echo "Locked FFmpeg $VERSION built for arm64 and x86_64"
