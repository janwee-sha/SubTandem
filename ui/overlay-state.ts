interface SubTandemOverlayRegion {
  top: number;
  bottom: number;
  marginX: number;
  marginY: number;
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
  strokeWidth: number;
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
  calculateSubTandemOverlayTypography(viewportHeight: number): SubTandemOverlayTypography;
  calculateSubTandemOverlayLayout(input: SubTandemOverlayLayoutInput): SubTandemOverlayLayout;
  createSubTandemOverlayState(): SubTandemOverlayStateCoordinator;
}

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

function calculateSubTandemOverlayTypography(viewportHeight: number): SubTandemOverlayTypography {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0)
    throw new Error("INVALID_OVERLAY_TYPOGRAPHY");
  const scale = viewportHeight / 720;
  return { fontSize: 29 * scale, fontWeight: 400, strokeWidth: 2 * scale };
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
    frame: frame ? { ...frame, lines: [...frame.lines], region: { ...frame.region } } : null,
  });
  const base = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (
      !Number.isInteger(record.renderRevision) ||
      (record.renderRevision as number) <= renderRevision ||
      !validPosition(record.position) ||
      !validRegion(record.region)
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
        Object.keys(record).sort().join(",") !== "lines,position,region,renderRevision" ||
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
      };
      layoutSignature = "";
      return true;
    },
    applyLayout(value: unknown): boolean {
      const record = base(value);
      if (!record || Object.keys(record).sort().join(",") !== "position,region,renderRevision")
        return false;
      renderRevision = record.renderRevision as number;
      if (frame) {
        frame = {
          ...frame,
          renderRevision,
          position: record.position as number,
          region: { ...(record.region as unknown as SubTandemOverlayRegion) },
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
overlayGlobals.calculateSubTandemOverlayLayout = calculateSubTandemOverlayLayout;
overlayGlobals.createSubTandemOverlayState = createSubTandemOverlayState;
