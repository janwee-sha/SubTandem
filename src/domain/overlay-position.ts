export const DEFAULT_OVERLAY_POSITION = 0;
export const DEFAULT_SUBTITLE_MARGIN_X = 25;
export const DEFAULT_SUBTITLE_MARGIN_Y = 22;

export interface OverlayRegion {
  top: number;
  bottom: number;
  marginX: number;
  marginY: number;
}

export interface OsdDimensions {
  h?: unknown;
  mt?: unknown;
  mb?: unknown;
}

export function isOverlayPosition(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100;
}

function finiteNonNegative(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function normalizeOverlayRegion(input: {
  dimensions?: OsdDimensions;
  fullscreen: boolean;
  useMargins: boolean;
  marginX?: unknown;
  marginY?: unknown;
  marginYOffset?: unknown;
}): OverlayRegion {
  const marginX = finiteNonNegative(input.marginX, DEFAULT_SUBTITLE_MARGIN_X);
  const marginY =
    finiteNonNegative(input.marginY, DEFAULT_SUBTITLE_MARGIN_Y) +
    finiteNonNegative(input.marginYOffset, 0);
  const h = input.dimensions?.h;
  const mt = input.dimensions?.mt;
  const mb = input.dimensions?.mb;
  const validGeometry =
    typeof h === "number" &&
    Number.isFinite(h) &&
    h > 0 &&
    typeof mt === "number" &&
    Number.isFinite(mt) &&
    mt >= 0 &&
    typeof mb === "number" &&
    Number.isFinite(mb) &&
    mb >= 0 &&
    mt + mb < h;
  if (!validGeometry || (input.fullscreen && input.useMargins)) {
    return { top: 0, bottom: 1, marginX, marginY };
  }
  return {
    top: (mt as number) / (h as number),
    bottom: ((h as number) - (mb as number)) / (h as number),
    marginX,
    marginY,
  };
}

export function isOverlayRegion(value: unknown): value is OverlayRegion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const region = value as Record<string, unknown>;
  if (Object.keys(region).sort().join(",") !== "bottom,marginX,marginY,top") return false;
  return (
    typeof region.top === "number" &&
    Number.isFinite(region.top) &&
    region.top >= 0 &&
    region.top <= 1 &&
    typeof region.bottom === "number" &&
    Number.isFinite(region.bottom) &&
    region.bottom >= region.top &&
    region.bottom <= 1 &&
    typeof region.marginX === "number" &&
    Number.isFinite(region.marginX) &&
    region.marginX >= 0 &&
    typeof region.marginY === "number" &&
    Number.isFinite(region.marginY) &&
    region.marginY >= 0
  );
}
