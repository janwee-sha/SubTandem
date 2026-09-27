import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sidebarHarness } from "../helpers/sidebar-harness.js";

const html = readFileSync(new URL("../../ui/sidebar.html", import.meta.url), "utf8");

describe("Session source summary", () => {
  it("keeps labels and values adjacent in Format, Translated cues, Total cues order", () => {
    const summary = html.match(/<dl id="source-summary"[\s\S]*?<\/dl>/)?.[0] ?? "";
    expect(summary).toMatch(/<dt>Format<\/dt>\s*<dd id="source-format">/);
    expect(summary).toMatch(/<dt>Translated cues<\/dt>\s*<dd id="cache-size">/);
    expect(summary).toMatch(/<dt>Total cues<\/dt>\s*<dd id="source-cues">/);
    expect(summary).not.toContain("Session cache");
  });

  it("shows current source and 0, partial, then full translated counts without extra preparation", () => {
    const h = sidebarHarness();
    const sent = h.messages.length;
    for (const cacheSize of [0, 3, 8]) {
      h.receive("state:update", {
        status: "running",
        source: { format: "ssa", cueCount: 8 },
        sourcePreparation: { state: "ready" },
        cacheSize,
      });
      expect(h.element("#source-summary").hidden).toBe(false);
      expect(h.element("#source-format").textContent).toBe("SSA (SubStation Alpha)");
      expect(h.element("#cache-size").textContent).toBe(String(cacheSize));
      expect(h.element("#source-cues").textContent).toBe("8");
    }
    h.receive("state:update", {
      status: "running",
      source: { format: "ssa", cueCount: 8 },
      sourcePreparation: { state: "ready" },
      cacheSize: 0,
    });
    expect(h.element("#cache-size").textContent).toBe("0");
    expect(h.messages.slice(sent).some((message) => message.name.includes("subtitle"))).toBe(false);
  });

  it("clears old values on source changes, invalid counts, preparation failure and Translate off", () => {
    const h = sidebarHarness();
    h.receive("state:update", {
      status: "running",
      source: { format: "ass", cueCount: 8 },
      cacheSize: 8,
    });
    h.receive("state:update", {
      status: "running",
      source: { format: "subrip", cueCount: 12 },
      cacheSize: 0,
    });
    expect(h.element("#source-format").textContent).toBe("SRT (SubRip)");
    expect(h.element("#cache-size").textContent).toBe("0");
    expect(h.element("#source-cues").textContent).toBe("12");
    h.receive("state:update", {
      status: "running",
      source: { format: "mystery", cueCount: -1 },
      cacheSize: Number.NaN,
    });
    expect(h.element("#source-format").textContent).toBe("Unknown subtitle format");
    expect(h.element("#cache-size").textContent).toBe("—");
    expect(h.element("#source-cues").textContent).toBe("—");
    h.receive("state:update", { status: "preparing", source: null, cacheSize: 0 });
    expect(h.element("#source-summary").hidden).toBe(true);
    expect(h.element("#source-format").textContent).toBe("");
    expect(h.element("#cache-size").textContent).toBe("");
    expect(h.element("#source-cues").textContent).toBe("");
    h.receive("state:update", {
      status: "running",
      source: { format: "ass", cueCount: 8 },
      sourcePreparation: { state: "failed" },
      cacheSize: 8,
    });
    expect(h.element("#source-summary").hidden).toBe(true);
    h.receive("state:update", {
      status: "disabled",
      source: { format: "ass", cueCount: 8 },
      cacheSize: 8,
    });
    expect(h.element("#source-summary").hidden).toBe(true);
  });
});
