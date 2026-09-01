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
    expect(source).toContain('window.iina?.onMessage("overlay:initialize"');
    expect(source).toContain('window.iina?.postMessage("overlay:ready", {})');
    expect(source).toContain("document.documentElement.clientHeight || window.innerHeight");
    expect(source).toContain("calculateSubTandemOverlayTypography(viewportHeight, frame.style)");
    expect(source).toContain("translationText.style.fontSize");
    expect(source).toContain("translationText.style.fontWeight");
    expect(source).toContain("translationText.style.webkitTextStrokeWidth");
    expect(source).not.toMatch(/innerHTML|fetch\(|XMLHttpRequest|WebSocket|EventSource/);
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\./i);
    expect(source).not.toMatch(/addEventListener\(["'](?:pointer|mouse|touch|key)/);
  });

  it("uses a transparent positioner and shrink-wrapped text block without fixed shadow", () => {
    const html = rootFile("ui/overlay.html");
    const css = rootFile("ui/overlay.css");
    expect(html).toMatch(
      /<div id="translation"[^>]*hidden>[\s\S]*?<span id="translation-text"><\/span>[\s\S]*?<\/div>/,
    );
    expect(css).toContain("#translation-text");
    expect(css).toContain("display: inline-block");
    expect(css).toContain("max-width: 100%");
    expect(css).toContain("font-size: 29px");
    expect(css).toContain("font-weight: 400");
    expect(css).toContain("-webkit-text-stroke: 2px #000");
    expect(css).toContain("text-shadow: none");
    expect(css).not.toContain("0 0 2px");
    expect(css).not.toMatch(/calc\([^)]*[*/][^)]*\)/);
  });

  it("applies stroke and alpha background only to the measured text block", () => {
    const css = rootFile("ui/overlay.css");
    const source = rootFile("ui/overlay.ts");
    const outerRule = css.match(/#translation\s*\{[\s\S]*?\n}/)?.[0] ?? "";
    const textRule = css.match(/#translation-text\s*\{[\s\S]*?\n}/)?.[0] ?? "";
    expect(outerRule).not.toContain("background:");
    expect(textRule).toContain("display: inline-block");
    expect(source).toContain("translationText.style.webkitTextStrokeWidth");
    expect(source).toContain("translationText.style.webkitTextStrokeColor");
    expect(source).toContain("translationText.style.padding");
    expect(source).toContain("translationText.style.backgroundColor");
    expect(source).toContain('translationText.style.textShadow = "none"');
  });

  it("uses style-bearing latest-only render/layout revisions and remeasures text", () => {
    const state = rootFile("ui/overlay-state.ts");
    const source = rootFile("ui/overlay.ts");
    const adapter = rootFile("src/adapters/iina/webview-translation-overlay.ts");
    expect(state).toContain("style: SubTandemOverlayTextStyle");
    expect(adapter).toContain("style: cloneSubtitleTextStyle(this.style)");
    expect(adapter).toContain("private renderRevision");
    expect(source).toContain("new ResizeObserver");
    expect(source).toContain("requestAnimationFrame");
    expect(source).toContain("const textBounds = translationText.getBoundingClientRect()");
    expect(source).toContain("const positionerBounds = translation.getBoundingClientRect()");
    expect(source).toContain("translationText.scrollHeight");
    expect(source).toContain("if (blockHeight === 0) return");
    expect(source).toContain("applyHorizontalBounds");
    expect(source).not.toContain("calculateSubTandemOverlayPaintMetrics");
    expect(source.indexOf("applyHorizontalBounds(viewportHeight);")).toBeLessThan(
      source.indexOf("const textBounds = translationText.getBoundingClientRect()"),
    );
    expect(source).not.toContain("placeholder");
  });

  it("anchors the measured text edge after compensating the positioner line box", () => {
    const source = rootFile("ui/overlay.ts");
    expect(source).toContain('translation.style.top = "auto"');
    expect(source).toContain(
      "const positionerBottomGap = positionerBounds.bottom - textBounds.bottom",
    );
    expect(source).toContain("viewportHeight - result.layout.bottomAnchor - positionerBottomGap");
    expect(source).not.toContain("translation.style.top = `${result.layout.topOffset}px`");
  });

  it("forces the host overlay to remain non-interactive", () => {
    const adapter = rootFile("src/adapters/iina/webview-translation-overlay.ts");
    expect(adapter).toContain("setClickable(false)");
    expect(adapter).toContain('loadFile("dist/ui/overlay.html")');
    expect(adapter).toContain('this.post("overlay:initialize", {})');
  });
});
