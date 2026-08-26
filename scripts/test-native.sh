#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PACKAGE_DIR="$ROOT_DIR/native/transport"
SOURCE_DIR="$ROOT_DIR/native/transport/Sources/SubTandemTransport"
TEST_DIR="$ROOT_DIR/native/transport/Tests"
BUILD_DIR="$ROOT_DIR/native/transport/.build/contract-tests"
MODULE_CACHE="$ROOT_DIR/native/.build/module-cache"

mkdir -p "$BUILD_DIR" "$MODULE_CACHE"
export CLANG_MODULE_CACHE_PATH="$MODULE_CACHE"
export SWIFTPM_MODULECACHE_OVERRIDE="$MODULE_CACHE"
swiftc -parse-as-library \
  -I "$PACKAGE_DIR/Sources/CCurl" \
  -lcurl \
  "$SOURCE_DIR/Protocol.swift" \
  "$SOURCE_DIR/SecureCredentialStore.swift" \
  "$SOURCE_DIR/HTTPClient.swift" \
  "$SOURCE_DIR/DirectCurlTransport.swift" \
  "$SOURCE_DIR/Server.swift" \
  "$TEST_DIR/SubTandemTransportTests/ServerTests.swift" \
  "$TEST_DIR/SubTandemTransportTests/HTTPClientTests.swift" \
  "$TEST_DIR/SubTandemTransportContractTests/TestMain.swift" \
  -o "$BUILD_DIR/subtandem-transport-contract-tests"
"$BUILD_DIR/subtandem-transport-contract-tests"
LIBDISPATCH_COOPERATIVE_POOL_STRICT=1 "$BUILD_DIR/subtandem-transport-contract-tests"

"$ROOT_DIR/scripts/build-ffmpeg.sh" "${SUBTANDEM_FFMPEG_SOURCE:-$ROOT_DIR/native/.build/ffmpeg/downloads/ffmpeg-8.1.2.tar.xz}"
EXTRACTOR_PREFIX="$ROOT_DIR/native/.build/ffmpeg/arm64"
EXTRACTOR_SOURCE="$ROOT_DIR/native/subtitle-extractor/Sources/SubTandemSubtitleExtractor"
EXTRACTOR_TESTS="$ROOT_DIR/native/subtitle-extractor/Tests/SubTandemSubtitleExtractorTests"
EXTRACTOR_BUILD="$ROOT_DIR/native/subtitle-extractor/.build/contract-tests"
mkdir -p "$EXTRACTOR_BUILD"
swiftc -parse-as-library \
  -I "$ROOT_DIR/native/subtitle-extractor/Sources/CFFmpeg" \
  -Xcc -I"$EXTRACTOR_PREFIX/include" \
  -L "$EXTRACTOR_PREFIX/lib" \
  -lavformat -lavcodec -lavutil -lz \
  "$EXTRACTOR_SOURCE/Protocol.swift" \
  "$EXTRACTOR_SOURCE/Extractor.swift" \
  "$EXTRACTOR_SOURCE/ExtractionJobs.swift" \
  "$EXTRACTOR_SOURCE/Server.swift" \
  "$EXTRACTOR_TESTS/PackageTests.swift" \
  "$EXTRACTOR_TESTS/ExtractionTests.swift" \
  "$EXTRACTOR_TESTS/LifecycleTests.swift" \
  "$EXTRACTOR_TESTS/SecurityTests.swift" \
  "$EXTRACTOR_TESTS/TestMain.swift" \
  -o "$EXTRACTOR_BUILD/subtandem-subtitle-extractor-tests"
"$EXTRACTOR_BUILD/subtandem-subtitle-extractor-tests"
