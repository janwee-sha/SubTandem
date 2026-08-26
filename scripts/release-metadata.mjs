import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validatePluginUpdateMetadata } from "./plugin-update-metadata.mjs";
import { readReleaseNotes } from "./release-notes.mjs";

const stableSemverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const projectLicense = "GPL-3.0-only";

export function validateReleaseMetadata(input) {
  const version = input.infoVersion;
  if (!stableSemverPattern.test(version)) {
    throw new Error(`Info.json version is not stable SemVer: ${version}`);
  }
  const sources = [
    ["package.json", input.packageVersion],
    ["package-lock.json", input.lockVersion],
    ['package-lock.json packages[""].version', input.lockRootVersion],
  ];
  for (const [source, sourceVersion] of sources) {
    if (sourceVersion !== version) {
      throw new Error(`Project version mismatch: Info.json=${version}, ${source}=${sourceVersion}`);
    }
  }
  const updateIdentity = validatePluginUpdateMetadata({
    version,
    ghRepo: input.infoGithubRepository,
    ghVersion: input.infoGithubVersion,
  });

  const licenses = [
    ["package.json", input.packageLicense],
    ['package-lock.json packages[""].license', input.lockRootLicense],
  ];
  for (const [source, license] of licenses) {
    if (license !== projectLicense) {
      throw new Error(`Project license mismatch: ${source}=${license}, expected=${projectLicense}`);
    }
  }
  if (
    !input.licenseText.includes("GNU GENERAL PUBLIC LICENSE") ||
    !input.licenseText.includes("Version 3, 29 June 2007")
  ) {
    throw new Error("LICENSE must contain the standard GPL v3 text");
  }

  const ffmpeg = input.ffmpegLock;
  const expectedSourceAsset = `ffmpeg-${ffmpeg?.version}.tar.xz`;
  if (
    ffmpeg?.version !== "8.1.2" ||
    ffmpeg?.license !== "LGPL-2.1-or-later" ||
    ffmpeg?.sourceAssetName !== expectedSourceAsset ||
    ffmpeg?.sourceDistribution?.assetName !== expectedSourceAsset ||
    ffmpeg?.sourceDistribution?.checksumAssetName !== `${expectedSourceAsset}.sha256` ||
    !/^[0-9a-f]{64}$/.test(ffmpeg?.sha256 ?? "")
  ) {
    throw new Error("FFmpeg lock metadata is incomplete or inconsistent");
  }
  for (const value of [ffmpeg.version, ffmpeg.license, expectedSourceAsset, ffmpeg.sha256]) {
    if (!input.thirdPartyNotices.includes(value)) {
      throw new Error(`FFmpeg third-party notice is missing ${value}`);
    }
  }

  const packVersions = Array.from(
    input.packScript.matchAll(/SubTandem-([0-9A-Za-z.+-]+)\.iinaplgz/g),
    (match) => match[1],
  );
  if (packVersions.length < 2 || packVersions.some((value) => value !== version)) {
    throw new Error(
      `The pack script must use SubTandem-${version}.iinaplgz for the artifact and safety boundary`,
    );
  }

  const artifactName = `SubTandem-${version}.iinaplgz`;
  return {
    version,
    tag: `v${version}`,
    artifactName,
    artifactPath: `build/package/${artifactName}`,
    license: projectLicense,
    ...updateIdentity,
    ffmpegSourceAssetName: ffmpeg.sourceDistribution.assetName,
    ffmpegSourceChecksumName: ffmpeg.sourceDistribution.checksumAssetName,
  };
}

export function readReleaseMetadata(rootDirectory) {
  const info = JSON.parse(readFileSync(resolve(rootDirectory, "Info.json"), "utf8"));
  const packageManifest = JSON.parse(readFileSync(resolve(rootDirectory, "package.json"), "utf8"));
  const packageLock = JSON.parse(readFileSync(resolve(rootDirectory, "package-lock.json"), "utf8"));
  const packScript = readFileSync(resolve(rootDirectory, "scripts/pack.sh"), "utf8");
  const licenseText = readFileSync(resolve(rootDirectory, "LICENSE"), "utf8");
  const ffmpegLock = JSON.parse(
    readFileSync(resolve(rootDirectory, "native/ffmpeg.lock.json"), "utf8"),
  );
  const thirdPartyNotices = readFileSync(resolve(rootDirectory, "THIRD_PARTY_NOTICES.txt"), "utf8");

  const metadata = validateReleaseMetadata({
    infoVersion: info.version,
    infoGithubRepository: info.ghRepo,
    infoGithubVersion: info.ghVersion,
    packageVersion: packageManifest.version,
    lockVersion: packageLock.version,
    lockRootVersion: packageLock.packages?.[""]?.version,
    packageLicense: packageManifest.license,
    lockRootLicense: packageLock.packages?.[""]?.license,
    licenseText,
    packScript,
    ffmpegLock,
    thirdPartyNotices,
  });
  const releaseNotes = readReleaseNotes(rootDirectory, metadata.version);
  return {
    ...metadata,
    releaseNotesPath: releaseNotes.sourcePath,
    releaseNotesSha256: releaseNotes.rawSha256,
  };
}

function parseArguments(argumentsList) {
  const options = { root: process.cwd() };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--root") {
      options.root = argumentsList[index + 1];
      index += 1;
    } else if (argument === "--github-output") {
      options.githubOutput = argumentsList[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const metadata = readReleaseMetadata(resolve(options.root));
  if (options.githubOutput) {
    writeFileSync(
      options.githubOutput,
      [
        `version=${metadata.version}`,
        `tag=${metadata.tag}`,
        `artifact_name=${metadata.artifactName}`,
        `artifact_path=${metadata.artifactPath}`,
        `github_repository=${metadata.githubRepository}`,
        `github_version=${metadata.githubVersion}`,
        `release_notes_path=${metadata.releaseNotesPath}`,
        `release_notes_sha256=${metadata.releaseNotesSha256}`,
        `ffmpeg_source_asset_name=${metadata.ffmpegSourceAssetName}`,
        `ffmpeg_source_checksum_name=${metadata.ffmpegSourceChecksumName}`,
        "",
      ].join("\n"),
      { flag: "a" },
    );
  }
  process.stdout.write(`${JSON.stringify(metadata)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
