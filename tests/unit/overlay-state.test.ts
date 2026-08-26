import { beforeAll, describe, expect, it } from "vitest";

beforeAll(async () => {
  await import("../../ui/overlay-state.js");
});

const region = { top: 0, bottom: 1, marginX: 16, marginY: 16 };

describe("Overlay DOM layout state", () => {
  it("scales the fixed typography from the 720p visual baseline", () => {
    expect(globalThis.calculateSubTandemOverlayTypography(360)).toEqual({
      fontSize: 14.5,
      fontWeight: 400,
      strokeWidth: 1,
    });
    expect(globalThis.calculateSubTandemOverlayTypography(720)).toEqual({
      fontSize: 29,
      fontWeight: 400,
      strokeWidth: 2,
    });
    expect(globalThis.calculateSubTandemOverlayTypography(1080)).toEqual({
      fontSize: 43.5,
      fontWeight: 400,
      strokeWidth: 3,
    });
    expect(() => globalThis.calculateSubTandemOverlayTypography(0)).toThrow(
      "INVALID_OVERLAY_TYPOGRAPHY",
    );
  });

  it("matches IINA subtitle endpoints while anchoring and clamping the rendered block", () => {
    const top = globalThis.calculateSubTandemOverlayLayout({
      viewportHeight: 720,
      blockHeight: 80,
      position: 0,
      region,
    });
    const middle = globalThis.calculateSubTandemOverlayLayout({
      viewportHeight: 720,
      blockHeight: 80,
      position: 50,
      region,
    });
    const bottom = globalThis.calculateSubTandemOverlayLayout({
      viewportHeight: 720,
      blockHeight: 80,
      position: 100,
      region,
    });
    expect(top).toMatchObject({ safeTop: 0, topOffset: 0, bottomAnchor: 80, horizontalMargin: 16 });
    expect(middle.topOffset).toBeGreaterThanOrEqual(top.topOffset);
    expect(bottom).toMatchObject({ safeBottom: 704, topOffset: 624, bottomAnchor: 704 });
  });

  it("uses subtitle margin only at the bottom endpoint", () => {
    const top = globalThis.calculateSubTandemOverlayLayout({
      viewportHeight: 720,
      blockHeight: 80,
      position: 0,
      region: { ...region, marginY: 22 },
    });
    const bottom = globalThis.calculateSubTandemOverlayLayout({
      viewportHeight: 720,
      blockHeight: 80,
      position: 100,
      region: { ...region, marginY: 22 },
    });
    expect(top).toMatchObject({ safeTop: 0, topOffset: 0, bottomAnchor: 80 });
    expect(bottom).toMatchObject({ safeBottom: 698, topOffset: 618, bottomAnchor: 698 });
  });

  it("is monotonic for all 101 positions with multiline block heights", () => {
    const offsets = Array.from(
      { length: 101 },
      (_, position) =>
        globalThis.calculateSubTandemOverlayLayout({
          viewportHeight: 1080,
          blockHeight: 180,
          position,
          region: { top: 0.1, bottom: 0.9, marginX: 24, marginY: 20 },
        }).topOffset,
    );
    expect(offsets.every((offset, index) => index === 0 || offset >= offsets[index - 1]!)).toBe(
      true,
    );
  });

  it("keeps oversized output finite for visible-boundary clipping", () => {
    const layout = globalThis.calculateSubTandemOverlayLayout({
      viewportHeight: 300,
      blockHeight: 600,
      position: 100,
      region,
    });
    expect(Number.isFinite(layout.topOffset)).toBe(true);
    expect(layout.topOffset).toBeLessThan(0);
    expect(() =>
      globalThis.calculateSubTandemOverlayLayout({
        viewportHeight: Number.NaN,
        blockHeight: 20,
        position: 0,
        region,
      }),
    ).toThrow("INVALID_OVERLAY_LAYOUT");
  });

  it("reflows on viewport, region and block-height changes and deduplicates one signature", () => {
    const state = globalThis.createSubTandemOverlayState();
    expect(
      state.applyRender({ renderRevision: 1, lines: ["first", "second"], position: 50, region }),
    ).toBe(true);
    expect(state.layout(720, 80)?.changed).toBe(true);
    expect(state.layout(720, 80)?.changed).toBe(false);
    expect(state.layout(1080, 120)?.changed).toBe(true);
    expect(
      state.applyLayout({
        renderRevision: 2,
        position: 50,
        region: { ...region, top: 0.1, bottom: 0.9 },
      }),
    ).toBe(true);
    expect(state.layout(1080, 120)?.changed).toBe(true);
  });

  it("never revives cleared text from stale render, layout or resize", () => {
    const state = globalThis.createSubTandemOverlayState();
    state.applyRender({ renderRevision: 4, lines: ["current"], position: 50, region });
    expect(state.clear({ renderRevision: 5 })).toBe(true);
    expect(state.applyRender({ renderRevision: 4, lines: ["stale"], position: 75, region })).toBe(
      false,
    );
    expect(state.applyRender({ renderRevision: 5, lines: ["equal"], position: 75, region })).toBe(
      false,
    );
    expect(state.applyLayout({ renderRevision: 4, position: 75, region })).toBe(false);
    expect(state.layout(720, 80)).toBeNull();
    expect(state.snapshot.frame).toBeNull();
  });

  it("rejects unknown message and region fields", () => {
    const state = globalThis.createSubTandemOverlayState();
    expect(
      state.applyRender({
        renderRevision: 1,
        lines: ["text"],
        position: 50,
        region,
        unexpected: true,
      }),
    ).toBe(false);
    expect(
      state.applyLayout({
        renderRevision: 1,
        position: 50,
        region: { ...region, unexpected: true },
      }),
    ).toBe(false);
    expect(state.clear({ renderRevision: 1, unexpected: true })).toBe(false);
  });
});
