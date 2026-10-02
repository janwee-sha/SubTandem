import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
export function auditCredentialPackage(root, sourceRoot, strict = false) {
  const info = JSON.parse(readFileSync(join(root, "Info.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8"));
  if (info.version !== pkg.version || info.minIINAVersion !== "1.4.0")
    throw new Error("Package version or host baseline mismatch");
  const notices = readFileSync(join(root, "THIRD_PARTY_NOTICES.txt"), "utf8");
  for (const name of ["@noble/curves", "@noble/ciphers", "@noble/hashes"])
    if (!notices.includes(name)) throw new Error("Missing cryptography dependency notice");
  const walk = (directory) =>
    readdirSync(directory).flatMap((name) => {
      const path = join(directory, name),
        stat = lstatSync(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
        throw new Error("Unsafe package entry");
      return stat.isDirectory() ? walk(path) : [path];
    });
  for (const file of walk(join(root, "dist"))) {
    const bytes = readFileSync(file);
    if (
      [
        "credential-host-probe",
        "CredentialHostProbe",
        "credential-write-observer",
        "CREDENTIAL_WRITE_OBSERVER",
        "synthetic-host-",
        "synthetic-migration-",
        "SubTandem-credential-probe-20260930",
      ].some((marker) => bytes.includes(Buffer.from(marker)))
    )
      throw new Error("Test credential material or observer in runtime package");
    if (
      /\.(?:map|ts|swift|json|iinaplgz)$|(?:^|\/)(?:@data|@tmp|tests|fixtures|specs|node_modules)(?:\/|$)/.test(
        relative(join(root, "dist"), file),
      )
    )
      throw new Error("Development or credential asset in runtime package");
  }
  if (strict) {
    const allowed = new Set([
      "Info.json",
      "README.md",
      "LICENSE",
      "THIRD_PARTY_NOTICES.txt",
      "dist",
    ]);
    if (readdirSync(root).some((name) => !allowed.has(name)))
      throw new Error("Unexpected package root entry");
    walk(root);
  }
}
export function auditArchive(archive, stage) {
  const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((name) => !name.endsWith("/"));
  const walk = (directory) =>
    readdirSync(directory).flatMap((name) => {
      const file = join(directory, name),
        stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error("Archive stage symlink");
      return stat.isDirectory() ? walk(file) : [relative(stage, file)];
    });
  const expected = walk(stage).sort();
  if (
    new Set(entries).size !== entries.length ||
    JSON.stringify(entries.sort()) !== JSON.stringify(expected)
  )
    throw new Error("Archive file set differs from audited stage");
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  for (const name of expected)
    if (
      hash(readFileSync(join(stage, name))) !==
      hash(execFileSync("unzip", ["-p", archive, name], { maxBuffer: 32 * 1024 * 1024 }))
    )
      throw new Error("Archive bytes differ from audited stage");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--archive") auditArchive(process.argv[3], process.argv[4]);
  else
    auditCredentialPackage(
      resolve(process.argv[2]),
      resolve(process.argv[3]),
      process.argv[4] === "--strict",
    );
}
