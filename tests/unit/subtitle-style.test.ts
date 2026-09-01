import { describe, expect, it } from "vitest";
import {
  BORDER_WIDTH_OPTIONS,
  DEFAULT_SUBTITLE_TEXT_STYLE,
  FONT_SIZE_OPTIONS,
  isRgbaColor,
  isSubtitleTextStyle,
  normalizeSubtitleTextStyle,
  renderBorderWidth,
  renderFontSize,
  resolveEffectiveFontFamily,
} from "../../src/domain/subtitle-style.js";

describe("subtitle text style domain", () => {
  it("defines the eight-field upgrade-safe default", () => {
    expect(DEFAULT_SUBTITLE_TEXT_STYLE).toEqual({
      fontColor: { r: 255, g: 255, b: 255, a: 255 },
      fontSize: 40,
      fontFamily: null,
      bold: false,
      italic: false,
      borderColor: { r: 0, g: 0, b: 0, a: 255 },
      borderWidth: 3,
      backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
    });
    expect(Object.keys(DEFAULT_SUBTITLE_TEXT_STYLE)).toHaveLength(8);
  });

  it("accepts only exact integer sRGB RGBA objects", () => {
    expect(isRgbaColor({ r: 0, g: 127, b: 255, a: 64 })).toBe(true);
    for (const value of [
      { r: 0, g: 0, b: 0 },
      { r: 0, g: 0, b: 0, a: 0, text: "forbidden" },
      { r: -1, g: 0, b: 0, a: 0 },
      { r: 256, g: 0, b: 0, a: 0 },
      { r: 1.5, g: 0, b: 0, a: 0 },
      null,
    ]) {
      expect(isRgbaColor(value)).toBe(false);
    }
  });

  it("exposes only the finite Size and Width choices and preserves baseline anchors", () => {
    expect(FONT_SIZE_OPTIONS).toEqual([30, 35, 40, 45, 50, 55, 60, 65, 70]);
    expect(BORDER_WIDTH_OPTIONS).toEqual([0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5]);
    expect(renderFontSize(40, 720)).toBe(29);
    expect(renderFontSize(40, 360)).toBe(14.5);
    expect(renderFontSize(70, 1080)).toBeCloseTo(76.125);
    expect(renderBorderWidth(3, 720)).toBe(2);
    expect(renderBorderWidth(0, 1080)).toBe(0);
    expect(renderBorderWidth(5, 360)).toBeCloseTo(5 / 3);
  });

  it("validates exact complete styles and rejects invalid families", () => {
    expect(isSubtitleTextStyle(DEFAULT_SUBTITLE_TEXT_STYLE)).toBe(true);
    for (const fontFamily of ["", "\u0000Hidden", "x".repeat(257), 42]) {
      expect(isSubtitleTextStyle({ ...DEFAULT_SUBTITLE_TEXT_STYLE, fontFamily })).toBe(false);
    }
    expect(isSubtitleTextStyle({ ...DEFAULT_SUBTITLE_TEXT_STYLE, fontSize: 41 })).toBe(false);
    expect(isSubtitleTextStyle({ ...DEFAULT_SUBTITLE_TEXT_STYLE, borderWidth: 0.75 })).toBe(false);
    expect(isSubtitleTextStyle({ ...DEFAULT_SUBTITLE_TEXT_STYLE, unknown: true })).toBe(false);
  });

  it("falls back invalid stored fields independently without mutating valid fields", () => {
    const normalized = normalizeSubtitleTextStyle({
      fontColor: { r: 1, g: 2, b: 3, a: 4 },
      fontSize: 41,
      fontFamily: "Avenir Next",
      bold: true,
      italic: "yes",
      borderColor: { r: 4, g: 3, b: 2, a: 1 },
      borderWidth: 4,
      backgroundColor: { r: 8, g: 9, b: 10, a: 11 },
    });
    expect(normalized).toEqual({
      fontColor: { r: 1, g: 2, b: 3, a: 4 },
      fontSize: 40,
      fontFamily: "Avenir Next",
      bold: true,
      italic: false,
      borderColor: { r: 4, g: 3, b: 2, a: 1 },
      borderWidth: 4,
      backgroundColor: { r: 8, g: 9, b: 10, a: 11 },
    });
    expect(normalizeSubtitleTextStyle(null)).toEqual(DEFAULT_SUBTITLE_TEXT_STYLE);
    expect(normalizeSubtitleTextStyle([])).toEqual(DEFAULT_SUBTITLE_TEXT_STYLE);
  });

  it("keeps the requested family while deriving a temporary system fallback", () => {
    expect(resolveEffectiveFontFamily(null, "available")).toEqual({
      preferredFamily: null,
      effectiveFamily: null,
      fallbackActive: false,
    });
    expect(resolveEffectiveFontFamily("Avenir Next", "available")).toEqual({
      preferredFamily: "Avenir Next",
      effectiveFamily: "Avenir Next",
      fallbackActive: false,
    });
    expect(resolveEffectiveFontFamily("Avenir Next", "unavailable")).toEqual({
      preferredFamily: "Avenir Next",
      effectiveFamily: null,
      fallbackActive: true,
    });
  });
});
