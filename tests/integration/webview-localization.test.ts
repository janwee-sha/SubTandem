import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { Parcel } from "@parcel/core";
import { UI_LOCALES } from "../../shared/localization/locales.js";
import { LOCALE_CATALOGS } from "../../ui/localization.js";
import type { CardinalCategory } from "../../shared/localization/types.js";

interface ProbeResult {
  locale: (typeof UI_LOCALES)[number];
  status: string;
  capabilities: Record<string, boolean>;
  effectiveLocale: string;
  colorsLocale: string;
  ordered: boolean;
  categories: CardinalCategory[];
  options: Array<{ id: string; displayName: string; label: string }>;
  colors: Array<{ id: string; displayName: string; label: string }>;
  quantities: Array<{ count: number; category: CardinalCategory; number: string; text: string }>;
  plain: string;
  technical: string;
  user: string;
}
let root: string;
let results: ProbeResult[];
beforeAll(async () => {
  if (process.platform !== "darwin")
    throw new Error("WKWebView verification requires macOS; it has not run on this platform.");
  root = mkdtempSync(resolve(realpathSync(tmpdir()), "subtandem-webview-localization-"));
  const app = resolve(root, "LocalizationProbe.app", "Contents");
  mkdirSync(resolve(app, "MacOS"), { recursive: true });
  writeFileSync(
    resolve(app, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>io.subtandem.localization-probe</string><key>CFBundleName</key><string>LocalizationProbe</string><key>CFBundleExecutable</key><string>localization-probe</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`,
  );
  const bundler = new Parcel({
    entries: resolve("tests/fixtures/localization/webview-probe.html"),
    defaultConfig: resolve("node_modules/@parcel/config-default/index.json"),
    targets: {
      probe: {
        context: "browser",
        distDir: resolve(app, "Resources"),
        publicUrl: "./",
        outputFormat: "global",
        engines: { browsers: ["Safari >= 15"] },
        sourceMap: false,
        optimize: false,
      },
    },
    defaultTargetOptions: { shouldOptimize: false, shouldScopeHoist: false, sourceMaps: false },
    shouldDisableCache: true,
  });
  await bundler.run();
  const html = resolve(app, "Resources", "webview-probe.html");
  writeFileSync(html, readFileSync(html, "utf8").replace(/<script type="module"/g, "<script"));
  const executable = resolve(app, "MacOS", "localization-probe");
  execFileSync(
    "/usr/bin/xcrun",
    [
      "swiftc",
      "tests/helpers/webview-localization-probe.swift",
      "-module-cache-path",
      resolve(root, "module-cache"),
      "-o",
      executable,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer" },
      timeout: 60000,
    },
  );
  execFileSync(
    "/usr/bin/codesign",
    ["--force", "--sign", "-", resolve(root, "LocalizationProbe.app")],
    { timeout: 30000 },
  );
  const output = execFileSync(executable, [resolve(app, "Resources", "webview-probe.html")], {
    encoding: "utf8",
    timeout: 50000,
  });
  results = JSON.parse(output) as ProbeResult[];
  writeFileSync(
    resolve("build", "webview-localization-results.json"),
    JSON.stringify({ platform: process.platform, results }, null, 2) + "\n",
  );
}, 120000);
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});
describe("actual WKWebView production localization", () => {
  it.each(UI_LOCALES)("supports normal formatter and directories in %s", (locale) => {
    const result = results.find((entry) => entry.locale === locale)!;
    expect(result.status).toBe("ran");
    expect(result.capabilities).toEqual({ Collator: true, PluralRules: true, NumberFormat: true });
    expect(result.effectiveLocale).toBe(locale);
    expect(result.colorsLocale).toBe(locale);
    expect(result.ordered).toBe(true);
    expect(result.options).toHaveLength(156);
    expect(result.colors).toHaveLength(10);
    expect(new Set(result.options.map(({ id }) => id)).size).toBe(156);
    const catalog = LOCALE_CATALOGS[locale];
    expect(result.plain).toBe(catalog.messages["sidebar.newProfile"]);
    for (const option of result.options)
      expect(option.displayName).toBe(catalog.targetLanguageNames[option.id]);
    for (const option of result.colors)
      expect(option.displayName).toBe(catalog.namedColorNames[option.id]);
    expect(result.categories.sort()).toEqual(
      Object.keys(catalog.messages["models.available"]!).sort(),
    );
    for (const quantity of result.quantities) {
      const template = catalog.messages["models.available"] as Partial<
        Record<CardinalCategory, string>
      >;
      expect(quantity.text).toBe(template[quantity.category]!.replace("{count}", quantity.number));
    }
    expect(result.technical).toBe(
      (catalog.messages["endpoint.request"] as string).replace(
        "{url}",
        "\u2066https://example.invalid/mixed\u2069",
      ),
    );
    expect(result.user).toBe(
      (catalog.messages["profile.deleteTitle"] as string).replace(
        "{name}",
        "\u2068User Ω <strong>\u2069",
      ),
    );
  });
});
