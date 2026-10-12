import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

export function nativePackageFixture() {
  mkdirSync(resolve("build"), { recursive: true });
  const root = mkdtempSync(join(resolve("build"), "native-package-fixture-"));
  const native = join(root, "dist/native");
  const app = join(native, "SubTandemStylePicker.app");
  const executable = join(app, "Contents/MacOS/subtandem-style-picker");
  const source = join(root, "fixture.c");
  writeFileSync(source, "int main(void) { return 0; }\n");
  mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
  for (const arch of ["arm64", "x86_64"])
    execFileSync("xcrun", [
      "clang",
      "-arch",
      arch,
      "-mmacosx-version-min=12.0",
      source,
      "-o",
      join(root, arch),
    ]);
  execFileSync("lipo", [
    "-create",
    join(root, "arm64"),
    join(root, "x86_64"),
    "-output",
    executable,
  ]);
  chmodSync(executable, 0o755);
  copyFileSync("native/style-picker/Info.plist", join(app, "Contents/Info.plist"));
  execFileSync(process.execPath, [
    "scripts/build-localization.mjs",
    "--native-resources",
    join(app, "Contents/Resources"),
  ]);
  execFileSync("codesign", ["--force", "--sign", "-", app], { stdio: "pipe" });
  for (const helper of ["subtandem-transport", "subtandem-subtitle-extractor"]) {
    copyFileSync(executable, join(native, helper));
    chmodSync(join(native, helper), 0o755);
    execFileSync("codesign", ["--force", "--sign", "-", join(native, helper)], { stdio: "pipe" });
  }
  for (const file of [
    "Info.json",
    "package.json",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.txt",
  ])
    copyFileSync(file, join(root, file));
  const hashFile = join(root, "native-hashes.json");
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  return {
    root,
    native,
    app,
    executable,
    hashFile,
    version,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
