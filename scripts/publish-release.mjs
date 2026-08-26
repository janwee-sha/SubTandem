import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import {
  normalizeReleaseBody,
  readReleaseNotesFile,
  releaseNotesRelativePath,
} from "./release-notes.mjs";

const remoteStateRetryDelays = [0, 500, 1_000, 2_000, 4_000, 8_000, 16_000];

export function decideReleaseAction(input) {
  const release = input.release;
  if (release && !release.draft) {
    if (release.prerelease) {
      throw new Error("The existing release is a prerelease");
    }
    if (!input.tagCommit) {
      throw new Error("The published release tag is missing");
    }
    if (normalizeReleaseBody(release.body) !== normalizeReleaseBody(input.expectedBody)) {
      throw new Error("Published release body conflict");
    }
    return { kind: "skip" };
  }

  if (!release) {
    if (input.tagCommit && input.tagCommit !== input.expectedCommit) {
      throw new Error(
        `Existing tag target mismatch: ${input.tagCommit} != ${input.expectedCommit}`,
      );
    }
    return { kind: "create", useExistingTag: Boolean(input.tagCommit) };
  }

  if (release.prerelease) {
    throw new Error("A draft prerelease cannot be resumed as a stable release");
  }
  const targetCommit = input.tagCommit ?? release.targetCommitish;
  if (targetCommit !== input.expectedCommit) {
    throw new Error(`Draft target mismatch: ${targetCommit} != ${input.expectedCommit}`);
  }
  if (normalizeReleaseBody(release.body) !== normalizeReleaseBody(input.expectedBody)) {
    throw new Error("Draft release body does not match the audited evidence");
  }
  return { kind: "resume", releaseId: release.id };
}

export function planAssetOperations(expectedAssets, remoteAssets) {
  const expectedByName = new Map(expectedAssets.map((asset) => [asset.name, asset]));
  const remoteByName = new Map();
  for (const asset of remoteAssets) {
    if (!expectedByName.has(asset.name)) {
      throw new Error(`Unexpected asset in draft release: ${asset.name}`);
    }
    if (remoteByName.has(asset.name)) {
      throw new Error(`Duplicate asset in draft release: ${asset.name}`);
    }
    remoteByName.set(asset.name, asset);
  }

  return expectedAssets.map((expected) => {
    const remote = remoteByName.get(expected.name);
    if (!remote) {
      return { kind: "upload", name: expected.name };
    }
    if (remote.sha256 !== expected.sha256) {
      throw new Error(`Remote asset content mismatch: ${expected.name}`);
    }
    return { kind: "reuse", name: expected.name };
  });
}

export function releaseAssetNames(version, ffmpegLock) {
  const distribution = ffmpegLock?.sourceDistribution;
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
    !/^ffmpeg-[0-9]+\.[0-9]+\.[0-9]+\.tar\.xz$/.test(distribution?.assetName ?? "") ||
    distribution?.checksumAssetName !== `${distribution.assetName}.sha256`
  ) {
    throw new Error("Release asset contract is invalid");
  }
  const artifactName = `SubTandem-${version}.iinaplgz`;
  return [
    artifactName,
    `${artifactName}.sha256`,
    distribution.assetName,
    distribution.checksumAssetName,
  ];
}

export function assertPublishedRelease(
  release,
  tagCommit,
  expectedCommit,
  latestReleaseId,
  expectedBody,
) {
  if (release.draft) {
    throw new Error("Release is not public after publication");
  }
  if (release.prerelease) {
    throw new Error("Published release is unexpectedly a prerelease");
  }
  if (tagCommit !== expectedCommit) {
    throw new Error(`Published tag target mismatch: ${tagCommit} != ${expectedCommit}`);
  }
  if (latestReleaseId !== undefined && release.id !== latestReleaseId) {
    throw new Error(`Published release is not Latest: ${release.id} != ${latestReleaseId}`);
  }
  if (
    expectedBody !== undefined &&
    normalizeReleaseBody(release.body) !== normalizeReleaseBody(expectedBody)
  ) {
    throw new Error("Published release body does not match the audited release notes");
  }
}

