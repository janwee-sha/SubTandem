interface SubTandemOverlayRegion {
  top: number;
  bottom: number;
  marginX: number;
  marginY: number;
}

interface SubTandemOverlayRgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface SubTandemOverlayTextStyle {
  fontColor: SubTandemOverlayRgba;
  fontSize: number;
  fontFamily: string | null;
  bold: boolean;
  italic: boolean;
  borderColor: SubTandemOverlayRgba;
  borderWidth: number;
  backgroundColor: SubTandemOverlayRgba;
}

interface SubTandemOverlayLayoutInput {
  viewportHeight: number;
  blockHeight: number;
  position: number;
  region: SubTandemOverlayRegion;
}

interface SubTandemOverlayTypography {
  fontSize: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  strokeWidth: number;
  fontFamily: string | null;
  fontColor: string;
  borderColor: string;
  backgroundColor: string;
}

interface SubTandemOverlayPaintMetrics {
  layoutHeight: number;
  contentOffset: number;
}

interface SubTandemOverlayLayout {
  safeTop: number;
  safeBottom: number;
  bottomAnchor: number;
  topOffset: number;
  horizontalMargin: number;
  signature: string;
}

interface SubTandemOverlayFrame {
  renderRevision: number;
  lines: string[];
  position: number;
  region: SubTandemOverlayRegion;
  style: SubTandemOverlayTextStyle;
}

interface SubTandemOverlayStateCoordinator {
  readonly snapshot: { renderRevision: number; frame: SubTandemOverlayFrame | null };
  applyRender(value: unknown): boolean;
  applyLayout(value: unknown): boolean;
  clear(value: unknown): boolean;
  layout(
    viewportHeight: number,
    blockHeight: number,
  ): {
    changed: boolean;
    layout: SubTandemOverlayLayout;
  } | null;
}

interface Window {
  calculateSubTandemOverlayTypography(
    viewportHeight: number,
    style: SubTandemOverlayTextStyle,
  ): SubTandemOverlayTypography;
  calculateSubTandemOverlayPaintMetrics(
    blockHeight: number,
    strokeWidth: number,
  ): SubTandemOverlayPaintMetrics;
  calculateSubTandemOverlayLayout(input: SubTandemOverlayLayoutInput): SubTandemOverlayLayout;
  createSubTandemOverlayState(): SubTandemOverlayStateCoordinator;
}

const fontSizes = [30, 35, 40, 45, 50, 55, 60, 65, 70];
const borderWidths = [0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5];

function validPosition(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100;
}

function validRegion(value: unknown): value is SubTandemOverlayRegion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const region = value as Record<string, unknown>;
  return (
    Object.keys(region).sort().join(",") === "bottom,marginX,marginY,top" &&
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

function validColor(value: unknown): value is SubTandemOverlayRgba {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const color = value as Record<string, unknown>;
  return (
    Object.keys(color).sort().join(",") === "a,b,g,r" &&
    [color.r, color.g, color.b, color.a].every(
      (channel) =>
        Number.isInteger(channel) && (channel as number) >= 0 && (channel as number) <= 255,
    )
  );
}

function printableFontFamily(value: string): boolean {
  return Array.from(value).every((character) => {
    const code = character.charCodeAt(0);
    return code > 31 && code !== 127;
  });
}

function validStyle(value: unknown): value is SubTandemOverlayTextStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const style = value as Record<string, unknown>;
  return (
    Object.keys(style).sort().join(",") ===
      "backgroundColor,bold,borderColor,borderWidth,fontColor,fontFamily,fontSize,italic" &&
    validColor(style.fontColor) &&
    fontSizes.includes(style.fontSize as number) &&
    (style.fontFamily === null ||
      (typeof style.fontFamily === "string" &&
        style.fontFamily.length >= 1 &&
        style.fontFamily.length <= 256 &&
        printableFontFamily(style.fontFamily))) &&
    typeof style.bold === "boolean" &&
    typeof style.italic === "boolean" &&
    validColor(style.borderColor) &&
    borderWidths.includes(style.borderWidth as number) &&
    validColor(style.backgroundColor)
  );
}

function cloneStyle(style: SubTandemOverlayTextStyle): SubTandemOverlayTextStyle {
  return {
    ...style,
    fontColor: { ...style.fontColor },
    borderColor: { ...style.borderColor },
    backgroundColor: { ...style.backgroundColor },
  };
}

function rgba(color: SubTandemOverlayRgba): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
}

function calculateSubTandemOverlayTypography(
  viewportHeight: number,
  style: SubTandemOverlayTextStyle,
): SubTandemOverlayTypography {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0 || !validStyle(style))
    throw new Error("INVALID_OVERLAY_TYPOGRAPHY");
  const scale = viewportHeight / 720;
  const strokeWidth = style.borderWidth * (2 / 3) * scale;
  return {
    fontSize: style.fontSize * (29 / 40) * scale,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    strokeWidth,
    fontFamily: style.fontFamily,
    fontColor: rgba(style.fontColor),
    borderColor: strokeWidth === 0 ? "transparent" : rgba(style.borderColor),
    backgroundColor: rgba(style.backgroundColor),
  };
}

