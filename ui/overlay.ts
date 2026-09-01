const translation = document.querySelector<HTMLElement>("#translation")!;
const translationText = document.querySelector<HTMLElement>("#translation-text")!;
const overlayState = window.createSubTandemOverlayState();
let scheduledFrame: number | null = null;

function currentViewportHeight(): number {
  return document.documentElement.clientHeight || window.innerHeight;
}

function safeFontFamily(family: string): string {
  return `"${family.replace(/["\\]/g, "\\$&")}", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif`;
}

function applyTypography(viewportHeight: number): SubTandemOverlayTypography | null {
  const frame = overlayState.snapshot.frame;
  if (!frame) return null;
  const typography = window.calculateSubTandemOverlayTypography(viewportHeight, frame.style);
  translationText.style.fontSize = `${typography.fontSize}px`;
  translationText.style.fontWeight = String(typography.fontWeight);
  translationText.style.fontStyle = typography.fontStyle;
  translationText.style.fontFamily = typography.fontFamily
    ? safeFontFamily(typography.fontFamily)
    : '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
  translationText.style.color = typography.fontColor;
  translationText.style.webkitTextStrokeWidth = `${typography.strokeWidth}px`;
  translationText.style.webkitTextStrokeColor = typography.borderColor;
  translationText.style.padding = `${typography.strokeWidth}px`;
  translationText.style.backgroundColor = typography.backgroundColor;
  translationText.style.textShadow = "none";
  return typography;
}

function applyHorizontalBounds(viewportHeight: number): void {
  const frame = overlayState.snapshot.frame;
  if (!frame) return;
  const horizontalMargin = (frame.region.marginX / 720) * viewportHeight;
  translation.style.left = `${horizontalMargin}px`;
  translation.style.right = `${horizontalMargin}px`;
}

function writeLines(lines: string[]): void {
  translationText.replaceChildren();
  lines.forEach((line, index) => {
    if (index > 0) translationText.append(document.createElement("br"));
    translationText.append(document.createTextNode(line));
  });
  translation.hidden = false;
}

function clearText(): void {
  translationText.replaceChildren();
  translation.hidden = true;
}

function layoutCurrent(): void {
  scheduledFrame = null;
  if (!overlayState.snapshot.frame || translation.hidden) return;
  const viewportHeight = currentViewportHeight();
  const typography = applyTypography(viewportHeight);
  if (!typography) return;
  applyHorizontalBounds(viewportHeight);
  const blockHeight = Math.ceil(
    Math.max(translationText.getBoundingClientRect().height, translationText.scrollHeight),
  );
  if (blockHeight === 0) return;
  const result = overlayState.layout(viewportHeight, blockHeight);
  if (!result?.changed) return;
  translation.style.top = "auto";
  translation.style.bottom = `${viewportHeight - result.layout.bottomAnchor}px`;
  translation.style.left = `${result.layout.horizontalMargin}px`;
  translation.style.right = `${result.layout.horizontalMargin}px`;
}

function scheduleLayout(): void {
  if (scheduledFrame !== null) return;
  scheduledFrame = window.requestAnimationFrame(layoutCurrent);
}

window.iina?.onMessage("overlay:render", (raw: unknown) => {
  if (!overlayState.applyRender(raw)) return;
  const frame = overlayState.snapshot.frame!;
  applyTypography(currentViewportHeight());
  writeLines(frame.lines);
  scheduleLayout();
});

window.iina?.onMessage("overlay:layout", (raw: unknown) => {
  if (!overlayState.applyLayout(raw)) return;
  applyTypography(currentViewportHeight());
  scheduleLayout();
});

window.iina?.onMessage("overlay:clear", (raw: unknown) => {
  if (!overlayState.clear(raw)) return;
  clearText();
});

window.addEventListener("resize", scheduleLayout);
const resizeObserver = new ResizeObserver(scheduleLayout);
resizeObserver.observe(translationText);
const postReady = (): void => window.iina?.postMessage("overlay:ready", {});
window.iina?.onMessage("overlay:initialize", postReady);
postReady();