export async function pollRemoteState(loadState, acceptState, options = {}) {
  const retryDelays = options.retryDelays ?? remoteStateRetryDelays;
  const pause = options.pause ?? wait;
  let state;
  for (const delayMilliseconds of retryDelays) {
    if (delayMilliseconds > 0) {
      await pause(delayMilliseconds);
    }
    state = loadState();
    if (acceptState(state)) {
      return { matched: true, state };
    }
  }
  return { matched: false, state };
}

export function hasExpectedAssetNames(release, expectedAssets) {
  if (!release) {
    return false;
  }
  const remoteNames = new Set(release.assets.map((asset) => asset.name));
  return expectedAssets.every((asset) => remoteNames.has(asset.name));
}

export function isPublishedStateReady(state, expectedCommit, expectedBody) {
  return Boolean(
    state?.release &&
    !state.release.draft &&
    state.tagCommit === expectedCommit &&
    state.latestReleaseId === state.release.id &&
    (expectedBody === undefined ||
      normalizeReleaseBody(state.release.body) === normalizeReleaseBody(expectedBody)),
  );
}

export function readAuditedReleaseNotes(options) {
  const expectedSourcePath = releaseNotesRelativePath(options.version);
  if (options.auditReleaseNotes?.sourcePath !== expectedSourcePath) {
    throw new Error("Audited release notes source path does not match the publication version");
  }
  const releaseNotes = readReleaseNotesFile(options.notesFile, options.version);
  if (releaseNotes.rawSha256 !== options.auditReleaseNotes?.rawSha256) {
    throw new Error("Audited release notes SHA-256 does not match the publication body");
  }
  return releaseNotes.rawContent;
}

