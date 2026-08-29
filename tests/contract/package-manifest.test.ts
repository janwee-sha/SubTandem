import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootFile = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("IINA package manifest", () => {
  it("declares the player and global entry fields understood by IINA", () => {
    const manifest = JSON.parse(rootFile("Info.json")) as Record<string, unknown>;

    expect(manifest.entry).toBe("dist/main.js");
    expect(manifest.globalEntry).toBe("dist/global.js");
    expect(manifest).not.toHaveProperty("global");
    expect(manifest.permissions).toEqual([
      "network-request",
      "file-system",
      "show-alert",
      "video-overlay",
    ]);
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.ghRepo).toBe("janwee-sha/SubTandem");
    expect(manifest.ghVersion).toBe(1000);
  });

  it("describes self-rendered translations without temporary display files", () => {
    const manifest = JSON.parse(rootFile("Info.json")) as {
      description: string;
      minIINAVersion: string;
      permissions: string[];
      allowedDomains: string[];
      permissionDescriptions: Record<string, string>;
    };

    expect(manifest.description).toContain("renders translated subtitles itself");
    expect(manifest.description).not.toContain("second subtitle track");
    expect(manifest.minIINAVersion).toBe("1.4.0");
    expect(manifest.permissions).toEqual([
      "network-request",
      "file-system",
      "show-alert",
      "video-overlay",
    ]);
    expect(manifest.allowedDomains).toEqual(["127.0.0.1"]);
    expect(manifest.permissionDescriptions["file-system"]).not.toMatch(
      /translated subtitle data|translated subtitle file/i,
    );
  });

  it("discloses subtitle-free model discovery without widening permissions", () => {
    const manifest = JSON.parse(rootFile("Info.json")) as {
      permissions: string[];
      allowedDomains: string[];
      permissionDescriptions: Record<string, string>;
    };
    expect(manifest.permissions).toEqual([
      "network-request",
      "file-system",
      "show-alert",
      "video-overlay",
    ]);
    expect(manifest.allowedDomains).toEqual(["127.0.0.1"]);
    expect(manifest.permissionDescriptions["network-request"]).toMatch(
      /edited endpoints.*subtitle-free model-list requests/i,
    );
    expect(manifest.permissionDescriptions["network-request"]).toMatch(
      /selected profile receives subtitle text/i,
    );
    expect(manifest.permissionDescriptions["network-request"]).toMatch(
      /DeepSeek.*api\.deepseek\.com.*before Select/i,
    );
  });

  it("declares only the non-interactive translation overlay permission and default position", () => {
    const manifest = JSON.parse(rootFile("Info.json")) as {
      permissions: string[];
      permissionDescriptions: Record<string, string>;
      preferenceDefaults: Record<string, unknown>;
    };

    expect(
      manifest.permissions.filter((permission) => permission === "video-overlay"),
    ).toHaveLength(1);
    expect(manifest.permissionDescriptions["video-overlay"]).toMatch(
      /local non-interactive translation overlay/i,
    );
    expect(manifest.preferenceDefaults.translationOverlayPosition).toBe(0);
  });

  it("rejects runtime state and sensitive material from the package", () => {
    const verify = rootFile("scripts/verify-package.sh");
    const pack = rootFile("scripts/pack.sh");
    expect(verify).toMatch(/credentials\.json/);
    expect(verify).toMatch(/@data/);
    expect(verify).toMatch(/@tmp/);
    expect(pack).toMatch(/node_modules.*specs.*tests.*src.*@data.*@tmp/);
    expect(pack).toMatch(/credentials\\\.json/);
  });

  it("locks the exact minimal FFmpeg source and component allowlist", () => {
    const lock = JSON.parse(rootFile("native/ffmpeg.lock.json")) as {
      version: string;
      sourceUrl: string;
      sha256: string;
      license: string;
      configure: string[];
      protocols: string[];
      demuxers: string[];
      decoders: string[];
      codecWhitelist: string[];
    };

    expect(lock.version).toBe("8.1.2");
    expect(lock.sourceUrl).toBe("https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz");
    expect(lock.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(lock.license).toBe("LGPL-2.1-or-later");
    expect(lock.configure).toEqual(
      expect.arrayContaining([
        "--disable-everything",
        "--disable-autodetect",
        "--disable-network",
        "--disable-gpl",
        "--disable-nonfree",
        "--disable-version3",
        "--enable-protocol=file",
        "--enable-demuxer=matroska,mov",
        "--enable-decoder=subrip,ass,ssa,movtext",
      ]),
    );
    expect(lock.protocols).toEqual(["file"]);
    expect(lock.demuxers).toEqual(["matroska", "mov"]);
    expect(lock.decoders).toEqual(["subrip", "ass", "ssa", "movtext"]);
    expect(lock.codecWhitelist).toEqual(["subrip", "ass", "ssa", "mov_text"]);
  });

  it("builds and packages exactly two named native executables", () => {
    const scripts = [
      rootFile("scripts/build-ffmpeg.sh"),
      rootFile("scripts/build-native.sh"),
      rootFile("scripts/test-native.sh"),
      rootFile("scripts/verify-package.sh"),
      rootFile("scripts/pack.sh"),
    ].join("\n");

    expect(scripts).toContain("subtandem-transport");
    expect(scripts).toContain("subtandem-subtitle-extractor");
    expect(scripts).toContain("native/ffmpeg.lock.json");
  });

  it("requires compliance files and exactly two universal packaged native executables", () => {
    const verify = rootFile("scripts/verify-package.sh");
    const pack = rootFile("scripts/pack.sh");
    for (const required of [
      "LICENSE",
      "THIRD_PARTY_NOTICES.txt",
      "dist/native/subtandem-transport",
      "dist/native/subtandem-subtitle-extractor",
    ]) {
      expect(`${verify}\n${pack}`).toContain(required);
    }
    expect(verify).toContain("lipo");
    expect(verify).toContain("codesign --verify --strict");
    expect(verify).toContain("otool -L");
    expect(verify).toContain("12.0");
    expect(verify).toContain("plugin-update-metadata.mjs");
  });

  it("limits source and object scans to the runtime distribution tree", () => {
    const verify = rootFile("scripts/verify-package.sh");

    expect(verify).toContain('find "$PACKAGE_DIR/dist" -type f');
    expect(verify).not.toContain("find \"$PACKAGE_DIR\" -type f \\( -name '*.a'");
  });

  it("audits the bundle for removed subtitle publication paths while allowing extraction input", () => {
    const verify = rootFile("scripts/verify-package.sh");

    expect(verify).toContain("sub-add");
    expect(verify).toContain("sub-remove");
    expect(verify).toContain("secondary-sid");
    expect(verify).toContain("@tmp/subtandem-[^/]*\\.srt");
    expect(verify).toContain("@tmp/subtandem-extraction");
  });

  it("builds and verifies the local Overlay target without the removed mpv OSD path", () => {
    const build = rootFile("scripts/build-plugin.sh");
    const verify = rootFile("scripts/verify-package.sh");
    const pack = rootFile("scripts/pack.sh");
    const runtime = [
      rootFile("src/main.ts"),
      rootFile("src/adapters/iina/webview-translation-overlay.ts"),
    ].join("\n");
    expect(build).toContain("--target overlay");
    expect(verify).toContain("dist/ui/overlay.html");
    expect(verify).toMatch(/Content-Security-Policy/);
    expect(verify).toMatch(/type="module"/);
    expect(pack).toContain("dist/ui/overlay.html");
    expect(runtime).not.toContain('command("osd-overlay"');
    expect(runtime).not.toContain("subtitle-overlay");
  });
});
