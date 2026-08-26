import { describe, expect, it } from "vitest";

import { validateReleaseMetadata } from "../../scripts/release-metadata.mjs";

const validInput = {
  infoVersion: "0.1.0",
  infoGithubRepository: "janwee-sha/SubTandem",
  infoGithubVersion: 1000,
  packageVersion: "0.1.0",
  lockVersion: "0.1.0",
  lockRootVersion: "0.1.0",
  packageLicense: "GPL-3.0-only",
  lockRootLicense: "GPL-3.0-only",
  licenseText: "GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007",
  packScript: [
    'ARTIFACT="$STAGE_PARENT/SubTandem-0.1.0.iinaplgz"',
    '"$ROOT_DIR"/build/package/SubTandem-0.1.0.iinaplgz) ;;',
  ].join("\n"),
  ffmpegLock: {
    version: "8.1.2",
    sourceAssetName: "ffmpeg-8.1.2.tar.xz",
    sha256: "4".repeat(64),
    license: "LGPL-2.1-or-later",
    sourceDistribution: {
      assetName: "ffmpeg-8.1.2.tar.xz",
      checksumAssetName: "ffmpeg-8.1.2.tar.xz.sha256",
    },
  },
  thirdPartyNotices: "FFmpeg 8.1.2 — LGPL-2.1-or-later — ffmpeg-8.1.2.tar.xz — " + "4".repeat(64),
};

describe("release metadata", () => {
  it("derives the immutable release identity from matching project versions", () => {
    expect(validateReleaseMetadata(validInput)).toEqual({
      version: "0.1.0",
      tag: "v0.1.0",
      artifactName: "SubTandem-0.1.0.iinaplgz",
      artifactPath: "build/package/SubTandem-0.1.0.iinaplgz",
      license: "GPL-3.0-only",
      githubRepository: "janwee-sha/SubTandem",
      githubVersion: 1000,
      ffmpegSourceAssetName: "ffmpeg-8.1.2.tar.xz",
      ffmpegSourceChecksumName: "ffmpeg-8.1.2.tar.xz.sha256",
    });
  });

  it.each(["1", "1.2", "01.2.3", "1.2.3-rc.1", "v1.2.3", "1.2.3+build"])(
    "rejects non-stable version %s",
    (version) => {
      expect(() => validateReleaseMetadata({ ...validInput, infoVersion: version })).toThrow(
        /stable SemVer/,
      );
    },
  );

  it("rejects missing or version-drifted IINA update metadata", () => {
    expect(() =>
      validateReleaseMetadata({ ...validInput, infoGithubRepository: undefined }),
    ).toThrow(/repository/i);
    expect(() => validateReleaseMetadata({ ...validInput, infoGithubVersion: 999 })).toThrow(
      /ghVersion|update/i,
    );
  });

  it.each([
    ["Info.json", "infoVersion"],
    ["package.json", "packageVersion"],
    ["package-lock.json", "lockVersion"],
    ['package-lock.json packages[""].version', "lockRootVersion"],
  ] as const)("rejects a mismatched %s version", (_, field) => {
    expect(() => validateReleaseMetadata({ ...validInput, [field]: "0.2.0" })).toThrow(
      /version mismatch/,
    );
  });

  it("rejects an artifact path that uses another version", () => {
    expect(() =>
      validateReleaseMetadata({
        ...validInput,
        packScript: validInput.packScript.replaceAll("0.1.0", "0.2.0"),
      }),
    ).toThrow(/pack script/);
  });

  it.each([
    ["package.json", "packageLicense"],
    ['package-lock.json packages[""].license', "lockRootLicense"],
  ] as const)("rejects a mismatched %s license", (_, field) => {
    expect(() => validateReleaseMetadata({ ...validInput, [field]: "MIT" })).toThrow(
      /license mismatch/,
    );
  });

  it("requires the standard GPL v3 text", () => {
    expect(() => validateReleaseMetadata({ ...validInput, licenseText: "modified" })).toThrow(
      /GPL v3/,
    );
  });

  it("rejects FFmpeg lock and third-party notice drift", () => {
    expect(() =>
      validateReleaseMetadata({
        ...validInput,
        ffmpegLock: { ...validInput.ffmpegLock, sourceAssetName: "ffmpeg-other.tar.xz" },
      }),
    ).toThrow(/FFmpeg/i);
    expect(() => validateReleaseMetadata({ ...validInput, thirdPartyNotices: "missing" })).toThrow(
      /FFmpeg/i,
    );
  });
});
