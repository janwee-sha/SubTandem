export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const FONT_SIZE_OPTIONS = [30, 35, 40, 45, 50, 55, 60, 65, 70] as const;
export const BORDER_WIDTH_OPTIONS = [0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5] as const;

export interface SubtitleTextStyle {
  fontColor: RgbaColor;
  fontSize: number;
  fontFamily: string | null;
  bold: boolean;
  italic: boolean;
  borderColor: RgbaColor;
  borderWidth: number;
  backgroundColor: RgbaColor;
}

export type SubtitleStyleField = keyof SubtitleTextStyle;
export type ColorStyleField = "fontColor" | "borderColor" | "backgroundColor";
export type FontAvailability = "available" | "unavailable" | "unknown";

export interface FontResolution {
  preferredFamily: string | null;
  availability: FontAvailability;
  effectiveFamily: string | null;
  fallbackActive: boolean;
  catalogRevision: number;
}

export const DEFAULT_SUBTITLE_TEXT_STYLE: SubtitleTextStyle = {
  fontColor: { r: 255, g: 255, b: 255, a: 255 },
  fontSize: 40,
  fontFamily: null,
  bold: false,
  italic: false,
  borderColor: { r: 0, g: 0, b: 0, a: 255 },
  borderWidth: 3,
  backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
};

const styleFields = [
  "fontColor",
  "fontSize",
  "fontFamily",
  "bold",
  "italic",
  "borderColor",
  "borderWidth",
  "backgroundColor",
] as const;

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");

const cloneColor = (color: RgbaColor): RgbaColor => ({ ...color });

export function cloneSubtitleTextStyle(style: SubtitleTextStyle): SubtitleTextStyle {
  return {
    ...style,
    fontColor: cloneColor(style.fontColor),
    borderColor: cloneColor(style.borderColor),
    backgroundColor: cloneColor(style.backgroundColor),
  };
}

export function isRgbaColor(value: unknown): value is RgbaColor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const color = value as Record<string, unknown>;
  if (!exactKeys(color, ["r", "g", "b", "a"])) return false;
  return [color.r, color.g, color.b, color.a].every(
    (channel) =>
      Number.isInteger(channel) && (channel as number) >= 0 && (channel as number) <= 255,
  );
}

function hasOnlyPrintableCharacters(value: string): boolean {
  return Array.from(value).every((character) => {
    const code = character.charCodeAt(0);
    return code > 31 && code !== 127;
  });
}

export function isFontFamily(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length >= 1 &&
      value.length <= 256 &&
      hasOnlyPrintableCharacters(value))
  );
}

export function isSubtitleStyleField(value: unknown): value is SubtitleStyleField {
  return typeof value === "string" && (styleFields as readonly string[]).includes(value);
}

export function isColorStyleField(value: unknown): value is ColorStyleField {
  return value === "fontColor" || value === "borderColor" || value === "backgroundColor";
}

export function isSubtitleStyleValue(
  field: SubtitleStyleField,
  value: unknown,
): value is SubtitleTextStyle[SubtitleStyleField] {
  if (field === "fontColor" || field === "borderColor" || field === "backgroundColor")
    return isRgbaColor(value);
  if (field === "fontSize") return (FONT_SIZE_OPTIONS as readonly unknown[]).includes(value);
  if (field === "borderWidth") return (BORDER_WIDTH_OPTIONS as readonly unknown[]).includes(value);
  if (field === "fontFamily") return isFontFamily(value);
  return typeof value === "boolean";
}

export function isSubtitleTextStyle(value: unknown): value is SubtitleTextStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const style = value as Record<string, unknown>;
  if (!exactKeys(style, styleFields)) return false;
  return styleFields.every((field) => isSubtitleStyleValue(field, style[field]));
}

export function normalizeSubtitleTextStyle(value: unknown): SubtitleTextStyle {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return cloneSubtitleTextStyle(DEFAULT_SUBTITLE_TEXT_STYLE);
  const input = value as Record<string, unknown>;
  const normalized = cloneSubtitleTextStyle(DEFAULT_SUBTITLE_TEXT_STYLE);
  for (const field of styleFields) {
    const candidate = input[field];
    if (!isSubtitleStyleValue(field, candidate)) continue;
    if (field === "fontColor" || field === "borderColor" || field === "backgroundColor") {
      normalized[field] = cloneColor(candidate as RgbaColor);
    } else if (field === "fontSize" || field === "borderWidth") {
      normalized[field] = candidate as number;
    } else if (field === "fontFamily") {
      normalized[field] = candidate as string | null;
    } else {
      normalized[field] = candidate as boolean;
    }
  }
  return normalized;
}

export function withSubtitleStyleField<F extends SubtitleStyleField>(
  style: SubtitleTextStyle,
  field: F,
  value: SubtitleTextStyle[F],
): SubtitleTextStyle {
  if (!isSubtitleStyleValue(field, value)) throw new Error("INVALID_SUBTITLE_STYLE_FIELD");
  const nextValue =
    field === "fontColor" || field === "borderColor" || field === "backgroundColor"
      ? cloneColor(value as RgbaColor)
      : value;
  return { ...cloneSubtitleTextStyle(style), [field]: nextValue };
}

export function renderFontSize(size: number, viewportHeight: number): number {
  if (!(FONT_SIZE_OPTIONS as readonly number[]).includes(size) || !validViewport(viewportHeight))
    throw new Error("INVALID_SUBTITLE_STYLE_RENDER_INPUT");
  return size * (29 / 40) * (viewportHeight / 720);
}

export function renderBorderWidth(width: number, viewportHeight: number): number {
  if (
    !(BORDER_WIDTH_OPTIONS as readonly number[]).includes(width) ||
    !validViewport(viewportHeight)
  )
    throw new Error("INVALID_SUBTITLE_STYLE_RENDER_INPUT");
  return width * (2 / 3) * (viewportHeight / 720);
}

function validViewport(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function resolveEffectiveFontFamily(
  preferredFamily: string | null,
  availability: FontAvailability,
): Pick<FontResolution, "preferredFamily" | "effectiveFamily" | "fallbackActive"> {
  if (!isFontFamily(preferredFamily)) throw new Error("INVALID_FONT_FAMILY");
  if (availability !== "available" && availability !== "unavailable" && availability !== "unknown")
    throw new Error("INVALID_FONT_AVAILABILITY");
  return {
    preferredFamily,
    effectiveFamily:
      preferredFamily !== null && availability === "available" ? preferredFamily : null,
    fallbackActive: preferredFamily !== null && availability === "unavailable",
  };
}

export function createFontResolution(
  preferredFamily: string | null,
  availability: FontAvailability = preferredFamily === null ? "available" : "unknown",
  catalogRevision = 0,
): FontResolution {
  if (!Number.isInteger(catalogRevision) || catalogRevision < 0)
    throw new Error("INVALID_FONT_CATALOG_REVISION");
  return {
    ...resolveEffectiveFontFamily(preferredFamily, availability),
    availability,
    catalogRevision,
  };
}
