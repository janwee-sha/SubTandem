#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
LOCK_FILE="$ROOT_DIR/native/ffmpeg.lock.json"
BUILD_ROOT="$ROOT_DIR/native/.build/ffmpeg"
DOWNLOAD_DIR="$BUILD_ROOT/downloads"
SOURCE_DIR="$BUILD_ROOT/source"
SDK_PATH=$(xcrun --sdk macosx --show-sdk-path)
BUILD_JOBS=$(sysctl -n hw.logicalcpu 2>/dev/null || echo 4)

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

echo "Locked FFmpeg $VERSION built for arm64 and x86_64"
