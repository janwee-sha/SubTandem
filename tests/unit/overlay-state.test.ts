import { beforeAll, describe, expect, it } from "vitest";

beforeAll(async () => {
  await import("../../ui/overlay-state.js");
});

const region = { top: 0, bottom: 1, marginX: 16, marginY: 16 };
const style = {
  fontColor: { r: 255, g: 255, b: 255, a: 255 },
  fontSize: 40,
  fontFamily: null,
  bold: false,
  italic: false,
  borderColor: { r: 0, g: 0, b: 0, a: 255 },
  borderWidth: 3,
  backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
};

describe("Overlay DOM layout state", () => {
  it("scales the fixed typography from the 720p visual baseline", () => {
    expect(globalThis.calculateSubTandemOverlayTypography(360, style)).toEqual({
      fontSize: 14.5,
      fontWeight: 400,
      strokeWidth: 1,
      fontStyle: "normal",
      fontFamily: null,
      fontColor: "rgba(255, 255, 255, 1)",
      borderColor: "rgba(0, 0, 0, 1)",
      backgroundColor: "rgba(0, 0, 0, 0)",
    });
    expect(globalThis.calculateSubTandemOverlayTypography(720, style)).toEqual({
      fontSize: 29,
      fontWeight: 400,
      strokeWidth: 2,
      fontStyle: "normal",
      fontFamily: null,
      fontColor: "rgba(255, 255, 255, 1)",
      borderColor: "rgba(0, 0, 0, 1)",
      backgroundColor: "rgba(0, 0, 0, 0)",
    });
    expect(globalThis.calculateSubTandemOverlayTypography(1080, style)).toEqual({
      fontSize: 43.5,
      fontWeight: 400,
      strokeWidth: 3,
      fontStyle: "normal",
      fontFamily: null,
      fontColor: "rgba(255, 255, 255, 1)",
      borderColor: "rgba(0, 0, 0, 1)",
      backgroundColor: "rgba(0, 0, 0, 0)",
    });
    expect(() => globalThis.calculateSubTandemOverlayTypography(0, style)).toThrow(
      "INVALID_OVERLAY_TYPOGRAPHY",
    );
  });

  it("maps all nine Size choices, RGBA, font family and traits", () => {
    for (const fontSize of [30, 35, 40, 45, 50, 55, 60, 65, 70]) {
      expect(
        globalThis.calculateSubTandemOverlayTypography(720, { ...style, fontSize }).fontSize,
      ).toBe(fontSize * (29 / 40));
    }
    expect(
      globalThis.calculateSubTandemOverlayTypography(720, {
        ...style,
        fontColor: { r: 1, g: 2, b: 3, a: 4 },
        fontFamily: "Avenir Next",
        bold: true,
        italic: true,
      }),
    ).toMatchObject({
      fontWeight: 700,
      fontStyle: "italic",
      fontFamily: "Avenir Next",
      fontColor: "rgba(1, 2, 3, 0.01568627450980392)",
    });
  });

  it("maps all ten Width choices and all three RGBA fields", () => {
    for (const borderWidth of [0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5]) {
      const typography = globalThis.calculateSubTandemOverlayTypography(720, {
        ...style,
        borderWidth,
      });
      expect(typography.strokeWidth).toBe(borderWidth * (2 / 3));
      expect(typography.borderColor).toBe(borderWidth === 0 ? "transparent" : "rgba(0, 0, 0, 1)");
    }
    expect(
      globalThis.calculateSubTandemOverlayTypography(720, {
        ...style,
        fontColor: { r: 1, g: 2, b: 3, a: 64 },
        borderColor: { r: 4, g: 5, b: 6, a: 128 },
        backgroundColor: { r: 7, g: 8, b: 9, a: 192 },
      }),
    ).toMatchObject({
      fontColor: "rgba(1, 2, 3, 0.25098039215686274)",
      borderColor: "rgba(4, 5, 6, 0.5019607843137255)",
      backgroundColor: "rgba(7, 8, 9, 0.7529411764705882)",
    });
  });

  it("anchors a stroke-padded painted block inside the bottom endpoint", () => {
    const strokeWidth = globalThis.calculateSubTandemOverlayTypography(720, {
      ...style,
      borderWidth: 5,
    }).strokeWidth;
    const measuredBlockHeight = 80 + strokeWidth * 2;
    const bottom = globalThis.calculateSubTandemOverlayLayout({
      viewportHeight: 720,
      blockHeight: measuredBlockHeight,
      position: 100,
      region,
    });
    expect(bottom.topOffset + measuredBlockHeight).toBe(bottom.safeBottom);
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
      state.applyRender({
        renderRevision: 1,
        lines: ["first", "second"],
        position: 50,
        region,
        style,
      }),
    ).toBe(true);
    expect(state.layout(720, 80)?.changed).toBe(true);
    expect(state.layout(720, 80)?.changed).toBe(false);
    expect(state.layout(1080, 120)?.changed).toBe(true);
    expect(
      state.applyLayout({
        renderRevision: 2,
        position: 50,
        region: { ...region, top: 0.1, bottom: 0.9 },
        style: { ...style, fontSize: 50 },
      }),
    ).toBe(true);
    expect(state.layout(1080, 120)?.changed).toBe(true);
  });

  it("never revives cleared text from stale render, layout or resize", () => {
    const state = globalThis.createSubTandemOverlayState();
    state.applyRender({ renderRevision: 4, lines: ["current"], position: 50, region, style });
    expect(state.clear({ renderRevision: 5 })).toBe(true);
    expect(
      state.applyRender({ renderRevision: 4, lines: ["stale"], position: 75, region, style }),
    ).toBe(false);
    expect(
      state.applyRender({ renderRevision: 5, lines: ["equal"], position: 75, region, style }),
    ).toBe(false);
    expect(state.applyLayout({ renderRevision: 4, position: 75, region, style })).toBe(false);
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
        style,
        unexpected: true,
      }),
    ).toBe(false);
    expect(
      state.applyLayout({
        renderRevision: 1,
        position: 50,
        region: { ...region, unexpected: true },
        style,
      }),
    ).toBe(false);
    expect(state.clear({ renderRevision: 1, unexpected: true })).toBe(false);
  });
});
