import { describe, expect, it } from "vitest";
import { WebViewTranslationOverlay } from "../../src/adapters/iina/webview-translation-overlay.js";
import { FakeIinaEvent, FakeIinaOverlay } from "../helpers/fake-iina.js";

function createOverlay(host = new FakeIinaOverlay(), event = new FakeIinaEvent()) {
  const reports: string[] = [];
  const overlay = new WebViewTranslationOverlay(host, event, (message) => reports.push(message));
  return { event, host, overlay, reports };
}

describe("Overlay WebView lifecycle", () => {
  it("keeps one latest frame until ready and then sends only that frame", () => {
    const { event, host, overlay, reports } = createOverlay();
    expect(host.simpleModeCount).toBe(1);
    expect(host.loadedFiles).toEqual([]);
    overlay.show(["old"]);
    overlay.show(["current"]);
    expect(host.messages).toEqual([]);
    expect(host.showCount).toBe(0);
    event.trigger("iina.plugin-overlay-loaded");
    expect(host.loadedFiles).toEqual(["dist/ui/overlay.html"]);
    expect(host.messages).toEqual([{ name: "overlay:initialize", data: {} }]);
    host.trigger("overlay:ready");
    expect(host.showCount).toBe(1);
    expect(host.messages).toHaveLength(2);
    expect(host.messages[1]).toMatchObject({
      name: "overlay:render",
      data: { lines: ["current"] },
    });
    expect(reports).toEqual([
      "Translation overlay WebView warmup started.",
      "Translation overlay WebView warmup completed.",
      "Translation overlay WebView ready.",
    ]);
  });

  it("recovers when the page's first ready message arrives before the host listener", () => {
    const { event, host, overlay } = createOverlay();
    overlay.show(["current"]);

    host.trigger("overlay:ready");
    event.trigger("iina.plugin-overlay-loaded");
    expect(host.messages).toEqual([{ name: "overlay:initialize", data: {} }]);

    host.trigger("overlay:ready");
    expect(host.showCount).toBe(1);
    expect(host.messages.at(-1)).toMatchObject({
      name: "overlay:render",
      data: { lines: ["current"] },
    });
  });

  it("keeps render, layout and clear revisions latest-only", () => {
    const { event, host, overlay } = createOverlay();
    event.trigger("iina.plugin-overlay-loaded");
    host.trigger("overlay:ready");
    overlay.show(["current"]);
    overlay.setPosition(50);
    overlay.clear();
    const renderingMessages = host.messages.filter(
      (message) => message.name !== "overlay:initialize",
    );
    expect(renderingMessages.map((message) => message.name)).toEqual([
      "overlay:clear",
      "overlay:render",
      "overlay:layout",
      "overlay:clear",
    ]);
    const revisions = renderingMessages.map(
      (message) => (message.data as { renderRevision: number }).renderRevision,
    );
    expect(revisions).toEqual([...revisions].sort((left, right) => left - right));
  });

  it("does not render empty text and isolates load or show failures", () => {
    const failedLoad = new FakeIinaOverlay();
    failedLoad.failLoad = true;
    const failedLoadLifecycle = createOverlay(failedLoad);
    expect(() => failedLoadLifecycle.event.trigger("iina.plugin-overlay-loaded")).not.toThrow();
    expect(failedLoadLifecycle.reports.at(-1)).toBe(
      "Translation overlay WebView initialization failed.",
    );
    const failedShow = new FakeIinaOverlay();
    failedShow.failShow = true;
    const failedShowLifecycle = createOverlay(failedShow);
    failedShowLifecycle.event.trigger("iina.plugin-overlay-loaded");
    const overlayWithFailedShow = failedShowLifecycle.overlay;
    expect(() => failedShow.trigger("overlay:ready")).not.toThrow();
    overlayWithFailedShow.show(["current"]);
    expect(failedShow.messages).toEqual([{ name: "overlay:initialize", data: {} }]);

    const { event, host, overlay } = createOverlay();
    event.trigger("iina.plugin-overlay-loaded");
    host.trigger("overlay:ready");
    overlay.show([" ", ""]);
    expect(host.messages.at(-1)?.name).toBe("overlay:clear");
  });

  it("does not show or replay a frame when ready arrives after close", () => {
    const { event, host, overlay } = createOverlay();
    overlay.show(["current"]);
    overlay.close();
    event.trigger("iina.plugin-overlay-loaded");
    host.trigger("overlay:ready");
    expect(host.showCount).toBe(0);
    expect(host.messages).toEqual([]);
    expect(host.loadedFiles).toEqual([]);
  });
});
