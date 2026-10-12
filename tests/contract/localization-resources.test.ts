import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UI_LOCALES } from "../../shared/localization/locales.js";
import { LOCALE_CATALOGS, validMessageTemplate } from "../../ui/localization.js";
import { MESSAGE_DEFINITIONS } from "../../shared/localization/message-definitions.js";
import type { MessageDefinition } from "../../shared/localization/types.js";
import en from "../../shared/localization/catalogs/en.json";

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function syntheticResources() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "subtandem-localization-contract-")));
  temporaryRoots.push(root);
  for (const file of [
    "scripts/build-localization.mjs",
    "scripts/native-package.mjs",
    "shared/localization/locales.ts",
    "shared/localization/message-definitions.ts",
    "shared/localization/types.ts",
    "src/domain/target-languages.ts",
    "Info.json",
  ]) {
    const destination = join(root, file);
    mkdirSync(join(destination, ".."), { recursive: true });
    cpSync(new URL(`../../${file}`, import.meta.url), destination);
  }
  const directory = join(root, "shared/localization/catalogs");
  mkdirSync(directory, { recursive: true });
  for (const locale of UI_LOCALES) {
    const catalog = structuredClone(en) as any;
    catalog.locale = locale;
    for (const [key, definition] of Object.entries(MESSAGE_DEFINITIONS))
      if ("pluralParam" in definition)
        catalog.messages[key] = Object.fromEntries(
          new Intl.PluralRules(locale)
            .resolvedOptions()
            .pluralCategories.map((category) => [category, en.messages["models.available"].other]),
        );
    writeFileSync(join(directory, `${locale}.json`), JSON.stringify(catalog));
  }
  const invoke = (...args: string[]) =>
    spawnSync(process.execPath, [join(root, "scripts/build-localization.mjs"), ...args], {
      encoding: "utf8",
      cwd: root,
    });
  expect(invoke("--write-metadata").status).toBe(0);
  return { root, directory, invoke };
}

describe("production localization resources", () => {
  it("checks real resources without rewriting the manifest", () => {
    const path = new URL("../../Info.json", import.meta.url);
    const before = readFileSync(path, "utf8");
    const result = spawnSync(process.execPath, ["scripts/build-localization.mjs", "--check"], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(before);
  });
  it.each(UI_LOCALES)("has complete %s resources and locale quantity rules", (locale) => {
    const catalog = LOCALE_CATALOGS[locale];
    expect(catalog?.locale).toBe(locale);
    expect(Object.keys(catalog!.messages).sort()).toEqual(Object.keys(MESSAGE_DEFINITIONS).sort());
    expect(Object.keys(catalog!.targetLanguageNames)).toHaveLength(156);
    expect(Object.keys(catalog!.namedColorNames)).toHaveLength(10);
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    for (const [key, definition] of Object.entries(MESSAGE_DEFINITIONS))
      expect(
        validMessageTemplate(catalog!.messages[key], definition as MessageDefinition, categories),
        key,
      ).toBe(true);
  });
  it.each([
    "missingKey",
    "empty",
    "wrongParameter",
    "wrongType",
    "missingPlural",
    "unknownLocale",
    "wrongOptionId",
    "html",
  ])("rejects %s through the formal checker without mutation", (fault) => {
    const { root, directory, invoke } = syntheticResources();
    const file = join(directory, "de.json");
    const catalog = JSON.parse(readFileSync(file, "utf8"));
    if (fault === "missingKey") delete catalog.messages["sidebar.save"];
    if (fault === "empty") catalog.messages["sidebar.save"] = " ";
    if (fault === "wrongParameter") catalog.messages["profile.deleteTitle"] = "Delete {wrong}?";
    if (fault === "wrongType") catalog.messages["sidebar.save"] = 4;
    if (fault === "missingPlural") delete catalog.messages["models.available"].other;
    if (fault === "wrongOptionId") catalog.targetLanguageNames.unknown = "Synthetic";
    if (fault === "html") catalog.messages["sidebar.save"] = "<script>synthetic</script>";
    writeFileSync(file, JSON.stringify(catalog));
    if (fault === "unknownLocale")
      writeFileSync(join(directory, "ar.json"), JSON.stringify(catalog));
    const beforeManifest = readFileSync(join(root, "Info.json"), "utf8");
    const beforeCatalog = readFileSync(file, "utf8");
    expect(invoke("--check").status).not.toBe(0);
    expect(readFileSync(join(root, "Info.json"), "utf8")).toBe(beforeManifest);
    expect(readFileSync(file, "utf8")).toBe(beforeCatalog);
  });
  it("rejects invalid arguments and output escape before writing", () => {
    const { root, invoke } = syntheticResources();
    for (const args of [
      ["--check", "extra"],
      ["--unknown"],
      ["--native-resources", join(root, "shared/Resources")],
      ["--native-resources", "build/Resources"],
      ["--native-resources", join(root, "build/../Resources")],
    ])
      expect(invoke(...args).status, args.join(" ")).not.toBe(0);
  });
  it("generates exactly the native subset into build outputs", () => {
    const { root, invoke } = syntheticResources();
    const output = join(root, "build/localization-contract/Resources");
    expect(invoke("--native-resources", output).status).toBe(0);
    for (const locale of UI_LOCALES) {
      const text = readFileSync(join(output, `${locale}.lproj/Localizable.strings`), "utf8");
      expect(text).toContain('"native.choose"');
      expect(text).not.toMatch(/sidebar\.|metadata\.|targetLanguageNames/);
    }
  });
});