function runGh(argumentsList, options = {}) {
  const result = spawnSync(process.env.GH_BIN || "gh", argumentsList, {
    encoding: options.binary ? undefined : "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    const output = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : result.stderr || result.stdout || "unknown error";
    throw new Error(`gh ${argumentsList.join(" ")} failed: ${output.trim()}`);
  }
  return result;
}

function normalizeRelease(release) {
  return {
    id: release.id,
    draft: release.draft,
    prerelease: release.prerelease,
    targetCommitish: release.target_commitish,
    body: release.body ?? "",
    assets: Array.isArray(release.assets) ? release.assets : [],
  };
}

function findRelease(repository, tag) {
  const result = runGh([
    "api",
    "--paginate",
    "--slurp",
    `repos/${repository}/releases?per_page=100`,
  ]);
  const pages = JSON.parse(result.stdout);
  const releases = pages.flat().filter((release) => release.tag_name === tag);
  if (releases.length > 1) {
    throw new Error(`Multiple releases use tag ${tag}`);
  }
  return releases[0] ? normalizeRelease(releases[0]) : undefined;
}

function findLatestReleaseId(repository, allowMissing = false) {
  const result = runGh(["api", `repos/${repository}/releases/latest`], {
    allowFailure: allowMissing,
  });
  if (result.status === 0) {
    return JSON.parse(result.stdout).id;
  }
  if (allowMissing && /404|not found/i.test(result.stderr || "")) {
    return undefined;
  }
  throw new Error(`Unable to read Latest release: ${(result.stderr || "").trim()}`);
}

function readTagObject(repository, endpoint) {
  const result = runGh(["api", endpoint], { allowFailure: true });
  if (result.status === 0) {
    return JSON.parse(result.stdout);
  }
  if (/404|not found/i.test(result.stderr || "")) {
    return undefined;
  }
  throw new Error(`Unable to read Git tag: ${(result.stderr || "").trim()}`);
}

function resolveTagCommit(repository, tag) {
  const reference = readTagObject(
    repository,
    `repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`,
  );
  if (!reference) {
    return undefined;
  }
  let object = reference.object;
  for (let depth = 0; depth < 5; depth += 1) {
    if (object.type === "commit") {
      return object.sha;
    }
    if (object.type !== "tag") {
      throw new Error(`Unsupported Git tag object type: ${object.type}`);
    }
    const tagObject = readTagObject(repository, `repos/${repository}/git/tags/${object.sha}`);
    if (!tagObject) {
      throw new Error(`Annotated tag object is missing: ${object.sha}`);
    }
    object = tagObject.object;
  }
  throw new Error(`Annotated tag chain is too deep: ${tag}`);
}

function createDraft(options, useExistingTag) {
  const argumentsList = [
    "release",
    "create",
    options.tag,
    "--repo",
    options.repository,
    "--draft",
    "--title",
    `SubTandem ${options.version}`,
    "--notes-file",
    options.notesFile,
  ];
  if (useExistingTag) {
    argumentsList.push("--verify-tag");
  } else {
    argumentsList.push("--target", options.commit);
  }
  runGh(argumentsList);
}

function hashFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function downloadAsset(repository, asset, destination) {
  const result = runGh(
    [
      "api",
      `repos/${repository}/releases/assets/${asset.id}`,
      "-H",
      "Accept: application/octet-stream",
    ],
    { binary: true },
  );
  writeFileSync(destination, result.stdout);
}

function loadRemoteAssets(repository, release, temporaryDirectory) {
  return release.assets.map((asset) => {
    const destination = join(temporaryDirectory, `${asset.id}-${basename(asset.name)}`);
    downloadAsset(repository, asset, destination);
    return { name: asset.name, sha256: hashFile(destination) };
  });
}

function validateOptions(options) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)) {
    throw new Error("Repository must use owner/name format");
  }
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(options.tag)) {
    throw new Error("Tag must use stable vX.Y.Z format");
  }
  if (!/^[0-9a-f]{40}$/.test(options.commit)) {
    throw new Error("Commit must be a lowercase 40-character SHA");
  }
  if (options.version !== options.tag.slice(1)) {
    throw new Error("Version and tag do not match");
  }
}

