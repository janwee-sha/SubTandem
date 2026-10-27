import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OverlayPositionPreferences } from "../../src/runtime/adapters/iina/overlay-position-preferences.js";
import { FakeIinaPreferences } from "../helpers/fake-iina.js";

const rootFile = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("overlay position privacy and input boundaries", () => {
  it("persists only the integer and never subtitle or translation text", () => {
    const store = new FakeIinaPreferences();
    new OverlayPositionPreferences(store).save(42);
    expect(store.writes).toEqual([{ key: "translationOverlayPosition", value: 42 }]);
    expect(JSON.stringify(store.writes)).not.toMatch(/subtitle|translation text|current line/i);
  });

  it("keeps Global position messages free of text, media and provider fields", () => {
    const globalSource = rootFile("src/runtime/global.ts");
    const start = globalSource.indexOf('globalMailbox.onMessage("overlay-position:get"');
    const end = globalSource.indexOf('globalMailbox.onMessage("subtitle-style:get"', start);
    const positionHandlers = globalSource.slice(start, end);
    expect(positionHandlers).not.toMatch(/lines|subtitle|media|provider|credential|console\./i);
    expect(positionHandlers).toContain('postToPlayer(null, "overlay-position:state"');
  });

  it("uses no storage, network, subtitle-track, translated-file or input-listener path", () => {
    const overlaySource = [
      rootFile("src/ui/overlay.ts"),
      rootFile("src/ui/overlay-state.ts"),
      rootFile("src/runtime/adapters/iina/webview-translation-overlay.ts"),
    ].join("\n");
    expect(overlaySource).not.toMatch(
      /localStorage|sessionStorage|indexedDB|CacheStorage|fetch\(|XMLHttpRequest|WebSocket|EventSource/,
    );
    expect(overlaySource).not.toMatch(/sub-add|sub-remove|secondary-sid|\.srt|\.ass/);
    expect(overlaySource).not.toMatch(/addEventListener\(["'](?:pointer|mouse|touch|key)/);
    expect(rootFile("src/ui/overlay.html")).not.toContain("data-clickable");
  });
});
