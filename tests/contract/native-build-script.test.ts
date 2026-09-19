import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const buildScript = readFileSync(new URL("../../scripts/build-native.sh", import.meta.url), "utf8");

describe("native build script", () => {
  it("uses the Swift Build backend for every SwiftPM build operation", () => {
    const buildCommands = buildScript.match(/swift build[^\n]+/g) ?? [];

    expect(buildCommands).toHaveLength(2);
    expect(buildCommands.every((command) => command.includes("--build-system swiftbuild"))).toBe(
      true,
    );
    expect(
      buildCommands.every((command) => command.includes('--triple "$ARCH-apple-macosx12.0"')),
    ).toBe(true);
    expect(buildScript).not.toContain("--build-system native");
    expect(buildScript).not.toContain('--arch "$ARCH"');
  });

  it("isolates every package and architecture in its own scratch path", () => {
    expect(buildScript).toContain('TRANSPORT_SCRATCH="$SWIFT_BUILD_DIR/transport/$ARCH"');
    expect(buildScript).toContain('EXTRACTOR_SCRATCH="$SWIFT_BUILD_DIR/subtitle-extractor/$ARCH"');
    expect(buildScript).toContain('STYLE_PICKER_SCRATCH="$SWIFT_BUILD_DIR/style-picker/$ARCH"');
    expect(buildScript).toContain(
      'build_package "$EXTRACTOR_PACKAGE" "$EXTRACTOR_SCRATCH" "$ARCH" "$ROOT_DIR/native/.build/ffmpeg/$ARCH"',
    );
  });

  it("discovers Swift Build products instead of assuming legacy output paths", () => {
    expect(buildScript).toContain("--show-bin-path");
    expect(buildScript).toContain("TRANSPORT_BIN_PATH=$SWIFT_BIN_PATH");
    expect(buildScript).toContain("EXTRACTOR_BIN_PATH=$SWIFT_BIN_PATH");
    expect(buildScript).toContain("STYLE_PICKER_BIN_PATH=$SWIFT_BIN_PATH");
    expect(buildScript).not.toMatch(/\.build\/(?:arm64|x86_64)-apple-macosx\/release/);
  });
});
