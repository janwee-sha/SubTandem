import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validatePluginUpdateMetadata } from "./plugin-update-metadata.mjs";
import { readReleaseNotes } from "./release-notes.mjs";

const gateLabels = [
  ["test", "npm run test"],
  ["typecheck", "npm run typecheck"],
  ["lint", "npm run lint"],
  ["buildNative", "npm run build:native"],
  ["testNative", "npm run test:native"],
  ["build", "npm run build"],
  ["verifyPackage", "npm run verify:package"],
  ["pack", "npm run pack"],
];

const forbiddenSegments = new Set([
  ".git",
  ".parcel-cache",
  "@data",
  "@tmp",
  "__macosx",
  "build",
  "coverage",
  "node_modules",
  "specs",
  "src",
  "tests",
]);

function isUnsafePath(name) {
  if (
    name.length === 0 ||
    /[^\x20-\x7e]/.test(name) ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name)
  ) {
    return true;
  }
  const segments = name.split("/");
  return segments.some(
    (segment, index) =>
      segment === "." || segment === ".." || (segment === "" && index !== segments.length - 1),
  );
}

function isForbiddenEntry(name) {
  const lowerName = name.toLowerCase();
  const segments = lowerName.split("/").filter(Boolean);
  const fileName = segments.at(-1) ?? "";
  if (segments.some((segment) => forbiddenSegments.has(segment))) {
    return true;
  }
  if (
    segments.some((segment, index) => segment === "native" && segments[index + 1] === "transport")
  ) {
    return true;
  }
  return (
    fileName === "credentials.json" ||
    fileName === ".env" ||
    fileName.startsWith(".env.") ||
    fileName.endsWith(".log") ||
    fileName.endsWith(".map") ||
    fileName.endsWith(".mobileprovision") ||
    fileName.endsWith(".p12") ||
    fileName.endsWith(".pem") ||
    fileName.endsWith(".pfx") ||
    fileName.endsWith(".key")
  );
}

export function validateArchiveEntries(entries, expectedCompliance = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("The release archive is empty");
  }

  const names = new Set();
  for (const entry of entries) {
    if (isUnsafePath(entry.name)) {
      throw new Error(`Unsafe archive path: ${entry.name}`);
    }
    const collisionKey = entry.name.normalize("NFC").toLowerCase();
    if (names.has(collisionKey)) {
      throw new Error(`Duplicate archive entry: ${entry.name}`);
    }
    names.add(collisionKey);
    if (entry.encrypted) {
      throw new Error(`Encrypted archive entry: ${entry.name}`);
    }
    if ((entry.unixMode & 0o170000) === 0o120000) {
      throw new Error(`Archive symbolic link is forbidden: ${entry.name}`);
    }
    if (
      Object.hasOwn(expectedCompliance, entry.name) &&
      entry.content !== expectedCompliance[entry.name]
    ) {
      throw new Error(`Packaged compliance file differs from repository source: ${entry.name}`);
    }

    const allowedRoot =
      entry.name === "Info.json" ||
      entry.name === "README.md" ||
      entry.name === "LICENSE" ||
      entry.name === "THIRD_PARTY_NOTICES.txt" ||
      entry.name === "dist/" ||
      (entry.name.startsWith("dist/") && entry.name.length > "dist/".length);
    if (!allowedRoot) {
      throw new Error(`Unexpected archive root entry: ${entry.name}`);
    }
    if (isForbiddenEntry(entry.name)) {
      throw new Error(`Forbidden archive entry: ${entry.name}`);
    }
  }

  const required = [
    "Info.json",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.txt",
    "dist/main.js",
    "dist/global.js",
    "dist/ui/sidebar.html",
    "dist/ui/overlay.html",
    "dist/native/subtandem-subtitle-extractor",
    "dist/native/subtandem-style-picker",
    "dist/native/subtandem-transport",
  ];
  for (const name of required) {
    if (!entries.some((entry) => entry.name === name)) {
      throw new Error(`Required archive entry is missing: ${name}`);
    }
  }

  const nativeFiles = entries
    .filter((entry) => entry.name.startsWith("dist/native/") && !entry.name.endsWith("/"))
    .map((entry) => entry.name)
    .sort();
  const expectedNativeFiles = [
    "dist/native/subtandem-style-picker",
    "dist/native/subtandem-subtitle-extractor",
    "dist/native/subtandem-transport",
  ];
  if (JSON.stringify(nativeFiles) !== JSON.stringify(expectedNativeFiles)) {
    throw new Error("The archive native executable allowlist does not match");
  }
  for (const name of expectedNativeFiles) {
    const helper = entries.find((entry) => entry.name === name);
    if (!helper || (helper.unixMode & 0o111) === 0) {
      throw new Error(`The archived native helper is not executable: ${name}`);
    }
  }
  return entries;
}

