import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const buildScript = readFileSync(new URL("../../scripts/build-native.sh", import.meta.url), "utf8");
const ffmpegScript = readFileSync(
  new URL("../../scripts/build-ffmpeg.sh", import.meta.url),
  "utf8",
);
const nativeTestScript = readFileSync(
  new URL("../../scripts/test-native.sh", import.meta.url),
  "utf8",
);
const toolchainScript = readFileSync(
  new URL("../../scripts/verify-native-toolchain.sh", import.meta.url),
  "utf8",
);

describe("native build script", () => {
  it("uses the Swift Build backend for every SwiftPM build operation", () => {
    const buildCommands = buildScript.match(/swift build[^\n]+/g) ?? [];

    expect(buildCommands).toHaveLength(2);
    expect(buildCommands.every((command) => command.includes("--build-system swiftbuild"))).toBe(
      true,
    );
    expect(
      buildCommands.every((command) => command.includes('--destination "$DESTINATION_PATH"')),
    ).toBe(true);
    expect(buildCommands.every((command) => command.includes('--arch "$ARCH"'))).toBe(true);
    expect(buildScript).not.toContain("--build-system native");
    expect(buildScript).not.toContain('--triple "$ARCH-apple-macosx12.0"');
  });

  it("combines a macOS 12 destination with one explicit architecture", () => {
    expect(buildScript).toContain("SWIFT_SDK=$(xcrun --sdk macosx --show-sdk-path)");
    expect(buildScript).toContain('SWIFT_TOOLCHAIN_BIN=$(dirname "$(xcrun --find swift)")');
    expect(buildScript).toContain('DESTINATION_PATH="$DESTINATION_DIR/$ARCH.json"');
    expect(buildScript).toContain('"$ARCH-apple-macosx12.0"');
    expect(buildScript).toContain('"toolchain-bin-dir":bin');
    expect(buildScript).toContain('"extra-swiftc-flags":[]');
  });

  it("isolates every package and architecture in its own scratch path", () => {
    expect(buildScript).toContain('TRANSPORT_SCRATCH="$SWIFT_BUILD_DIR/transport/$ARCH"');
    expect(buildScript).toContain('EXTRACTOR_SCRATCH="$SWIFT_BUILD_DIR/subtitle-extractor/$ARCH"');
    expect(buildScript).toContain('STYLE_PICKER_SCRATCH="$SWIFT_BUILD_DIR/style-picker/$ARCH"');
    expect(buildScript).toContain(
      'build_package "$EXTRACTOR_PACKAGE" "$EXTRACTOR_SCRATCH" "$ARCH" "$DESTINATION_PATH" "$ROOT_DIR/native/.build/ffmpeg/$ARCH"',
    );
  });

  it("discovers Swift Build products instead of assuming legacy output paths", () => {
    expect(buildScript).toContain("--show-bin-path");
    expect(buildScript).toContain("TRANSPORT_BIN_PATH=$SWIFT_BIN_PATH");
    expect(buildScript).toContain("EXTRACTOR_BIN_PATH=$SWIFT_BIN_PATH");
    expect(buildScript).toContain("STYLE_PICKER_BIN_PATH=$SWIFT_BIN_PATH");
    expect(buildScript).not.toMatch(/\.build\/(?:arm64|x86_64)-apple-macosx\/release/);
  });

  it("reuses only validated locked FFmpeg outputs", () => {
    expect(ffmpegScript).toContain('CACHE_STAMP="$BUILD_ROOT/build-context.sha256"');
    expect(ffmpegScript).toContain('LOCK_SHA=$(shasum -a 256 "$LOCK_FILE"');
    expect(ffmpegScript).toContain('SCRIPT_SHA=$(shasum -a 256 "$0"');
    expect(ffmpegScript).toContain("xcrun --sdk macosx --show-sdk-version");
    expect(ffmpegScript).toContain("xcrun --sdk macosx clang --version");
    expect(ffmpegScript).toContain("FORCE_REBUILD=${SUBTANDEM_FORCE_REBUILD:-0}");
    expect(ffmpegScript).toContain("validate_outputs");
    expect(ffmpegScript).toContain('xcrun lipo "$LIBRARY_PATH" -verify_arch "$ARCH"');
    expect(ffmpegScript).toContain('mv "$CACHE_STAMP_TMP" "$CACHE_STAMP"');
    expect(ffmpegScript.indexOf('rm -f "$CACHE_STAMP"')).toBeLessThan(
      ffmpegScript.indexOf('tar -xf "$SOURCE_ARCHIVE"'),
    );
  });

  it("keeps Swift incremental state within one verified toolchain context", () => {
    expect(buildScript).toContain('SWIFT_CACHE_STAMP="$SWIFT_BUILD_DIR/build-context.sha256"');
    expect(buildScript).toContain("FORCE_REBUILD=${SUBTANDEM_FORCE_REBUILD:-0}");
    expect(buildScript).toContain('FFMPEG_CACHE_KEY=$(cat "$FFMPEG_CACHE_STAMP")');
    expect(buildScript).toContain('"ffmpeg=$FFMPEG_CACHE_KEY"');
    expect(buildScript).toContain('[ "$(cat "$SWIFT_CACHE_STAMP")" != "$SWIFT_CACHE_KEY" ]');
    expect(buildScript).toMatch(
      /if \[ "\$FORCE_REBUILD" = 1 \][\s\S]*?find "\$SWIFT_BUILD_DIR" -mindepth 1 -delete[\s\S]*?fi/,
    );
    expect(buildScript).toContain('mv "$SWIFT_CACHE_STAMP_TMP" "$SWIFT_CACHE_STAMP"');
    expect(buildScript.indexOf('find "$OUTPUT_DIR" -mindepth 1 -delete')).toBeLessThan(
      buildScript.indexOf("build_package()"),
    );
  });

  it("rejects incomplete universal Swift toolchains before expensive native work", () => {
    expect(toolchainScript).toContain("libswiftCompatibility56.a");
    expect(toolchainScript).toContain("libswiftCompatibilityPacks.a");
    expect(toolchainScript).toContain("for ARCH in arm64 x86_64");
    expect(toolchainScript).toContain('xcrun lipo "$ARCHIVE" -verify_arch "$ARCH"');
    expect(buildScript.indexOf('"$TOOLCHAIN_CHECK"')).toBeLessThan(
      buildScript.indexOf('"$FFMPEG_BUILD"'),
    );
    expect(nativeTestScript.indexOf("verify-native-toolchain.sh")).toBeLessThan(
      nativeTestScript.indexOf("build-ffmpeg.sh"),
    );
  });
});
