import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildReleaseAudit,
  formatReleaseAuditSummary,
  parseOtoolDependencies,
  validateArchiveEntries,
  validateArtifactIdentity,
  validateFFmpegSource,
  validateHelperFacts,
} from "../../scripts/audit-release.mjs";

const regularMode = 0o100644;
const executableMode = 0o100755;

const validEntries = [
  { name: "Info.json", unixMode: regularMode, encrypted: false },
  { name: "README.md", unixMode: regularMode, encrypted: false },
  { name: "LICENSE", unixMode: regularMode, encrypted: false },
  { name: "THIRD_PARTY_NOTICES.txt", unixMode: regularMode, encrypted: false },
  { name: "dist/", unixMode: 0o040755, encrypted: false },
  { name: "dist/main.js", unixMode: regularMode, encrypted: false },
  { name: "dist/global.js", unixMode: regularMode, encrypted: false },
  {
    name: "dist/ui/sidebar.html",
    unixMode: regularMode,
    encrypted: false,
  },
  {
    name: "dist/ui/overlay.html",
    unixMode: regularMode,
    encrypted: false,
  },
  {
    name: "dist/native/subtandem-transport",
    unixMode: executableMode,
    encrypted: false,
  },
  {
    name: "dist/native/subtandem-subtitle-extractor",
    unixMode: executableMode,
    encrypted: false,
  },
  {
    name: "dist/native/subtandem-style-picker",
    unixMode: executableMode,
    encrypted: false,
  },
];