export function validateArtifactIdentity(input) {
  const expectedName = `SubTandem-${input.expectedVersion}.iinaplgz`;
  if (input.artifactName !== expectedName) {
    throw new Error(
      `Release artifact name mismatch: expected ${expectedName}, received ${input.artifactName}`,
    );
  }
  if (input.packageInfo.version !== input.expectedVersion) {
    throw new Error(
      `Release package version mismatch: expected ${input.expectedVersion}, received ${input.packageInfo.version}`,
    );
  }
  const updateIdentity = validatePluginUpdateMetadata(input.packageInfo);
  if (updateIdentity.githubRepository !== input.expectedGithubRepository) {
    throw new Error(
      `Release package update repository mismatch: expected ${input.expectedGithubRepository}, received ${updateIdentity.githubRepository}`,
    );
  }
  if (updateIdentity.githubVersion !== input.expectedGithubVersion) {
    throw new Error(
      `Release package ghVersion mismatch: expected ${input.expectedGithubVersion}, received ${updateIdentity.githubVersion}`,
    );
  }
  return updateIdentity;
}

export function validateHelperFacts(label, facts) {
  for (const architecture of ["arm64", "x86_64"]) {
    if (!facts.architectures.includes(architecture)) {
      throw new Error(`${label} is missing ${architecture}`);
    }
  }
  if (!facts.executable) {
    throw new Error(`${label} is not executable`);
  }
  if (!facts.signed) {
    throw new Error(`${label} does not have a valid signature`);
  }
  if (
    !Array.isArray(facts.minimumMacos) ||
    facts.minimumMacos.length !== 2 ||
    facts.minimumMacos.some((version) => version !== "12.0")
  ) {
    throw new Error(`${label} does not declare macOS 12.0 for both architectures`);
  }
  if (
    !Array.isArray(facts.dependencies) ||
    facts.dependencies.some(
      (dependency) =>
        !dependency.startsWith("/usr/lib/") && !dependency.startsWith("/System/Library/"),
    )
  ) {
    throw new Error(`${label} has a non-system dynamic dependency`);
  }
  if (!/^[0-9a-f]{64}$/.test(facts.sha256)) {
    throw new Error(`${label} does not have a valid SHA-256`);
  }
  return facts;
}

