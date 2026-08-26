import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootFile = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("translation overlay WebView contract", () => {
  it("uses tracked local classic-script assets and a network-denying CSP", () => {
    const html = rootFile("ui/overlay.html");
    const packageJson = JSON.parse(rootFile("package.json")) as {
      targets?: { overlay?: { source?: string; publicUrl?: string; distDir?: string } };
    };
    expect(packageJson.targets?.overlay).toMatchObject({
      source: "ui/overlay.html",
      publicUrl: "./",
      distDir: "dist/ui",
    });
    expect(html).toContain("content=\"default-src 'self'; connect-src 'none'; img-src 'none'");
    expect(html).toContain('<script src="./overlay-state.ts"></script>');
    expect(html).toContain('<script src="./overlay.ts"></script>');
    expect(html).not.toContain('type="module"');
    expect(html).not.toContain("data-clickable");
  });

  it("renders with text nodes and has no network, storage or input APIs", () => {
    const source = rootFile("ui/overlay.ts");
    expect(source).toContain("document.createTextNode");
    expect(source).toContain("calculateSubTandemOverlayTypography(window.innerHeight)");
    expect(source).toContain("translation.style.fontSize");
    expect(source).toContain("translation.style.fontWeight");
    expect(source).toContain("translation.style.webkitTextStrokeWidth");
    expect(source).not.toMatch(/innerHTML|fetch\(|XMLHttpRequest|WebSocket|EventSource/);
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\./i);
    expect(source).not.toMatch(/addEventListener\(["'](?:pointer|mouse|touch|key)/);
  });

  it("uses a 720p-safe fallback without unsupported CSS arithmetic", () => {
    const css = rootFile("ui/overlay.css");
    expect(css).toContain("font-size: 29px");
    expect(css).toContain("font-weight: 400");
    expect(css).toContain("-webkit-text-stroke: 2px #000");
    expect(css).not.toMatch(/calc\([^)]*[*/][^)]*\)/);
  });

  it("forces the host overlay to remain non-interactive", () => {
    const adapter = rootFile("src/adapters/iina/webview-translation-overlay.ts");
    expect(adapter).toContain("setClickable(false)");
    expect(adapter).toContain('loadFile("dist/ui/overlay.html")');
  });
});