describe("release archive audit", () => {
  it("loads in the supported Node.js runtime", () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../../scripts/audit-release.mjs", import.meta.url))],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing required option");
    expect(result.stderr).not.toContain("SyntaxError");
  });

  it("accepts the minimal runtime archive", () => {
    expect(validateArchiveEntries(validEntries).map((entry) => entry.name)).toEqual(
      validEntries.map((entry) => entry.name),
    );
  });

  it.each(["LICENSE", "THIRD_PARTY_NOTICES.txt"])("requires compliance file %s", (name) => {
    expect(() =>
      validateArchiveEntries(validEntries.filter((entry) => entry.name !== name)),
    ).toThrow(/required archive entry/i);
  });

  it("requires all three exact native executables", () => {
    expect(() =>
      validateArchiveEntries(
        validEntries.filter((entry) => entry.name !== "dist/native/subtandem-subtitle-extractor"),
      ),
    ).toThrow(/required archive entry/i);
    expect(() =>
      validateArchiveEntries(
        validEntries.filter((entry) => entry.name !== "dist/native/subtandem-style-picker"),
      ),
    ).toThrow(/required archive entry/i);
  });

  it("requires the built translation Overlay entry", () => {
    expect(() =>
      validateArchiveEntries(validEntries.filter((entry) => entry.name !== "dist/ui/overlay.html")),
    ).toThrow(/required archive entry/i);
  });

  it("rejects a compliance file that differs from its repository source", () => {
    const entries = validEntries.map((entry) =>
      entry.name === "LICENSE" ? { ...entry, content: "modified" } : entry,
    );
    expect(() => validateArchiveEntries(entries, { LICENSE: "expected" })).toThrow(
      /compliance file/i,
    );
  });

  it.each([
    "../Info.json",
    "/Info.json",
    "dist/../Info.json",
    "dist\\main.js",
    "dist//main.js",
    "dist/./main.js",
    "dist/bad\nname",
  ])("rejects unsafe path %s", (name) => {
    expect(() =>
      validateArchiveEntries([...validEntries, { name, unixMode: regularMode }]),
    ).toThrow(/unsafe archive path/i);
  });

  it.each([
    "package.json",
    "dist/src/main.ts",
    "dist/tests/main.test.js",
    "dist/node_modules/module/index.js",
    "dist/main.js.map",
    "dist/.env",
    "dist/credentials.json",
    "dist/private.key",
    "dist/@data/cache.json",
  ])("rejects forbidden archive entry %s", (name) => {
    expect(() =>
      validateArchiveEntries([...validEntries, { name, unixMode: regularMode }]),
    ).toThrow(/forbidden archive entry|root entry/i);
  });

  it("rejects paths that collide on a case-insensitive filesystem", () => {
    expect(() =>
      validateArchiveEntries([...validEntries, { name: "dist/Main.js", unixMode: regularMode }]),
    ).toThrow(/duplicate archive entry/i);
  });

  it("rejects symbolic links before extraction", () => {
    expect(() =>
      validateArchiveEntries([...validEntries, { name: "dist/link", unixMode: 0o120777 }]),
    ).toThrow(/symbolic link/);
  });

  it("rejects encrypted entries", () => {
    expect(() =>
      validateArchiveEntries([
        ...validEntries,
        { name: "dist/secret", unixMode: regularMode, encrypted: true },
      ]),
    ).toThrow(/encrypted/i);
  });

  it("rejects artifact name or package version drift", () => {
    expect(() =>
      validateArtifactIdentity({
        artifactName: "SubTandem-0.2.0.iinaplgz",
        packageInfo: {
          version: "0.1.0",
          ghRepo: "janwee-sha/SubTandem",
          ghVersion: 1000,
        },
        expectedVersion: "0.1.0",
        expectedGithubRepository: "janwee-sha/SubTandem",
        expectedGithubVersion: 1000,
      }),
    ).toThrow(/artifact name/);
    expect(() =>
      validateArtifactIdentity({
        artifactName: "SubTandem-0.1.0.iinaplgz",
        packageInfo: {
          version: "0.2.0",
          ghRepo: "janwee-sha/SubTandem",
          ghVersion: 2000,
        },
        expectedVersion: "0.1.0",
        expectedGithubRepository: "janwee-sha/SubTandem",
        expectedGithubVersion: 1000,
      }),
    ).toThrow(/package version/);
  });

  it("rejects final archive update identity drift", () => {
    expect(() =>
      validateArtifactIdentity({
        artifactName: "SubTandem-0.3.4.iinaplgz",
        packageInfo: {
          version: "0.3.4",
          ghRepo: "another/repository",
          ghVersion: 3004,
        },
        expectedVersion: "0.3.4",
        expectedGithubRepository: "janwee-sha/SubTandem",
        expectedGithubVersion: 3004,
      }),
    ).toThrow(/repository/i);
    expect(() =>
      validateArtifactIdentity({
        artifactName: "SubTandem-0.3.4.iinaplgz",
        packageInfo: {
          version: "0.3.4",
          ghRepo: "janwee-sha/SubTandem",
          ghVersion: 3003,
        },
        expectedVersion: "0.3.4",
        expectedGithubRepository: "janwee-sha/SubTandem",
        expectedGithubVersion: 3004,
      }),
    ).toThrow(/ghVersion|update/i);
  });

  it.each([
    {
      architectures: ["arm64"],
      minimumMacos: ["12.0"],
      executable: true,
      signed: true,
      dependencies: [],
      sha256: "a".repeat(64),
    },
    {
      architectures: ["arm64", "x86_64"],
      minimumMacos: ["12.0"],
      executable: false,
      signed: true,
      dependencies: [],
      sha256: "a".repeat(64),
    },
    {
      architectures: ["arm64", "x86_64"],
      minimumMacos: ["12.0"],
      executable: true,
      signed: false,
      dependencies: [],
      sha256: "a".repeat(64),
    },
    {
      architectures: ["arm64", "x86_64"],
      minimumMacos: ["13.0"],
      executable: true,
      signed: true,
      dependencies: [],
      sha256: "a".repeat(64),
    },
    {
      architectures: ["arm64", "x86_64"],
      minimumMacos: ["12.0"],
      executable: true,
      signed: true,
      dependencies: ["/private/libffmpeg.dylib"],
      sha256: "a".repeat(64),
    },
  ])("rejects missing native helper properties", (facts) => {
    expect(() => validateHelperFacts("package helper", facts)).toThrow();
  });

  it("ignores absolute universal-binary headers when parsing dynamic dependencies", () => {
    expect(
      parseOtoolDependencies(
        [
          "/tmp/subtandem-transport (architecture x86_64):",
          "\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)",
          "/tmp/subtandem-transport (architecture arm64):",
          "\t/System/Library/Frameworks/Foundation.framework/Versions/C/Foundation (compatibility version 300.0.0)",
        ].join("\n"),
      ),
    ).toEqual([
      "/usr/lib/libSystem.B.dylib",
      "/System/Library/Frameworks/Foundation.framework/Versions/C/Foundation",
    ]);
  });

  it("validates the lock-named FFmpeg source and digest", () => {
    const source = Buffer.from("locked source");
    const lock = {
      version: "8.1.2",
      sourceAssetName: "ffmpeg-8.1.2.tar.xz",
      sha256: createHash("sha256").update(source).digest("hex"),
      license: "LGPL-2.1-or-later",
      sourceDistribution: {
        assetName: "ffmpeg-8.1.2.tar.xz",
        checksumAssetName: "ffmpeg-8.1.2.tar.xz.sha256",
      },
    };
    expect(validateFFmpegSource(lock, "ffmpeg-8.1.2.tar.xz", source)).toMatchObject({
      version: "8.1.2",
      assetName: "ffmpeg-8.1.2.tar.xz",
      checksumAssetName: "ffmpeg-8.1.2.tar.xz.sha256",
      sha256: lock.sha256,
    });
    expect(() => validateFFmpegSource(lock, "ffmpeg-8.1.2.tar.xz", Buffer.from("drift"))).toThrow(
      /FFmpeg source/i,
    );
  });

  it("keeps complete technical evidence separate from the user body", () => {
    const gates = {
      test: true,
      typecheck: true,
      lint: true,
      buildNative: true,
      testNative: true,
      build: true,
      verifyPackage: true,
      pack: true,
    };
    const audit = buildReleaseAudit({
      version: "0.2.0",
      commit: "a".repeat(40),
      artifactName: "SubTandem-0.2.0.iinaplgz",
      packageVersion: "0.2.0",
      updateIdentity: {
        githubRepository: "janwee-sha/SubTandem",
        githubVersion: 2000,
      },
      byteSize: 42,
      sha256: "b".repeat(64),
      gates,
      entries: validEntries,
      buildHelpers: {
        "subtandem-transport": helperFacts("c"),
        "subtandem-subtitle-extractor": helperFacts("d"),
        "subtandem-style-picker": helperFacts("e"),
      },
      packageHelpers: {
        "subtandem-transport": helperFacts("c"),
        "subtandem-subtitle-extractor": helperFacts("d"),
        "subtandem-style-picker": helperFacts("e"),
      },
      ffmpeg: {
        version: "8.1.2",
        license: "LGPL-2.1-or-later",
        assetName: "ffmpeg-8.1.2.tar.xz",
        checksumAssetName: "ffmpeg-8.1.2.tar.xz.sha256",
        sha256: "e".repeat(64),
      },
      releaseNotes: {
        sourcePath: "docs/releases/v0.2.0.md",
        rawSha256: "f".repeat(64),
      },
    });

    expect(audit).toMatchObject({
      version: "0.2.0",
      tag: "v0.2.0",
      commit: "a".repeat(40),
      artifactName: "SubTandem-0.2.0.iinaplgz",
      checksumName: "SubTandem-0.2.0.iinaplgz.sha256",
      updateIdentity: {
        githubRepository: "janwee-sha/SubTandem",
        githubVersion: 2000,
      },
      gates,
      entries: validEntries,
      releaseNotes: {
        sourcePath: "docs/releases/v0.2.0.md",
        rawSha256: "f".repeat(64),
      },
      hostValidation: {
        installation: "not-covered",
        uninstallation: "not-covered",
        playback: "not-covered",
      },
    });
    expect(Object.keys(audit.buildHelpers)).toHaveLength(3);
    expect(Object.keys(audit.packageHelpers)).toHaveLength(3);
    expect(audit.ffmpeg.assetName).toBe("ffmpeg-8.1.2.tar.xz");

    const summary = formatReleaseAuditSummary(audit);
    expect(summary.match(/PASS/g)).toHaveLength(8);
    expect(summary).toContain("SubTandem-0.2.0.iinaplgz");
    expect(summary).toContain("subtandem-transport");
    expect(summary).toContain("subtandem-subtitle-extractor");
    expect(summary).toContain("subtandem-style-picker");
    expect(summary).toContain("ffmpeg-8.1.2.tar.xz");
    expect(summary.match(/not-covered/g)).toHaveLength(3);
    expect(summary).not.toContain("用户获得新功能");
  });
});

function helperFacts(seed: string) {
  return {
    architectures: ["arm64", "x86_64"],
    minimumMacos: ["12.0"],
    executable: true,
    signed: true,
    signature: "adhoc",
    dependencies: ["/usr/lib/libSystem.B.dylib"],
    sha256: seed.repeat(64),
  };
}