export function parseOtoolDependencies(output) {
  return output
    .split("\n")
    .filter((line) => /^\s+\//.test(line))
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
}

export function validateFFmpegSource(lock, sourceName, sourceBuffer) {
  const distribution = lock?.sourceDistribution;
  if (
    lock?.version !== "8.1.2" ||
    lock?.license !== "LGPL-2.1-or-later" ||
    lock?.sourceAssetName !== sourceName ||
    distribution?.assetName !== sourceName ||
    distribution?.checksumAssetName !== `${sourceName}.sha256` ||
    !/^[0-9a-f]{64}$/.test(lock?.sha256 ?? "")
  ) {
    throw new Error("FFmpeg source metadata does not match the lock");
  }
  const sha256 = createHash("sha256").update(sourceBuffer).digest("hex");
  if (sha256 !== lock.sha256) {
    throw new Error("FFmpeg source SHA-256 does not match the lock");
  }
  return {
    version: lock.version,
    license: lock.license,
    assetName: distribution.assetName,
    checksumAssetName: distribution.checksumAssetName,
    sha256,
  };
}

export function copyAuditedReleaseNotes(options) {
  const releaseNotes = readReleaseNotes(options.rootDirectory, options.expectedVersion);
  if (options.sourcePath && options.sourcePath !== releaseNotes.sourcePath) {
    throw new Error(
      `Release notes path mismatch: ${options.sourcePath} != ${releaseNotes.sourcePath}`,
    );
  }
  if (releaseNotes.rawSha256 !== options.expectedSha256) {
    throw new Error("Release notes SHA-256 changed after metadata validation");
  }
  mkdirSync(resolve(options.outputDirectory), { recursive: true });
  writeFileSync(resolve(options.outputDirectory, "release-notes.md"), releaseNotes.rawContent);
  return {
    sourcePath: releaseNotes.sourcePath,
    rawSha256: releaseNotes.rawSha256,
  };
}

export function buildReleaseAudit(input) {
  return {
    version: input.version,
    tag: `v${input.version}`,
    commit: input.commit,
    artifactName: input.artifactName,
    checksumName: `${input.artifactName}.sha256`,
    packageVersion: input.packageVersion,
    updateIdentity: input.updateIdentity,
    byteSize: input.byteSize,
    sha256: input.sha256,
    gates: input.gates,
    entries: input.entries,
    buildHelpers: input.buildHelpers,
    packageHelpers: input.packageHelpers,
    ffmpeg: input.ffmpeg,
    releaseNotes: input.releaseNotes,
    hostValidation: {
      installation: "not-covered",
      uninstallation: "not-covered",
      playback: "not-covered",
    },
  };
}

export function formatReleaseAuditSummary(audit) {
  const lines = [
    "## Release audit",
    "",
    `- Version: \`${audit.version}\``,
    `- Tag: \`${audit.tag}\``,
    `- Commit: \`${audit.commit}\``,
    `- Artifact: \`${audit.artifactName}\` (${audit.byteSize} bytes)`,
    `- Artifact SHA-256: \`${audit.sha256}\``,
    `- Update repository: \`${audit.updateIdentity.githubRepository}\``,
    `- Update version: \`${audit.updateIdentity.githubVersion}\``,
    `- Release notes: \`${audit.releaseNotes.sourcePath}\``,
    `- Release notes SHA-256: \`${audit.releaseNotes.rawSha256}\``,
    "",
    "### Gates",
    "",
    ...gateLabels.map(
      ([key, command]) => `- \`${command}\`: ${audit.gates[key] ? "PASS" : "FAIL"}`,
    ),
    "",
    "### Archive entries",
    "",
    ...audit.entries.map((entry) => `- \`${entry.name}\``),
    "",
    "### Native helpers",
    "",
    ...Object.entries(audit.buildHelpers).flatMap(([name, helper]) => [
      `- Build \`${name}\`: \`${helper.sha256}\``,
      `  - Architectures: ${helper.architectures.join(", ")}`,
      `  - Minimum macOS: ${helper.minimumMacos.join(", ")}`,
      `  - Signature: ${helper.signature}`,
      `  - Dependencies: ${helper.dependencies.join(", ") || "none"}`,
    ]),
    ...Object.entries(audit.packageHelpers).flatMap(([name, helper]) => [
      `- Package \`${name}\`: \`${helper.sha256}\``,
      `  - Architectures: ${helper.architectures.join(", ")}`,
      `  - Minimum macOS: ${helper.minimumMacos.join(", ")}`,
      `  - Signature: ${helper.signature}`,
      `  - Dependencies: ${helper.dependencies.join(", ") || "none"}`,
    ]),
    "",
    "### FFmpeg source",
    "",
    `- Asset: \`${audit.ffmpeg.assetName}\``,
    `- Checksum asset: \`${audit.ffmpeg.checksumAssetName}\``,
    `- SHA-256: \`${audit.ffmpeg.sha256}\``,
    "",
    "### Host validation",
    "",
    `- Installation: ${audit.hostValidation.installation}`,
    `- Uninstallation: ${audit.hostValidation.uninstallation}`,
    `- Playback: ${audit.hostValidation.playback}`,
    "",
  ];
  return lines.join("\n");
}

export function readZipEntries(archiveBuffer) {
  const minimumOffset = Math.max(0, archiveBuffer.length - 65_557);
  const endOffsets = [];
  for (let offset = archiveBuffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (
      archiveBuffer.readUInt32LE(offset) === 0x06054b50 &&
      archiveBuffer.readUInt16LE(offset + 20) === archiveBuffer.length - offset - 22
    ) {
      endOffsets.push(offset);
    }
  }
  if (endOffsets.length === 0) {
    throw new Error("ZIP end-of-central-directory record is missing");
  }
  if (endOffsets.length !== 1) {
    throw new Error("ZIP contains ambiguous end-of-central-directory records");
  }
  const [endOffset] = endOffsets;

  const diskNumber = archiveBuffer.readUInt16LE(endOffset + 4);
  const directoryDisk = archiveBuffer.readUInt16LE(endOffset + 6);
  const diskEntryCount = archiveBuffer.readUInt16LE(endOffset + 8);
  const entryCount = archiveBuffer.readUInt16LE(endOffset + 10);
  const directorySize = archiveBuffer.readUInt32LE(endOffset + 12);
  const directoryOffset = archiveBuffer.readUInt32LE(endOffset + 16);
  if (
    diskNumber !== 0 ||
    directoryDisk !== 0 ||
    diskEntryCount !== entryCount ||
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    throw new Error("ZIP64 release archives are not supported");
  }
  if (directoryOffset + directorySize !== endOffset) {
    throw new Error("ZIP central directory does not end at its directory record");
  }

  const entries = [];
  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (archiveBuffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central directory entry at index ${index}`);
    }
    const versionMadeBy = archiveBuffer.readUInt16LE(cursor + 4);
    const flags = archiveBuffer.readUInt16LE(cursor + 8);
    const fileNameLength = archiveBuffer.readUInt16LE(cursor + 28);
    const extraLength = archiveBuffer.readUInt16LE(cursor + 30);
    const commentLength = archiveBuffer.readUInt16LE(cursor + 32);
    const externalAttributes = archiveBuffer.readUInt32LE(cursor + 38);
    const localHeaderOffset = archiveBuffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > archiveBuffer.length) {
      throw new Error(`Invalid ZIP filename at index ${index}`);
    }
    const name = archiveBuffer.subarray(nameStart, nameEnd).toString("utf8");
    if (
      localHeaderOffset + 30 > directoryOffset ||
      archiveBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      throw new Error(`Invalid ZIP local file header at index ${index}`);
    }
    const localFlags = archiveBuffer.readUInt16LE(localHeaderOffset + 6);
    const localNameLength = archiveBuffer.readUInt16LE(localHeaderOffset + 26);
    const localNameStart = localHeaderOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    if (localNameEnd > directoryOffset) {
      throw new Error(`Invalid ZIP local filename at index ${index}`);
    }
    const localName = archiveBuffer.subarray(localNameStart, localNameEnd).toString("utf8");
    if (localName !== name || (localFlags & 1) !== (flags & 1)) {
      throw new Error(`ZIP local and central entries differ at index ${index}`);
    }
    const platform = versionMadeBy >>> 8;
    const unixMode = platform === 3 || platform === 19 ? externalAttributes >>> 16 : 0;
    entries.push({
      name,
      unixMode,
      encrypted: (flags & 1) !== 0,
    });
    cursor = nameEnd + extraLength + commentLength;
  }
  if (cursor !== directoryOffset + directorySize) {
    throw new Error("ZIP central directory size does not match its entries");
  }
  return entries;
}

function runCommand(command, argumentsList) {
  const result = spawnSync(command, argumentsList, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} failed: ${(result.stderr || result.stdout || "unknown error").trim()}`,
    );
  }
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function verifyHelper(filePath, label) {
  const lipo = process.env.LIPO_BIN || "lipo";
  const codesign = process.env.CODESIGN_BIN || "codesign";
  const otool = process.env.OTOOL_BIN || "otool";
  const architectureOutput = runCommand(lipo, ["-archs", filePath]).stdout;
  const architectures = architectureOutput.split(/\s+/).filter(Boolean);
  let executable = true;
  try {
    accessSync(filePath, constants.X_OK);
  } catch {
    executable = false;
  }
  const verification = spawnSync(codesign, ["--verify", "--strict", filePath], {
    encoding: "utf8",
  });
  const signed = verification.status === 0;
  let signature = "valid";
  if (signed) {
    const details = runCommand(codesign, ["-dv", "--verbose=4", filePath]);
    const selected = `${details.stdout}\n${details.stderr}`
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^(Identifier|Format|CodeDirectory|Signature|TeamIdentifier)=/.test(line));
    signature = selected.length > 0 ? selected.join("; ") : "valid";
  }
  const minimumMacos = runCommand(otool, ["-l", filePath])
    .stdout.split("\n")
    .map((line) => line.trim().match(/^minos\s+([^\s]+)$/)?.[1])
    .filter(Boolean);
  const dependencies = parseOtoolDependencies(runCommand(otool, ["-L", filePath]).stdout);
  const sha256 = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  return validateHelperFacts(label, {
    architectures,
    minimumMacos,
    executable,
    signed,
    signature,
    dependencies,
    sha256,
  });
}

