import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAY_POSITION,
  DEFAULT_SUBTITLE_MARGIN_X,
  DEFAULT_SUBTITLE_MARGIN_Y,
  isOverlayPosition,
  normalizeOverlayRegion,
} from "../../src/domain/overlay-position.js";

describe("overlay position domain", () => {
  it("accepts every integer from 0 through 100 and rejects everything else", () => {
    expect(Array.from({ length: 101 }, (_, value) => isOverlayPosition(value))).toEqual(
      Array(101).fill(true),
    );
    for (const value of [-1, 101, 0.5, "0", Number.NaN, Infinity, null]) {
      expect(isOverlayPosition(value)).toBe(false);
    }
    expect(DEFAULT_OVERLAY_POSITION).toBe(0);
  });

  it("normalizes video geometry, fullscreen margins and subtitle margin fallbacks", () => {
    const dimensions = { h: 800, mt: 100, mb: 100 };
    expect(
      normalizeOverlayRegion({
        dimensions,
        fullscreen: false,
        useMargins: true,
        marginX: 24,
        marginY: 32,
      }),
    ).toEqual({ top: 0.125, bottom: 0.875, marginX: 24, marginY: 32 });
    expect(
      normalizeOverlayRegion({
        dimensions,
        fullscreen: true,
        useMargins: true,
        marginX: -1,
        marginY: NaN,
      }),
    ).toEqual({
      top: 0,
      bottom: 1,
      marginX: DEFAULT_SUBTITLE_MARGIN_X,
      marginY: DEFAULT_SUBTITLE_MARGIN_Y,
    });
    expect(
      normalizeOverlayRegion({
        dimensions,
        fullscreen: true,
        useMargins: false,
        marginX: 16,
        marginY: 16,
      }),
    ).toMatchObject({ top: 0.125, bottom: 0.875 });
  });

  it("falls back to the full viewport for missing or invalid geometry", () => {
    for (const dimensions of [
      undefined,
      { h: 0, mt: 0, mb: 0 },
      { h: 100, mt: 60, mb: 40 },
      { h: 100, mt: -1, mb: 0 },
      { h: Infinity, mt: 0, mb: 0 },
    ]) {
      expect(normalizeOverlayRegion({ dimensions, fullscreen: false, useMargins: false })).toEqual({
        top: 0,
        bottom: 1,
        marginX: 25,
        marginY: 22,
      });
    }
  });

  it("adds the current native subtitle margin offset and rejects invalid offsets", () => {
    expect(
      normalizeOverlayRegion({
        fullscreen: false,
        useMargins: false,
        marginX: 25,
        marginY: 22,
        marginYOffset: 8,
      }),
    ).toMatchObject({ marginX: 25, marginY: 30 });
    expect(
      normalizeOverlayRegion({
        fullscreen: false,
        useMargins: false,
        marginY: 22,
        marginYOffset: -1,
      }),
    ).toMatchObject({ marginY: 22 });
  });

  it("maps video bars and makes the no-bar margin modes equivalent", () => {
    const barred = { h: 1000, mt: 125, mb: 125 };
    expect(
      normalizeOverlayRegion({
        dimensions: barred,
        fullscreen: false,
        useMargins: true,
      }),
    ).toMatchObject({ top: 0.125, bottom: 0.875 });
    expect(
      normalizeOverlayRegion({
        dimensions: barred,
        fullscreen: true,
        useMargins: true,
      }),
    ).toMatchObject({ top: 0, bottom: 1 });
    const withoutBars = { h: 1000, mt: 0, mb: 0 };
    const included = normalizeOverlayRegion({
      dimensions: withoutBars,
      fullscreen: true,
      useMargins: true,
    });
    const excluded = normalizeOverlayRegion({
      dimensions: withoutBars,
      fullscreen: true,
      useMargins: false,
    });
    expect(included).toEqual(excluded);
  });
});
