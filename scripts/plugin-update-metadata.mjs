import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const pluginGithubRepository = "janwee-sha/SubTandem";

const stableSemverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const versionComponentLimit = 999;

export function expectedGithubVersion(version) {
  const match = stableSemverPattern.exec(version);
  if (!match) {
    throw new Error(`Plugin version is not stable SemVer: ${version}`);
  }
  const components = match.slice(1).map(Number);
  if (components.some((component) => component > versionComponentLimit)) {
    throw new Error(`Plugin version component exceeds ${versionComponentLimit}: ${version}`);
  }
  const [major, minor, patch] = components;
  const githubVersion = major * 1_000_000 + minor * 1_000 + patch;
  if (!Number.isSafeInteger(githubVersion) || githubVersion <= 0) {
    throw new Error(`Plugin version does not produce a positive update version: ${version}`);
  }
  return githubVersion;
}

export function validatePluginUpdateMetadata(manifest) {
  const githubVersion = expectedGithubVersion(manifest?.version);
  if (manifest?.ghRepo !== pluginGithubRepository) {
    throw new Error(
      `Plugin update repository mismatch: expected ${pluginGithubRepository}, received ${manifest?.ghRepo}`,
    );
  }
  if (!Number.isSafeInteger(manifest?.ghVersion) || manifest.ghVersion <= 0) {
    throw new Error(`Plugin ghVersion must be a positive safe integer: ${manifest?.ghVersion}`);
  }
  if (manifest.ghVersion !== githubVersion) {
    throw new Error(
      `Plugin ghVersion mismatch: expected ${githubVersion}, received ${manifest.ghVersion}`,
    );
  }
  return {
    githubRepository: manifest.ghRepo,
    githubVersion: manifest.ghVersion,
  };
}

export function readPluginUpdateMetadata(manifestPath) {
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  return validatePluginUpdateMetadata(manifest);
}

function parseArguments(argumentsList) {
  if (argumentsList.length !== 2 || argumentsList[0] !== "--manifest") {
    throw new Error("Usage: plugin-update-metadata.mjs --manifest <Info.json>");
  }
  return { manifest: argumentsList[1] };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(readPluginUpdateMetadata(options.manifest))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