function readGates(filePath) {
  const gates = JSON.parse(readFileSync(filePath, "utf8"));
  for (const [key] of gateLabels) {
    if (gates[key] !== true) {
      throw new Error(`Release gate is not marked successful: ${key}`);
    }
  }
  return Object.fromEntries(gateLabels.map(([key]) => [key, true]));
}

export function auditRelease(options) {
  if (!/^[0-9a-f]{40}$/.test(options.expectedCommit)) {
    throw new Error("Expected commit must be a lowercase 40-character SHA");
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(options.expectedVersion)) {
    throw new Error("Expected version must be stable SemVer");
  }

  const artifactPath = resolve(options.artifact);
  const archiveBuffer = readFileSync(artifactPath);
  const entries = validateArchiveEntries(readZipEntries(archiveBuffer));
  const gates = readGates(resolve(options.gates));
  const ffmpegLock = JSON.parse(readFileSync(resolve(options.ffmpegLock), "utf8"));
  const ffmpegSourcePath = resolve(options.ffmpegSource);
  const ffmpegSourceBuffer = readFileSync(ffmpegSourcePath);
  const ffmpeg = validateFFmpegSource(ffmpegLock, basename(ffmpegSourcePath), ffmpegSourceBuffer);
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "subtandem-release-"));

  try {
    runCommand(process.env.UNZIP_BIN || "unzip", ["-q", artifactPath, "-d", temporaryDirectory]);
    const packageInfo = JSON.parse(readFileSync(join(temporaryDirectory, "Info.json"), "utf8"));
    for (const complianceFile of ["LICENSE", "THIRD_PARTY_NOTICES.txt"]) {
      const packagedContent = readFileSync(join(temporaryDirectory, complianceFile));
      const repositoryContent = readFileSync(resolve(complianceFile));
      if (!packagedContent.equals(repositoryContent)) {
        throw new Error(
          `Packaged compliance file differs from repository source: ${complianceFile}`,
        );
      }
    }
    const updateIdentity = validateArtifactIdentity({
      artifactName: basename(artifactPath),
      packageInfo,
      expectedVersion: options.expectedVersion,
      expectedGithubRepository: options.expectedGithubRepository,
      expectedGithubVersion: Number(options.expectedGithubVersion),
    });

    const helperPaths = {
      "subtandem-transport": resolve(options.buildHelper),
      "subtandem-subtitle-extractor": resolve(options.buildExtractor),
      "subtandem-style-picker": resolve(options.buildStylePicker),
    };
    const buildHelpers = {};
    const packageHelpers = {};
    for (const [name, buildPath] of Object.entries(helperPaths)) {
      buildHelpers[name] = verifyHelper(buildPath, `Build ${name}`);
      packageHelpers[name] = verifyHelper(
        join(temporaryDirectory, `dist/native/${name}`),
        `Packaged ${name}`,
      );
      if (buildHelpers[name].sha256 !== packageHelpers[name].sha256) {
        throw new Error(`Packaged ${name} differs from the audited build`);
      }
    }
    const byteSize = statSync(artifactPath).size;
    const sha256 = createHash("sha256").update(archiveBuffer).digest("hex");
    const artifactName = basename(artifactPath);
    const outputDirectory = resolve(options.outputDirectory);
    const releaseNotes = copyAuditedReleaseNotes({
      rootDirectory: process.cwd(),
      expectedVersion: options.expectedVersion,
      expectedSha256: options.expectedReleaseNotesSha256,
      sourcePath: options.releaseNotes,
      outputDirectory,
    });
    const audit = buildReleaseAudit({
      version: options.expectedVersion,
      commit: options.expectedCommit,
      artifactName,
      packageVersion: packageInfo.version,
      updateIdentity,
      byteSize,
      sha256,
      gates,
      entries,
      buildHelpers,
      packageHelpers,
      ffmpeg,
      releaseNotes,
    });

    mkdirSync(outputDirectory, { recursive: true });
    const outputArtifact = join(outputDirectory, artifactName);
    if (outputArtifact !== artifactPath) {
      copyFileSync(artifactPath, outputArtifact);
    }
    writeFileSync(join(outputDirectory, `${artifactName}.sha256`), `${sha256}  ${artifactName}\n`);
    const outputSource = join(outputDirectory, ffmpeg.assetName);
    if (outputSource !== ffmpegSourcePath) {
      copyFileSync(ffmpegSourcePath, outputSource);
    }
    writeFileSync(
      join(outputDirectory, ffmpeg.checksumAssetName),
      `${ffmpeg.sha256}  ${ffmpeg.assetName}\n`,
    );
    writeFileSync(
      join(outputDirectory, "release-audit.json"),
      `${JSON.stringify(audit, null, 2)}\n`,
    );
    if (options.summaryFile) {
      writeFileSync(resolve(options.summaryFile), formatReleaseAuditSummary(audit), { flag: "a" });
    }
    return audit;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function parseArguments(argumentsList) {
  const options = {};
  const names = new Map([
    ["--artifact", "artifact"],
    ["--expected-version", "expectedVersion"],
    ["--expected-github-repository", "expectedGithubRepository"],
    ["--expected-github-version", "expectedGithubVersion"],
    ["--expected-commit", "expectedCommit"],
    ["--build-helper", "buildHelper"],
    ["--build-extractor", "buildExtractor"],
    ["--build-style-picker", "buildStylePicker"],
    ["--ffmpeg-source", "ffmpegSource"],
    ["--ffmpeg-lock", "ffmpegLock"],
    ["--gates", "gates"],
    ["--release-notes", "releaseNotes"],
    ["--release-notes-sha256", "expectedReleaseNotesSha256"],
    ["--summary-file", "summaryFile"],
    ["--output-dir", "outputDirectory"],
  ]);
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = names.get(argumentsList[index]);
    const value = argumentsList[index + 1];
    if (!name || !value) {
      throw new Error(`Invalid argument: ${argumentsList[index] ?? "missing"}`);
    }
    options[name] = value;
  }
  for (const name of [
    "artifact",
    "expectedVersion",
    "expectedGithubRepository",
    "expectedGithubVersion",
    "expectedCommit",
    "buildHelper",
    "buildExtractor",
    "buildStylePicker",
    "ffmpegSource",
    "ffmpegLock",
    "gates",
    "releaseNotes",
    "expectedReleaseNotesSha256",
    "outputDirectory",
  ]) {
    if (!options[name]) {
      throw new Error(`Missing required option: ${name}`);
    }
  }
  return options;
}

function main() {
  const audit = auditRelease(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(audit)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
