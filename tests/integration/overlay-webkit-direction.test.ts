import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import { getTargetLanguageDirection } from "../../src/domain/target-languages.js";
import { WebViewTranslationOverlay } from "../../src/adapters/iina/webview-translation-overlay.js";
import { FakeIinaEvent, FakeIinaOverlay } from "../helpers/fake-iina.js";

const samples = {
  ar: "مرحبا (123).",
  dv: "މަރުޙަބާ (123).",
  fa: "سلام (123).",
  he: "שלום (123).",
  ps: "سلام (123).",
  sd: "سلام (123).",
  ug: "ياخشى (123).",
  ur: "سلام (123).",
  yi: "שלום (123).",
  en: "Hello (123).",
  "zh-Hans": "你好 (123).",
};
interface ProbeResult {
  id: string;
  direction: string;
  lines: Array<{
    text: string;
    first: number;
    period: number;
    digits: number[];
    open: number;
    close: number;
    top: number;
  }>;
  hidden: boolean;
}
let root: string;
let results: ProbeResult[];
beforeAll(() => {
  if (process.platform !== "darwin")
    throw new Error("Overlay WKWebView verification requires macOS.");
  root = mkdtempSync(resolve(realpathSync(tmpdir()), "subtandem-overlay-direction-"));
  const app = resolve(root, "OverlayProbe.app", "Contents");
  const resources = resolve(app, "Resources");
  mkdirSync(resolve(app, "MacOS"), { recursive: true });
  mkdirSync(resources);
  writeFileSync(
    resolve(app, "Info.plist"),
    `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>io.subtandem.overlay-probe</string><key>CFBundleName</key><string>OverlayProbe</string><key>CFBundleExecutable</key><string>overlay-probe</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`,
  );
  for (const name of ["overlay-state", "overlay"]) {
    writeFileSync(
      resolve(resources, `${name}.js`),
      ts.transpileModule(readFileSync(resolve("ui", `${name}.ts`), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText,
    );
  }
  writeFileSync(resolve(resources, "overlay.css"), readFileSync(resolve("ui/overlay.css")));
  writeFileSync(
    resolve(resources, "bridge.js"),
    `window.probeMessages = {}; window.iina = { onMessage: (name, callback) => window.probeMessages[name] = callback, postMessage: () => {} };`,
  );
  const host = new FakeIinaOverlay();
  const event = new FakeIinaEvent();
  const overlay = new WebViewTranslationOverlay(host, event);
  event.trigger("iina.plugin-overlay-loaded");
  host.trigger("overlay:ready");
  const frames = Object.entries(samples).map(([id, sample]) => {
    overlay.show([sample, `Alice: ${sample}`], getTargetLanguageDirection(id));
    return { id, data: host.messages.at(-1)!.data };
  });
  writeFileSync(
    resolve(resources, "runner.js"),
    `
(async () => {
  await document.fonts.ready;
  const results = [];
  const element = document.querySelector("#translation-text");
  for (const frame of ${JSON.stringify(frames)}) {
    window.probeMessages["overlay:render"](frame.data);
    const lines = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => {
      const center = (index) => {
        const range = document.createRange();
        range.setStart(node, index); range.setEnd(node, index + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, top: rect.top };
      };
      const number = node.textContent.indexOf("123");
      return { text: node.textContent, first: center(0).x, period: center(node.length - 1).x,
        digits: [0, 1, 2].map(offset => center(number + offset).x),
        open: center(node.textContent.indexOf("(")).x, close: center(node.textContent.indexOf(")")).x, top: center(0).top };
    });
    results.push({ id: frame.id, direction: getComputedStyle(element).direction, lines });
  }
  window.probeMessages["overlay:clear"]({ renderRevision: ${frames.length + 1} });
  results.push({ id: "clear", hidden: document.querySelector("#translation").hidden, lines: [] });
  window.webkit.messageHandlers.result.postMessage(results);
})();`,
  );
  const html = readFileSync(resolve("ui/overlay.html"), "utf8")
    .replace("</head>", '<script src="./bridge.js"></script></head>')
    .replaceAll('.ts"', '.js"')
    .replace("</body>", '<script src="./runner.js"></script></body>');
  writeFileSync(resolve(resources, "overlay.html"), html);
  const executable = resolve(app, "MacOS", "overlay-probe");
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
      env: { ...process.env, DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer" },
      timeout: 60000,
    },
  );
  execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", resolve(root, "OverlayProbe.app")], {
    timeout: 30000,
  });
  results = JSON.parse(
    execFileSync(executable, [resolve(resources, "overlay.html"), "1280", "720"], {
      encoding: "utf8",
      timeout: 50000,
    }),
  ) as ProbeResult[];
  mkdirSync(resolve("build"), { recursive: true });
  writeFileSync(
    resolve("build/overlay-direction-results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
}, 120000);
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});
describe("actual WebKit Overlay punctuation and number ordering", () => {
  it.each(Object.entries(samples))(
    "renders %s punctuation with the target base direction",
    (id, sample) => {
      const result = results.find((entry) => entry.id === id)!;
      const direction = getTargetLanguageDirection(id);
      expect(result.direction).toBe(direction);
      expect(result.lines.map((line) => line.text)).toEqual([sample, `Alice: ${sample}`]);
      expect(result.lines[1]!.top).toBeGreaterThan(result.lines[0]!.top);
      for (const line of result.lines) {
        if (direction === "rtl") {
          expect(line.period).toBeLessThan(line.first);
          expect(line.open).toBeGreaterThan(line.digits[2]!);
          expect(line.close).toBeLessThan(line.digits[0]!);
        } else {
          expect(line.period).toBeGreaterThan(line.first);
          expect(line.open).toBeLessThan(line.digits[0]!);
          expect(line.close).toBeGreaterThan(line.digits[2]!);
        }
        expect(line.digits[0]).toBeLessThan(line.digits[1]!);
        expect(line.digits[1]).toBeLessThan(line.digits[2]!);
      }
    },
  );
  it("clears the rendered candidate", () => {
    expect(results.find((entry) => entry.id === "clear")?.hidden).toBe(true);
  });
});
