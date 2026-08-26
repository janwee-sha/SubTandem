import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";

const stableSemverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function assertStableVersion(version) {
  if (!stableSemverPattern.test(version)) {
    throw new Error(`Release notes version is not stable SemVer: ${version}`);
  }
}

export function releaseNotesRelativePath(version) {
  assertStableVersion(version);
  return `docs/releases/v${version}.md`;
}

export function normalizeReleaseBody(body) {
  return (body ?? "").replaceAll("\r\n", "\n").trimEnd();
}

export function readReleaseNotesFile(filePath, version) {
  assertStableVersion(version);
  const absolutePath = resolve(filePath);
  let fileStatus;
  try {
    fileStatus = lstatSync(absolutePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`Release notes file is missing: ${filePath}`);
    }
    throw error;
  }
  if (!fileStatus.isFile()) {
    throw new Error(`Release notes path must be a regular file: ${filePath}`);
  }
  const rawBytes = readFileSync(absolutePath);
  let rawContent;
  try {
    rawContent = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
  } catch {
    throw new Error("Release notes must contain valid UTF-8 text");
  }
  return {
    rawContent,
    rawSha256: createHash("sha256").update(rawBytes).digest("hex"),
  };
}

export function readReleaseNotes(rootDirectory, version) {
  const sourcePath = releaseNotesRelativePath(version);
  return {
    ...readReleaseNotesFile(resolve(rootDirectory, sourcePath), version),
    sourcePath,
  };
}
