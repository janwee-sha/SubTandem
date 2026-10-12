import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { nativeResourceText } from "./native-package.mjs";
import { UI_LOCALES } from "../shared/localization/locales.ts";
import { MESSAGE_DEFINITIONS } from "../shared/localization/message-definitions.ts";
import { TARGET_LANGUAGES } from "../src/domain/target-languages.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogRoot = path.join(root, "shared/localization/catalogs");
const colorIds = [
  "transparent",
  "white",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
  "black",
];
const sameKeys = (left, right) => [...left].sort().join("\0") === [...right].sort().join("\0");
const fail = (identity) => {
  throw new Error(identity);
};
const plainText = (value) =>
  typeof value === "string" &&
  Boolean(value.trim()) &&
  !/<\/?[A-Za-z][^>]*>/.test(value) &&
  !Array.from(value).some(
    (character) => character.charCodeAt(0) < 32 && ![9, 10, 13].includes(character.charCodeAt(0)),
  );
const validText = (text, definition) =>
  plainText(text) &&
  sameKeys(
    [...new Set([...text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]))],
    Object.keys(definition.params),
  ) &&
  !/[{}]/.test(text.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, ""));

function readCatalogs() {
  if (
    !sameKeys(
      fs.readdirSync(catalogRoot),
      UI_LOCALES.map((locale) => `${locale}.json`),
    )
  )
    fail("INVALID_LOCALE_RESOURCE_SET");
  const catalogs = new Map();
  for (const locale of UI_LOCALES) {
    const catalog = JSON.parse(fs.readFileSync(path.join(catalogRoot, `${locale}.json`), "utf8"));
    if (
      !sameKeys(Object.keys(catalog), [
        "locale",
        "messages",
        "targetLanguageNames",
        "namedColorNames",
      ]) ||
      catalog.locale !== locale
    )
      fail(`INVALID_CATALOG:${locale}`);
    if (
      !catalog.messages ||
      !sameKeys(Object.keys(catalog.messages), Object.keys(MESSAGE_DEFINITIONS))
    )
      fail(`INVALID_MESSAGE_KEYS:${locale}`);
    const categories = new Intl.PluralRules(locale, { type: "cardinal" }).resolvedOptions()
      .pluralCategories;
    for (const [key, definition] of Object.entries(MESSAGE_DEFINITIONS)) {
      const entry = catalog.messages[key];
      if (definition.pluralParam) {
        if (
          entry === null ||
          typeof entry !== "object" ||
          Array.isArray(entry) ||
          !sameKeys(Object.keys(entry), categories) ||
          categories.some((category) => !validText(entry[category], definition))
        )
          fail(`INVALID_PLURAL_MESSAGE:${locale}:${key}`);
      } else if (!validText(entry, definition)) fail(`INVALID_MESSAGE:${locale}:${key}`);
    }
    for (const [surface, ids] of [
      ["targetLanguageNames", TARGET_LANGUAGES.map((language) => language.id)],
      ["namedColorNames", colorIds],
    ]) {
      if (
        !catalog[surface] ||
        !sameKeys(Object.keys(catalog[surface]), ids) ||
        Object.values(catalog[surface]).some((label) => !plainText(label) || /[{}]/.test(label))
      )
        fail(`INVALID_OPTION_NAMES:${locale}:${surface}`);
    }
    catalogs.set(locale, catalog);
  }
  return catalogs;
}

function checkMetadata(manifest, catalogs) {
  if (
    manifest.name !== "SubTandem" ||
    manifest.sidebarTab?.name !== "SubTandem" ||
    manifest.minIINAVersion !== "1.4.0" ||
    manifest.description !== catalogs.get("en").messages["metadata.description"]
  )
    fail("INVALID_LOCALIZATION_MANIFEST_BASELINE");
  if (!manifest.localized || !sameKeys(Object.keys(manifest.localized), UI_LOCALES))
    fail("LOCALIZATION_METADATA_OUT_OF_DATE:run --write-metadata");
  for (const locale of UI_LOCALES)
    if (
      !sameKeys(Object.keys(manifest.localized[locale]), ["description"]) ||
      manifest.localized[locale].description !==
        catalogs.get(locale).messages["metadata.description"]
    )
      fail(`LOCALIZATION_METADATA_OUT_OF_DATE:${locale}:run --write-metadata`);
}

function outputRoot(value) {
  if (!value || !path.isAbsolute(value)) fail("INVALID_NATIVE_RESOURCE_OUTPUT");
  const output = path.resolve(value);
  const dist = path.join(root, "dist/native/SubTandemStylePicker.app/Contents/Resources");
  const build = path.join(root, "build") + path.sep;
  if (output !== dist && !(output.startsWith(build) && path.basename(output) === "Resources"))
    fail("INVALID_NATIVE_RESOURCE_OUTPUT");
  for (let current = output; current !== root; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      fail("INVALID_NATIVE_RESOURCE_OUTPUT_SYMLINK");
    if (path.dirname(current) === current) fail("INVALID_NATIVE_RESOURCE_OUTPUT");
  }
  if (
    fs.existsSync(output) &&
    fs.readdirSync(output).some((name) => !UI_LOCALES.some((locale) => `${locale}.lproj` === name))
  )
    fail("INVALID_NATIVE_RESOURCE_CONTENTS");
  return output;
}

try {
  const args = process.argv.slice(2);
  if (
    !(args.length === 1 && ["--check", "--write-metadata"].includes(args[0])) &&
    !(args.length === 2 && args[0] === "--native-resources")
  )
    fail("INVALID_LOCALIZATION_ARGUMENTS");
  const output = args[0] === "--native-resources" ? outputRoot(args[1]) : null;
  const catalogs = readCatalogs();
  const manifestPath = path.join(root, "Info.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (args[0] === "--write-metadata") {
    manifest.localized = Object.fromEntries(
      UI_LOCALES.map((locale) => [
        locale,
        { description: catalogs.get(locale).messages["metadata.description"] },
      ]),
    );
    checkMetadata(manifest, catalogs);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    checkMetadata(manifest, catalogs);
    if (output) {
      for (const locale of UI_LOCALES) {
        const directory = path.join(output, `${locale}.lproj`);
        if (
          fs.existsSync(directory) &&
          (fs.lstatSync(directory).isSymbolicLink() ||
            fs.readdirSync(directory).some((name) => name !== "Localizable.strings"))
        )
          fail("INVALID_NATIVE_RESOURCE_CONTENTS");
        const text = nativeResourceText(catalogs.get(locale));
        fs.mkdirSync(directory, { recursive: true });
        const file = path.join(directory, "Localizable.strings");
        if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
          fail("INVALID_NATIVE_RESOURCE_OUTPUT_SYMLINK");
        fs.writeFileSync(file, text);
        if (fs.readFileSync(file, "utf8") !== text) fail("INVALID_GENERATED_NATIVE_RESOURCE");
      }
    }
  }
  process.stdout.write("Localization resources verified (31 locales).\n");
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "LOCALIZATION_VALIDATION_FAILED"}\n`,
  );
  process.exitCode = 1;
}
