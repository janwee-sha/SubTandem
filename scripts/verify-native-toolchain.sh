#!/bin/sh
set -eu

for TOOL in xcrun xcodebuild swift swiftc lipo codesign otool shasum; do
  if ! command -v "$TOOL" >/dev/null 2>&1; then
    echo "Required native build tool is unavailable: $TOOL" >&2
    exit 1
  fi
done

SWIFT_BIN=$(xcrun --find swift)
CLANG_BIN=$(xcrun --sdk macosx --find clang)
SDK_PATH=$(xcrun --sdk macosx --show-sdk-path)
SWIFT_TOOLCHAIN_BIN=$(dirname "$SWIFT_BIN")
SWIFT_MACOS_LIB="$SWIFT_TOOLCHAIN_BIN/../lib/swift/macosx"

test -x "$SWIFT_BIN"
test -x "$CLANG_BIN"
test -d "$SDK_PATH"

for ARCHIVE_NAME in libswiftCompatibility56.a libswiftCompatibilityPacks.a; do
  ARCHIVE="$SWIFT_MACOS_LIB/$ARCHIVE_NAME"
  if [ ! -f "$ARCHIVE" ]; then
    echo "Selected Swift toolchain is missing $ARCHIVE_NAME. Set DEVELOPER_DIR to a complete Xcode installation." >&2
    exit 1
  fi
  for ARCH in arm64 x86_64; do
    if ! xcrun lipo "$ARCHIVE" -verify_arch "$ARCH" >/dev/null 2>&1; then
      echo "Selected Swift toolchain cannot link $ARCH macOS binaries. Set DEVELOPER_DIR to a complete Xcode installation." >&2
      exit 1
    fi
  done
done

echo "Native toolchain verification passed"
