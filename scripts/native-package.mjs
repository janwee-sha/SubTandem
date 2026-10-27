import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UI_LOCALES } from "../src/shared/localization/locales.ts";
import { MESSAGE_DEFINITIONS } from "../src/shared/localization/message-definitions.ts";

export const STYLE_PICKER_APP = "SubTandemStylePicker.app";
export const STYLE_PICKER_EXECUTABLE = `${STYLE_PICKER_APP}/Contents/MacOS/subtandem-style-picker`;
export const NATIVE_EXECUTABLES = [
  "subtandem-transport",
  "subtandem-subtitle-extractor",
  STYLE_PICKER_EXECUTABLE,
];
export const NATIVE_FILES = [
  ...NATIVE_EXECUTABLES,
  `${STYLE_PICKER_APP}/Contents/Info.plist`,
  `${STYLE_PICKER_APP}/Contents/_CodeSignature/CodeResources`,
  ...UI_LOCALES.map(
    (locale) => `${STYLE_PICKER_APP}/Contents/Resources/${locale}.lproj/Localizable.strings`,
  ),
].sort();
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const directories = new Set(
  NATIVE_FILES.flatMap((file) => {
    const segments = file.split("/");
    return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
  }),
);

export function nativeResourceText(catalog) {
  return (
    Object.entries(MESSAGE_DEFINITIONS)
      .filter(([, definition]) => definition.surfaces.includes("native"))
      .map(([key]) => `${JSON.stringify(key)} = ${JSON.stringify(catalog.messages[key])};`)
      .join("\n") + "\n"
  );
}

export function validateNativeNames(names) {
  if (
    !same(
      names.filter((name) => !name.endsWith("/")),
      NATIVE_FILES,
    ) ||
    names.some((name) => name.endsWith("/") && !directories.has(name.slice(0, -1)))
  )
    throw new Error("Native runtime allowlist does not match");
}

export function nativeHashes(nativeRoot) {
  const files = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const file = join(directory, name);
      const stat = lstatSync(file);
      const key = relative(nativeRoot, file);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
        throw new Error("Unsafe native package entry");
      if (stat.isDirectory()) {
        if (!directories.has(key)) throw new Error("Native runtime allowlist does not match");
        walk(file);
      } else files.push(key);
    }
  };
  walk(nativeRoot);
  validateNativeNames(files);
  return Object.fromEntries(
    files.sort().map((key) => [key, hash(readFileSync(join(nativeRoot, key)))]),
  );
}

export function writeNativeHashes(nativeRoot, hashFile) {
  writeFileSync(hashFile, JSON.stringify(nativeHashes(nativeRoot), null, 2) + "\n");
}

export function auditNativePackage(nativeRoot, sourceRoot, version, hashFile) {
  const facts = nativeHashes(nativeRoot);
  const app = join(nativeRoot, STYLE_PICKER_APP);
  const plist = JSON.parse(
    execFileSync("plutil", ["-convert", "json", "-o", "-", join(app, "Contents/Info.plist")], {
      encoding: "utf8",
    }),
  );
  if (
    plist.CFBundleIdentifier !== "io.subtandem.style-picker" ||
    plist.CFBundleExecutable !== "subtandem-style-picker" ||
    plist.CFBundlePackageType !== "APPL" ||
    plist.CFBundleDevelopmentRegion !== "en" ||
    plist.CFBundleShortVersionString !== version ||
    plist.CFBundleVersion !== version ||
    !Array.isArray(plist.CFBundleLocalizations) ||
    !same(plist.CFBundleLocalizations, UI_LOCALES) ||
    plist.CFBundleLocalizations.length !== UI_LOCALES.length ||
    plist.LSMinimumSystemVersion !== "12.0" ||
    plist.LSUIElement !== true
  )
    throw new Error("Native app plist does not match delivery contract");
  for (const locale of UI_LOCALES) {
    const catalog = JSON.parse(
      readFileSync(join(sourceRoot, `src/shared/localization/catalogs/${locale}.json`), "utf8"),
    );
    if (
      readFileSync(join(app, `Contents/Resources/${locale}.lproj/Localizable.strings`), "utf8") !==
      nativeResourceText(catalog)
    )
      throw new Error(`Native resource differs from source: ${locale}`);
  }
  execFileSync("codesign", ["--verify", "--strict", app], { stdio: "pipe" });
  for (const file of NATIVE_EXECUTABLES) {
    const path = join(nativeRoot, file);
    if ((lstatSync(path).mode & 0o111) === 0)
      throw new Error(`Native executable permission missing: ${file}`);
  }
  if (hashFile) {
    const expected = JSON.parse(readFileSync(hashFile, "utf8"));
    if (
      !same(Object.keys(expected), NATIVE_FILES) ||
      NATIVE_FILES.some((file) => expected[file] !== facts[file])
    )
      throw new Error("Native file hash differs from audited build");
  }
  return facts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, nativeRoot, argument, version, hashFile] = process.argv.slice(2);
  if (mode === "--write-hashes" && process.argv.length === 5)
    writeNativeHashes(resolve(nativeRoot), resolve(argument));
  else if (mode === "--verify" && process.argv.length === 7)
    auditNativePackage(resolve(nativeRoot), resolve(argument), version, resolve(hashFile));
  else throw new Error("Invalid native package audit arguments");
}