export async function publishRelease(options) {
  validateOptions(options);
  const notesFile = resolve(options.notesFile);
  const assetsDirectory = resolve(options.assetsDirectory);
  const audit = JSON.parse(readFileSync(join(assetsDirectory, "release-audit.json"), "utf8"));
  const expectedBody = readAuditedReleaseNotes({
    notesFile,
    version: options.version,
    auditReleaseNotes: audit.releaseNotes,
  });
  const artifactName = `SubTandem-${options.version}.iinaplgz`;
  if (
    audit.version !== options.version ||
    audit.commit !== options.commit ||
    audit.artifactName !== artifactName ||
    audit.ffmpeg?.assetName === undefined ||
    audit.ffmpeg?.checksumAssetName === undefined
  ) {
    throw new Error("Audited release payload identity does not match publication options");
  }
  const expectedAssets = releaseAssetNames(options.version, {
    sourceDistribution: {
      assetName: audit.ffmpeg.assetName,
      checksumAssetName: audit.ffmpeg.checksumAssetName,
    },
  }).map((name) => {
    const filePath = join(assetsDirectory, name);
    return { name, filePath, sha256: hashFile(filePath) };
  });

  let release = findRelease(options.repository, options.tag);
  let tagCommit = resolveTagCommit(options.repository, options.tag);
  let action = decideReleaseAction({
    release,
    tagCommit,
    expectedCommit: options.commit,
    expectedBody,
  });
  if (action.kind === "skip") {
    process.stdout.write(`Release ${options.tag} already exists; publication skipped\n`);
    return { status: "skipped" };
  }

  if (action.kind === "create") {
    let creationError;
    try {
      createDraft({ ...options, notesFile }, action.useExistingTag);
    } catch (error) {
      creationError = error;
    }
    const createdRelease = await pollRemoteState(
      () => findRelease(options.repository, options.tag),
      Boolean,
    );
    release = createdRelease.state;
    if (!createdRelease.matched) {
      if (creationError) {
        throw creationError;
      }
      throw new Error(`Draft ${options.tag} was not visible after creation`);
    }
    tagCommit = resolveTagCommit(options.repository, options.tag);
    action = decideReleaseAction({
      release,
      tagCommit,
      expectedCommit: options.commit,
      expectedBody,
    });
    if (action.kind === "skip") {
      process.stdout.write(
        `Release ${options.tag} was published concurrently; publication skipped\n`,
      );
      return { status: "skipped" };
    }
    if (action.kind !== "resume") {
      throw new Error("New draft could not be resumed after creation");
    }
  }

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "subtandem-assets-"));
  try {
    const remoteAssets = loadRemoteAssets(options.repository, release, temporaryDirectory);
    const operations = planAssetOperations(expectedAssets, remoteAssets);
    for (const operation of operations) {
      if (operation.kind === "upload") {
        const asset = expectedAssets.find((item) => item.name === operation.name);
        runGh(["release", "upload", options.tag, asset.filePath, "--repo", options.repository]);
      }
    }

    const releaseWithAssets = await pollRemoteState(
      () => findRelease(options.repository, options.tag),
      (candidate) => hasExpectedAssetNames(candidate, expectedAssets),
    );
    release = releaseWithAssets.state;
    if (!releaseWithAssets.matched) {
      throw new Error(`Draft ${options.tag} assets were not visible after upload`);
    }
    tagCommit = resolveTagCommit(options.repository, options.tag);
    decideReleaseAction({
      release,
      tagCommit,
      expectedCommit: options.commit,
      expectedBody,
    });
    const verifiedAssets = loadRemoteAssets(options.repository, release, temporaryDirectory);
    const finalOperations = planAssetOperations(expectedAssets, verifiedAssets);
    if (finalOperations.some((operation) => operation.kind !== "reuse")) {
      throw new Error("Draft release assets are incomplete after upload");
    }

    runGh([
      "release",
      "edit",
      options.tag,
      "--repo",
      options.repository,
      "--draft=false",
      "--prerelease=false",
      "--latest",
    ]);
    const publishedState = await pollRemoteState(
      () => ({
        release: findRelease(options.repository, options.tag),
        tagCommit: resolveTagCommit(options.repository, options.tag),
        latestReleaseId: findLatestReleaseId(options.repository, true),
      }),
      (candidate) => isPublishedStateReady(candidate, options.commit, expectedBody),
    );
    release = publishedState.state?.release;
    tagCommit = publishedState.state?.tagCommit;
    const latestReleaseId = publishedState.state?.latestReleaseId;
    if (!release) {
      throw new Error(`Release ${options.tag} was not visible after publication`);
    }
    assertPublishedRelease(release, tagCommit, options.commit, latestReleaseId, expectedBody);
    if (!publishedState.matched) {
      throw new Error(`Release ${options.tag} did not become Latest after publication`);
    }
    process.stdout.write(`Published ${options.tag} at ${options.commit}\n`);
    return { status: "published" };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function parseArguments(argumentsList) {
  const options = {};
  const names = new Map([
    ["--repository", "repository"],
    ["--version", "version"],
    ["--tag", "tag"],
    ["--commit", "commit"],
    ["--assets-dir", "assetsDirectory"],
    ["--notes-file", "notesFile"],
  ]);
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = names.get(argumentsList[index]);
    const value = argumentsList[index + 1];
    if (!name || !value) {
      throw new Error(`Invalid argument: ${argumentsList[index] ?? "missing"}`);
    }
    options[name] = value;
  }
  for (const name of names.values()) {
    if (!options[name]) {
      throw new Error(`Missing required option: ${name}`);
    }
  }
  return options;
}

async function main() {
  await publishRelease(parseArguments(process.argv.slice(2)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