function calculateSubTandemOverlayPaintMetrics(
  blockHeight: number,
  strokeWidth: number,
): SubTandemOverlayPaintMetrics {
  if (
    !Number.isFinite(blockHeight) ||
    blockHeight < 0 ||
    !Number.isFinite(strokeWidth) ||
    strokeWidth < 0
  )
    throw new Error("INVALID_OVERLAY_PAINT_METRICS");
  return {
    layoutHeight: blockHeight + strokeWidth * 2,
    contentOffset: strokeWidth,
  };
}

function calculateSubTandemOverlayLayout(
  input: SubTandemOverlayLayoutInput,
): SubTandemOverlayLayout {
  if (
    !Number.isFinite(input.viewportHeight) ||
    input.viewportHeight <= 0 ||
    !Number.isFinite(input.blockHeight) ||
    input.blockHeight < 0 ||
    !validPosition(input.position) ||
    !validRegion(input.region)
  )
    throw new Error("INVALID_OVERLAY_LAYOUT");
  const regionHeight = (input.region.bottom - input.region.top) * input.viewportHeight;
  const verticalMargin = Math.min(
    (input.region.marginY / 720) * input.viewportHeight,
    regionHeight / 2,
  );
  const safeTop = input.region.top * input.viewportHeight;
  const safeBottom = input.region.bottom * input.viewportHeight - verticalMargin;
  const rawAnchor = safeTop + ((safeBottom - safeTop) * input.position) / 100;
  const bottomAnchor = Math.min(safeBottom, Math.max(rawAnchor, safeTop + input.blockHeight));
  const topOffset = bottomAnchor - input.blockHeight;
  const horizontalMargin = (input.region.marginX / 720) * input.viewportHeight;
  if (![safeTop, safeBottom, bottomAnchor, topOffset, horizontalMargin].every(Number.isFinite))
    throw new Error("INVALID_OVERLAY_LAYOUT");
  return {
    safeTop,
    safeBottom,
    bottomAnchor,
    topOffset,
    horizontalMargin,
    signature: JSON.stringify([
      input.viewportHeight,
      input.blockHeight,
      input.position,
      input.region.top,
      input.region.bottom,
      input.region.marginX,
      input.region.marginY,
    ]),
  };
}

function createSubTandemOverlayState(): SubTandemOverlayStateCoordinator {
  let renderRevision = -1;
  let frame: SubTandemOverlayFrame | null = null;
  let layoutSignature = "";
  const snapshot = (): { renderRevision: number; frame: SubTandemOverlayFrame | null } => ({
    renderRevision,
    frame: frame
      ? {
          ...frame,
          lines: [...frame.lines],
          region: { ...frame.region },
          style: cloneStyle(frame.style),
        }
      : null,
  });
  const base = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (
      !Number.isInteger(record.renderRevision) ||
      (record.renderRevision as number) <= renderRevision ||
      !validPosition(record.position) ||
      !validRegion(record.region) ||
      !validStyle(record.style)
    )
      return null;
    return record;
  };
  return {
    get snapshot() {
      return snapshot();
    },
    applyRender(value: unknown): boolean {
      const record = base(value);
      if (
        !record ||
        Object.keys(record).sort().join(",") !== "lines,position,region,renderRevision,style" ||
        !Array.isArray(record.lines) ||
        record.lines.length === 0 ||
        record.lines.some((line) => typeof line !== "string" || !line.trim())
      )
        return false;
      renderRevision = record.renderRevision as number;
      frame = {
        renderRevision,
        lines: [...record.lines] as string[],
        position: record.position as number,
        region: { ...(record.region as unknown as SubTandemOverlayRegion) },
        style: cloneStyle(record.style as SubTandemOverlayTextStyle),
      };
      layoutSignature = "";
      return true;
    },
    applyLayout(value: unknown): boolean {
      const record = base(value);
      if (
        !record ||
        Object.keys(record).sort().join(",") !== "position,region,renderRevision,style"
      )
        return false;
      renderRevision = record.renderRevision as number;
      if (frame) {
        frame = {
          ...frame,
          renderRevision,
          position: record.position as number,
          region: { ...(record.region as unknown as SubTandemOverlayRegion) },
          style: cloneStyle(record.style as SubTandemOverlayTextStyle),
        };
      }
      layoutSignature = "";
      return true;
    },
    clear(value: unknown): boolean {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const record = value as Record<string, unknown>;
      const revision = record.renderRevision;
      if (
        Object.keys(record).join(",") !== "renderRevision" ||
        !Number.isInteger(revision) ||
        (revision as number) <= renderRevision
      )
        return false;
      renderRevision = revision as number;
      frame = null;
      layoutSignature = "";
      return true;
    },
    layout(viewportHeight: number, blockHeight: number) {
      if (!frame) return null;
      const layout = calculateSubTandemOverlayLayout({
        viewportHeight,
        blockHeight,
        position: frame.position,
        region: frame.region,
      });
      const changed = layout.signature !== layoutSignature;
      layoutSignature = layout.signature;
      return { changed, layout };
    },
  };
}

const overlayGlobals = globalThis as typeof globalThis & Window;
overlayGlobals.calculateSubTandemOverlayTypography = calculateSubTandemOverlayTypography;
overlayGlobals.calculateSubTandemOverlayPaintMetrics = calculateSubTandemOverlayPaintMetrics;
overlayGlobals.calculateSubTandemOverlayLayout = calculateSubTandemOverlayLayout;
overlayGlobals.createSubTandemOverlayState = createSubTandemOverlayState;
